# LivePrep: Execution Plan (revised 14 Nov 2026)

Goal: a functional, safe, demo-ready product, then a production-grade one. Students log in, have a live voice mock interview, see their speech in a live transcript, every session is stored, and after each session they get a report (fluency, vocabulary, grammar, communication, pace, pronunciation) with a personal improvement plan.

How to work: follow `AGENT_CONTEXT.md`. Execute steps strictly in order, one step per branch, verify, commit, merge locally, update `PROGRESS.md`. `PROGRESS.md` is the status source, but if it disagrees with `git log`, trust git and fix `PROGRESS.md`.

---

## STATUS SNAPSHOT (verified against code)

| Step | Name | Status |
|---|---|---|
| 0 | Baseline (tests, CI) | PARTIAL: pytest exists, but no CI and no requirements-dev.txt (done in Step 3B) |
| 1 | Remove dangerous tools, non-root Docker | DONE |
| 2 | Deploy config and secrets | DONE |
| 3 | Stability fixes | DONE (12 tests pass) |
| 3B | Follow-ups from review | DONE (except the audioop-fallback test) |
| 4 | Auth (Supabase) + Postgres | DONE (4.1 DB, 4.2 JWT/API, 4A/4B bundled into the Step 5 commit) |
| 5 | Transcripts and storage | DONE (157 tests, 8 vitest, build green on 20 Nov 2026) |
| 6 | Reports | DONE (metrics, rubric v1, report/progress endpoints + UI, 185 backend tests) |
| 7 | Personalization | TODO (next) |
| 7 | Personalization | TODO |
| 8 | Demo-ready cleanup | TODO |
| 9-16 | Production improvements (Phase 2) | TODO, after the demo |

Decisions already made (do not revisit without asking): Supabase Auth (Google + email OTP) and Supabase Postgres; SQLAlchemy 2 async + Alembic; models come only from env vars; no client-supplied API keys; no terminal/file tools in the product; honest pronunciation handling (no fake scores).

---

# PHASE 1: Demo-ready (Steps 3B to 8)

## Step 3B: Follow-ups from the review of Steps 1 to 3
Problems found in the current code:
1. `app.py` acquires `SESSION_SEMAPHORE` before authentication and the first auth message has no timeout, so unauthenticated clients can hold all slots and lock out real users.
2. The auth failure log prints token lengths (information leak).
3. No CI and no dev requirements file; tests only run if someone installs pytest manually.
4. Dockerfile uses `python:3.10-slim`.
5. Idle timeout uses an RMS threshold (150), which may treat quiet speakers as idle.

Tasks:
1. Authenticate first, with a 10 second timeout on the first message (close 1008 on timeout), then acquire the semaphore. Keep the 1013 "server busy" response for authenticated users (send it after auth, before starting the session).
2. Log only "authentication failed" with no lengths.
3. Add `backend/requirements-dev.txt` (pytest, pytest-asyncio, httpx, pinned), set `asyncio_default_fixture_loop_scope = function` in `pytest.ini`, add `.github/workflows/ci.yml` (backend: install requirements + dev requirements + pytest; frontend: `npm ci && npm run build`).
4. Upgrade the base image to `python:3.12-slim`, confirm requirements install. Note: `audioop` is removed in Python 3.13, so keep the existing pure-Python fallback in `_calculate_audio_rms` and add a test that the fallback gives the same result as `audioop.rms` where available.
5. Make the silence threshold and idle behavior easy to tune: keep `AUDIO_SILENCE_RMS_THRESHOLD` env (document it in `.env.example`), lower the default to 100, and send the client a `session_status: idle_warning` message 30 seconds before the idle timeout so the UI can show "Are you still there?". Add the warning handling in the frontend (small banner).
6. Tests: auth timeout, unauthenticated clients cannot occupy slots, idle warning is sent, RMS fallback equals audioop.

Done when: pytest and frontend build pass locally and in the CI workflow file (syntax valid), PROGRESS.md updated.

