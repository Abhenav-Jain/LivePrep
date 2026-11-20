import uuid
import datetime
from typing import Optional, List, Dict, Any
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession
from models import Session, Turn, Profile


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
    for session, turn_count in res.all():
        rows.append({
            "id": str(session.id),
            "scenario": session.scenario,
            "status": session.status,
            "started_at": session.started_at.isoformat() if session.started_at else None,
            "ended_at": session.ended_at.isoformat() if session.ended_at else None,
            "duration_s": session.duration_s,
            "turn_count": turn_count or 0,
            # Step 6 fields (null until reports table exists)
            "report_status": None,
            "overall_score": None,
        })
    return rows


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
