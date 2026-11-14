import uuid
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.exc import IntegrityError
import models
import repositories


@pytest_asyncio.fixture
async def test_db():
    """Isolated in-memory SQLite database using aiosqlite for tests.
    Does not touch the production DATABASE_URL.
    """
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session

    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.drop_all)
    await engine.dispose()


@pytest.mark.asyncio
async def test_create_and_fetch_session(test_db: AsyncSession):
    """Verify creating a session and fetching it by user_id and session_id."""
    user_a = uuid.uuid4()
    sess = await repositories.create_session(test_db, user_id=user_a, scenario="behavioral_intro")
    await test_db.commit()

    fetched = await repositories.get_session(test_db, user_id=user_a, session_id=sess.id)
    assert fetched is not None
    assert fetched.id == sess.id
    assert fetched.user_id == user_a
    assert fetched.scenario == "behavioral_intro"
    assert fetched.status == "active"


@pytest.mark.asyncio
async def test_turns_keep_order(test_db: AsyncSession):
    """Verify that turns are retrieved in ascending index order."""
    user_id = uuid.uuid4()
    sess = await repositories.create_session(test_db, user_id=user_id, scenario="system_design")
    await test_db.commit()

    # Add turns out of order
    await repositories.add_turn(test_db, user_id=user_id, session_id=sess.id, idx=2, speaker="user", text="I used Redis.")
    await repositories.add_turn(test_db, user_id=user_id, session_id=sess.id, idx=1, speaker="ai", text="How did you scale?")
    await repositories.add_turn(test_db, user_id=user_id, session_id=sess.id, idx=3, speaker="ai", text="What about eviction?")
    await test_db.commit()

    turns = await repositories.get_turns(test_db, user_id=user_id, session_id=sess.id)
    assert len(turns) == 3
    assert [t.idx for t in turns] == [1, 2, 3]
    assert turns[0].text == "How did you scale?"
    assert turns[1].text == "I used Redis."
    assert turns[2].text == "What about eviction?"


@pytest.mark.asyncio
async def test_user_isolation(test_db: AsyncSession):
    """Verify User A cannot get or list User B's sessions or turns."""
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()

    sess_b = await repositories.create_session(test_db, user_id=user_b, scenario="finance_role")
    await repositories.add_turn(test_db, user_id=user_b, session_id=sess_b.id, idx=1, speaker="ai", text="Question B")
    await test_db.commit()

    # User A tries to get User B's session
    cross_session = await repositories.get_session(test_db, user_id=user_a, session_id=sess_b.id)
    assert cross_session is None

    # User A lists sessions -> should not see User B's session
    a_sessions = await repositories.list_sessions(test_db, user_id=user_a)
    assert len(a_sessions) == 0

    # User A tries to get turns of User B's session
    cross_turns = await repositories.get_turns(test_db, user_id=user_a, session_id=sess_b.id)
    assert cross_turns == []

    # User A tries to insert turn into User B's session -> PermissionError
    with pytest.raises(PermissionError):
        await repositories.add_turn(test_db, user_id=user_a, session_id=sess_b.id, idx=2, speaker="user", text="Hacked turn")


@pytest.mark.asyncio
async def test_unique_session_idx_enforced(test_db: AsyncSession):
    """Verify unique constraint on (session_id, idx) is strictly enforced."""
    user_id = uuid.uuid4()
    sess = await repositories.create_session(test_db, user_id=user_id, scenario="tech_lead")
    await test_db.commit()

    await repositories.add_turn(test_db, user_id=user_id, session_id=sess.id, idx=1, speaker="ai", text="First turn")
    await test_db.commit()

    with pytest.raises(IntegrityError):
        await repositories.add_turn(test_db, user_id=user_id, session_id=sess.id, idx=1, speaker="user", text="Duplicate idx 1")
        await test_db.commit()
    await test_db.rollback()
