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
- **Follow-up (language rule)**: when the user switches to Hindi or Hinglish, the coach now stays in simple English, acknowledges the point in one English sentence, hands them the exact English sentence to repeat (or two-three words / a sentence starter if they are stuck), recasts mixed sentences fully in English and asks them to say it again - kindly, without lecturing or shame. Interview practice is only on explicit request.
- **Needs human check**: start a call and confirm the coach asks for a topic, does not behave like an interviewer, and never asks about a job/role; switch to Hindi/Hinglish mid-call and confirm it guides you back to English with a sentence to repeat; check a report shows Clarity/Structure/Confidence; confirm an older session report still renders.

## Feature: v2 — coach memory, Word Bank (spaced repetition), practice insights, production hardening
- **Status**: Completed
- **Why**: the app ended at "report after a call". Nothing carried over between sessions, feedback was read once and forgotten, and the only motivation was a daily minute cap. v2 turns it into a practice loop: the coach remembers you, your words come back until you know them, and progress is visible. It also adds the operational pieces a real deploy needs.
- **Backend (new modules)**:
  - `backend/coach_context.py` (new): `build_learner_context()` turns profile + last ready report (`next_session_focus`, grammar patterns, words to reuse) + due word-bank cards + today's focus into one sanitised, length-capped prompt block; `compose_system_instruction()` appends it to the coach instruction.
  - `backend/wordbank.py` (new): term cleaning/de-duplication keys, defensive report extraction (vocabulary + grammar cards), `schedule_review()` (again +10 min, good 1→2→4… days, easy 3 days ×2.5, cap 180), `is_due()`, `summarize()`, `daily_goal_hint()`. Pure and unit tested.
  - `backend/insights.py` (new): `practice_days()`, `current_streak()` (today or yesterday anchor), `week_start()` (Monday UTC), `compute_insights()` (totals, weekly goal, averages, strongest/weakest skill, improvement).
- **Backend (existing files)**:
  - `backend/models.py`, `backend/migrations/versions/b7e2d4c9a105_create_vocabulary_items_table.py` (new): `vocabulary_items` table (user-scoped, unique per user+term_key, review state, RLS enabled like the other tables).
  - `backend/repositories.py`: `latest_ready_report`, `list_sessions_for_stats`, word-bank CRUD (`list_wordbank`, `get_wordbank_item`, `add_wordbank_item` with duplicate-safe insert, `sync_wordbank_from_report`, `apply_review`, `delete_wordbank_item`).
  - `backend/reports.py`: optional `best_moment` field in the schema/prompt/assembled report (backwards compatible), and a best-effort `_sync_wordbank()` after a ready report (a word-bank failure never fails the report; rebuilding a report does not duplicate cards).
  - `backend/gemini_live.py`: `GeminiLiveBridge(learner_context=...)` folds the block into the live system instruction.
  - `backend/app.py`: `GET/POST /api/wordbank`, `POST /api/wordbank/{id}/review`, `DELETE /api/wordbank/{id}`, `GET /api/stats`; WS auth message accepts an optional `focus` (capped at 160 chars) used for the coach context; `/api/version`, `/api/ready` (SELECT 1); security-headers + request-id middleware; generic 500 handler. `/api/health` unchanged.
- **Frontend**:
  - `frontend/src/components/WordBankView.tsx` (new): counts, one-card practice (Show answer → Again / Good / Easy), add-your-own form, full list with delete.
  - `frontend/src/lib/api.ts`: word-bank + stats types/functions, `best_moment` on `ReportAnalysis`.
  - `frontend/src/App.tsx`: Word Bank tab with due-count badge, `#/words` route, "Today's focus" input, focus passed to `connect()`.
  - `frontend/src/audio/useLiveSession.ts`: `connect(focus?)` sends the focus in the auth message only.
  - `frontend/src/components/ProgressView.tsx`: habit cards (streak, weekly goal + progress bar, total minutes, words due) and a "weakest area" hint.
  - `frontend/src/components/ReportView.tsx`: "Your best moment" quote and a "Practise these words" action.
