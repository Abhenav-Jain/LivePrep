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

## Step 3B: Follow-ups From the Review of Steps 1 to 3
- **Status**: Completed (one item still missing, see below)
- **Evidence in code**: auth-before-semaphore with `AUTH_TIMEOUT_SECONDS` (see fix section), `backend/requirements-dev.txt` and `.github/workflows/ci.yml`, `python:3.12-slim` runner stage in `Dockerfile`, `AUDIO_SILENCE_RMS_THRESHOLD=100` and `IDLE_WARNING_SECONDS=30` with client `idle_warning` banner.
- **Still missing**: `PLAN.md` 3B item 6 asks for a test proving the pure-Python RMS fallback equals `audioop.rms`; no such test exists yet (`_calculate_audio_rms` has the fallback).

## Step 4.2: Supabase JWT Verification, /api/me, Profile Endpoints, CI
- **Status**: Completed
- **Branch**: `step4-2-jwt-auth-and-profile` (Merged into `main`)
- **Files Changed**: `backend/auth.py` (JWKS-based ES256/RS256 verification, algorithm allowlist, `kid`-based key cache, issuer/audience/expiry checks), `backend/app.py` (`GET /api/me`, `PUT /api/me/profile`), `backend/tests/test_auth.py`, `backend/tests/test_profile.py`, `backend/tests/conftest.py`, `backend/pytest.ini`, `backend/requirements-dev.txt`, `.github/workflows/ci.yml`, `README.md`, `backend/.env.example`, `render.yaml`, `docker-compose.yml`.
- **Commit note**: Steps 4A (ticket store, `/api/ws-ticket`, websocket auth, tools removal, one-active-session-per-user) and 4B (frontend login, auth gate, ticket flow) were implemented but committed inside `8a170fd` ("Step 5: Transcripts..."), so `git log` does not show them as their own step.
- **Verification Results** (re-run 20 Nov 2026 on a clean checkout):
  - Backend: 157 pytest tests pass (`python -m pytest -q`).
  - Frontend: 8 vitest tests pass (`npm test`); `npm run build` passes.

## Step 5: Transcripts and Storage
- **Status**: Completed
- **Branch**: `step5-transcripts-storage`
- **Files Changed**:
  - `backend/transcript.py`: Implemented `TurnAssembler` and `join_fragments`. Normalizes whitespace runs, tracks monotonic millisecond timestamps since session start, caps turns at 8,000 characters and sessions at 2,000 turns. Speaker change queues turns in ready buffer; turns complete on speaker change, `turn_complete`, barge-in, or session `flush()`.
  - `backend/gemini_live.py`: Wired `TurnAssembler` to `GeminiLiveBridge`. Fed input/output audio transcription into assembler, handled barge-in and `turn_complete`, sent `turn_complete` WebSocket message to browser, and flushed assembler on session end.
  - `backend/app.py`: Created turn persistence sink using `repositories.add_turn`, ensuring each turn is saved as it completes. Handled sink exceptions safely without impacting active calls. Added `session_started` message with `session_id` after successful auth. Added `GET /api/sessions` and `GET /api/sessions/{id}/transcript` owner-scoped endpoints.
  - `backend/repositories.py`: Added `list_sessions_with_counts` with turn counts and user scoping.
  - `backend/tests/test_transcript.py`, `backend/tests/test_sessions_api.py`, `backend/tests/test_turn_integration.py`: Added comprehensive unit and integration tests covering assembly, limits, timing, persistence, pagination, and ownership isolation.
  - `frontend/src/audio/transcriptMerge.ts` & `frontend/src/audio/transcriptMerge.test.ts`: Created pure transcript merging function `mergeTranscript` fixing the user bubble fragmentation bug. Installed pinned `vitest@1.6.0` and added `npm test` to `.github/workflows/ci.yml`.
  - `frontend/src/audio/useLiveSession.ts`: Integrated `mergeTranscript`, captured `session_id`, and added client-side AI voice mute/unmute control saved in `localStorage`.
  - `frontend/src/components/SessionsList.tsx` & `frontend/src/components/SessionTranscriptView.tsx`: Built hash-based navigation (`#/`, `#/sessions`, `#/sessions/<id>`) for past sessions and read-only transcripts with responsive Tailwind styling, loading, empty, and error states.
  - `frontend/src/App.tsx`: Added navigation bar tabs, voice mute/unmute button, post-call review prompt banner, and hash route views.
