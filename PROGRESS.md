# Project Progress: LivePrep

## Step 1: Remove Dangerous Capabilities
- **Status**: Completed
- **Branch**: `step1-remove-dangerous-capabilities`
- **Files Changed**:
  - `backend/tools.py`: Removed `execute_command`, `read_file`, `write_file`, `list_directory`, `get_system_telemetry`, and their unused helper functions (`safe_path`, `_is_protected`, `PROTECTED_PATTERNS`, `ALLOWED_COMMANDS`, `_safe_env`, `subprocess`/`shlex`/`signal`/`platform` imports). Replaced `WORKSPACE_ROOT` with configurable `DATA_DIR` (defaults to `./data`) for SQLite database storage. Kept `search_web`, `save_note`, `score_answer`, `get_progress`.
  - `backend/gemini_live.py`: Updated `SYSTEM_INSTRUCTION` to focus purely on the mock interview coach and Hindi/English/Hinglish adaptation, removing all terminal/file/workspace/telemetry mentions.
  - `Dockerfile`: Removed `ENV PROJECT_WORKSPACE_ROOT=/app`. Added non-root user `appuser` (uid 1000), created and chowned `/app` and `/app/data` to `appuser:appuser`, added `USER appuser` before `CMD`, switched frontend install to `npm ci`, and added container `HEALTHCHECK` for `/api/health`.
  - `docker-compose.yml`: Removed `PROJECT_WORKSPACE_ROOT`, added `DATA_DIR=/app/data` and persistent named volume `liveprep-data`.
  - `backend/.env.example`: Removed `PROJECT_WORKSPACE_ROOT` and added `DATA_DIR=./data`.
  - `backend/requirements.txt`: Pinned installed dependencies with exact versions (`==`) using `uv`.
  - `backend/pytest.ini` & `backend/tests/test_tools.py`: Added automated test suite verifying tool registrations, exclusion of dangerous commands, and storage functionality.
  - `frontend/src/components/ToolActivityCard.tsx`: Updated icons and labels to match the remaining interview coaching tools (`search_web`, `save_note`, `score_answer`, `get_progress`).
  - `frontend/src/components/TranscriptView.tsx`: Updated suggestion prompts from terminal commands to interview coaching prompts.
  - `frontend/src/audio/useLiveSession.ts`: Cleaned up unused helper `arrayBufferToBase64` to satisfy TypeScript strict checking.
  - `README.md`: Updated architecture diagrams, feature lists, and tool execution descriptions from arbitrary shell/file commands to interview coaching tools.
  - `.gitignore`: Added ignore rules for `data/`, `backend/data/`, and `*.db`/`*.sqlite3`.

- **Verification Results**:
  - `grep -rn "subprocess" backend`: No matches found in Python source files.
  - Backend starts and responds on `/api/health`: Verified (status: `healthy`).
  - Backend unit tests: All 5 pytest tests passed (`pytest`).
  - Frontend typecheck & build: `npm run build` completed cleanly without errors.
  - Docker verification note: Docker daemon/CLI is not installed on the Windows host machine; Dockerfile was structured with a multi-stage non-root build (`USER appuser`, uid 1000, `HEALTHCHECK`).

- **Needs human check**:
  - Run `docker build -t liveprep .` and `docker run --rm liveprep id` on a machine with Docker to verify uid=1000(appuser).
  - Launch live session with a valid `GEMINI_API_KEY` and verify real-time voice interview coaching.