- **Tests added**: `test_wordbank.py` (13), `test_insights.py` (8), `test_coach_context.py` (6), `test_wordbank_api.py` (5, including report→deck sync and no duplicates on rebuild), `test_stats_api.py` (7: stats, per-user isolation, readiness, version, headers).
- **Verification Results**: `backend/.venv/bin/python -m pytest -q` → 250 passed; `npm test` → 17 passed; `npm run build` → success (498 kB / 134 kB gzip).
- **Decisions**: the word bank stores no audio and no transcript snippets beyond the corrected sentence; streaks count sessions of at least 30 s so an accidental 5-second tap does not fake a habit; `WEEKLY_SESSION_GOAL` is a target only (never an access limit); the focus text is per-call and not persisted, so no new column was needed.
- **Needs human check**: start a call with a focus typed and confirm the coach opens on that topic and remembers the previous report's advice; finish a 30+ word session and confirm cards appear in `#/words`, then review one and see the next date change; check a report shows "Your best moment"; confirm the header badge counts down after reviews; run `alembic upgrade head` on a real Supabase database (SQLite tests do not exercise the migration).

## UI/UX Revamp: Premium Interface Pass
- **Status**: Completed (frontend only; no backend, audio or API behaviour changed)

- **Design system**:
  - `frontend/tailwind.config.js`: new ink-and-iris palette (`background #07080B`, `surface #0E1016`, `primary #7C6CFF` with `hover`/`glow`/`deep`), `font-display` = Instrument Serif for headings, `boxShadow.card/lift/glow`, `rounded-4xl`, and motion tokens (`fade-up`, `fade-in`, `scale-in`, `breathe`).
  - `frontend/src/index.css`: layered radial background, refined scrollbars, `:focus-visible` ring, `text-wrap: balance`, `prefers-reduced-motion` guard, and shared component classes (`.panel`, `.panel-strong`, `.card-hover`, `.btn*`, `.field`, `.chip`, `.skeleton`, `.eyebrow`).
  - `frontend/src/components/ui.tsx` (new): `Page`, `PageHeader`, `SectionCard`, `StatTile`, `SkeletonLines`, `ErrorNote`, `EmptyState`, `RefreshButton`, `cx`.
  - `frontend/index.html`: correct title/description/theme colour, Instrument Serif added to the font request.

- **Navigation and shell** (`frontend/src/App.tsx`):
  - Desktop sidebar (brand, workspace nav with due-count badge, status card, account row) replaces the cramped header tabs; mobile gets a bottom tab bar with an active indicator and a compact header.
  - Header now carries only ambient state: connection status, daily-allowance pill, mute and echo-shield toggles, settings. The duplicate "Start call" header button was removed — the cockpit dock is the single primary action.
  - Coaching tools panel is collapsible (closed by default) so the transcript owns the space; practice panel is limited width on desktop and stacks on mobile.

- **Screens restyled on the shared primitives**: `LoginScreen.tsx` (split brand/story + form), `TranscriptView.tsx`, `UsageMeter.tsx`, `ReportCharts.tsx`, `ProgressView.tsx`, `WordBankView.tsx`, `SessionsList.tsx`, `SessionTranscriptView.tsx`, `ReportView.tsx`, `SettingsModal.tsx` (Escape/backdrop close), `ToolActivityCard.tsx`, `ScreenPreview.tsx`, `AuthGate.tsx`.
  - Loading states use skeletons instead of spinners where content is known; empty and error states are consistent.
  - Word bank gained a client-side search over term/alternatives/note and a "next review" label per card.

- **Unchanged on purpose**: `VoiceOrb.tsx`, `audio-player.ts`, `pcm-recorder.worklet.js`, `useLiveSession.ts` and every backend file. No new dependency was added (no icon or animation library).