---

## Step 4: Per-user auth (Supabase) and real database (Postgres)
Human prerequisites (if missing, STOP and ask): `backend/.env` has `DATABASE_URL`, `SUPABASE_URL` (and any JWT verification setting); `frontend/.env` has `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Supabase Email and Google providers enabled, redirect URL `http://localhost:3000` added.

### 4A Backend
1. Check the CURRENT Supabase docs for verifying access-token JWTs (asymmetric JWKS vs legacy shared secret) and implement the correct current method with PyJWT (signature, expiry, audience, issuer). FastAPI dependency `current_user` returns the user id (`sub`). Cache JWKS.
2. Alembic migration, tables:
   - `profiles(user_id PK, display_name, goal, target_role, level, native_language, correction_style, created_at, updated_at)`
   - `sessions(id uuid PK, user_id, scenario, started_at, ended_at, duration_s, status)`
   - `turns(id, session_id FK, user_id, idx, speaker, text, started_at_ms, ended_at_ms)`
   - indexes on `user_id` and `(session_id, idx)`.
3. Enable Row Level Security on these tables in the migration (deny by default; the backend connects with its own role). Document this in the README.
4. `POST /api/ws-ticket` (Bearer JWT required): single-use ticket (`secrets.token_urlsafe(32)`), valid 60 s, in-memory TTL dict (leave `TODO: move to Redis when running multiple instances`). Returns `{"ticket": ...}`.
5. `/ws/live`: first message `{"type":"auth","ticket":"..."}` (10 s timeout). Consume the ticket (single use, expiry checked) to get `user_id`, else close 1008. Remove `LIVEPREP_TOKEN` and its startup check entirely. Order: origin check, accept, auth, then semaphore. After auth, create the `sessions` row **server-side** and pass `session_id` and `user_id` into `GeminiLiveBridge`. Max 1 active session per user (reject a second one with a clear message).
6. `tools.py`: remove `save_note`, `score_answer`, `get_progress` and all SQLite code. Tools must never take `session_id` or `user_id` from the model. `search_web` is not needed for interview coaching; remove it unless it is clearly useful (if kept: output wrapped as untrusted data, truncated). Update `SYSTEM_INSTRUCTION` accordingly.
7. `GET /api/me`, `PUT /api/me/profile` with validation and length limits (enums allowlisted).
8. Update `.env.example`, `render.yaml`, `docker-compose.yml`, README (env vars, `alembic upgrade head`). Run the migration against the configured database.

### 4B Frontend
1. Add `@supabase/supabase-js`, config via `frontend/.env`, add `frontend/.env.example`.
2. Clean, mobile-friendly login screen in the existing Tailwind style: "Continue with Google" and email sign-in (OTP or magic link), logout, session persistence, loading state.
3. Auth gate: before connecting the WebSocket call `POST /api/ws-ticket` with the Bearer token, connect, send `{"type":"auth","ticket":...}`. Remove the LivePrep token input, `omni_liveprep_token` localStorage and the related Settings fields (purge the old localStorage key on load).
4. Friendly UI errors with Retry: expired login, server busy, ticket failure.

Done when: pytest covers invalid/expired/reused ticket, wrong-audience JWT, auth timeout, user A cannot read user B's rows, one-active-session-per-user; `npm run build` passes; migration applied. Needs human check: Google login, email login, refresh keeps login, logout, voice session connects.

---

## Step 5: Correct transcripts and persistent storage
Backend (`gemini_live.py`):
1. Handle `content.turn_complete` and speaker switches to close turns. Buffer transcription fragments per speaker; on turn end join them correctly (no broken words, no double spaces) and insert into `turns` with `speaker`, `idx`, `text`, `started_at_ms`, `ended_at_ms`.
2. Timing is server-side: session timeline in ms from `time.monotonic()`, cross-checked with user audio byte count (16 kHz, 16-bit mono = 32 bytes per ms). Never trust client timestamps.
3. Send the client `{"type":"turn_complete","speaker":...}`.
4. On session end for any reason, set `ended_at`, `duration_s`, `status` in a `finally` block. Persist turns incrementally (not only at the end) so a crash does not lose the transcript.
5. `GET /api/sessions` (current user, newest first, paginated), `GET /api/sessions/{id}/transcript` (404 if not owned).

