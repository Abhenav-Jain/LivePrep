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

# Load environment variables
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("omni-copilot-live-app")

app = FastAPI(
    title="OmniCopilot Live Backend",
    description="Low-Latency Multimodal Voice, Vision, and Tool Agent Backend powered by Gemini 3.8 Live API",
    version="1.0.0"
)

# CORS setup for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DEFAULT_MODEL = os.getenv("GEMINI_LIVE_MODEL", "gemini-3.8-live")
SERVER_API_KEY = os.getenv("GEMINI_API_KEY", "")

@app.get("/api/health")
async def health_check():
    """Health check endpoint providing status and configuration info."""
    return {
        "status": "healthy",
        "api_key_configured": bool(SERVER_API_KEY and SERVER_API_KEY != "your_gemini_api_key_here"),
        "default_model": DEFAULT_MODEL,
        "workspace": os.getenv("PROJECT_WORKSPACE_ROOT", str(Path(__file__).resolve().parent.parent)),
    }

@app.websocket("/ws/live")
async def websocket_live_endpoint(
    websocket: WebSocket,
    api_key: str = Query(default=""),
    model: str = Query(default="")
):
    """
    WebSocket endpoint handling real-time audio/video streaming and tool events
    between browser client and Gemini Live API.
    """
    await websocket.accept()
    logger.info("New client connected to /ws/live")

    # Determine effective API key and Model
    effective_key = api_key.strip() if api_key.strip() else SERVER_API_KEY
    effective_model = model.strip() if model.strip() else DEFAULT_MODEL

    if not effective_key or effective_key == "your_gemini_api_key_here":
        await websocket.send_text(json.dumps({
            "type": "error",
            "message": "GEMINI_API_KEY is not configured! Please provide it in .env or via the settings panel."
        }))
        await websocket.close()
        return

    bridge = GeminiLiveBridge(api_key=effective_key, model=effective_model)

    async def ws_send(data: dict):
        try:
            await websocket.send_text(json.dumps(data))
        except Exception:
            pass

    async def ws_receive():
        try:
            text = await websocket.receive_text()
            return text
        except WebSocketDisconnect:
            return None
        except Exception as e:
            logger.warning(f"Error receiving from WebSocket: {e}")
            return None

    try:
        await bridge.run_session(ws_send=ws_send, ws_receive=ws_receive)
    except Exception as e:
        logger.error(f"Error in Live session lifecycle: {e}", exc_info=True)
        try:
            await ws_send({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        logger.info("Client disconnected from /ws/live")

# Mount production frontend build if available
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("app:app", host=host, port=port, reload=True)
