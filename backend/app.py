import os
import json
import time
import uuid
import asyncio
import logging
import unicodedata
import datetime
from contextlib import asynccontextmanager
from enum import Enum
from pathlib import Path
from typing import AsyncGenerator, Optional
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import text
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
    list_pending_reports,
    seconds_used_since,
    latest_ready_report,
    list_sessions_for_stats,
    list_wordbank,
    get_wordbank_item,
    add_wordbank_item,
    apply_review,
    delete_wordbank_item,
)
from reports import RUBRIC_VERSION, run_report_pipeline
from coach_context import build_learner_context
from insights import compute_insights
from wordbank import (
    clean_alternatives,
    daily_goal_hint,
    is_due,
    normalize_term,
    schedule_review,
    summarize as summarize_wordbank,
    term_key,
)
from tickets import TicketStore, TicketLimitError
from ratelimit import RateLimitError, SlidingWindowLimiter

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

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Startup work before the first request."""
    # A restart (deploy, crash, free-tier sleep) kills the in-process report job, so the
    # stored row would stay "pending" and the page would poll until it gives up.
    await _recover_pending_reports()
    yield


app = FastAPI(
    lifespan=lifespan,
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

# Report jobs that may run at once (startup recovery can queue several at a time).
REPORT_SEMAPHORE = asyncio.Semaphore(max(1, int(os.getenv("MAX_CONCURRENT_REPORT_JOBS", "2"))))

# Rebuilding a report costs up to two model calls, so retries are rate limited per user.
REPORT_RETRY_LIMITER = SlidingWindowLimiter(
    max_events=int(os.getenv("REPORT_RETRY_LIMIT", "10")),
    window_s=float(os.getenv("REPORT_RETRY_WINDOW_SECONDS", "3600")),
)

# Practice minutes per user per UTC day (0 disables the limit). Each live minute costs
# money, so one account must not be able to drain the Gemini quota in a single day.
DAILY_MINUTES_LIMIT = int(os.getenv("DAILY_MINUTES_LIMIT", "30"))

# Sessions a learner aims to finish each week (0 hides the goal). Only affects the progress
# screen: it is a motivation target, never an access limit.
WEEKLY_SESSION_GOAL = int(os.getenv("WEEKLY_SESSION_GOAL", "5"))

APP_VERSION = os.getenv("APP_VERSION", "2.0.0")

# Concurrency limit for sessions (default 3)
MAX_CONCURRENT_SESSIONS = int(os.getenv("MAX_CONCURRENT_SESSIONS", "3"))
SESSION_SEMAPHORE = asyncio.Semaphore(MAX_CONCURRENT_SESSIONS)

# One-time WebSocket login tickets (in memory: single server instance, see tickets.py)
ticket_store = TicketStore(ttl_seconds=float(os.getenv("WS_TICKET_TTL_SECONDS", "60")))

# Users that currently have a live session (one session per user at a time)
ACTIVE_USERS: set = set()

# Conversation modes a client may request; anything else becomes the default.
# The legacy interview modes are still accepted so older clients keep working.
ALLOWED_SCENARIOS = {
    "free_talk", "everyday", "storytelling", "discussion", "presentation", "pronunciation",
    "mixed", "hr_round", "technical", "behavioral",
}
DEFAULT_SCENARIO = "free_talk"

# Authentication timeout for WebSocket initial auth message (seconds)
AUTH_TIMEOUT_SECONDS = float(os.getenv("AUTH_TIMEOUT_SECONDS", "10"))


# --------------------------------------------------------------------------- #
# Operational endpoints
# --------------------------------------------------------------------------- #
@app.middleware("http")
async def security_headers(request: Request, call_next):
    """Request id + response hardening for every answer (API and static frontend).

    The id makes one failing request traceable in the logs without logging any content.
    ``SAMEORIGIN`` (not DENY) keeps the app usable inside the preview iframe.
    """
    request_id = uuid.uuid4().hex[:12]
    response = await call_next(request)
    response.headers.setdefault("X-Request-Id", request_id)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(self), microphone=(self)")
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Never leak a stack trace or an internal message to the client."""
    logger.error(
        "Unhandled error on %s %s: %s",
        request.method, request.url.path, type(exc).__name__, exc_info=True,
    )
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/api/health")
async def health_check():
    """Liveness probe: the process is up (no dependencies touched)."""
    return {"status": "ok"}


@app.get("/api/version")
async def version_info():
    return {"name": "LivePrep", "version": APP_VERSION, "rubric": RUBRIC_VERSION}