- **Verification Results**: `npm run build` → success (496 kB / 137 kB gzip, tsc strict clean); `npm test` → 17 passed. Visually checked the practice cockpit at 1280x800 and 390x844 through a temporary preview entry (`dev-preview.html` + `src/devPreview.tsx`), both since removed along with the temporary `allowedHosts` edit to `vite.config.ts`.

- **Decisions**: kept the existing hash router (no routing library), kept the dependency-free SVG charts, and reused the existing palette token names (`primary`, `surface`, `background`) so no page needed a behavioural change. `VoiceOrb`'s internal "OMNICOPILOT READY" label was left alone because that file is on the do-not-touch audio list.

- **Needs human check**: signed-in pass over every page in the real app (login → practice → report → word bank → progress → sessions); a live call to confirm the orb, vision preview and tool cards sit correctly in the new panels; mobile Safari/Chrome safe-area spacing on the bottom nav; dark-mode contrast on a low-brightness laptop screen.

## UI/UX Revamp: Feedback Pass (Small-Laptop Fixes)
- **Status**: Completed (frontend only)

- **Layout**: the practice panel is now a height-aware flex column on desktop (`lg:h-full lg:min-h-0`) with a `flex-none` control block, so "Start session", the mic toggle and the message box can never be clipped. The orb is a shrinking middle region (`flex-1 min-h-0`) and its canvas is sized with `clamp(112px, 24vh, 216px)` via the new `.orb-stage` rule in `index.css`; on mobile it uses a fixed `clamp(160px, 26vh, 240px)` stage.
- **One status, one clock**: the sidebar "Status / disconnected" card was removed (status lives only in the header, with a larger dot and label), and the header usage pill was removed so today's allowance appears once, in the card. `resetTimeLabel()` in `lib/usage.ts` converts the server's UTC midnight into local time, so the card reads "Resets at 5:30 AM" in IST instead of quoting UTC.
- **Prototype leftovers removed**: screen-share and camera dock buttons, the `ScreenPreview` overlay, the "share your screen" empty-state copy and the dead "Coaching tools" panel are gone from the practice screen (the components and hooks stay in the codebase; nothing audio-related changed).
- **Controls**: the mic button is now a labelled toggle ("Mute"/"Unmute") that shows a normal `Mic` icon when no call is running, and the panel explains the disabled state ("Mic and chat unlock when the session starts. Headphones give the cleanest audio."). The start button reads "Start session" / "Connecting…" / "End session".
- **Readability**: `.eyebrow` is 11px, semi-bold, lower tracking and `slate-400` instead of 10px mono at `slate-500`; `.chip` is 11px sentence case. `font-mono` was removed across components and `font-display` now survives only on the LivePrep wordmark (sidebar/mobile/login) and the login headline, so serif is a signature rather than a third voice.
- **Transcript empty state**: shorter copy, arrow affordances on the opener cards, and clicking one starts a call with that opener as `focus` (instead of only connecting); during a live call it is sent as a message.
- **Focus field**: stronger border (`border-white/20`, `bg-black/40`) and four one-tap presets (Past tense, Small talk, Storytelling, Interview prep) that fill the field.
- **Personalisation**: the sidebar greets with "Good morning/afternoon/evening, <first name>" from the account email plus one actionable line that switches to the word-bank due count when cards are waiting.
- **Verification Results**: `npm run build` → success (484 kB / 135 kB gzip, tsc strict clean); `npm test` → 17 passed. Measured in a real browser at 1366x650: session panel 80–634 px inside a 650 px viewport, "Start session" fully visible at 478–522 px, no "Coaching tools"/"share your screen" text, local reset label rendered. Mobile 390x844: no horizontal overflow.
- **Needs human check**: a signed-in pass with real usage numbers (the preview shows "unavailable" because the API is not reachable from the cloud workspace), and a live call to confirm the labelled mic toggle reflects the real mute state.
