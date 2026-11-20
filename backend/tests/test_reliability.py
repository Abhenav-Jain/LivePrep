import os
import json
import asyncio
from unittest.mock import AsyncMock, patch
import pytest
from fastapi.testclient import TestClient

import app
from gemini_live import GeminiLiveBridge, GoAwayReconnect


def test_reconnect_after_exception():
    """Verify that when an exception occurs mid-session, run_session retries reconnecting."""
    bridge = GeminiLiveBridge(api_key="test_key")

    call_count = 0
    sent_messages = []

    async def fake_run_single(ws_send, ws_receive):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise ConnectionResetError("Simulated socket drop")
        # Second attempt succeeds and closes session
        bridge._session_closed = True

    async def fake_ws_send(data):
        sent_messages.append(data)

    async def fake_ws_receive():
        return None

    async def runner():
        with patch.object(bridge, "_run_single_session", side_effect=fake_run_single):
            await bridge.run_session(ws_send=fake_ws_send, ws_receive=fake_ws_receive)

    asyncio.run(runner())

    assert call_count == 2
    # Verify client was notified about reconnecting
    reconnect_status = [m for m in sent_messages if m.get("type") == "session_status" and m.get("status") == "reconnecting"]
    assert len(reconnect_status) >= 1
    assert reconnect_status[0]["attempt"] == 1


def test_go_away_reconnect():
    """Verify GoAwayReconnect triggers immediate retry without incrementing failed attempts count."""
    bridge = GeminiLiveBridge(api_key="test_key")

    call_count = 0
    sent_messages = []

    async def fake_run_single(ws_send, ws_receive):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            bridge.resume_handle = "stored_resume_handle_xyz"
            raise GoAwayReconnect("Server requested reconnect")
        bridge._session_closed = True

    async def fake_ws_send(data):
        sent_messages.append(data)

    async def fake_ws_receive():
        return None

    async def runner():
        with patch.object(bridge, "_run_single_session", side_effect=fake_run_single):
            await bridge.run_session(ws_send=fake_ws_send, ws_receive=fake_ws_receive)

    asyncio.run(runner())

    assert call_count == 2
    # Handle should still be preserved
    assert bridge.resume_handle == "stored_resume_handle_xyz"
    # Should notify client of reconnecting without attempt counter penalty
    go_away_notices = [m for m in sent_messages if m.get("type") == "session_status" and m.get("message") == "Server requested reconnect"]
    assert len(go_away_notices) == 1
    assert "attempt" not in go_away_notices[0]


def test_server_busy_path(make_ticket, ws_db):
    """When all slots are taken, an authenticated client gets an error and close 1013."""
    client = TestClient(app.app)

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    acquired = []
    for _ in range(app.MAX_CONCURRENT_SESSIONS):
        loop.run_until_complete(app.SESSION_SEMAPHORE.acquire())
        acquired.append(True)

    try:
        assert app.SESSION_SEMAPHORE.locked()
        with client.websocket_connect("/ws/live", headers={"origin": "http://localhost:3000"}) as ws:
            ws.send_json({"type": "auth", "ticket": make_ticket()})
            data = ws.receive_json()
            assert data["type"] == "error"
            assert "Server is busy" in data["message"]
            close_frame = ws.receive()
            assert close_frame["type"] == "websocket.close"
            assert close_frame["code"] == 1013
    finally:
        for _ in acquired:
            app.SESSION_SEMAPHORE.release()
        loop.close()


def test_input_limits_binary_and_json():
    """Verify binary frames >64KB and JSON >1MB are dropped safely."""
    bridge = GeminiLiveBridge(api_key="test_key")
    fake_session = AsyncMock()
    last_audio = [0.0]

    messages = [
        # 1. Oversized binary frame: 65 KB
        b"\x01" + (b"\x00" * 65536),
        # 2. Oversized JSON string: 1.1 MB
        json.dumps({"type": "text", "text": "A" * (1024 * 1024 + 100)}),
        # 3. Unknown message type
        json.dumps({"type": "unknown_action", "payload": 123}),
        # 4. Valid small text
        json.dumps({"type": "text", "text": "Hello interviewer"}),
        # 5. EOF
        None,
    ]

    async def fake_ws_receive():
        if messages:
            return messages.pop(0)
        return None

    async def runner():
        await bridge._client_to_gemini(fake_session, fake_ws_receive, last_audio)

    asyncio.run(runner())

    # Only the valid small text should have reached session.send_realtime_input
    assert fake_session.send_realtime_input.call_count == 1
    args, kwargs = fake_session.send_realtime_input.call_args
    assert kwargs.get("text") == "Hello interviewer"
