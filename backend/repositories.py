import uuid
import datetime
from typing import Optional, List, Dict, Any
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession
from models import Session, Turn, Profile, Report


async def create_session(
    db: AsyncSession,
    user_id: uuid.UUID,
    scenario: Optional[str] = None
) -> Session:
    """Creates a new mock interview session for user_id."""
    session = Session(
        id=uuid.uuid4(),
        user_id=user_id,
        scenario=scenario,
        status="active"
    )
    db.add(session)
    await db.flush()
    return session


async def get_session(
    db: AsyncSession,
    user_id: uuid.UUID,
    session_id: uuid.UUID
) -> Optional[Session]:
    """Retrieves a session strictly owned by user_id. Returns None if not owned or not found."""
    stmt = select(Session).where(
        and_(Session.id == session_id, Session.user_id == user_id)
    )
    res = await db.execute(stmt)
    return res.scalar_one_or_none()


async def list_sessions(
    db: AsyncSession,
    user_id: uuid.UUID,
    limit: int = 50,
    offset: int = 0
) -> List[Session]:
    """Lists sessions strictly owned by user_id, ordered by started_at descending."""
    stmt = (
        select(Session)
        .where(Session.user_id == user_id)
        .order_by(Session.started_at.desc())
        .limit(limit)
        .offset(offset)
    )
    res = await db.execute(stmt)
    return list(res.scalars().all())


async def add_turn(
    db: AsyncSession,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    idx: int,
    speaker: str,
    text: str,
    started_at_ms: Optional[int] = None,
    ended_at_ms: Optional[int] = None,
) -> Turn:
    """Adds a turn to an existing session strictly verified for user_id ownership."""
    # Verify session ownership
    sess = await get_session(db, user_id=user_id, session_id=session_id)
    if sess is None:
        raise PermissionError(f"Session {session_id} not found or does not belong to user {user_id}")

    turn = Turn(
        session_id=session_id,
        user_id=user_id,
        idx=idx,
        speaker=speaker,
        text=text,
        started_at_ms=started_at_ms,
        ended_at_ms=ended_at_ms,
    )
    db.add(turn)
    await db.flush()
    return turn


async def get_turns(
    db: AsyncSession,
    user_id: uuid.UUID,
    session_id: uuid.UUID
) -> List[Turn]:
    """Retrieves turns for a session strictly owned by user_id, ordered by turn index."""
    sess = await get_session(db, user_id=user_id, session_id=session_id)
    if sess is None:
        return []

    stmt = (
        select(Turn)
        .where(and_(Turn.session_id == session_id, Turn.user_id == user_id))
        .order_by(Turn.idx.asc())
    )
    res = await db.execute(stmt)
    return list(res.scalars().all())


async def get_profile(
    db: AsyncSession,
    user_id: uuid.UUID
) -> Optional[Profile]:
    """Retrieves the profile for a user strictly by user_id."""
    stmt = select(Profile).where(Profile.user_id == user_id)
    res = await db.execute(stmt)
    return res.scalar_one_or_none()


async def upsert_profile(
    db: AsyncSession,
    user_id: uuid.UUID,
    data: Dict[str, Any]
) -> Profile:
    """Creates or updates a user profile, strictly keying on user_id."""
    profile = await get_profile(db, user_id)
    if profile is None:
        profile = Profile(
            user_id=user_id,
            display_name=data.get("display_name"),
            goal=data.get("goal"),
            target_role=data.get("target_role"),
            level=data.get("level"),
            native_language=data.get("native_language"),
            correction_style=data.get("correction_style"),
        )
        db.add(profile)
    else:
        for field in ("display_name", "goal", "target_role", "level", "native_language", "correction_style"):
            if field in data:
                setattr(profile, field, data[field])

    await db.flush()
    return profile


