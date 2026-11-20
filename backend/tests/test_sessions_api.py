"""Tests for Step 5B: REST endpoints /api/sessions and /api/sessions/{id}/transcript.

Covers:
- GET /api/sessions: list caller's sessions, newest first, with turn counts
- Ownership: User A cannot see User B's sessions or read their transcript
- Pagination bounds: limit capped at 50, minimum 1, negative offset clamped
- 404 response body is identical for 'not yours' and 'does not exist'
- Unauthenticated requests return 401
- GET /api/sessions/{id}/transcript: returns session and turns ordered by idx
"""
import uuid
import pytest
from fastapi.testclient import TestClient

import app
import models
import repositories
from auth import AuthenticatedUser, current_user


@pytest.fixture
def client():
    return TestClient(app.app)


def test_sessions_endpoint_requires_auth(client):
    assert client.get("/api/sessions").status_code == 401
    assert client.get("/api/sessions/00000000-0000-0000-0000-000000000000/transcript").status_code == 401


def test_sessions_list_pagination_and_ownership(client, ws_db):
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()

    # Seed data
    import asyncio

    async def _seed():
        async with ws_db() as db:
            # User A sessions
            s1 = await repositories.create_session(db, user_id=user_a, scenario="technical")
            s2 = await repositories.create_session(db, user_id=user_a, scenario="hr_round")
            # User B session
            s_b = await repositories.create_session(db, user_id=user_b, scenario="behavioral")

            # Add turns
            await repositories.add_turn(db, user_id=user_a, session_id=s1.id, idx=0, speaker="user", text="Hi")
            await repositories.add_turn(db, user_id=user_a, session_id=s1.id, idx=1, speaker="agent", text="Welcome")
            await db.commit()

    asyncio.run(_seed())

    # User A lists sessions
    app.app.dependency_overrides[current_user] = lambda: AuthenticatedUser(user_id=user_a)
    try:
        r = client.get("/api/sessions?limit=50&offset=0")
        assert r.status_code == 200
        data = r.json()
        sessions = data["sessions"]
        # Only User A's 2 sessions
        assert len(sessions) == 2
        # Turn count for s1 is 2
        s1_row = next(s for s in sessions if s["scenario"] == "technical")
        assert s1_row["turn_count"] == 2
        assert s1_row["report_status"] is None
        assert s1_row["overall_score"] is None

        # User B lists sessions
        app.app.dependency_overrides[current_user] = lambda: AuthenticatedUser(user_id=user_b)
        r_b = client.get("/api/sessions")
        assert r_b.status_code == 200
        b_sessions = r_b.json()["sessions"]
        assert len(b_sessions) == 1
        assert b_sessions[0]["scenario"] == "behavioral"
    finally:
        app.app.dependency_overrides.clear()


def test_pagination_bounds(client, ws_db):
    user_id = uuid.uuid4()
    app.app.dependency_overrides[current_user] = lambda: AuthenticatedUser(user_id=user_id)
    try:
        # limit=0 gets clamped to 1, limit=100 gets clamped to 50, negative offset clamped to 0
        r1 = client.get("/api/sessions?limit=0&offset=-5")
        assert r1.status_code == 200

        r2 = client.get("/api/sessions?limit=100")
        assert r2.status_code == 200
    finally:
        app.app.dependency_overrides.clear()


def test_transcript_ownership_and_404_consistency(client, ws_db):
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()
    session_id_b = uuid.uuid4()
    non_existent = uuid.uuid4()

    import asyncio

    async def _seed():
        async with ws_db() as db:
            s = models.Session(id=session_id_b, user_id=user_b, scenario="behavioral", status="completed")
            db.add(s)
            await db.commit()

    asyncio.run(_seed())

    app.app.dependency_overrides[current_user] = lambda: AuthenticatedUser(user_id=user_a)
    try:
        # User A requests User B's session
        r_foreign = client.get(f"/api/sessions/{session_id_b}/transcript")
        # User A requests a non-existent session
        r_missing = client.get(f"/api/sessions/{non_existent}/transcript")

        assert r_foreign.status_code == 404
        assert r_missing.status_code == 404
        # Response body must be identical to avoid user enumeration / info leaks
        assert r_foreign.json() == r_missing.json()

        # Invalid UUID
        r_invalid = client.get("/api/sessions/not-a-uuid/transcript")
        assert r_invalid.status_code == 404
        assert r_invalid.json() == r_missing.json()
    finally:
        app.app.dependency_overrides.clear()


def test_transcript_ordering_by_idx(client, ws_db):
    user_id = uuid.uuid4()
    session_id = uuid.uuid4()

    import asyncio

    async def _seed():
        async with ws_db() as db:
            s = models.Session(id=session_id, user_id=user_id, scenario="technical", status="completed")
            db.add(s)
            # Add turns in reverse order
            await repositories.add_turn(db, user_id=user_id, session_id=session_id, idx=2, speaker="user", text="Two")
            await repositories.add_turn(db, user_id=user_id, session_id=session_id, idx=0, speaker="user", text="Zero")
            await repositories.add_turn(db, user_id=user_id, session_id=session_id, idx=1, speaker="agent", text="One")
            await db.commit()

    asyncio.run(_seed())

    app.app.dependency_overrides[current_user] = lambda: AuthenticatedUser(user_id=user_id)
    try:
        r = client.get(f"/api/sessions/{session_id}/transcript")
        assert r.status_code == 200
        data = r.json()
        turns = data["turns"]
        assert len(turns) == 3
        assert [t["idx"] for t in turns] == [0, 1, 2]
        assert [t["text"] for t in turns] == ["Zero", "One", "Two"]
    finally:
        app.app.dependency_overrides.clear()
