import os
import pytest
from fastapi.testclient import TestClient

# Set valid credentials before importing app
os.environ["LIVEPREP_TOKEN"] = "12345678901234567890123456789012"
os.environ["GEMINI_API_KEY"] = "test_gemini_api_key_valid"
os.environ["ALLOWED_ORIGINS"] = "http://localhost:3000,http://localhost:8000"

import app


def test_health_check():
    client = TestClient(app.app)
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_websocket_rejected_on_wrong_origin():
    client = TestClient(app.app)
    with pytest.raises(Exception):
        with client.websocket_connect("/ws/live", headers={"origin": "http://evil.com"}):
            pass


def test_websocket_auth_flow():
    client = TestClient(app.app)
    # Correct origin
    with client.websocket_connect("/ws/live", headers={"origin": "http://localhost:3000"}) as ws:
        # Send bad token
        ws.send_json({"type": "auth", "token": "wrong_token"})
        # Should close connection with code 1008
        msg = ws.receive()
        assert msg["type"] == "websocket.close"
        assert msg["code"] == 1008
