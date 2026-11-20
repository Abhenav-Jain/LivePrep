import pytest
from fastapi.testclient import TestClient

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