@app.get("/api/ready")
async def readiness_check():
    """Readiness probe: liveness plus a real database round-trip."""
    if AsyncSessionLocal is None:
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "database": "unconfigured", "version": APP_VERSION},
        )
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        logger.error("Readiness check failed: %s", type(exc).__name__)
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "database": "error", "version": APP_VERSION},
        )
    return {"status": "ok", "database": "ok", "version": APP_VERSION}


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
    # Communication goals (what the coach practices with the user).
    general_english = "general_english"
    fluency = "fluency"
    grammar = "grammar"
    vocabulary = "vocabulary"
    pronunciation = "pronunciation"
    confidence = "confidence"
    public_speaking = "public_speaking"
    # Legacy values: kept so existing profiles stay editable.
    job_interview = "job_interview"
    campus_placement = "campus_placement"
    ielts_speaking = "ielts_speaking"


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
def _utc_day_start() -> datetime.datetime:
    """Midnight UTC today: the daily minute allowance resets at a fixed, explainable time."""
    now = datetime.datetime.now(datetime.timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


async def _practice_usage(db: AsyncSession, user_id) -> dict:
    """Seconds this user has practised today (UTC) and what is left of the daily limit.

    ``used_seconds`` is exact so the client can show a live timer; minutes stay for the
    limit check and for readers that only care about the quota.
    """
    used_s = await seconds_used_since(db, user_id=user_id, since=_utc_day_start())
    used_minutes = used_s // 60
    if DAILY_MINUTES_LIMIT <= 0:
        return {
            "limit_minutes": None,
            "used_minutes": used_minutes,
            "used_seconds": used_s,
            "remaining_minutes": None,
        }
    return {
        "limit_minutes": DAILY_MINUTES_LIMIT,
        "used_minutes": used_minutes,
        "used_seconds": used_s,
        "remaining_minutes": max(0, DAILY_MINUTES_LIMIT - used_minutes),
    }


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
        "usage": await _practice_usage(db, user.user_id),
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
    """API shape of a report. A finished call with no report row can be generated on demand."""
    if report is not None:
        status_value = report.status
    else:
        # For a running call the job may still be queued, so pending is honest. A finished
        # call without a row means auto-generation never ran (older build, REPORT_AUTO_GENERATE=0,
        # or the row was never created), so the client offers a "Generate report" action.
        status_value = "pending" if session.status == "active" else "missing"

    return {
        "session_id": str(session.id),
        "status": status_value,
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
    # Every rebuild is up to two model calls, so the endpoint has its own budget.
    try:
        REPORT_RETRY_LIMITER.hit(user.user_id)
    except RateLimitError as exc:
        retry_after = int(exc.retry_after_s) + 1
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many report rebuilds. Try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )
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


# --------------------------------------------------------------------------- #
# Word bank (v2) — saved words and corrections, practised with spaced repetition
# --------------------------------------------------------------------------- #
def _wordbank_view(row) -> dict:
    alternatives = row.alternatives if isinstance(row.alternatives, list) else []
    return {
        "id": row.id,
        "term": row.term,
        "alternatives": [str(a) for a in alternatives],
        "note": row.note,
        "source": row.source,
        "status": row.status,
        "review_count": row.review_count,
        "correct_count": row.correct_count,
        "interval_days": row.interval_days,
        "next_review_at": row.next_review_at.isoformat() if row.next_review_at else None,
        "due": is_due(row.next_review_at),
        "session_id": str(row.session_id) if row.session_id else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _sorted_for_practice(rows) -> list:
    """Due cards first, oldest scheduled first, so practice always starts with the backlog."""
    epoch = datetime.datetime.min.replace(tzinfo=datetime.timezone.utc)
    return sorted(
        rows,
        key=lambda r: (
            0 if is_due(r.next_review_at) else 1,
            r.next_review_at or epoch,
            -r.id,
        ),
    )


MAX_WORDBANK_ROWS = 500


class WordBankCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    term: str = Field(min_length=1, max_length=120)
    alternatives: list[str] = Field(default_factory=list, max_length=5)
    note: Optional[str] = Field(default=None, max_length=300)

    @field_validator("alternatives", mode="before")
    @classmethod
    def _clean_alternatives(cls, value):
        return clean_alternatives(value)


class WordBankReview(BaseModel):
    model_config = ConfigDict(extra="forbid")

    result: str = Field(pattern=r"^(again|good|easy)$")


@app.get("/api/wordbank")
async def list_my_wordbank(
    due_only: bool = False,
    user: AuthenticatedUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """The caller's word bank, due cards first, with the counts the UI badge needs."""
    rows = await list_wordbank(db, user_id=user.user_id, limit=MAX_WORDBANK_ROWS)
    counts = summarize_wordbank(rows)
    ordered = _sorted_for_practice(rows)
    if due_only:
        ordered = [row for row in ordered if is_due(row.next_review_at)]
    return {
        "items": [_wordbank_view(row) for row in ordered],
        "summary": counts,
        "hint": daily_goal_hint(counts["due"]),
    }


@app.post("/api/wordbank")
async def create_wordbank_card(
    body: WordBankCreate,
    user: AuthenticatedUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a card by hand. Adding the same word twice returns the existing card."""
    term = normalize_term(body.term)
    if term is None:
        raise HTTPException(status_code=422, detail="Enter a word or short phrase.")
    try:
        note = _clean_single_line(body.note)
    except ValueError:
        raise HTTPException(status_code=422, detail="The note contains invalid characters.")

    row, created = await add_wordbank_item(
        db,
        user.user_id,
        term=term,
        term_key=term_key(term),
        alternatives=body.alternatives,
        note=note,
        source="manual",
    )
    await db.commit()
    return {"item": _wordbank_view(row), "created": created}


@app.post("/api/wordbank/{item_id}/review")
async def review_wordbank_card(
    item_id: int,
    body: WordBankReview,
    user: AuthenticatedUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """Record one review (again / good / easy) and return the next schedule."""
    row = await get_wordbank_item(db, user.user_id, item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Card not found")

    state = schedule_review(
        result=body.result,
        interval_days=row.interval_days,
        review_count=row.review_count,
        correct_count=row.correct_count,
    )
    apply_review(row, state)
    await db.commit()

    rows = await list_wordbank(db, user_id=user.user_id, limit=MAX_WORDBANK_ROWS)
    return {"item": _wordbank_view(row), "summary": summarize_wordbank(rows)}


@app.delete("/api/wordbank/{item_id}")
async def delete_wordbank_card(
    item_id: int,
    user: AuthenticatedUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a card. A foreign id answers 404 exactly like a missing one."""
    row = await get_wordbank_item(db, user.user_id, item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Card not found")
    await delete_wordbank_item(db, row)
    await db.commit()
    return {"deleted": True}


# --------------------------------------------------------------------------- #
# Practice insights — streak, weekly goal, totals, skill trends
# --------------------------------------------------------------------------- #
@app.get("/api/stats")
async def get_stats(
    user: AuthenticatedUser = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    """Everything derived from existing rows: no extra state, nothing to drift."""
    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=365)
    sessions = await list_sessions_for_stats(db, user_id=user.user_id, since=since)
    progress = await list_progress_reports(db, user_id=user.user_id, limit=20)
    rows = await list_wordbank(db, user_id=user.user_id, limit=MAX_WORDBANK_ROWS)
    return compute_insights(
        sessions=sessions,
        progress=progress,
        wordbank=summarize_wordbank(rows),
        weekly_goal=WEEKLY_SESSION_GOAL,
    )


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
        async with REPORT_SEMAPHORE:  # many calls ending together must not stampede the model
            result = await run_report_pipeline(
                user_id=user_id,
                session_id=session_id,
                session_factory=AsyncSessionLocal,
            )
        logger.info("Report for session %s: %s", session_id, result)
    except Exception as exc:  # noqa: BLE001
        logger.error("Report job crashed (session=%s): %s", session_id, type(exc).__name__)


async def _recover_pending_reports() -> None:
    """Rebuild reports that a previous process left pending.

    The generation job lives in this process's memory, so a restart (deploy, crash, free
    tier sleeping) leaves the row at ``pending`` with nobody working on it. Re-running the
    pipeline is safe: it is idempotent and stores its own failure instead of hanging.
    """
    if AsyncSessionLocal is None:
        return
    try:
        async with AsyncSessionLocal() as db:
            rows = await list_pending_reports(
                db, limit=int(os.getenv("REPORT_RECOVERY_LIMIT", "20"))
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not look for pending reports: %s", type(exc).__name__)
        return
    if not rows:
        return
    logger.info("Recovering %d report(s) left pending by an earlier run", len(rows))
    for row in rows:
        _schedule_report(row["user_id"], row["session_id"])


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

    # Optional, learner-written focus for this call ("past tense", "tell a work story").
    # Treated as data: it is length-capped here and sanitised again when the prompt is built.
    focus_raw = first.get("focus")
    focus = focus_raw.strip()[:160] if isinstance(focus_raw, str) else ""

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

    # 5. Daily practice allowance. A database hiccup must never block a call: fail open.
    try:
        async with AsyncSessionLocal() as db:
            usage = await _practice_usage(db, user_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not read today's usage for %s: %s", user_id, type(exc).__name__)
        usage = None
    if usage and usage.get("remaining_minutes") is not None and usage["remaining_minutes"] <= 0:
        logger.info("Daily practice limit reached for %s", user_id)
        await _reject(
            websocket,
            1008,
            (
                f"You have used all {usage['limit_minutes']} minutes allowed today. "
                "Your allowance resets at midnight UTC."
            ),
        )
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

            # Coach memory: who the learner is, what the last report asked them to practise,
            # and which word-bank cards are due. Built once per call, best effort: a database
            # hiccup must never block a live session, so a failure just means no extra context.
            learner_context = ""
            try:
                async with AsyncSessionLocal() as db:
                    profile_row = await get_profile(db, user_id)
                    last_report = await latest_ready_report(db, user_id)
                    word_rows = await list_wordbank(db, user_id=user_id, limit=200)
                due_words = [row for row in word_rows if is_due(row.next_review_at)][:8]
                learner_context = build_learner_context(
                    profile=profile_row,
                    last_report=last_report,
                    due_words=due_words,
                    focus=focus,
                )
            except Exception as exc:  # noqa: BLE001 — personalisation is optional
                logger.warning(
                    "Could not build learner context for %s: %s", user_id, type(exc).__name__
                )

            bridge = GeminiLiveBridge(
                api_key=SERVER_API_KEY,
                model=DEFAULT_MODEL,
                session_id=str(session_id),
                user_id=str(user_id),
                assembler=turn_assembler,
                learner_context=learner_context,
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
