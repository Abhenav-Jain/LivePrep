# Project Progress: LivePrep

## Step 1: Remove Dangerous Capabilities
- **Status**: Completed
- **Branch**: `step1-remove-dangerous-capabilities` (Merged into `main`)

## Step 2: Deployment Config and Secrets
- **Status**: Completed
- **Branch**: `step2-deployment-config-and-secrets`
- **Files Changed**:
  - `backend/app.py`: Read `ALLOWED_ORIGINS` from environment variable (default: `http://localhost:3000,http://localhost:8000`). Used it for both CORS and WebSocket origin verification. Added startup fail-closed validation for `LIVEPREP_TOKEN` (missing or < 32 chars) and `GEMINI_API_KEY`. Replaced token string comparison with `secrets.compare_digest`. Removed client-supplied API key handling and fallback logic; always uses server `GEMINI_API_KEY` and `GEMINI_LIVE_MODEL`. Updated `/api/health` to return `{"status": "ok"}`.
  - `backend/gemini_live.py`: Removed resume handle value logging.
  - `frontend/src/App.tsx`: Removed `apiKey` state, `selectedModel` state, and their localStorage storage. Added purge on mount for deprecated `omni_gemini_api_key` and `omni_gemini_model` localStorage keys.
  - `frontend/src/audio/useLiveSession.ts`: Removed `apiKey` and `model` arguments from `connect()`, removed `api_key` from auth message payload, and removed `model` query param from WebSocket URL.
  - `frontend/src/components/SettingsModal.tsx`: Removed Gemini API key input and Gemini Live model selector. Retained only the `LIVEPREP_TOKEN` configuration.
  - `render.yaml`: Added `ALLOWED_ORIGINS` (sync: false), `LIVEPREP_TOKEN` (sync: false), `GEMINI_API_KEY` (sync: false), `GEMINI_LIVE_MODEL` (sync: false), `MAX_CONCURRENT_SESSIONS` (value: "3"), and `PORT` (value: 8000).
  - `docker-compose.yml`: Added `ALLOWED_ORIGINS`, `LIVEPREP_TOKEN`, `GEMINI_API_KEY`, `GEMINI_LIVE_MODEL`, `MAX_CONCURRENT_SESSIONS` (default: 3).
  - `backend/.env.example`: Added `ALLOWED_ORIGINS`, `MAX_CONCURRENT_SESSIONS=3`, updated `LIVEPREP_TOKEN` note (min 32 chars).
  - `backend/tests/test_app.py`: Added automated test suite for `/api/health`, WebSocket origin rejection, and authentication token validation.

- **Verification Results**:
  - Refuses to start without token or with token < 32 chars: Verified (`RuntimeError` on startup).
  - Refuses to start without GEMINI_API_KEY: Verified (`RuntimeError` on startup).
  - Frontend contains no active `apiKey` or `omni_gemini_api_key` logic: Verified (only explicit `localStorage.removeItem('omni_gemini_api_key')` cleanup present).
  - Health endpoint: `GET /api/health` returns `{"status": "ok"}`.
  - WebSocket connection security: Verified that requests with unauthorized Origin headers fail with code 1008, and invalid auth tokens fail authentication.
  - Tests: All 8 unit tests in `backend/tests/` passed (`pytest`).
  - Frontend build: `npm run build` completed successfully.

- **Needs human check**:
  - Deploy to Render and verify connection from the deployed frontend origin with `LIVEPREP_TOKEN`.
