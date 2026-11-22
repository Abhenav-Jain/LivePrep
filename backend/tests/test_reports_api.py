"""HTTP tests for Step 6 endpoints: report, retry, progress, and the sessions list fields."""
import asyncio
import uuid

import pytest
from fastapi.testclient import TestClient

import app
import models
import repositories
import reports
from auth import AuthenticatedUser, current_user


@pytest.fixture
def client():
    return TestClient(app.app)


def _auth(user_id):
    app.app.dependency_overrides[current_user] = lambda: AuthenticatedUser(user_id=user_id)


def _clear_auth():
    app.app.dependency_overrides.clear()


def _analysis(**overrides):
    data = {
        "scores": {"fluency": 60, "vocabulary": 70, "grammar": 50, "communication": 80, "pace": 90},
        "estimated_cefr": "B1",
        "summary": "Clear answers, add measurable results.",
        "strengths": ["Clear structure", "Good examples", "Calm tone"],
        "grammar_mistakes": [],
        "words_to_upgrade": [],
        "interview_feedback": {
            "relevance": 75, "structure": 70, "confidence": 65, "comments": "Use STAR.",
        },
        "action_plan": [
            {"step": f"Step {i}", "daily_exercise": "Practise 5 minutes"} for i in range(1, 6)
        ],
        "next_session_focus": "Add results to stories.",
    }
    data.update(overrides)
    return reports.ReportAnalysis.model_validate(data)


def _seed_session(ws_db, user_id, *, scenario="technical", status_value="completed"):
    async def _run():
        async with ws_db() as db:
            session = await repositories.create_session(db, user_id=user_id, scenario=scenario)
            await repositories.add_turn(
                db, user_id=user_id, session_id=session.id, idx=0,
                speaker="user",
                text=(
                    "I led a small project last year and we shipped the first version early, "
                    "then I measured the results and improved the onboarding flow for new users. "
                    "I also ran weekly reviews with stakeholders and documented every decision "
                    "in a short written summary for the whole team."
                ),
                started_at_ms=0, ended_at_ms=12_000,
            )
            await repositories.finish_session(
                db, user_id=user_id, session_id=session.id, duration_s=30, status=status_value,
            )
            await db.commit()
            return session.id
    return asyncio.run(_run())


def _store_report(ws_db, user_id, session_id, *, status_value="ready", overall=70, minutes_ago=0):
    import datetime

    async def _run():
        async with ws_db() as db:
            payload = None
            if status_value == "ready":
                payload = {
                    "rubric_version": reports.RUBRIC_VERSION,
                    "too_short": False,
                    "scores": {
                        "fluency": 60, "vocabulary": 70, "grammar": 50,
                        "communication": 80, "pace": 90,
                        "pronunciation": None, "overall": overall,
                    },
                    "metrics": {"user_word_count": 40},
                }
            await repositories.upsert_report(
                db, user_id=user_id, session_id=session_id, status=status_value,
                rubric_version=reports.RUBRIC_VERSION, metrics={"user_word_count": 40},
                report=payload, error=None if status_value == "ready" else "boom",
            )
            await db.commit()
    asyncio.run(_run())


def test_report_endpoints_require_auth(client):
    sid = "00000000-0000-0000-0000-000000000000"
    assert client.get(f"/api/sessions/{sid}/report").status_code == 401
    assert client.post(f"/api/sessions/{sid}/report/retry").status_code == 401
    assert client.get("/api/progress").status_code == 401


def test_foreign_and_missing_reports_are_identical_404(client, ws_db):
    owner = uuid.uuid4()
    stranger = uuid.uuid4()
    sid = _seed_session(ws_db, owner)

    _auth(stranger)
    try:
        foreign = client.get(f"/api/sessions/{sid}/report")
        missing = client.get(f"/api/sessions/{uuid.uuid4()}/report")
        invalid = client.get("/api/sessions/not-a-uuid/report")
        assert foreign.status_code == missing.status_code == invalid.status_code == 404
        assert foreign.json() == missing.json() == invalid.json()

        # Retry must not let a stranger trigger generation either.
        assert client.post(f"/api/sessions/{sid}/report/retry").status_code == 404
    finally:
        _clear_auth()


