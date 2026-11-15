import os
import json
import secrets
import asyncio
import logging
import unicodedata
from enum import Enum
from pathlib import Path
from typing import AsyncGenerator, Optional
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession
from gemini_live import GeminiLiveBridge
from auth import current_user, AuthenticatedUser
from db import AsyncSessionLocal
from repositories import get_profile, upsert_profile

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

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
if not SUPABASE_URL.startswith(("https://", "http://")):
    raise RuntimeError(
        "CRITICAL STARTUP ERROR: SUPABASE_URL is missing or invalid "
        "(expected https://<project-ref>.supabase.co)."
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


# --------------------------------------------------------------------------- #
# Database dependency
# --------------------------------------------------------------------------- #
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """One DB session per request. 503 if DATABASE_URL is not configured."""
    if AsyncSessionLocal is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database is not configured",
        )
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


# --------------------------------------------------------------------------- #
# Profile models (strict validation: this text later goes into AI prompts)
# --------------------------------------------------------------------------- #
class Goal(str, Enum):
    job_interview = "job_interview"
    campus_placement = "campus_placement"
    ielts_speaking = "ielts_speaking"
    general_english = "general_english"


class Level(str, Enum):
    beginner = "beginner"
    intermediate = "intermediate"
    advanced = "advanced"


class CorrectionStyle(str, Enum):
    live = "live"
    end_of_session = "end_of_session"


def _clean_single_line(value):
    """Trim; reject control/format characters (newlines, zero-width, bidi overrides...)."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("must be a string")
    value = value.strip()
    if any(unicodedata.category(ch).startswith("C") for ch in value):
        raise ValueError("control characters are not allowed")
    return value or None


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: str = Field(min_length=1, max_length=60)
    goal: Goal
    level: Level
    target_role: Optional[str] = Field(default=None, max_length=100)
    native_language: Optional[str] = Field(default=None, max_length=50)
    correction_style: CorrectionStyle = CorrectionStyle.end_of_session

    @field_validator("display_name", "target_role", "native_language", mode="before")
    @classmethod
    def _single_line(cls, value):
        return _clean_single_line(value)


def _profile_to_dict(profile) -> Optional[dict]:
    if profile is None:
        return None
    return {
        "display_name": profile.display_name,
        "goal": profile.goal,
        "target_role": profile.target_role,
        "level": profile.level,
        "native_language": profile.native_language,
        "correction_style": profile.correction_style,
    }


def _onboarding_complete(profile) -> bool:
    return bool(profile and profile.display_name and profile.goal and profile.level)


# --------------------------------------------------------------------------- #
# /api/me
# --------------------------------------------------------------------------- #
@app.get("/api/me")
async def read_me(
    user: AuthenticatedUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    profile = await get_profile(db, user.user_id)
    return {
        "user_id": str(user.user_id),
        "email": user.email,
        "profile": _profile_to_dict(profile),
        "onboarding_complete": _onboarding_complete(profile),
    }


@app.put("/api/me/profile")
async def update_my_profile(
    body: ProfileUpdate,
    user: AuthenticatedUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    # user_id comes ONLY from the verified token, never from the request body.
    profile = await upsert_profile(db, user.user_id, body.model_dump(mode="json"))
    await db.commit()
    return {
        "user_id": str(user.user_id),
        "email": user.email,
        "profile": _profile_to_dict(profile),
        "onboarding_complete": _onboarding_complete(profile),
    }


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