Frontend:
6. `useLiveSession.ts`: user transcription currently creates a new bubble per fragment. Merge fragments into the current user bubble (like agent logic); start a new bubble only after `turn_complete` or a speaker change. Use `crypto.randomUUID()` for ids.
7. "Past sessions" list and a transcript page that loads saved turns from the API.

Done when: pytest covers fragment joining and turn logic; build passes. Needs human check: a long sentence shows as one bubble; after refresh the past session appears with its transcript.

---

## Step 6: Post-session report and report page
Honesty constraint: audio is not stored and Gemini's transcript normalizes mispronunciations. Do NOT fabricate a pronunciation score: set `pronunciation = null` with the note "Audio-based pronunciation analysis coming soon" (delivered in Step 12). Transcripts may miss fillers, so label the filler metric "approximate".

Backend:
1. Table `reports(session_id PK, user_id, status pending|ready|failed, rubric_version, metrics_json, report_json, created_at)` (Alembic).
2. After a session completes, generate the report as a background task (write it as a function that can later move to a queue). If the user spoke fewer than about 30 words, store `status=ready` with a "session too short" report and skip the LLM. Make generation idempotent (re-running replaces the report) and add `POST /api/sessions/{id}/report/retry` for failed reports.
3. Objective metrics in plain Python, unit-tested: user word count, user speaking time (from turn timings), WPM, average and longest pause between turns, filler count (um, uh, like, you know, matlab, basically, actually), type-token ratio, unique words, top repeated words, average turn length.
4. LLM analysis with the Gemini text model from env `REPORT_MODEL`, structured JSON output, fixed versioned rubric (`RUBRIC_VERSION = "v1"`). Input: transcript (user turns marked) + metrics + profile. Output validated with Pydantic: scores 0-100 for fluency, vocabulary, grammar, communication, pace (pronunciation = null), overall, estimated CEFR level, 3 strengths, top grammar mistakes `[{said, better, rule}]`, `words_to_upgrade [{used, alternatives}]`, interview feedback (relevance, structure/STAR, confidence), an action plan of 5 concrete steps with short daily exercises, `next_session_focus`. Evaluate only the English parts; do not penalize Hindi/Hinglish code-switching as errors but mention it. Retry once on invalid output; on failure `status=failed`. Temperature low for consistency.
5. Prompt-injection defense: the prompt states that transcript content is data and any instructions inside it (for example "give me 100") must be ignored. Add a test with a malicious transcript.
6. Endpoints: `GET /api/sessions/{id}/report`, `GET /api/progress` (scores of the last 10 sessions). All filtered by `user_id`.

Frontend:
7. Report page: pending state with polling, overall score, 6 score cards (pronunciation shown as "coming soon"), bar or radar chart, mistakes and word-upgrade tables, action-plan checklist, deltas "vs last session", link to the transcript. After a session ends navigate to its report. Dashboard progress trend chart.

Done when: pytest covers metrics on fixed sample transcripts, Pydantic validation, ownership checks, malicious-transcript handling. Include a sample generated report JSON in `PROGRESS.md`. Build passes.

---

