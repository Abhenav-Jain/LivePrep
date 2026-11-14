import os
import json
import asyncio
import logging
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient

os.environ["LIVEPREP_TOKEN"] = "12345678901234567890123456789012"
os.environ["GEMINI_API_KEY"] = "test_gemini_api_key_valid"
os.environ["ALLOWED_ORIGINS"] = "http://localhost:3000,http://localhost:8000"

import app


def test_auth_timeout_closes_1008_without_holding_semaphore(monkeypatch):
    """Client connects and sends nothing: connection is closed with 1008 after timeout, semaphore is available."""
    # Use a small timeout for the test
    monkeypatch.setenv("AUTH_TIMEOUT_SECONDS", "0.2")

    client = TestClient(app.app)
    initial_available = app.SESSION_SEMAPHORE._value

    with client.websocket_connect("/ws/live", headers={"origin": "http://localhost:3000"}) as ws:
        msg = ws.receive()
        assert msg["type"] == "websocket.close"
        assert msg["code"] == 1008

    # Semaphore was never held or locked
    assert app.SESSION_SEMAPHORE._value == initial_available
    assert not app.SESSION_SEMAPHORE.locked()


def test_unauthenticated_clients_do_not_exhaust_semaphore(monkeypatch):
    """With MAX_CONCURRENT_SESSIONS=2: open 5 unauthenticated connections, then verify authenticated client succeeds."""
    monkeypatch.setattr(app, "MAX_CONCURRENT_SESSIONS", 2)
    # Ensure fresh semaphore with capacity 2
    test_sem = asyncio.Semaphore(2)
    monkeypatch.setattr(app, "SESSION_SEMAPHORE", test_sem)
    monkeypatch.setenv("AUTH_TIMEOUT_SECONDS", "0.1")

    client = TestClient(app.app)

    # Attempt 5 unauthenticated/bad connections (sending nothing, invalid json, or wrong token)
    bad_scenarios = [
        None,  # sends nothing -> timeout
        "wrong_json",  # invalid json
        {"type": "not_auth"},  # wrong type
        {"type": "auth", "token": "wrong"},  # wrong token
        None,  # sends nothing -> timeout
    ]

    for scenario in bad_scenarios:
        with client.websocket_connect("/ws/live", headers={"origin": "http://localhost:3000"}) as ws:
            if scenario == "wrong_json":
                ws.send_text("not-a-json")
            elif isinstance(scenario, dict):
                ws.send_json(scenario)
            msg = ws.receive()
            assert msg["type"] == "websocket.close"
            assert msg["code"] == 1008

    # Semaphore must be completely free
    assert not app.SESSION_SEMAPHORE.locked()
    assert app.SESSION_SEMAPHORE._value == 2

    # Now verify a valid authenticated connection is accepted and NOT rejected with 1013
    async def mock_run_session(self, ws_send, ws_receive):
        await ws_send({"type": "session_status", "status": "connected"})

    with patch("app.GeminiLiveBridge.run_session", new=mock_run_session):
        with client.websocket_connect("/ws/live", headers={"origin": "http://localhost:3000"}) as ws:
            ws.send_json({"type": "auth", "token": app.LIVEPREP_TOKEN})
            response = ws.receive_json()
            assert response["type"] == "session_status"
            assert response["status"] == "connected"


def test_authenticated_client_rejected_when_slots_taken():
    """Authenticated client when all slots are taken receives busy message and code 1013."""
    client = TestClient(app.app)

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    acquired = []
    # Lock all permits
    for _ in range(app.MAX_CONCURRENT_SESSIONS):
        loop.run_until_complete(app.SESSION_SEMAPHORE.acquire())
        acquired.append(True)

    try:
        assert app.SESSION_SEMAPHORE.locked()
        with client.websocket_connect("/ws/live", headers={"origin": "http://localhost:3000"}) as ws:
            # Send correct auth first
            ws.send_json({"type": "auth", "token": app.LIVEPREP_TOKEN})
            # Receives busy error message
            msg = ws.receive_json()
            assert msg["type"] == "error"
            assert "Server is busy" in msg["message"]
            close_frame = ws.receive()
            assert close_frame["type"] == "websocket.close"
            assert close_frame["code"] == 1013
    finally:
        for _ in acquired:
            app.SESSION_SEMAPHORE.release()
        loop.close()


def test_wrong_token_logs_only_authentication_failed(caplog):
    """Wrong token closes 1008 and log output does not contain token length or token values."""
    client = TestClient(app.app)
    caplog.clear()

    with caplog.at_level(logging.WARNING, logger="liveprep-app"):
        with client.websocket_connect("/ws/live", headers={"origin": "http://localhost:3000"}) as ws:
            ws.send_json({"type": "auth", "token": "attacker_supplied_bad_token_12345"})
            msg = ws.receive()
            assert msg["type"] == "websocket.close"
            assert msg["code"] == 1008

    # Check logs
    assert any("Authentication failed" in record.message for record in caplog.records)
    # Ensure no token lengths or values leaked in log records
    for record in caplog.records:
        assert "token mismatch" not in record.message.lower()
        assert "client provided" not in record.message.lower()
        assert "server expects" not in record.message.lower()
        assert "attacker_supplied_bad_token_12345" not in record.message
        assert str(len("attacker_supplied_bad_token_12345")) not in record.message
