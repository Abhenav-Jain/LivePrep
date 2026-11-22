"""Cost guards (daily minutes, report rebuild budget) and recovery of stuck reports."""
import asyncio
import json
import uuid

import pytest
from fastapi.testclient import TestClient

import app
import models
import repositories
from auth import AuthenticatedUser, current_user
from ratelimit import RateLimitError, SlidingWindowLimiter

ORIGIN = {"origin": "http://localhost:3000"}


class FakeClock:
    def __init__(self, now: float = 1000.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def close_code(ws) -> int:
    for _ in range(10):
        message = ws.receive()
        if message.get("type") == "websocket.close":
            return message["code"]
    raise AssertionError("the socket was not closed")


def close_message(ws) -> str:
    """The JSON error message the server sent before closing, if any."""
    for _ in range(10):
        message = ws.receive()
        if message.get("text"):
            payload = json.loads(message["text"])
            if payload.get("type") == "error":
                return payload.get("message") or ""
        if message.get("type") == "websocket.close":
            return ""
    return ""


# --------------------------------------------------------------------------- #
# The limiter itself
# --------------------------------------------------------------------------- #
def test_limiter_allows_its_budget_then_refuses():
    clock = FakeClock()
    limiter = SlidingWindowLimiter(max_events=2, window_s=60, clock=clock)

    limiter.hit("alice")
    limiter.hit("alice")
    with pytest.raises(RateLimitError) as excinfo:
        limiter.hit("alice")
    assert 1 <= excinfo.value.retry_after_s <= 60


def test_limiter_frees_the_budget_when_the_window_slides():
    clock = FakeClock()
    limiter = SlidingWindowLimiter(max_events=1, window_s=60, clock=clock)

    limiter.hit("alice")
    with pytest.raises(RateLimitError):
        limiter.hit("alice")
    clock.advance(61)
    limiter.hit("alice")  # the first attempt is now outside the window
    assert limiter.remaining("alice") == 0


def test_limiter_keeps_keys_separate():
    limiter = SlidingWindowLimiter(max_events=1, window_s=60, clock=FakeClock())

    limiter.hit("alice")
    limiter.hit("bob")  # bob has his own budget


def test_zero_max_events_disables_the_limit():
    limiter = SlidingWindowLimiter(max_events=0, window_s=60, clock=FakeClock())

    for _ in range(50):
        limiter.hit("alice")  # never raises
    assert limiter.remaining("alice") is None


# --------------------------------------------------------------------------- #
# Daily practice minutes
# --------------------------------------------------------------------------- #
@pytest.fixture
def client():
    return TestClient(app.app)


def _login(user_id):
    app.app.dependency_overrides[current_user] = lambda: AuthenticatedUser(user_id=user_id)


@pytest.fixture(autouse=True)
def _clear_auth():
    yield
    app.app.dependency_overrides.clear()


def _seed_duration(ws_db, user_id, seconds, *, status_value="completed", scenario="mixed"):
    """A finished session worth `seconds` of practice today."""

    async def _run():
        async with ws_db() as db:
            session = await repositories.create_session(db, user_id=user_id, scenario=scenario)
            await repositories.finish_session(
                db, user_id=user_id, session_id=session.id,
                duration_s=seconds, status=status_value,
            )
            await db.commit()
            return session.id

    return asyncio.run(_run())


def test_me_reports_todays_usage(client, ws_db, monkeypatch):
    monkeypatch.setattr(app, "DAILY_MINUTES_LIMIT", 30)
    user_id = uuid.uuid4()
    _seed_duration(ws_db, user_id, 600)  # 10 minutes
    _login(user_id)

    body = client.get("/api/me").json()

    assert body["usage"] == {
        "limit_minutes": 30,
        "used_minutes": 10,
        "used_seconds": 600,
        "remaining_minutes": 20,
    }


def test_me_reports_no_limit_when_disabled(client, ws_db, monkeypatch):
    monkeypatch.setattr(app, "DAILY_MINUTES_LIMIT", 0)
    user_id = uuid.uuid4()
    _seed_duration(ws_db, user_id, 600)
    _login(user_id)

    body = client.get("/api/me").json()

    assert body["usage"]["limit_minutes"] is None
    assert body["usage"]["remaining_minutes"] is None
    assert body["usage"]["used_seconds"] == 600


def test_call_is_refused_when_the_daily_minutes_are_used(client, ws_db, monkeypatch, make_ticket):
    monkeypatch.setattr(app, "DAILY_MINUTES_LIMIT", 30)
    user_id = uuid.uuid4()
    _seed_duration(ws_db, user_id, 30 * 60)
    ticket = make_ticket(user_id)

    with client.websocket_connect("/ws/live", headers=ORIGIN) as ws:
        ws.send_json({"type": "auth", "ticket": ticket})
        assert "minutes" in close_message(ws)
        assert close_code(ws) == 1008
    assert app.ACTIVE_USERS == set()


def test_call_is_allowed_below_the_limit(client, ws_db, monkeypatch, make_ticket):
    monkeypatch.setattr(app, "DAILY_MINUTES_LIMIT", 30)
    user_id = uuid.uuid4()
    _seed_duration(ws_db, user_id, 29 * 60)
    ticket = make_ticket(user_id)

    async def quick_session(self, ws_send, ws_receive):
        await ws_send({"type": "session_status", "status": "connected"})

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("gemini_live.GeminiLiveBridge.run_session", quick_session)
        with client.websocket_connect("/ws/live", headers=ORIGIN) as ws:
            ws.send_json({"type": "auth", "ticket": ticket})
            for _ in range(10):
                message = ws.receive_json()
                if message.get("type") == "session_status":
                    break
            else:
                raise AssertionError("the session never started")
            ws.send_text("bye")
            assert close_code(ws) == 1000


# --------------------------------------------------------------------------- #
# Report rebuild budget
# --------------------------------------------------------------------------- #
def test_report_retry_is_rate_limited(client, ws_db, monkeypatch):
    user_id = uuid.uuid4()
    session_id = _seed_duration(ws_db, user_id, 120)
    _login(user_id)
    monkeypatch.setattr(
        app, "REPORT_RETRY_LIMITER", SlidingWindowLimiter(max_events=1, window_s=600, clock=FakeClock())
    )

    async def fake_pipeline(**_kwargs):
        return "failed"

    monkeypatch.setattr(app, "run_report_pipeline", fake_pipeline)

    assert client.post(f"/api/sessions/{session_id}/report/retry").status_code == 200
    second = client.post(f"/api/sessions/{session_id}/report/retry")
    assert second.status_code == 429
    assert "Retry-After" in second.headers


def test_report_retry_of_a_foreign_session_spends_no_budget(client, ws_db, monkeypatch):
    _login(uuid.uuid4())
    limiter = SlidingWindowLimiter(max_events=1, window_s=600, clock=FakeClock())
    monkeypatch.setattr(app, "REPORT_RETRY_LIMITER", limiter)
    other_user = uuid.uuid4()
    foreign = _seed_duration(ws_db, other_user, 120)

    assert client.post(f"/api/sessions/{foreign}/report/retry").status_code == 404
    assert limiter.remaining(uuid.uuid4()) == 1  # nothing consumed by the 404


# --------------------------------------------------------------------------- #
# Restart recovery
# --------------------------------------------------------------------------- #
def _seed_report(ws_db, user_id, session_id, status_value="pending"):
    async def _run():
        async with ws_db() as db:
            await repositories.upsert_report(
                db, user_id=user_id, session_id=session_id, status=status_value, rubric_version="v1"
            )
            await db.commit()

    asyncio.run(_run())


def test_recovery_reschedules_a_report_left_pending(ws_db, monkeypatch):
    user_id = uuid.uuid4()
    session_id = _seed_duration(ws_db, user_id, 300)
    _seed_report(ws_db, user_id, session_id)
    scheduled = []
    monkeypatch.setattr(app, "_schedule_report", lambda u, s: scheduled.append((u, s)))

    asyncio.run(app._recover_pending_reports())

    assert scheduled == [(user_id, session_id)]


def test_recovery_ignores_ready_reports_and_live_sessions(ws_db, monkeypatch):
    user_id = uuid.uuid4()
    finished = _seed_duration(ws_db, user_id, 300)
    _seed_report(ws_db, user_id, finished, status_value="ready")

    live_user = uuid.uuid4()

    async def _live():
        async with ws_db() as db:
            session = await repositories.create_session(db, user_id=live_user, scenario="mixed")
            await repositories.upsert_report(
                db, user_id=live_user, session_id=session.id, status="pending", rubric_version="v1"
            )
            await db.commit()

    asyncio.run(_live())
    scheduled = []
    monkeypatch.setattr(app, "_schedule_report", lambda u, s: scheduled.append((u, s)))

    asyncio.run(app._recover_pending_reports())

    assert scheduled == []


def test_recovery_is_quiet_without_a_database(monkeypatch):
    monkeypatch.setattr(app, "AsyncSessionLocal", None)

    asyncio.run(app._recover_pending_reports())  # must not raise
