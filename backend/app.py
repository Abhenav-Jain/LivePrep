import os
import json
import time
import uuid
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
from transcript import TurnAssembler
from auth import current_user, AuthenticatedUser
from db import AsyncSessionLocal
from repositories import (
    get_profile,
    upsert_profile,
    create_session,
    finish_session,
    add_turn,
    get_turns,
    list_sessions_with_counts,
    get_session,
    get_report,
    get_previous_ready_report,
    list_progress_reports,
)
from reports import RUBRIC_VERSION, run_report_pipeline
from tickets import TicketStore, TicketLimitError

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("liveprep-app")

# Fail-closed credential validation on startup
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

# Reports: text model used for the post-session analysis. Never hardcoded; see .env.example.
REPORT_MODEL = os.getenv("REPORT_MODEL", "").strip()
if not REPORT_MODEL:
    logger.warning("REPORT_MODEL is not set: session reports will be stored as failed until it is configured")

# Reports still running in the background (kept referenced so they are not garbage collected)
REPORT_TASKS: set = set()

# Concurrency limit for sessions (default 3)
MAX_CONCURRENT_SESSIONS = int(os.getenv("MAX_CONCURRENT_SESSIONS", "3"))
SESSION_SEMAPHORE = asyncio.Semaphore(MAX_CONCURRENT_SESSIONS)

# One-time WebSocket login tickets (in memory: single server instance, see tickets.py)
ticket_store = TicketStore(ttl_seconds=float(os.getenv("WS_TICKET_TTL_SECONDS", "60")))

# Users that currently have a live session (one session per user at a time)
ACTIVE_USERS: set = set()

# Interview scenarios a client may request; anything else becomes the default
ALLOWED_SCENARIOS = {"mixed", "hr_round", "technical", "behavioral"}
DEFAULT_SCENARIO = "mixed"

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


# --------------------------------------------------------------------------- #
# /api/sessions  — session list and transcript
# --------------------------------------------------------------------------- #