- **Verification Results**:
  - All 156 pytest backend tests passed cleanly (`python -m pytest -q`).
  - All 8 vitest unit tests in frontend passed (`npm test`).
  - Frontend production build passed cleanly (`npm run build`).
- **Needs human check**:
  - In a real call confirm words are not glued together or double spaced; if glued, change the join to insert a space between fragments.


## Step 6: Post-Session Report and Report Page
- **Status**: Completed
- **Branch**: `freebuff/8c9902527b678388fadf49c4` (cloud workspace branch; the plan's `step6-reports` branch name was not used because the workspace is bound to this branch)
- **Decisions**:
  - `overall` is computed **server-side** as a weighted mean of the five skills (fluency 20%, vocabulary 20%, grammar 20%, communication 25%, pace 15%). The model never supplies it, so it cannot be inflated and stays consistent across sessions.
  - `REPORT_MODEL` is required config (no hardcoded model name). Without it, generation stores `failed` with a clear message instead of pretending.
  - Automatic generation is queued as an `asyncio` task after the session row is finalized; `REPORT_AUTO_GENERATE=0` disables it (the test suite sets this so live-flow tests never call the network).
  - The LLM call never holds a DB connection: inputs are read in one short session, the model runs outside any transaction, the result is written in another short session.
  - Short sessions (< 30 user words) skip the model entirely and return guidance with `too_short: true`.
  - The retry endpoint is synchronous (user-triggered, returns the final stored status); automatic generation is asynchronous.
  - Fillers are labelled approximate and pronunciation stays `null` ("coming soon"), per the honesty constraint.
- **Files Changed**:
  - `backend/models.py`: new `Report` model (session_id PK/FK cascade, user_id, status, rubric_version, `metrics_json`, `report_json`, error, timestamps, index on user_id) and `Session.report` relationship.
  - `backend/migrations/versions/9c1f4b7a2d10_create_reports_table.py`: creates `reports` with cascade FK, index and RLS enabled.
  - `backend/reports.py`: `compute_metrics`, `build_report_prompt` (sanitising + delimiters + injection defence), Pydantic `ReportAnalysis` schema, JSON-mode Gemini call with one retry, `run_report_pipeline` (pending -> ready/failed, idempotent), too-short report.
  - `backend/repositories.py`: `get_report`, `upsert_report`, `get_previous_ready_report`, `list_progress_reports`; session list now exposes `report_status` and `overall_score` (one extra query per page, portable across SQLite/Postgres).
  - `backend/app.py`: `GET /api/sessions/{id}/report`, `POST /api/sessions/{id}/report/retry`, `GET /api/progress`, report queue/scheduler, report scheduled after every call.
  - `backend/.env.example`, `render.yaml`, `docker-compose.yml`, `README.md`: `REPORT_MODEL`, `REPORT_AUTO_GENERATE`, `REPORT_LLM_TIMEOUT_SECONDS`, migration and architecture notes.
  - `frontend/src/lib/api.ts`: report/progress types and calls.
  - `frontend/src/components/ReportCharts.tsx`: `ScoreRing`, `ScoreBar` (with deltas), `TrendChart` (dependency-free SVG).
  - `frontend/src/components/ReportView.tsx`: pending polling, failed + retry, too-short state, overall ring, CEFR badge, five score cards + pronunciation "soon", objective metrics, strengths, interview feedback, grammar fixes, words to upgrade, 5-step checklist.
  - `frontend/src/components/ProgressView.tsx`: overall trend chart, best/latest/change, skill averages, recent reports.
  - `frontend/src/App.tsx`, `SessionsList.tsx`, `SessionTranscriptView.tsx`: `#/sessions/<id>/report` and `#/progress` routes, nav tab, post-call banner with report link, score badges.
  - Tests: `backend/tests/test_report_metrics.py`, `test_report_pipeline.py`, `test_reports_api.py`; `backend/tests/conftest.py` sets `REPORT_AUTO_GENERATE=0`.
- **Verification Results** (20 Nov 2026):
  - Backend: `cd backend && python -m pytest -q` -> **185 passed** (157 before Step 6).
  - Frontend: `npm test` -> **8 passed**; `npm run build` (`tsc && vite build`) -> **passed**.
  - `alembic heads` -> `9c1f4b7a2d10 (head)`; the migration itself has **not** been applied to a live database from this workspace.
  - Tests cover: metrics on fixed transcripts, WPM/pauses/fillers/TTR, <30-word short path, model failure -> `failed`, unconfigured model, one retry on invalid output, idempotent regeneration, out-of-range/wrong-length rejection, prompt-injection transcript neutralisation, ownership 404s (identical for foreign/missing/invalid), pending/ready/failed API states, previous-score deltas, retry, progress scoping, and the auto-generation scheduler.
- **Sample generated report JSON** (shape produced by `_assemble_report`, abbreviated):
```json
{
  "rubric_version": "v1",
  "too_short": false,
  "scores": {"fluency": 62, "vocabulary": 58, "grammar": 55, "communication": 70, "pace": 64, "pronunciation": null, "overall": 62},
  "estimated_cefr": "B1",
  "summary": "You answered the behavioural question with a clear story and good detail. Keep results explicit and slow down slightly when you list technical steps.",
  "strengths": ["Clear STAR structure in the project answer", "Confident, natural opening", "Good use of concrete examples"],
  "grammar_mistakes": [{"said": "I have went to the client", "better": "I went to the client", "rule": "Use past simple, not present perfect, with a finished time."}],
  "words_to_upgrade": [{"used": "good", "alternatives": ["strong", "effective", "solid"]}],
  "interview_feedback": {"relevance": 78, "structure": 72, "confidence": 66, "comments": "Answers were relevant; make the Result of each story measurable."},
  "action_plan": [{"step": "Add a measurable result to every story", "daily_exercise": "Rewrite one project story with a number in the result."}],
  "next_session_focus": "Make every project story end with a measurable result.",
  "metrics": {"user_word_count": 212, "words_per_minute": 90.1, "filler_count": 14, "avg_pause_s": 1.8},
  "notes": {"pronunciation": "Audio-based pronunciation analysis coming soon.", "filler": "Approximate: transcription can miss filler words."}
}
```
- **Needs human check**:
  - Run `alembic upgrade head` against the Supabase database (creates `reports`; RLS enabled) and set `REPORT_MODEL` (for example `gemini-2.5-flash`).
  - Complete a real call and confirm the report appears after ~10-40 s, the browser tab title/labels are correct, and scores feel fair.
  - Check a session with background noise / Hinglish to confirm fillers and code-switching are treated sensibly.
  - Confirm report retry on a model failure works in the deployed environment.

## Fix: Cost guards and stuck reports (production safety)
- **Status**: Completed
- **Branch**: `fix/voice-and-report`
- **Why**: the live call and report rebuilds cost money per use and nothing stopped one account from draining the quota; a restart left a report `pending` forever.
- **Files Changed**:
  - `backend/ratelimit.py` (new): `SlidingWindowLimiter` (per-key budget, injectable clock, bounded key count) and `RateLimitError`.
  - `backend/app.py`: `lifespan` startup hook that calls `_recover_pending_reports()`; daily practice allowance checked before a session starts (fails open on a database error); `usage` added to `GET /api/me`; report retry limited per user (`429` + `Retry-After`); `REPORT_SEMAPHORE` around report jobs.
  - `backend/repositories.py`: `seconds_used_since()` and `list_pending_reports()` (pending reports whose session has already ended).
  - `backend/.env.example`, `render.yaml`, `docker-compose.yml`, `README.md`: `DAILY_MINUTES_LIMIT`, `MAX_CONCURRENT_REPORT_JOBS`, `REPORT_RETRY_LIMIT`, `REPORT_RETRY_WINDOW_SECONDS`, `REPORT_RECOVERY_LIMIT`.
  - `backend/tests/test_limits_and_recovery.py` (new) and `backend/tests/conftest.py` (clears the retry limiter between tests).
- **Verification Results** (22 Nov 2026):
  - `cd backend && python -m pytest -q` -> **208 passed** (195 before).
  - Tests cover: limiter budget/window/sliding/disabled/per-key isolation; `usage` in `/api/me` with a limit and with the limit disabled; call refused at the limit and allowed below it; retry `429` with `Retry-After`; a foreign session's retry spending no budget; startup recovery rescheduling a pending report and skipping ready reports and live sessions; recovery with no database.
- **Needs human check**: after a real call, `/api/me` should show today's minutes; sit through the limit once (or set `DAILY_MINUTES_LIMIT=1`) to see the refusal message.

## Feature: Daily practice allowance visible in the app (live usage timer)
- **Status**: Completed
- **Branch**: `fix/voice-and-report`
- **Why**: the daily limit was enforced by the server but invisible to the user; they only learned about it when a call was refused. The allowance is now shown everywhere in the app and counts down during a call.
- **Files Changed**:
  - `backend/app.py`: `_practice_usage()` also returns `used_seconds` (exact seconds today, so the client can show a precise timer); limit logic unchanged.
  - `frontend/src/lib/api.ts`: `PracticeUsage` / `MeResponse` types and `fetchMe()`.
  - `frontend/src/lib/usage.ts` (new): pure helpers (`limitSecondsFor`, `baseUsedSeconds`, `usedSecondsFor`, `remainingSecondsFor`, `usageTone`, `formatDuration`, `formatClock`).
  - `frontend/src/lib/usePracticeUsage.ts` (new): fetches `/api/me`, counts the connected call second by second locally (the server stores a session only when it ends), refreshes when the call ends and every 5 minutes / on window focus.
  - `frontend/src/components/UsageMeter.tsx` (new): `UsagePill` (header, always visible, tones green/amber/red, pulsing dot while live) and `UsageCard` (practice view: used / limit bar, current call timer, "resets at midnight UTC").
  - `frontend/src/App.tsx`: wires the hook, the header pill and the practice-view card.
  - `backend/tests/test_limits_and_recovery.py`, `frontend/src/lib/usage.test.ts` (new), `README.md`, `PROGRESS.md`.
- **Verification Results**: backend `python -m pytest -q` and frontend `npm run test` + `npm run build` (see the run log in the conversation).
- **Decisions**: the running call is counted client-side and reconciled with the server after the call ends, because `sessions.duration_s` is written on session end. When `DAILY_MINUTES_LIMIT=0` the UI shows total time used with "no daily limit" instead of a countdown.
- **Needs human check**: start a call and confirm the header pill counts down every second and the card shows "This call m:ss"; end the call and confirm the total stops at the server value; set `DAILY_MINUTES_LIMIT=1` to see the amber/red states.

## Feature: General communication coach (not an interview coach)
- **Status**: Completed
- **Branch**: `fix/voice-and-report`
- **Why**: the live model behaved like an interviewer, so every call turned into job/role preparation. The product goal is free-flow English practice: anyone (technical or non-technical) should be able to talk about any topic and improve flow, grammar, vocabulary, pronunciation and confidence.
- **Files Changed**:
  - `backend/gemini_live.py`: new `SYSTEM_INSTRUCTION` - a warm English and communication coach, not an interviewer. It lets the user pick any topic, never assumes a job/role/field, never tests domain knowledge, recasts mistakes gently in the flow with one tip at a time, offers one better word, gives one pronunciation/accent tip from the audio, matches the speaker's level, encourages Hinglish users towards English, and only does interview practice if the user explicitly asks.
  - `backend/reports.py`: assessment prompt rewritten for a general communication rubric (clarity instead of interview relevance); `CommunicationFeedback` (`clarity`, `structure`, `confidence`, `comments`) replaces `InterviewFeedback` (`relevance`, ...); transcript is labelled `SPEAKER`/`COACH`; too-short guidance uses everyday speaking exercises; text is described as "untrusted speaker data"; pronunciation is explicitly not guessed from text.
  - `backend/app.py`: new conversation modes (`free_talk`, `everyday`, `storytelling`, `discussion`, `presentation`, `pronunciation`), default `free_talk`; legacy interview modes stay allowlisted for older clients. Profile `Goal` gains communication goals (`fluency`, `grammar`, `vocabulary`, `pronunciation`, `confidence`, `public_speaking`) while old values remain valid.
  - Frontend: `ReportView` shows "Communication feedback" (Clarity / Structure / Confidence) and still reads old stored reports via `interview_feedback`; `api.ts` has `CommunicationFeedback` + `LegacyInterviewFeedback`; `App.tsx`, `TranscriptView.tsx` (free-flow prompts + "Coach" label), `LoginScreen.tsx`, `SessionsList.tsx`, `ProgressView.tsx`, `SessionTranscriptView.tsx`, `ToolActivityCard.tsx` copy no longer says interviewer/mock interview.
  - `README.md`, `AGENT_CONTEXT.md`, `PROGRESS.md`: product description updated.
- **Decisions**: the report JSON key was renamed, not versioned, because `rubric_version` is already `v1` for old rows and the frontend reads both shapes. Audio is still not stored, so accent/pronunciation is coached live in conversation and remains unscored in the report.
- **Needs human check**: start a call and confirm the coach asks for a topic, does not behave like an interviewer, and never asks about a job/role; check a report shows Clarity/Structure/Confidence; confirm an older session report still renders.
