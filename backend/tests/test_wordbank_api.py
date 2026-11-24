"""HTTP tests for /api/wordbank and the automatic cards created by a report."""
import asyncio
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


def _add(client, term, alternatives=None, note=None):
    return client.post(
        "/api/wordbank",
        json={"term": term, "alternatives": alternatives or [], "note": note},
    )


def test_wordbank_requires_auth(client):
    assert client.get("/api/wordbank").status_code == 401
    assert client.post("/api/wordbank", json={"term": "however"}).status_code == 401
    assert client.post("/api/wordbank/1/review", json={"result": "good"}).status_code == 401
    assert client.delete("/api/wordbank/1").status_code == 401


def test_add_list_review_and_delete(client, ws_db):
    user_id = uuid.uuid4()
    _auth(user_id)
    try:
        created = _add(client, "  good ", ["excellent", "solid"], note="use a precise word")
        assert created.status_code == 200
        body = created.json()
        assert body["created"] is True
        assert body["item"]["term"] == "good"
        assert body["item"]["status"] == "new"
        assert body["item"]["due"] is True
        item_id = body["item"]["id"]

        listing = client.get("/api/wordbank").json()
        assert listing["summary"] == {"total": 1, "due": 1, "new": 1, "learning": 0, "mastered": 0}
        assert len(listing["items"]) == 1
        assert "review" in listing["hint"].lower()

        reviewed = client.post(f"/api/wordbank/{item_id}/review", json={"result": "good"})
        assert reviewed.status_code == 200
        item = reviewed.json()["item"]
        assert item["status"] == "learning"
        assert item["interval_days"] == 1
        assert item["review_count"] == 1
        assert item["due"] is False
        assert reviewed.json()["summary"]["due"] == 0

        assert client.get("/api/wordbank?due_only=true").json()["items"] == []

        deleted = client.delete(f"/api/wordbank/{item_id}")
        assert deleted.status_code == 200
        assert client.get("/api/wordbank").json()["summary"]["total"] == 0
    finally:
        _clear_auth()


def test_duplicate_word_returns_the_existing_card(client, ws_db):
    user_id = uuid.uuid4()
    _auth(user_id)
    try:
        first = _add(client, "actually").json()
        second = _add(client, "Actually").json()
        assert second["created"] is False
        assert second["item"]["id"] == first["item"]["id"]
        assert client.get("/api/wordbank").json()["summary"]["total"] == 1
    finally:
        _clear_auth()


def test_validation_and_bad_review_results(client, ws_db):
    user_id = uuid.uuid4()
    _auth(user_id)
    try:
        assert _add(client, "   ").status_code == 422
        assert _add(client, "x" * 200).status_code == 422
        card = _add(client, "however").json()["item"]
        assert client.post(
            f"/api/wordbank/{card['id']}/review", json={"result": "perfect"}
        ).status_code == 422
        assert client.post(
            f"/api/wordbank/{card['id']}/review", json={"result": "good", "extra": 1}
        ).status_code == 422
    finally:
        _clear_auth()


def test_foreign_card_is_indistinguishable_from_a_missing_one(client, ws_db):
    owner = uuid.uuid4()
    stranger = uuid.uuid4()
    _auth(owner)
    card_id = _add(client, "however").json()["item"]["id"]

    _auth(stranger)
    try:
        foreign = client.post(f"/api/wordbank/{card_id}/review", json={"result": "good"})
        missing = client.post("/api/wordbank/999999/review", json={"result": "good"})
        assert foreign.status_code == missing.status_code == 404
        assert foreign.json() == missing.json()
        assert client.delete(f"/api/wordbank/{card_id}").status_code == 404
        assert client.get("/api/wordbank").json()["summary"]["total"] == 0
    finally:
        _clear_auth()


def _analysis():
    report = {
        "scores": {"fluency": 60, "vocabulary": 70, "grammar": 50, "communication": 80, "pace": 90},
        "estimated_cefr": "B1",
        "summary": "Good flow.",
        "strengths": ["Clear", "Calm", "Structured"],
        "grammar_mistakes": [
            {"said": "I has a plan", "better": "I have a plan", "rule": "subject-verb agreement"}
        ],
        "words_to_upgrade": [{"used": "good", "alternatives": ["excellent"]}],
        "communication_feedback": {"clarity": 70, "structure": 65, "confidence": 60, "comments": "Clear."},
        "action_plan": [{"step": f"Step {i}", "daily_exercise": "Practise"} for i in range(1, 6)],
        "next_session_focus": "Past tense.",
    }
    return reports.ReportAnalysis.model_validate(report)


def test_finished_report_fills_the_word_bank(client, ws_db, monkeypatch):
    user_id = uuid.uuid4()

    async def _seed():
        async with ws_db() as db:
            session = await repositories.create_session(db, user_id=user_id, scenario="free_talk")
            await repositories.add_turn(
                db, user_id=user_id, session_id=session.id, idx=0, speaker="user",
                text=(
                    "I has a plan and I think it is good for the team and everyone else here, "
                    "because last month we worked on a small project and the first version "
                    "shipped early, then we measured the results and improved the onboarding "
                    "flow for new users, and I wrote a short summary for the whole team."
                ),
                started_at_ms=0, ended_at_ms=10_000,
            )
            await repositories.finish_session(
                db, user_id=user_id, session_id=session.id, duration_s=60
            )
            await db.commit()
            return session.id
    session_id = asyncio.run(_seed())

    async def fake_analyze(**kwargs):
        return _analysis()

    monkeypatch.setattr(reports, "analyze_transcript", fake_analyze)
    monkeypatch.setenv("REPORT_MODEL", "test-text-model")

    result = asyncio.run(
        reports.run_report_pipeline(user_id=user_id, session_id=session_id, session_factory=ws_db)
    )
    assert result == "ready"

    _auth(user_id)
    try:
        listing = client.get("/api/wordbank").json()
        terms = {item["term"] for item in listing["items"]}
        assert terms == {"good", "I has a plan"}
        assert listing["summary"]["total"] == 2
        grammar = next(i for i in listing["items"] if i["source"] == "grammar")
        assert grammar["alternatives"] == ["I have a plan"]
        assert grammar["note"] == "subject-verb agreement"
        assert grammar["session_id"] == str(session_id)
    finally:
        _clear_auth()

    # Rebuilding the report must not duplicate cards.
    asyncio.run(
        reports.run_report_pipeline(user_id=user_id, session_id=session_id, session_factory=ws_db)
    )
    _auth(user_id)
    try:
        assert client.get("/api/wordbank").json()["summary"]["total"] == 2
    finally:
        _clear_auth()
