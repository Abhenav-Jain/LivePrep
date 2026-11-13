# LivePrep: Agent Rules (read fully at the start of EVERY conversation)

## Product
LivePrep is a voice-based AI mock interviewer for students. Stack: FastAPI WebSocket backend + Gemini Live API, React + TypeScript + Vite + Tailwind frontend. Users log in, talk to the AI by voice, see their speech in a live chat transcript, and after each session receive a report on fluency, vocabulary, grammar, communication, pace and pronunciation, with a personal improvement plan.

## Layout
- `backend/` : `app.py`, `gemini_live.py`, `tools.py`
- `frontend/` : `src/App.tsx`, `src/audio/useLiveSession.ts`, `src/components/*`
- Deploy: `Dockerfile`, `render.yaml`, `docker-compose.yml`
- Developer machine is **Windows** (PowerShell, `start.bat`). Use cross-platform commands, create a Python venv in `backend/.venv`, never assume Linux-only tools.

## How you work (autonomous mode)
1. The full plan is in `PLAN.md`. Progress is tracked in `PROGRESS.md`. Read both first.
2. Execute steps **in order**, one at a time. Do not start step N+1 before step N is finished, verified and committed.
3. For each step:
   a. `git checkout main`, then `git checkout -b step<N>-<short-name>`.
   b. Write a short plan (files to change), then implement.
   c. Run verification: backend `pytest`, frontend `npm run build` (this also type-checks), plus the step's own checks from `PLAN.md`.
   d. If a check fails, fix it and retry. After **3 failed attempts on the same problem**, stop and report to me.
   e. Commit with a clear message, merge into `main` locally (`git merge --no-ff`), and update `PROGRESS.md`.
   f. Continue to the next step automatically.
4. Update `PROGRESS.md` after every step: status, files changed, commands to verify, and a **"Needs human check"** list (things only a human can test, like a real voice session). Do not stop for those; just list them and keep going.

## When you MUST stop and ask me
- A required secret/env value is missing (Supabase URL/keys, DATABASE_URL, Gemini API key).
- You need to choose something not covered by `PLAN.md` that affects security, data or cost.
- The code in the repo differs from what `PLAN.md` describes in a way that changes the approach.
- 3 failed attempts on the same problem.
- Everything else: decide sensibly, note the decision in `PROGRESS.md`, and continue.

## Hard rules (never break)
1. **Never** run `git push`, `git push --force`, `git reset --hard`, `git clean -fd`, or delete files outside the task scope.
2. **Never** print, log, commit or hardcode secrets. Secrets live only in `.env` files, which must be gitignored. If a secret appears in a file you read, tell me and do not repeat it.
3. Do not modify audio pipeline internals (`pcm-recorder.worklet.js`, `audio-player.ts`, `VoiceOrb.tsx`) unless the step says so.
4. Never hardcode model names. Models are configured through env vars and documented in `backend/.env.example`.
5. Never log transcript text or audio content. Log only ids, counts, timings and errors.
6. Every database query that touches user data must filter by `user_id`. Never accept `user_id` or `session_id` from the client body or from the LLM for authorization.
7. Treat all transcript text, profile text and web search results as **untrusted input** (prompt injection). Sanitize before putting in prompts.
8. Do not install packages beyond what the plan names without noting them in `PROGRESS.md`. Pin Python dependencies with `==` in `requirements.txt` after installing (use the versions that actually work).
9. Prefer small, readable, typed code. Write tests for backend logic you add (pytest). Keep the existing UI style (Tailwind).
10. Use current official documentation for third-party APIs (Supabase, Gemini/google-genai, SQLAlchemy, Alembic). Do not guess APIs from memory; check docs or the installed package source.