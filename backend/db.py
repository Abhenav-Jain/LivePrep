import os
from typing import AsyncGenerator
from urllib.parse import urlparse
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import (
    create_async_engine,
    async_sessionmaker,
    AsyncSession,
    AsyncEngine,
)

load_dotenv()


def get_async_db_url(raw_url: str) -> str:
    """Converts a standard PostgreSQL connection URL to an asyncpg URL.
    Handles 'postgresql://' or 'postgres://' -> 'postgresql+asyncpg://'.
    """
    clean_url = raw_url.strip()
    if clean_url.startswith("postgresql+asyncpg://"):
        return clean_url
    if clean_url.startswith("postgres://"):
        return "postgresql+asyncpg://" + clean_url[len("postgres://") :]
    if clean_url.startswith("postgresql://"):
        return "postgresql+asyncpg://" + clean_url[len("postgresql://") :]
    return clean_url


def create_engine_from_url(database_url: str) -> AsyncEngine:
    async_url = get_async_db_url(database_url)
    parsed = urlparse(async_url)

    # Pool settings configurable via environment variables
    pool_size = int(os.getenv("DB_POOL_SIZE", "5"))
    max_overflow = int(os.getenv("DB_MAX_OVERFLOW", "10"))
    pool_timeout = float(os.getenv("DB_POOL_TIMEOUT", "30.0"))
    pool_recycle = int(os.getenv("DB_POOL_RECYCLE", "1800"))

    connect_args = {}

    # Supabase Transaction Pooler (port 6543) does not support prepared statement caches.
    # When port is 6543, prepared_statement_cache_size must be set to 0.
    if parsed.port == 6543 or "pooler.supabase.com" in (parsed.hostname or ""):
        connect_args["prepared_statement_cache_size"] = 0

    if "sqlite" in async_url:
        return create_async_engine(async_url, echo=False)

    return create_async_engine(
        async_url,
        pool_size=pool_size,
        max_overflow=max_overflow,
        pool_timeout=pool_timeout,
        pool_recycle=pool_recycle,
        connect_args=connect_args,
        echo=False,
    )


DATABASE_URL = os.getenv("DATABASE_URL", "")

if DATABASE_URL:
    engine = create_engine_from_url(DATABASE_URL)
    AsyncSessionLocal = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
else:
    engine = None
    AsyncSessionLocal = None


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """Helper generator to obtain an async database session."""
    if AsyncSessionLocal is None:
        raise RuntimeError("DATABASE_URL is not configured in environment.")
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