async def list_sessions_with_counts(
    db: AsyncSession,
    user_id: uuid.UUID,
    limit: int = 20,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    """Lists sessions owned by user_id with turn counts. Newest first."""
    # Subquery: count turns per session
    turn_count_sq = (
        select(Turn.session_id, func.count(Turn.id).label("turn_count"))
        .where(Turn.user_id == user_id)
        .group_by(Turn.session_id)
        .subquery()
    )
    stmt = (
        select(Session, turn_count_sq.c.turn_count)
        .outerjoin(turn_count_sq, Session.id == turn_count_sq.c.session_id)
        .where(Session.user_id == user_id)
        .order_by(Session.started_at.desc())
        .limit(limit)
        .offset(offset)
    )
    res = await db.execute(stmt)
    rows = []
    session_ids = []
    for session, turn_count in res.all():
        session_ids.append(session.id)
        rows.append({
            "id": str(session.id),
            "scenario": session.scenario,
            "status": session.status,
            "started_at": session.started_at.isoformat() if session.started_at else None,
            "ended_at": session.ended_at.isoformat() if session.ended_at else None,
            "duration_s": session.duration_s,
            "turn_count": turn_count or 0,
            "report_status": None,
            "overall_score": None,
        })

    # One extra query for the whole page (portable: no JSON operators in SQL).
    if session_ids:
        rep_res = await db.execute(
            select(Report.session_id, Report.status, Report.report_json).where(
                and_(Report.user_id == user_id, Report.session_id.in_(session_ids))
            )
        )
        by_id = {str(rid): (status_value, report_json) for rid, status_value, report_json in rep_res.all()}
        for row in rows:
            status_value, report_json = by_id.get(row["id"], (None, None))
            row["report_status"] = status_value
            row["overall_score"] = _overall_from_report(report_json)
    return rows


def _overall_from_report(report_json: Optional[dict]) -> Optional[int]:
    """Overall score from a stored report, or None (too short / not ready)."""
    if not isinstance(report_json, dict):
        return None
    scores = report_json.get("scores")
    if isinstance(scores, dict):
        overall = scores.get("overall")
        if isinstance(overall, (int, float)):
            return int(overall)
    return None


async def finish_session(
    db: AsyncSession,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    duration_s: int,
    status: str = "completed",
) -> bool:
    """Marks a session as finished. Only touches a session owned by user_id.

    Returns True if a row was updated, False if the session does not belong to the user.
    """
    import datetime

    sess = await get_session(db, user_id=user_id, session_id=session_id)
    if sess is None:
        return False
    sess.ended_at = datetime.datetime.now(datetime.timezone.utc)
    sess.duration_s = max(0, int(duration_s))
    sess.status = status
    await db.flush()
    return True


# --------------------------------------------------------------------------- #
# Reports (Step 6)
# --------------------------------------------------------------------------- #
async def get_report(
    db: AsyncSession,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
) -> Optional[Report]:
    """Report strictly owned by user_id, or None."""
    stmt = select(Report).where(
        and_(Report.session_id == session_id, Report.user_id == user_id)
    )
    res = await db.execute(stmt)
    return res.scalar_one_or_none()


async def upsert_report(
    db: AsyncSession,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    status: str,
    rubric_version: Optional[str] = None,
    metrics: Optional[dict] = None,
    report: Optional[dict] = None,
    error: Optional[str] = None,
) -> Report:
    """Creates or replaces the report row for a session. Idempotent by design."""
    row = await get_report(db, user_id=user_id, session_id=session_id)
    if row is None:
        row = Report(session_id=session_id, user_id=user_id)
        db.add(row)
    row.status = status
    row.rubric_version = rubric_version
    row.metrics_json = metrics
    row.report_json = report
    row.error = error
    row.updated_at = datetime.datetime.now(datetime.timezone.utc)
    await db.flush()
    return row


async def get_previous_ready_report(
    db: AsyncSession,
    user_id: uuid.UUID,
    before_started_at: Optional[datetime.datetime],
) -> Optional[dict]:
    """The most recent earlier ready report for the same user (for deltas), or None."""
    if before_started_at is None:
        return None
    stmt = (
        select(Report.report_json)
        .join(Session, Session.id == Report.session_id)
        .where(
            and_(
                Report.user_id == user_id,
                Report.status == "ready",
                Session.user_id == user_id,
                Session.started_at < before_started_at,
            )
        )
        .order_by(Session.started_at.desc())
        .limit(1)
    )
    res = await db.execute(stmt)
    row = res.first()
    if row is None or not isinstance(row[0], dict):
        return None
    return row[0]


async def list_progress_reports(
    db: AsyncSession,
    user_id: uuid.UUID,
    limit: int = 10,
) -> List[Dict[str, Any]]:
    """Scores of the user's most recent ready reports, newest first."""
    stmt = (
        select(Session.id, Session.started_at, Session.scenario, Report.report_json)
        .join(Report, Report.session_id == Session.id)
        .where(
            and_(
                Session.user_id == user_id,
                Report.user_id == user_id,
                Report.status == "ready",
            )
        )
        .order_by(Session.started_at.desc())
        .limit(limit)
    )
    res = await db.execute(stmt)
    out: List[Dict[str, Any]] = []
    for session_id, started_at, scenario, report_json in res.all():
        scores = (report_json or {}).get("scores") if isinstance(report_json, dict) else None
        if not isinstance(scores, dict):
            continue  # too-short reports have no scores and do not belong on the trend
        out.append({
            "session_id": str(session_id),
            "scenario": scenario,
            "started_at": started_at.isoformat() if started_at else None,
            "scores": {
                "overall": scores.get("overall"),
                "fluency": scores.get("fluency"),
                "vocabulary": scores.get("vocabulary"),
                "grammar": scores.get("grammar"),
                "communication": scores.get("communication"),
                "pace": scores.get("pace"),
            },
        })
    return out