def test_report_is_missing_until_generated(client, ws_db):
    user_id = uuid.uuid4()
    sid = _seed_session(ws_db, user_id)

    _auth(user_id)
    try:
        r = client.get(f"/api/sessions/{sid}/report")
        assert r.status_code == 200
        body = r.json()
        # The call is finished and no row exists: the client can offer "Generate report".
        assert body["status"] == "missing"
        assert body["report"] is None
        assert body["metrics"] is None
        assert body["rubric_version"] == reports.RUBRIC_VERSION
        assert body["previous"] is None
    finally:
        _clear_auth()


def test_ready_report_includes_scores_and_previous(client, ws_db):
    user_id = uuid.uuid4()
    older = _seed_session(ws_db, user_id)
    newer = _seed_session(ws_db, user_id)

    # Older session is reported; force ordering by setting its started_at backwards.
    async def _backdate():
        import datetime
        async with ws_db() as db:
            sess = await repositories.get_session(db, user_id=user_id, session_id=older)
            sess.started_at = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=1)
            await db.commit()
    asyncio.run(_backdate())

    _store_report(ws_db, user_id, older, overall=55)
    _store_report(ws_db, user_id, newer, overall=70)

    _auth(user_id)
    try:
        r = client.get(f"/api/sessions/{newer}/report")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "ready"
        assert body["report"]["scores"]["overall"] == 70
        assert body["previous"]["scores"]["overall"] == 55
    finally:
        _clear_auth()


def test_retry_regenerates_a_failed_report(client, ws_db, monkeypatch):
    user_id = uuid.uuid4()
    sid = _seed_session(ws_db, user_id)
    _store_report(ws_db, user_id, sid, status_value="failed")

    async def fake_analyze(**kwargs):
        return _analysis()

    monkeypatch.setattr(reports, "analyze_transcript", fake_analyze)
    monkeypatch.setenv("REPORT_MODEL", "test-text-model")

    _auth(user_id)
    try:
        r = client.post(f"/api/sessions/{sid}/report/retry")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "ready"
        assert body["report"]["scores"]["overall"] == 70
    finally:
        _clear_auth()


def test_progress_lists_only_scored_reports_newest_first(client, ws_db):
    user_id = uuid.uuid4()
    other = uuid.uuid4()
    s1 = _seed_session(ws_db, user_id)
    s2 = _seed_session(ws_db, user_id)
    s_short = _seed_session(ws_db, user_id)
    s_other = _seed_session(ws_db, other)

    _store_report(ws_db, user_id, s1, overall=50)
    _store_report(ws_db, user_id, s2, overall=80)
    _store_report(ws_db, user_id, s_short, overall=99)
    _store_report(ws_db, other, s_other, overall=10)

    # Turn the third report into a "too short" one: ready but no scores -> excluded.
    async def _too_short():
        async with ws_db() as db:
            await repositories.upsert_report(
                db, user_id=user_id, session_id=s_short, status="ready",
                rubric_version=reports.RUBRIC_VERSION,
                metrics={"user_word_count": 3},
                report={"rubric_version": reports.RUBRIC_VERSION, "too_short": True, "scores": None},
            )
            await db.commit()
    asyncio.run(_too_short())

    _auth(user_id)
    try:
        r = client.get("/api/progress")
        assert r.status_code == 200
        rows = r.json()["reports"]
        assert len(rows) == 2  # too-short and other users' reports excluded
        assert [row["scores"]["overall"] for row in rows] == [80, 50]
        assert all(row["session_id"] in {str(s1), str(s2)} for row in rows)
    finally:
        _clear_auth()


def test_sessions_list_exposes_report_status_and_score(client, ws_db):
    user_id = uuid.uuid4()
    sid = _seed_session(ws_db, user_id)
    _store_report(ws_db, user_id, sid, overall=66)

    _auth(user_id)
    try:
        r = client.get("/api/sessions")
        assert r.status_code == 200
        row = r.json()["sessions"][0]
        assert row["report_status"] == "ready"
        assert row["overall_score"] == 66
    finally:
        _clear_auth()


def test_pending_report_row_is_visible(client, ws_db):
    user_id = uuid.uuid4()
    sid = _seed_session(ws_db, user_id)

    async def _pending():
        async with ws_db() as db:
            await repositories.upsert_report(
                db, user_id=user_id, session_id=sid, status="pending",
                rubric_version=reports.RUBRIC_VERSION,
            )
            await db.commit()
    asyncio.run(_pending())

    _auth(user_id)
    try:
        body = client.get(f"/api/sessions/{sid}/report").json()
        assert body["status"] == "pending"
        assert body["error"] is None
    finally:
        _clear_auth()
