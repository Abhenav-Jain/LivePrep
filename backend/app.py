import os
import json
import secrets
import asyncio
import logging
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from gemini_live import GeminiLiveBridge

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("liveprep-app")

# Fail-closed credential validation on startup
LIVEPREP_TOKEN = os.getenv("LIVEPREP_TOKEN", "")
if not LIVEPREP_TOKEN or len(LIVEPREP_TOKEN) < 32:
    raise RuntimeError(
        "CRITICAL STARTUP ERROR: LIVEPREP_TOKEN is missing or shorter than 32 characters. "
        "Set a strong random token of at least 32 characters in your environment."
    )

SERVER_API_KEY = os.getenv("GEMINI_API_KEY", "")
if not SERVER_API_KEY or SERVER_API_KEY == "your_gemini_api_key_here":
    raise RuntimeError(
        "CRITICAL STARTUP ERROR: GEMINI_API_KEY is missing or unconfigured in environment."
    )

# Allowed origins from env var (comma-separated)
raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:8000")
ALLOWED_ORIGINS = {orig.strip() for orig in raw_origins.split(",") if orig.strip()}

app = FastAPI(
    title="LivePrep Backend",
    description="Low-Latency Multimodal Voice, Vision, and Tool Agent Backend powered by Gemini Live API",
    version="1.0.0"
)

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(ALLOWED_ORIGINS),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DEFAULT_MODEL = os.getenv("GEMINI_LIVE_MODEL", "gemini-3.8-live")

# Concurrency limit for sessions (default 3)
MAX_CONCURRENT_SESSIONS = int(os.getenv("MAX_CONCURRENT_SESSIONS", "3"))
SESSION_SEMAPHORE = asyncio.Semaphore(MAX_CONCURRENT_SESSIONS)

# Authentication timeout for WebSocket initial auth message (seconds)
AUTH_TIMEOUT_SECONDS = float(os.getenv("AUTH_TIMEOUT_SECONDS", "10"))


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok"}


@app.websocket("/ws/live")
async def websocket_live_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time audio/video streaming and tool events.
    Requires Origin check and token authentication (first message must be auth within timeout).
    Uses server GEMINI_API_KEY and GEMINI_LIVE_MODEL only.
    """
    # 1. Origin check (browsers do NOT enforce CORS on WebSocket)
    origin = websocket.headers.get("origin")
    if origin not in ALLOWED_ORIGINS:
        logger.warning(f"Connection rejected: origin '{origin}' not in ALLOWED_ORIGINS")
        await websocket.close(code=1008)
        return

    # 2. Accept connection first so we can respond cleanly
    await websocket.accept()
    logger.info("New client connected to /ws/live")

    # 3. Wait for the first message with timeout (asyncio.wait_for).
    # On timeout, invalid JSON, wrong message type, or token mismatch: close with code 1008 without touching semaphore.
    try:
        auth_timeout = float(os.getenv("AUTH_TIMEOUT_SECONDS", str(AUTH_TIMEOUT_SECONDS)))
        first_raw = await asyncio.wait_for(websocket.receive_text(), timeout=auth_timeout)
        first = json.loads(first_raw)
    except (asyncio.TimeoutError, TimeoutError):
        logger.warning("Authentication failed")
        await websocket.close(code=1008)
        return
    except Exception:
        logger.warning("Authentication failed")
        await websocket.close(code=1008)
        return

    client_token = str(first.get("token", "")).strip()
    expected_token = LIVEPREP_TOKEN.strip()
    if first.get("type") != "auth" or not secrets.compare_digest(client_token, expected_token):
        logger.warning("Authentication failed")
        await websocket.close(code=1008)
        return

    # 4. Only after successful authentication: check server capacity
    if SESSION_SEMAPHORE.locked():
        logger.warning("Server is busy (semaphore locked). Rejecting client with 1013.")
        try:
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": "Server is busy, please try again in a few minutes."
            }))
            await websocket.close(code=1013)
        except Exception:
            pass
        return

    # 5. Acquire semaphore and run session
    async with SESSION_SEMAPHORE:
        bridge = GeminiLiveBridge(api_key=SERVER_API_KEY, model=DEFAULT_MODEL)

        async def ws_send(data: dict):
            try:
                await websocket.send_text(json.dumps(data))
            except Exception as e:
                logger.warning(f"WebSocket send failed: {e}")
                raise

        async def ws_receive():
            try:
                message = await websocket.receive()
                if message["type"] == "websocket.disconnect":
                    return None
                if "text" in message:
                    return message["text"]
                if "bytes" in message:
                    return message["bytes"]
                return None
            except WebSocketDisconnect:
                return None
            except Exception as e:
                logger.warning(f"Error receiving from WebSocket: {e}")
                return None

        try:
            await bridge.run_session(ws_send=ws_send, ws_receive=ws_receive)
        except Exception as e:
            logger.error(f"Error in Live session lifecycle: {e}", exc_info=True)
        finally:
            logger.info("Client disconnected from /ws/live")


FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    reload = os.getenv("DEV", "0") == "1"
    uvicorn.run("app:app", host=host, port=port, reload=reload)
