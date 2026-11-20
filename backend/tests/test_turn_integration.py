"""Integration tests for Step 5A: turn assembly and persistence in live WebSocket flow.

Covers:
- `session_started` is sent immediately after authentication
- Turns are saved with correct user_id, session_id, idx, speaker
- Turns are flushed and saved before the session status becomes final
- A failing sink does not crash or end the call
"""
import json
import uuid
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

import app
import models


ORIGIN = {"origin": "http://localhost:3000"}


@pytest.fixture
def client():
    return TestClient(app.app)


def test_session_started_message_sent_first(client, ws_db, make_ticket):
    """The client receives {"type":"session_started","session_id":"<uuid>"} as the first message."""
    user_id = uuid.uuid4()

    async def fake_session(self, ws_send, ws_receive):
        await ws_send({"type": "session_status", "status": "connected"})

    with patch("app.GeminiLiveBridge.run_session", new=fake_session):
        with client.websocket_connect("/ws/live", headers=ORIGIN) as ws:
            ws.send_json({"type": "auth", "ticket": make_ticket(user_id)})
            msg1 = ws.receive_json()
            assert msg1["type"] == "session_started"
            sid = uuid.UUID(msg1["session_id"])
            assert sid is not None

            msg2 = ws.receive_json()
            assert msg2["type"] == "session_status"
            assert msg2["status"] == "connected"


def test_turns_saved_with_correct_metadata_and_ordering(client, ws_db, make_ticket):
    """Turns emitted by the assembler are saved to the database with user_id, session_id, idx."""
    user_id = uuid.uuid4()
    captured_session_id = []

    async def talking_session(self, ws_send, ws_receive):
        captured_session_id.append(uuid.UUID(self.session_id))
        # Feed fragments through the assembler attached to bridge
        self._assembler.add_fragment("user", "Hello")
        self._assembler.add_fragment("user", " world")
        await self._assembler.end_turn()

        self._assembler.add_fragment("agent", "Hi there,")
        self._assembler.add_fragment("agent", " welcome to LivePrep!")
        await self._assembler.end_turn()

    with patch("app.GeminiLiveBridge.run_session", new=talking_session):
        with client.websocket_connect("/ws/live", headers=ORIGIN) as ws:
            ws.send_json({"type": "auth", "ticket": make_ticket(user_id)})
            # drain messages
            while True:
                msg = ws.receive()
                if msg["type"] == "websocket.close":
                    assert msg["code"] == 1000
                    break

    assert len(captured_session_id) == 1
    session_id = captured_session_id[0]

    # Verify rows in database
    import asyncio
    async def _check():
        async with ws_db() as db:
            result = await db.execute(
                select(models.Turn).where(models.Turn.session_id == session_id).order_by(models.Turn.idx)
            )
            turns = list(result.scalars())
            assert len(turns) == 2

            assert turns[0].user_id == user_id
            assert turns[0].session_id == session_id
            assert turns[0].idx == 0
            assert turns[0].speaker == "user"
            assert turns[0].text == "Hello world"

            assert turns[1].user_id == user_id
            assert turns[1].session_id == session_id
            assert turns[1].idx == 1
            assert turns[1].speaker == "agent"
            assert turns[1].text == "Hi there, welcome to LivePrep!"

            # Session should be marked completed
            sess_res = await db.execute(select(models.Session).where(models.Session.id == session_id))
            sess = sess_res.scalar_one()
            assert sess.status == "completed"

    asyncio.run(_check())


def test_failing_sink_does_not_crash_call(client, ws_db, make_ticket, caplog):
    """If saving a turn fails in the DB, the live call continues without crashing."""
    user_id = uuid.uuid4()

    async def session_with_failing_sink(self, ws_send, ws_receive):
        # Force add_turn to fail by passing broken DB or patch
        self._assembler.add_fragment("user", "Testing turn")
        await self._assembler.end_turn()
        await ws_send({"type": "session_status", "status": "still_connected"})

    with patch("app.GeminiLiveBridge.run_session", new=session_with_failing_sink), \
         patch("app.add_turn", side_effect=RuntimeError("db constraint error")):
        with client.websocket_connect("/ws/live", headers=ORIGIN) as ws:
            ws.send_json({"type": "auth", "ticket": make_ticket(user_id)})
            # session_started
            msg1 = ws.receive_json()
            assert msg1["type"] == "session_started"
            # drain until close, verifying still_connected was received
            received_statuses = []
            while True:
                msg = ws.receive()
                if msg["type"] == "websocket.close":
                    assert msg["code"] == 1000
                    break
                parsed = json.loads(msg["text"])
                if parsed.get("status"):
                    received_statuses.append(parsed["status"])
            assert "still_connected" in received_statuses