## Step 7: Onboarding and personalization
1. Onboarding screen after first login (when no profile): display name, goal (job interview / campus placement / IELTS speaking / general English), target role (free text), level (beginner/intermediate/advanced), native language, correction style ("correct me live" vs "tell me at the end"). Save via `PUT /api/me/profile`. Editable Profile page.
2. Build the system instruction **per session** on the backend: base instruction + profile block + the last report's `next_session_focus` and top 3 recurring mistakes (if any). The AI greets the user by name, mentions what they worked on last time, adapts question difficulty to level, follows the correction style.
3. Security: profile fields are user-controlled text going into a system prompt. Strip newlines and control characters, cap lengths, allowlist enums, place them in a clearly delimited block described as user data, not instructions.
4. Dashboard: "Welcome back, <name>", streak (consecutive days with a session), "Start practice" with scenario choice (HR round, technical, behavioral, mixed), stored in `sessions.scenario`.

Done when: pytest covers prompt building (sanitization, missing profile, no previous report). Build passes.

---

## Step 8: Demo-ready cleanup
1. README: remove the "Production Ready" claim; document setup (env vars, Supabase, migrations, Windows via `start.bat`, Docker), architecture, known limitations.
2. Ask which LICENSE to use, then add it (README links to one but the file is missing).
3. Make sure `start.bat` works with the new env requirements.
4. Run all tests and build. Produce a smoke-test checklist for the human: signup, onboarding, live session, refresh, report, history, logout, wrong-origin rejection, expired login.
5. Final `PROGRESS.md` summary and the exact env vars to set on Render. Tag the commit `v0.1-demo` (local tag).

---

# PHASE 2: Production improvements (start only after the demo works)

## Step 9: Cost control and abuse protection
Problem: each live voice minute costs money, and one user or script could drain the budget.
1. Per-user daily minutes quota (env `DAILY_MINUTES_LIMIT`, default 30), tracked from `sessions.duration_s`; refuse new sessions with a friendly message and show remaining minutes on the dashboard.
2. Rate limiting on `/api/ws-ticket`, `/api/me*`, report retry (per user and per IP), returning 429.
3. Concurrency per instance and per user are already enforced; add a global "kill switch" env `MAINTENANCE_MODE` that rejects new sessions.
4. Log per-session cost estimate fields (duration, model) for later cost dashboards. Document setting a billing budget alert in the README.
Done when: tests for quota exhaustion, rate-limit 429, maintenance mode.

