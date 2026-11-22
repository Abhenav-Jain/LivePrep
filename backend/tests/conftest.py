"""Shared test configuration.

Environment defaults are applied BEFORE any test module imports the application, so the
app's fail-closed startup checks pass without touching real credentials. Real values from a
developer's .env file are never needed for tests, and tests never talk to a real database.
"""
import asyncio
import os
import uuid

import pytest

os.environ.setdefault("GEMINI_API_KEY", "test_gemini_api_key_valid")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:8000")
os.environ.setdefault("SUPABASE_URL", "https://test-project.supabase.co")
# No live-flow test should ever reach the report model (network + cost). Report tests
# call the pipeline directly with a mocked model.
os.environ.setdefault("REPORT_AUTO_GENERATE", "0")


@pytest.fixture(autouse=True)
def _reset_app_state():
    """Every test starts with no tickets and no active users."""
    import app

    app.ticket_store.clear()
    app.ACTIVE_USERS.clear()
    app.REPORT_RETRY_LIMITER.clear()
    yield
    app.ticket_store.clear()
    app.ACTIVE_USERS.clear()
    app.REPORT_RETRY_LIMITER.clear()


@pytest.fixture
def make_ticket():
    """Factory: returns a valid one-time WebSocket ticket for a (new or given) user."""
    import app

    def _make(user_id=None):
        return app.ticket_store.issue(user_id or uuid.uuid4())

    return _make


@pytest.fixture
def ws_db(tmp_path, monkeypatch):
    """Temporary SQLite database wired into the app (never the real DATABASE_URL)."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
    from sqlalchemy.pool import NullPool

    import app
    import models

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'ws.db'}", poolclass=NullPool)

    async def _create():
        async with engine.begin() as conn:
            await conn.run_sync(models.Base.metadata.create_all)

    asyncio.run(_create())
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(app, "AsyncSessionLocal", factory)
    yield factory
    asyncio.run(engine.dispose())


@pytest.fixture
def read_sessions(ws_db):
    """Returns a function that loads all rows of the sessions table from the temporary DB."""
    from sqlalchemy import select

    import models

    def _read():
        async def _run():
            async with ws_db() as db:
                result = await db.execute(select(models.Session))
                return list(result.scalars())

        return asyncio.run(_run())

    return _read