@app.get("/api/sessions")
async def list_my_sessions(
    limit: int = 20,
    offset: int = 0,
    user: AuthenticatedUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """List the caller's sessions, newest first. limit capped at 50."""
    limit = min(max(1, limit), 50)
    offset = max(0, offset)
    rows = await list_sessions_with_counts(db, user_id=user.user_id, limit=limit, offset=offset)
    return {"sessions": rows}


@app.get("/api/sessions/{session_id}/transcript")
async def get_session_transcript(
    session_id: str,
    user: AuthenticatedUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return a session and its turns. 404 for a foreign or unknown session_id."""
    try:
        sid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Session not found")

    session = await get_session(db, user_id=user.user_id, session_id=sid)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    turns = await get_turns(db, user_id=user.user_id, session_id=sid)
    return {
        "session": {
            "id": str(session.id),
            "scenario": session.scenario,
            "status": session.status,
            "started_at": session.started_at.isoformat() if session.started_at else None,
            "ended_at": session.ended_at.isoformat() if session.ended_at else None,
            "duration_s": session.duration_s,
        },
        "turns": [
            {
                "idx": t.idx,
                "speaker": t.speaker,
                "text": t.text,
                "started_at_ms": t.started_at_ms,
                "ended_at_ms": t.ended_at_ms,
            }
            for t in turns
        ],
    }


# --------------------------------------------------------------------------- #
# /api/sessions/{id}/report  — post-session report (Step 6)
# --------------------------------------------------------------------------- #
def _previous_report_view(report_json: Optional[dict]) -> Optional[dict]:
    """Small data needed for the "vs last session" deltas."""
    if not isinstance(report_json, dict):
        return None
    scores = report_json.get("scores")
    if not isinstance(scores, dict):
        return None
    keys = ("overall", "fluency", "vocabulary", "grammar", "communication", "pace")
    return {"scores": {k: scores.get(k) for k in keys}}


def _report_view(session, report, previous_json: Optional[dict]) -> dict:
    return {
        "session_id": str(session.id),
        # No row yet is treated as pending: the report job may still be queued.
        "status": report.status if report is not None else "pending",
        "rubric_version": (report.rubric_version if report is not None else RUBRIC_VERSION),
        "metrics": report.metrics_json if report is not None else None,
        "report": report.report_json if report is not None else None,
        "error": report.error if report is not None else None,
        "created_at": report.created_at.isoformat() if report is not None and report.created_at else None,
        "updated_at": report.updated_at.isoformat() if report is not None and report.updated_at else None,
        "previous": _previous_report_view(previous_json),
    }


async def _owned_session_or_404(db: AsyncSession, user_id, session_id: str):
    try:
        sid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Session not found")
    session = await get_session(db, user_id=user_id, session_id=sid)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.get("/api/sessions/{session_id}/report")
async def get_session_report(
    session_id: str,
    user: AuthenticatedUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """The caller's report for one session: pending, ready (with analysis) or failed."""
    session = await _owned_session_or_404(db, user.user_id, session_id)
    report = await get_report(db, user_id=user.user_id, session_id=session.id)
    previous = await get_previous_ready_report(db, user_id=user.user_id, before_started_at=session.started_at)
    return _report_view(session, report, previous)


@app.post("/api/sessions/{session_id}/report/retry")
async def retry_session_report(
    session_id: str,
    user: AuthenticatedUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """Regenerates a report (idempotent). Missing/failed reports are rebuilt on demand."""
    session = await _owned_session_or_404(db, user.user_id, session_id)
    db_factory = AsyncSessionLocal
    if db_factory is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database is not configured",
        )
    sid = session.id

    await run_report_pipeline(
        user_id=user.user_id,
        session_id=sid,
        session_factory=db_factory,
    )

    # Reload through the request session so the client gets the stored result.
    await db.rollback()  # end the read transaction; the pipeline committed separately
    session = await get_session(db, user_id=user.user_id, session_id=sid)
    if session is None:  # deleted while the report was generated
        raise HTTPException(status_code=404, detail="Session not found")
    report = await get_report(db, user_id=user.user_id, session_id=sid)
    previous = await get_previous_ready_report(db, user_id=user.user_id, before_started_at=session.started_at)
    return _report_view(session, report, previous)


@app.get("/api/progress")
async def get_progress(
    limit: int = 10,
    user: AuthenticatedUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """Scores of the caller's latest ready reports (newest first), for the trend chart."""
    limit = min(max(1, limit), 20)
    rows = await list_progress_reports(db, user_id=user.user_id, limit=limit)
    return {"reports": rows}


@app.post("/api/ws-ticket")
async def create_ws_ticket(user: AuthenticatedUser = Depends(current_user)):
    """Issues a single-use ticket (valid ~60 s) that the browser sends as its first WebSocket message."""
    try:
        ticket = ticket_store.issue(user.user_id)
    except TicketLimitError:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many connection attempts. Please wait a minute and try again.",
        )
    return {"ticket": ticket, "expires_in": int(ticket_store.ttl_seconds)}


async def _open_session_record(user_id: uuid.UUID, scenario: str) -> uuid.UUID:
    """Creates the session row on the server. The id is generated here, never by the client or the model."""
    async with AsyncSessionLocal() as db:
        row = await create_session(db, user_id=user_id, scenario=scenario)
        await db.commit()
        return row.id


async def _close_session_record(user_id: uuid.UUID, session_id: uuid.UUID, duration_s: float, status_value: str) -> None:
    """Marks the session finished. Never raises: a storage hiccup must not crash the connection handler."""
    try:
        async with AsyncSessionLocal() as db:
            await finish_session(db, user_id=user_id, session_id=session_id,
                                 duration_s=int(duration_s), status=status_value)
            await db.commit()
    except Exception as e:  # noqa: BLE001
        logger.error("Could not finalize session %s: %s", session_id, type(e).__name__)


async def _report_job(user_id: uuid.UUID, session_id: uuid.UUID) -> None:
    """Background report generation. Never raises: the call handler must not be affected."""
    try:
        result = await run_report_pipeline(
            user_id=user_id,
            session_id=session_id,
            session_factory=AsyncSessionLocal,
        )
        logger.info("Report for session %s: %s", session_id, result)
    except Exception as exc:  # noqa: BLE001
        logger.error("Report job crashed (session=%s): %s", session_id, type(exc).__name__)


def _schedule_report(user_id: uuid.UUID, session_id: uuid.UUID) -> None:
    """Queue report generation after a call ends (disable with REPORT_AUTO_GENERATE=0)."""
    if os.getenv("REPORT_AUTO_GENERATE", "1").strip().lower() not in {"1", "true", "yes"}:
        return
    if AsyncSessionLocal is None:
        return
    try:
        task = asyncio.create_task(_report_job(user_id, session_id))
    except RuntimeError:  # no running loop (should not happen inside a request)
        logger.error("Could not schedule report for session %s: no event loop", session_id)
        return
    REPORT_TASKS.add(task)
    task.add_done_callback(REPORT_TASKS.discard)


async def _reject(websocket: WebSocket, code: int, message: Optional[str] = None) -> None:
    """Optionally tell the client why, then close. Never raises."""
    try:
        if message:
            await websocket.send_text(json.dumps({"type": "error", "message": message}))
        await websocket.close(code=code)
    except Exception:  # noqa: BLE001
        pass


@app.websocket("/ws/live")
async def websocket_live_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time audio and the live transcript.

    Flow: origin check -> accept -> first message {"type":"auth","ticket":...} within the
    timeout (ticket comes from POST /api/ws-ticket) -> one session per user -> capacity check
    -> server creates the session row -> Gemini Live session runs -> session row is finalized.
    Uses the server GEMINI_API_KEY and GEMINI_LIVE_MODEL only.
    """
    # 1. Origin check (browsers do NOT enforce CORS on WebSocket)
    origin = websocket.headers.get("origin")
    if origin not in ALLOWED_ORIGINS:
        logger.warning(f"Connection rejected: origin '{origin}' not in ALLOWED_ORIGINS")
        await websocket.close(code=1008)
        return

    # 2. Accept first so we can answer cleanly
    await websocket.accept()
    logger.info("New client connected to /ws/live")

    # 3. First message must arrive in time and be valid. Any problem: close 1008 without
    #    touching the semaphore, so unauthenticated clients can never occupy session slots.
    try:
        auth_timeout = float(os.getenv("AUTH_TIMEOUT_SECONDS", str(AUTH_TIMEOUT_SECONDS)))
        first_raw = await asyncio.wait_for(websocket.receive_text(), timeout=auth_timeout)
        first = json.loads(first_raw)
    except Exception:  # timeout, disconnect, binary frame, invalid JSON
        logger.warning("Authentication failed")
        await _reject(websocket, 1008)
        return

    ticket = first.get("ticket") if isinstance(first, dict) else None
    if (
        not isinstance(first, dict)
        or first.get("type") != "auth"
        or not isinstance(ticket, str)
        or not (16 <= len(ticket) <= 128)
    ):
        logger.warning("Authentication failed")
        await _reject(websocket, 1008)
        return

    user_id = ticket_store.consume(ticket)  # single use: the ticket is burned here
    if user_id is None:
        logger.warning("Authentication failed")
        await _reject(websocket, 1008)
        return

    requested = first.get("scenario")
    scenario = requested if isinstance(requested, str) and requested in ALLOWED_SCENARIOS else DEFAULT_SCENARIO

    # 4. One live session per user, server capacity, and storage must be available.
    #    (No await between the check and ACTIVE_USERS.add, so two quick tabs cannot both pass.)
    if user_id in ACTIVE_USERS:
        logger.warning("Rejected second concurrent session for a user")
        await _reject(websocket, 1008, "You already have a live session open. Close it first, then try again.")
        return

    if SESSION_SEMAPHORE.locked():
        logger.warning("Server is busy (semaphore locked). Rejecting client with 1013.")
        await _reject(websocket, 1013, "Server is busy, please try again in a few minutes.")
        return

    if AsyncSessionLocal is None:
        logger.error("DATABASE_URL is not configured: refusing to start an unrecorded session")
        await _reject(websocket, 1011, "Session storage is not available right now. Please try again later.")
        return

    ACTIVE_USERS.add(user_id)
    try:
        async with SESSION_SEMAPHORE:
            try:
                session_id = await _open_session_record(user_id, scenario)
            except Exception as e:  # noqa: BLE001
                logger.error("Could not create session record: %s", type(e).__name__)
                await _reject(websocket, 1011, "Could not start your session. Please try again.")
                return

            logger.info("Session %s started", session_id)
            started = time.monotonic()
            outcome = "completed"

            # Build the turn sink: persists each completed turn to the database as it arrives.
            # A failure in the sink must NEVER crash or end the live call.
            async def _save_turn(turn) -> None:
                try:
                    async with AsyncSessionLocal() as db:
                        await add_turn(
                            db,
                            user_id=user_id,
                            session_id=session_id,
                            idx=turn.idx,
                            speaker=turn.speaker,
                            text=turn.text,
                            started_at_ms=turn.started_at_ms,
                            ended_at_ms=turn.ended_at_ms,
                        )
                        await db.commit()
                except Exception as e:  # noqa: BLE001
                    logger.error("Turn save failed (session=%s): %s", session_id, type(e).__name__)

            turn_assembler = TurnAssembler(on_turn=_save_turn)

            bridge = GeminiLiveBridge(
                api_key=SERVER_API_KEY,
                model=DEFAULT_MODEL,
                session_id=str(session_id),
                user_id=str(user_id),
                assembler=turn_assembler,
            )

            # Notify the client which session_id was created (for linking to the report later)
            try:
                await websocket.send_text(json.dumps({
                    "type": "session_started",
                    "session_id": str(session_id),
                }))
            except Exception:  # noqa: BLE001
                pass

            client_gone = False  # becomes True when the browser hung up (normal, not a server error)

            async def ws_send(data: dict):
                nonlocal client_gone
                try:
                    await websocket.send_text(json.dumps(data))
                except Exception as e:
                    client_gone = True
                    logger.warning(f"WebSocket send failed: {e}")
                    raise

            async def ws_receive():
                nonlocal client_gone
                try:
                    message = await websocket.receive()
                    if message["type"] == "websocket.disconnect":
                        client_gone = True
                        return None
                    if "text" in message:
                        return message["text"]
                    if "bytes" in message:
                        return message["bytes"]
                    return None
                except WebSocketDisconnect:
                    client_gone = True
                    return None
                except Exception as e:
                    logger.warning(f"Error receiving from WebSocket: {e}")
                    return None

            try:
                await bridge.run_session(ws_send=ws_send, ws_receive=ws_receive)
            except Exception as e:
                if client_gone:
                    # The browser hung up while we were talking to it: a normal end of the call.
                    logger.info("Client disconnected during the session")
                else:
                    outcome = "error"
                    logger.error(f"Error in Live session lifecycle: {e}", exc_info=True)
            finally:
                # shield: even if this handler is cancelled (server shutdown), the row is still finalized
                await asyncio.shield(
                    _close_session_record(user_id, session_id, time.monotonic() - started, outcome)
                )
                logger.info("Session %s ended (%s)", session_id, outcome)
                # Generate the report after the transcript and session row are final.
                _schedule_report(user_id, session_id)
                # Tell the client the call is over (normal closure), after the record is saved.
                try:
                    await websocket.close(code=1000)
                except Exception:  # noqa: BLE001
                    pass
    finally:
        ACTIVE_USERS.discard(user_id)


FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    reload = os.getenv("DEV", "0") == "1"
    uvicorn.run("app:app", host=host, port=port, reload=reload)
