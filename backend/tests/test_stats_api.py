"""HTTP tests for the practice stats and the operational endpoints."""
import asyncio
import datetime
import uuid

import pytest
from fastapi.testclient import TestClient

import app
import models
import reports
import repositories
from auth import AuthenticatedUser, current_user


@pytest.fixture
def client():
    return TestClient(app.app)


def _auth(user_id):
    app.app.dependency_overrides[current_user] = lambda: AuthenticatedUser(user_id=user_id)


def _clear_auth():
    app.app.dependency_overrides.clear()


def _seed(ws_db, user_id, *, minutes=10, days_ago=0, overall=None):
    async def _run():
        async with ws_db() as db:
            session = await repositories.create_session(db, user_id=user_id, scenario="free_talk")
            if days_ago:
                session.started_at = datetime.datetime.now(
                    datetime.timezone.utc
                ) - datetime.timedelta(days=days_ago)
            await repositories.finish_session(
                db, user_id=user_id, session_id=session.id, duration_s=minutes * 60
            )
            if overall is not None and days_ago == 0:
                await repositories.upsert_report(
                    db,
                    user_id=user_id,
                    session_id=session.id,
                    status="ready",
                    rubric_version=reports.RUBRIC_VERSION,
                    metrics={"user_word_count": 100},
                    report={
                        "too_short": False,
                        "scores": {
                            "fluency": 60, "vocabulary": 70, "grammar": 50,
                            "communication": 80, "pace": 90,
                            "pronunciation": None, "overall": overall,
                        },
                    },
                )
            await db.commit()
            return session.id

    return asyncio.run(_run())


def test_stats_requires_auth(client):
    assert client.get("/api/stats").status_code == 401


def test_stats_are_derived_from_existing_rows(client, ws_db):
    user_id = uuid.uuid4()
    _seed(ws_db, user_id, minutes=10, overall=72)
    _seed(ws_db, user_id, minutes=5, days_ago=1)

    _auth(user_id)
    try:
        body = client.get("/api/stats").json()
        assert body["sessions_total"] == 2
        assert body["minutes_total"] == 15
        assert body["streak_days"] == 2
        assert body["latest_overall"] == 72
        assert body["wordbank"]["total"] == 0
        assert body["weekly_goal"] == app.WEEKLY_SESSION_GOAL
    finally:
        _clear_auth()


def test_stats_are_per_user(client, ws_db):
    owner = uuid.uuid4()
    stranger = uuid.uuid4()
    _seed(ws_db, owner, minutes=10)

    _auth(stranger)
    try:
        assert client.get("/api/stats").json()["sessions_total"] == 0
    finally:
        _clear_auth()


def test_readiness_needs_a_database(client, monkeypatch):
    monkeypatch.setattr(app, "AsyncSessionLocal", None)
    response = client.get("/api/ready")
    assert response.status_code == 503
    assert response.json()["database"] == "unconfigured"


def test_readiness_is_ok_with_a_working_database(client, ws_db):
    response = client.get("/api/ready")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["database"] == "ok"


def test_version_endpoint(client):
    body = client.get("/api/version").json()
    assert body["name"] == "LivePrep"
    assert body["version"] == app.APP_VERSION
    assert body["rubric"] == reports.RUBRIC_VERSION


def test_health_stays_minimal_and_responses_are_hardened(client):
    response = client.get("/api/health")
    assert response.json() == {"status": "ok"}
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "SAMEORIGIN"
    assert response.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert len(response.headers["X-Request-Id"]) == 12
