import uuid
from typing import Optional, List, Dict, Any
from sqlalchemy import select, and_
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
