import os
import json
import asyncio
import logging
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from gemini_live import GeminiLiveBridge

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("liveprep-app")

app = FastAPI(
    title="LivePrep Backend",
    description="Low-Latency Multimodal Voice, Vision, and Tool Agent Backend powered by Gemini Live API",
    version="1.0.0"
)

# CORS - restricted to local dev origins only
ALLOWED_ORIGINS = {"http://localhost:3000", "http://localhost:8000"}
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(ALLOWED_ORIGINS),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DEFAULT_MODEL = os.getenv("GEMINI_LIVE_MODEL", "gemini-3.8-live")
SERVER_API_KEY = os.getenv("GEMINI_API_KEY", "")
LIVEPREP_TOKEN = os.getenv("LIVEPREP_TOKEN", "")

# Concurrency limit for sessions
SESSION_SEMAPHORE = asyncio.Semaphore(int(os.getenv("MAX_CONCURRENT_SESSIONS", "5")))


@app.get("/api/health")
async def health_check():
    """Health check endpoint (no sensitive path info leaked)."""
    return {
        "status": "healthy",
        "api_key_configured": bool(SERVER_API_KEY and SERVER_API_KEY != "your_gemini_api_key_here"),
        "default_model": DEFAULT_MODEL,
    }


@app.websocket("/ws/live")
async def websocket_live_endpoint(
    websocket: WebSocket,
    model: str = Query(default="")
):
    """
    WebSocket endpoint for real-time audio/video streaming and tool events.
    Requires Origin check and token authentication (first message must be auth).
    API key is sent via auth message, never via query string.
    """
    # 1. Origin check (browsers do NOT enforce CORS on WebSocket)
    origin = websocket.headers.get("origin")
    if origin not in ALLOWED_ORIGINS:
        await websocket.close(code=1008)
        return

    # 2. Concurrency limit
    async with SESSION_SEMAPHORE:
        await websocket.accept()
        logger.info("New client connected to /ws/live")

        # 3. First message must be auth: {"type": "auth", "token": "...", "api_key": "..."}
        try:
            first_raw = await websocket.receive_text()
            first = json.loads(first_raw)
        except Exception:
            await websocket.close(code=1008)
            return

        if first.get("type") != "auth" or first.get("token") != LIVEPREP_TOKEN:
            await websocket.close(code=1008)
            return

        # Effective API key - from client auth message, fallback to server key
        client_key = first.get("api_key", "")
        if isinstance(client_key, str):
            client_key = client_key.strip()
        effective_key = client_key if client_key else SERVER_API_KEY
        effective_model = model.strip() if model.strip() else DEFAULT_MODEL

        if not effective_key or effective_key == "your_gemini_api_key_here":
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": "GEMINI_API_KEY is not configured! Provide it via auth message."
            }))
            await websocket.close(code=1008)
            return

        bridge = GeminiLiveBridge(api_key=effective_key, model=effective_model)

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