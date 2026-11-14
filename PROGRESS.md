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