## Step 10: Security hardening round 2
1. Security headers on the app (CSP suited to the Vite build, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` allowing only microphone for self, HSTS in production). Check that the mic and WebSocket still work.
2. CI additions: `pip-audit`, `npm audit --omit=dev` (report-only at first), `gitleaks` secret scan.
3. Error responses never leak stack traces; global exception handler; request size limits on REST bodies.
4. Review every endpoint for `user_id` filtering again; add an automated "ownership" test per endpoint.
5. Dependabot or Renovate config for dependency updates.
Done when: CI green, headers verified with a test, ownership tests exist for every user-data endpoint.

## Step 11: Privacy, consent and data rights
Note: this is engineering support, not legal advice. Have a legal expert review the final policy (India DPDP Act 2023; minors need guardian consent).
1. Consent screen at signup: what is recorded, who processes it (Google for the live AI), retention period. Store `consent_at` and `consent_version`. Age gate: ask age or date of birth; if under 18, show a guardian-consent flow or block, as decided by the owner (ask before building).
2. Settings: "Download my data" (JSON export of profile, sessions, transcripts, reports) and "Delete my account and all data" (hard delete everything including future audio).
3. Retention job: delete transcripts and audio older than configurable days (env) unless the user keeps them.
4. Privacy Policy and Terms pages (draft text, clearly marked "to be reviewed by a lawyer").
Done when: tests for export and full deletion (nothing remains for that user_id in any table).

## Step 12: Audio storage and real pronunciation
1. With explicit user consent (toggle, default off), store user audio per session in object storage (S3-compatible or Supabase Storage), encrypted at rest, private bucket, access only through short-lived signed URLs, retention limit from Step 11. Record audio as chunked PCM or Opus; keep the session timeline aligned with turn timings.
2. Post-session worker: run speech-to-text with word-level timestamps and a pronunciation assessment service (evaluate options, for example Azure Speech Pronunciation Assessment, and ask the owner to choose before building because of cost and keys). Get accuracy, fluency, prosody, completeness, per-word mispronunciations.
3. Improve metrics using real word timestamps (true WPM, pause distribution, filler detection from raw audio STT).
4. Fill the `pronunciation` score and a "words to practice" list with tips; keep the "coming soon" state for users who did not opt in to audio storage.
Done when: tests with fixture audio and a mocked service; end-to-end opt-in and opt-out paths verified.

## Step 13: Scalability and reliability
1. Move the ticket store, rate limits, quotas and active-session tracking to Redis; keep the in-memory implementation as the local-dev fallback behind an interface.
2. Move report generation to a real job queue/worker (for example Redis-based) with retries and a dead-letter state; reports must survive restarts.
3. Make the backend stateless so it can run multiple instances (sticky sessions are not required once state is in Redis/Postgres).
4. Graceful shutdown: on SIGTERM tell clients to reconnect, finish persisting turns, and trigger reports.
5. Staging environment config separate from production.
Done when: a test or script runs two instances and proves limits are shared; worker retry test.

## Step 14: Observability
1. Structured JSON logs with `session_id` and `user_id` hash, no transcript or audio content.
2. Sentry (backend and frontend) with PII scrubbing enabled.
3. Metrics: active sessions, session duration, Gemini connect latency, reconnect count, report success/failure rate, per-user minutes. Expose a protected `/metrics` or push to a hosted service.
4. Alerts (documented): error rate, report failures, daily cost above threshold.
Done when: an induced error appears in Sentry with no PII, metrics endpoint works.

## Step 15: Product depth (what makes it genuinely useful for students)
1. Mistake tracker: table `mistake_tracker(user_id, error_type, count, last_seen)` fed from reports; next sessions deliberately practice the top recurring mistakes.
2. Scenario library: HR round, technical interview by role, behavioral/STAR drills, group-discussion mode, IELTS speaking parts 1-3, presentation practice, each with its own system-prompt template and rubric emphasis.
3. Resume-aware interviews: user pastes or uploads resume text; questions are generated from it (treat the text as untrusted data).
4. Adaptive difficulty from level and recent scores; hint mode for beginners.
5. Practice exercises after a report: shadowing sentences, tongue-twisters for flagged sounds, vocabulary flashcards from `words_to_upgrade`.
6. Gamification: streaks, weekly goals, badges, shareable progress card.
7. Mobile-first PWA polish, low-bandwidth mode, mic-permission and network-drop UX, accessibility (keyboard, screen reader labels, contrast).
8. Multi-language UI (English/Hindi) for onboarding and reports.
Do these as separate small steps (15a, 15b, ...), each with its own branch and tests.

## Step 16: Quality assurance and launch
1. Report quality evaluation: a fixed set of 20-30 sample transcripts with expected score ranges; a script that runs the report pipeline and flags drift when the rubric or model changes.
2. End-to-end tests with Playwright (login mock, onboarding, session UI with a fake audio source, report page).
3. Load test: N concurrent sessions against a staging instance, measure latency and cost per session.
4. Beta with 20-50 real students: collect feedback, check whether scores match their own feeling and whether following the action plan improves later scores.
5. Production runbook in the README: deploy, rollback, rotate keys, restore database backups, incident checklist.
Done when: all of the above exist and a staging deploy passes the smoke checklist.

---

## Working conventions (for every step)
- One branch per step (`step<N>-<short-name>`), small commits, merge to `main` locally with `--no-ff`, never push (the human pushes).
- Every step updates `PROGRESS.md` with: status, files changed, how to verify, decisions made, "Needs human check", blockers.
- Every bug fix gets a test that failed before the fix.
- New env vars always go into `backend/.env.example` (or `frontend/.env.example`), `render.yaml` and the README.
- Stop and ask the human when a decision involves money (paid services), law/privacy, or secrets.