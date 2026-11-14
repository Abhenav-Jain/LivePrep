# Project Progress: LivePrep

## Step 1: Remove Dangerous Capabilities
- **Status**: Completed
- **Branch**: `step1-remove-dangerous-capabilities` (Merged into `main`)

## Step 2: Deployment Config and Secrets
- **Status**: Completed
- **Branch**: `step2-deployment-config-and-secrets` (Merged into `main`)

## Step 3: Reliability Fixes in backend/gemini_live.py and backend/app.py
- **Status**: Completed
- **Branch**: `step3-reliability-fixes`
- **Files Changed**:
  - `backend/gemini_live.py`:
    - Fixed task exception handling after `asyncio.wait(..., FIRST_COMPLETED)`: pending tasks are cancelled and awaited, then done tasks have `.exception()` retrieved and re-raised to trigger session reconnection. If `send_task` finished cleanly without exceptions (client disconnected), `_session_closed=True` is set and reconnect is skipped.
    - Defined `GoAwayReconnect(Exception)` raised when Gemini Live API sends a `go_away` signal. Caught in `run_session()` to reconnect immediately with the preserved `resume_handle` without penalizing the failed attempt counter.
    - Reset the reconnect attempts counter to 0 whenever a session connection stays healthy for 30+ seconds.
    - Added input boundaries in `_client_to_gemini`: drops binary frames >64KB, drops JSON messages >1MB, drops base64 audio >64KB, and ignores unknown message types.
    - Added session limits: max duration (`MAX_SESSION_MINUTES`, default 20 min) and user audio idle timeout (`IDLE_TIMEOUT_SECONDS`, default 120s based on PCM 16kHz audio RMS energy exceeding silence threshold), notifying the client and ending gracefully on timeout.
  - `backend/app.py`:
    - Resolved concurrency hang: calls `await websocket.accept()` first. If `SESSION_SEMAPHORE.locked()`, sends `{"type":"error","message":"Server is busy, please try again in a few minutes."}` and cleanly closes with code `1013`. Otherwise executes inside the semaphore.
  - `Dockerfile`:
    - Added `--ws-max-size 1048576` (1MB) to uvicorn command.
  - `backend/.env.example`:
    - Documented `MAX_SESSION_MINUTES=20` and `IDLE_TIMEOUT_SECONDS=120`.
  - `backend/tests/test_reliability.py`:
    - Added unit tests for: reconnect after exception, go_away reconnect using resume_handle, server busy path (code 1013), and oversized input limits.

- **Verification Results**:
  - All 12 pytest unit tests in `backend/tests/` passed cleanly (`test_app.py`, `test_reliability.py`, `test_tools.py`).
  - Frontend `npm run build` passed cleanly with no TypeScript or bundling errors.

- **Needs human check**:
  - Simulate network drop during an active voice session to verify seamless user reconnect in browser.

## Fix: Authenticate Client Before Acquiring Session Semaphore
- **Status**: Completed
- **Branch**: `fix-auth-before-semaphore`
- **Files Changed**:
  - `backend/app.py`: Reordered WebSocket lifecycle: (1) check origin, (2) `await websocket.accept()`, (3) await first message with configurable timeout (`AUTH_TIMEOUT_SECONDS`, default 10s) using `asyncio.wait_for`. On timeout, invalid JSON, wrong message type, or token mismatch, logs `"Authentication failed"` and closes with code `1008` without touching `SESSION_SEMAPHORE`. (4) Only after successful authentication checks `SESSION_SEMAPHORE.locked()`, rejecting with code `1013` and busy message if full, otherwise acquires semaphore and runs session.
  - `backend/.env.example`: Added `AUTH_TIMEOUT_SECONDS=10`.
  - `backend/tests/test_auth_semaphore.py` & `backend/tests/test_reliability.py`: Added tests verifying auth timeout closing 1008 without locking semaphore, unauthenticated floods not blocking authenticated clients, authenticated busy 1013 path, and log privacy (no token lengths or values).
- **Verification Results**:
  - All 16 pytest tests in `backend/tests/` passed.

## Step 4.1: Database Foundation (Supabase / PostgreSQL)
- **Status**: Completed
- **Branch**: `step4-1-database-foundation`
- **Connection-Mode & Pooler Decision**:
  - Supabase supports Session pooler (port 5432) and Transaction pooler (port 6543 via PgBouncer / Supavisor).
  - Transaction pooling does not support named prepared statements. In `backend/db.py`, when connecting to port `6543` or `*.pooler.supabase.com`, `prepared_statement_cache_size=0` is automatically configured on `connect_args` for `asyncpg`.
  - Configurable pool options via environment variables: `DB_POOL_SIZE` (default: 5), `DB_MAX_OVERFLOW` (default: 10), `DB_POOL_TIMEOUT` (default: 30s), and `DB_POOL_RECYCLE` (default: 1800s).
- **Exact Migration Commands**:
  - Apply migrations: `cd backend && uv run --python .venv\Scripts\python.exe alembic upgrade head` (or `alembic upgrade head`)
  - Create new migration: `cd backend && uv run --python .venv\Scripts\python.exe alembic revision --autogenerate -m "<description>"`
- **Files Changed**:
  - `backend/models.py`: Declarative SQLAlchemy 2 typed models for `profiles`, `sessions`, and `turns` with GUID type decorator (UUID natively on Postgres, CHAR(36) on SQLite), unique constraint on `(session_id, idx)`, cascade delete from session to turns, and indexes on `user_id` and `(session_id, idx)`.
  - `backend/db.py`: Async engine and session factory (`create_async_engine`, `async_sessionmaker`, `get_db_session`).
  - `backend/repositories.py`: Data access functions (`create_session`, `get_session`, `list_sessions`, `add_turn`, `get_turns`) strictly requiring `user_id` and filtering by it.
  - `backend/alembic.ini`, `backend/migrations/env.py`, `backend/migrations/versions/44ff8b38f8b8_create_profiles_sessions_and_turns_.py`: Configured Alembic with `DATABASE_URL` and applied migration enabling RLS on `profiles`, `sessions`, and `turns`.
  - `backend/tests/test_db_repositories.py`: Test suite testing session creation, turn ordering, user isolation, and unique constraint enforcement on an isolated in-memory SQLite database.
  - `backend/requirements.txt`: Pinned `sqlalchemy==2.0.57`, `asyncpg==0.32.0`, `alembic==1.20.1`, `aiosqlite==0.22.1`, `greenlet==3.5.6`, `psycopg2-binary==2.9.13`.
  - `backend/.env.example`: Added `DATABASE_URL` and pool configuration variables.
  - `render.yaml` & `docker-compose.yml`: Added `DATABASE_URL`.
  - `README.md`: Documented Alembic migration commands and RLS rationale.
- **Verification Results**:
  - Ran `alembic upgrade head` against Supabase database: executed cleanly.
  - Verification script confirmed all 3 tables exist in PostgreSQL with `rowsecurity = True` (RLS enabled).
  - All 20 pytest unit tests passed (`test_app.py`, `test_auth_semaphore.py`, `test_db_repositories.py`, `test_reliability.py`, `test_tools.py`).
  - Frontend `npm run build` completed cleanly without errors.
- **Needs human check**:
  - None for Part 4.1 (database foundations verified against live database).
