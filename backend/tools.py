import os
import re
import subprocess
import platform
import shlex
import signal
import datetime
from pathlib import Path
from typing import Any, Dict, List
from google.genai import types

# --- Workspace Isolation ---
_REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_WORKSPACE = _REPO_ROOT / "workspace"
WORKSPACE_ROOT = Path(os.getenv("PROJECT_WORKSPACE_ROOT", DEFAULT_WORKSPACE)).resolve()
WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)

# --- Protected file patterns ---
PROTECTED_PATTERNS = [
    r"\.env(\..*)?$", r"\.pem$", r"\.py$", r"Dockerfile",
    r"start\.bat$", r"\.git/", r"id_rsa", r"id_ed25519",
    r"credentials\.json", r"client_secret\.json", r"master\.key",
]

def _is_protected(path: Path) -> bool:
    name = path.name.lower()
    rel = str(path.relative_to(WORKSPACE_ROOT)).lower() if WORKSPACE_ROOT in path.parents else ""
    for pat in PROTECTED_PATTERNS:
        if re.search(pat, name) or re.search(pat, rel):
            return True
    return False

def safe_path(relative_path: str) -> Path:
    clean_path = relative_path.strip().lstrip("/\\")
    target = (WORKSPACE_ROOT / clean_path).resolve()
    try:
        target.relative_to(WORKSPACE_ROOT)
    except ValueError:
        raise PermissionError(
            f"Security Violation: Path '{relative_path}' resolves to '{target}', outside workspace root."
        )
    if _is_protected(target):
        raise PermissionError(
            f"Security Violation: Access to protected file '{target}' is strictly denied."
        )
    return target

# --- Command Allowlist ---
ALLOWED_COMMANDS = {"python", "pytest", "npm", "node", "git", "ls", "dir"}
SAFE_ENV_KEYS = {"PATH", "SYSTEMROOT", "HOME", "USERPROFILE", "TEMP", "TMP"}

# --- TOOL IMPLEMENTATIONS ---

def execute_command_impl(command: str) -> Dict[str, Any]:
    cmd_clean = command.strip()
    if not cmd_clean:
        return {"status": "error", "error": "Empty command string."}
    try:
        argv = shlex.split(cmd_clean)
    except ValueError as e:
        return {"status": "error", "error": f"Invalid command syntax: {e}"}
    if not argv:
        return {"status": "error", "error": "Empty command."}
    base_cmd = os.path.basename(argv[0]).lower()
    if base_cmd.endswith(".exe"):
        base_cmd = base_cmd[:-4]
    if base_cmd not in ALLOWED_COMMANDS:
        return {
            "status": "error",
            "error": f"Command not allowed: '{argv[0]}'. Allowed: {', '.join(sorted(ALLOWED_COMMANDS))}"
        }
    try:
        env = _safe_env()
        is_win = platform.system() == "Windows"
        proc = subprocess.Popen(
            argv, shell=False, cwd=str(WORKSPACE_ROOT), env=env,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True,
            start_new_session=not is_win,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if is_win else 0,
        )
        try:
            stdout, stderr = proc.communicate(timeout=35)
        except subprocess.TimeoutExpired:
            if is_win:
                subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
            else:
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                except ProcessLookupError:
                    pass
            try:
                stdout, stderr = proc.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                if is_win:
                    subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
                else:
                    try:
                        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                proc.communicate()
            return {"status": "error", "error": "Command execution timed out after 35 seconds."}
        max_out = 4000
        truncated = len(stdout) > max_out
        clean_stdout = stdout[-max_out:] if truncated else stdout
        return {
            "status": "success" if proc.returncode == 0 else "error",
            "exit_code": proc.returncode,
            "stdout": clean_stdout,
            "stderr": stderr[-2000:] if len(stderr) > 2000 else stderr,
            "truncated": truncated,
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}

def read_file_impl(file_path: str, max_lines: Any = 400) -> Dict[str, Any]:
    try:
        try:
            max_lines = int(max_lines)
        except (TypeError, ValueError):
            max_lines = 400
        max_lines = max(1, min(max_lines, 2000))
        target = safe_path(file_path)
        if not target.exists():
            return {"status": "error", "error": f"File '{file_path}' does not exist."}
        if not target.is_file():
            return {"status": "error", "error": f"Path '{file_path}' is a directory, not a file."}
        file_size = target.stat().st_size
        if file_size > 500 * 1024:
            return {
                "status": "error",
                "error": f"File is too large ({file_size / 1024:.1f} KB). Max readable size is 500 KB.",
            }
        with open(target, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        total_lines = len(lines)
        truncated = total_lines > max_lines
        content = "".join(lines[:max_lines])
        return {
            "status": "success",
            "file_path": str(target.relative_to(WORKSPACE_ROOT)),
            "content": content,
            "total_lines": total_lines,
            "displayed_lines": min(total_lines, max_lines),
            "truncated": truncated,
        }
    except PermissionError as pe:
        return {"status": "error", "security_blocked": True, "error": str(pe)}
    except Exception as e:
        return {"status": "error", "error": str(e)}

def write_file_impl(file_path: str, content: str) -> Dict[str, Any]:
    try:
        target = safe_path(file_path)
        if len(content.encode("utf-8")) > 1024 * 1024:
            return {"status": "error", "error": "Content exceeds 1MB limit for single file write."}
        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, "w", encoding="utf-8") as f:
            f.write(content)
        return {
            "status": "success",
            "file_path": str(target.relative_to(WORKSPACE_ROOT)),
            "bytes_written": len(content.encode("utf-8")),
            "message": f"Successfully wrote {len(content)} characters to {file_path}",
        }
    except PermissionError as pe:
        return {"status": "error", "security_blocked": True, "error": str(pe)}
    except Exception as e:
        return {"status": "error", "error": str(e)}

def search_web_impl(query: str, max_results: Any = 5) -> Dict[str, Any]:
    query_clean = query.strip()
    if not query_clean:
        return {"status": "error", "error": "Empty search query."}
    try:
        try:
            from ddgs import DDGS
        except ImportError:
            from duckduckgo_search import DDGS
        with DDGS(timeout=10) as ddgs:
            results = list(ddgs.text(query_clean, max_results=int(max_results)))
        formatted_results = []
        for r in results:
            formatted_results.append({
                "title": r.get("title", ""),
                "url": r.get("href", ""),
                "snippet": r.get("body", ""),
            })
        return {
            "status": "success",
            "query": query_clean,
            "results": formatted_results,
            "count": len(formatted_results),
        }
    except Exception as e:
        return {
            "status": "error",
            "query": query_clean,
            "error": f"Search engine temporarily unavailable: {str(e)}",
        }

def get_system_telemetry_impl() -> Dict[str, Any]:
    return {
        "status": "success",
        "current_time": datetime.datetime.now().isoformat(),
        "platform": platform.platform(),
        "python_version": platform.python_version(),
        "workspace_root": str(WORKSPACE_ROOT),
        "security_sandbox_active": False,
    }

import sqlite3
_DB_PATH = WORKSPACE_ROOT / "sessions.db"

def _init_db():
    conn = sqlite3.connect(str(_DB_PATH))
    conn.execute("""
        CREATE TABLE IF NOT EXISTS session_memory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()

_init_db()
TOOL_DISPATCHER = {
    "execute_command": lambda args: execute_command_impl(args.get("command", "")),
    "read_file": lambda args: read_file_impl(args.get("file_path", ""), args.get("max_lines", 400)),
    "write_file": lambda args: write_file_impl(args.get("file_path", ""), args.get("content", "")),
    "list_directory": lambda args: list_directory_impl(args.get("dir_path", ".")),
    "search_web": lambda args: search_web_impl(args.get("query", ""), args.get("max_results", 5)),
    "get_system_telemetry": lambda args: get_system_telemetry_impl(),
    "save_note": lambda args: save_note_impl(args.get("session_id", ""), args.get("key", ""), args.get("value", "")),
    "score_answer": lambda args: score_answer_impl(args.get("session_id", ""), args.get("question", ""), args.get("answer", ""), args.get("score", 0)),
    "get_progress": lambda args: get_progress_impl(args.get("session_id", "")),
}

def get_gemini_tools() -> List[types.Tool]:
    declarations = [
        types.FunctionDeclaration(
            name="execute_command",
            description="Run an allowlisted terminal command (python, pytest, npm, node, git, ls, dir) in the isolated workspace. Destructive commands are blocked.",
            behavior="NON_BLOCKING",
            parameters={
                "type": "OBJECT",
                "properties": {
                    "command": {
                        "type": "STRING",
                        "description": "The exact command line to run (only allowlisted binaries).",
                    }
                },
                "required": ["command"],
            },
        ),
        types.FunctionDeclaration(
            name="read_file",
            description="Read the text content of a file strictly inside the isolated workspace.",
            behavior="NON_BLOCKING",
            parameters={
                "type": "OBJECT",
                "properties": {
                    "file_path": {
                        "type": "STRING",
                        "description": "Relative path to the file inside the workspace.",
                    },
                    "max_lines": {
                        "type": "INTEGER",
                        "description": "Max number of lines to read (default 400, max 2000).",
                    }
                },
                "required": ["file_path"],
            },
        ),
        types.FunctionDeclaration(
            name="write_file",
            description="Write or overwrite content into a project file in the isolated workspace. Protected files (.py, .env, Dockerfile, etc.) are denied.",
            behavior="NON_BLOCKING",
            parameters={
                "type": "OBJECT",
                "properties": {
                    "file_path": {
                        "type": "STRING",
                        "description": "Relative path of the file to create or overwrite.",
                    },
                    "content": {
                        "type": "STRING",
                        "description": "The full text content to write into the file.",
                    }
                },
                "required": ["file_path", "content"],
            },
        ),
        types.FunctionDeclaration(
            name="list_directory",
            description="List files and folders in a specified directory in the workspace.",
            behavior="NON_BLOCKING",
            parameters={
                "type": "OBJECT",
                "properties": {
                    "dir_path": {
                        "type": "STRING",
                        "description": "Relative path of directory to list (e.g. '.' or 'workspace').",
                    }
                },
            },
        ),
        types.FunctionDeclaration(
            name="search_web",
            description="Search the live internet for documentation, solutions, APIs, or real-time information.",
            behavior="NON_BLOCKING",
            parameters={
                "type": "OBJECT",
                "properties": {
                    "query": {
                        "type": "STRING",
                        "description": "Search query terms.",
                    },
                    "max_results": {
                        "type": "INTEGER",
                        "description": "Max number of search results to retrieve (default: 5).",
                    }
                },
                "required": ["query"],
            },
        ),
        types.FunctionDeclaration(
            name="get_system_telemetry",
            description="Get current system date/time, OS environment details, and workspace status.",
            behavior="NON_BLOCKING",
            parameters={
                "type": "OBJECT",
                "properties": {},
            },
        ),
        types.FunctionDeclaration(
            name="save_note",
            description="Save a note for the current interview/prep session.",
            behavior="NON_BLOCKING",
            parameters={
                "type": "OBJECT",
                "properties": {
                    "session_id": {"type": "STRING", "description": "Session identifier."},
                    "key": {"type": "STRING", "description": "Note key."},
                    "value": {"type": "STRING", "description": "Note value."},
                },
                "required": ["session_id", "key", "value"],
            },
        ),
        types.FunctionDeclaration(
            name="score_answer",
            description="Score an interview answer (0-100) and save it for progress tracking.",
            behavior="NON_BLOCKING",
            parameters={
                "type": "OBJECT",
                "properties": {
                    "session_id": {"type": "STRING", "description": "Session identifier."},
                    "question": {"type": "STRING", "description": "The question asked."},
                    "answer": {"type": "STRING", "description": "The user's answer."},
                    "score": {"type": "INTEGER", "description": "Score from 0-100."},
                },
                "required": ["session_id", "question", "answer"],
            },
        ),
        types.FunctionDeclaration(
            name="get_progress",
            description="Get progress summary (notes, scores, average) for a session.",
            behavior="NON_BLOCKING",
            parameters={
                "type": "OBJECT",
                "properties": {
                    "session_id": {"type": "STRING", "description": "Session identifier."},
                },
                "required": ["session_id"],
            },
        ),
    ]
    return [types.Tool(function_declarations=declarations)]

def save_note_impl(session_id: str, key: str, value: str) -> Dict[str, Any]:
    try:
        conn = sqlite3.connect(str(_DB_PATH))
        conn.execute(
            "INSERT INTO session_memory (session_id, key, value) VALUES (?, ?, ?)",
            (session_id, key, value),
        )
        conn.commit()
        conn.close()
        return {"status": "success", "message": f"Note '{key}' saved."}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def score_answer_impl(session_id: str, question: str, answer: str, score: Any = None) -> Dict[str, Any]:
    try:
        try:
            score = int(score) if score is not None else 0
        except (TypeError, ValueError):
            score = 0
        score = max(0, min(100, score))
        conn = sqlite3.connect(str(_DB_PATH))
        conn.execute(
            "INSERT INTO session_memory (session_id, key, value) VALUES (?, ?, ?)",
            (session_id, f"score:{question}", f"{score}|{answer}"),
        )
        conn.commit()
        conn.close()
        return {"status": "success", "score": score, "message": f"Answer scored {score}/100."}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def get_progress_impl(session_id: str) -> Dict[str, Any]:
    try:
        conn = sqlite3.connect(str(_DB_PATH))
        rows = conn.execute(
            "SELECT key, value FROM session_memory WHERE session_id = ? ORDER BY created_at",
            (session_id,),
        ).fetchall()
        conn.close()
        notes = {}
        scores = []
        for key, value in rows:
            if key.startswith("score:"):
                try:
                    parts = value.split("|", 1)
                    score_val = int(parts[0])
                    answer_text = parts[1] if len(parts) > 1 else ""
                    scores.append({"question": key[6:], "score": score_val, "answer": answer_text})
                except (ValueError, IndexError):
                    pass
            else:
                notes[key] = value
        avg_score = sum(s["score"] for s in scores) / len(scores) if scores else 0
        return {
            "status": "success",
            "session_id": session_id,
            "notes": notes,
            "scores": scores,
            "average_score": round(avg_score, 1),
            "total_answers": len(scores),
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}
        if len(content.encode("utf-8")) > 1024 * 1024:
            return {"status": "error", "error": "Content exceeds 1MB limit for single file write."}
        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, "w", encoding="utf-8") as f:
            f.write(content)
        return {
            "status": "success",
            "file_path": str(target.relative_to(WORKSPACE_ROOT)),
            "bytes_written": len(content.encode("utf-8")),
            "message": f"Successfully wrote {len(content)} characters to {file_path}",
        }
    except PermissionError as pe:
        return {"status": "error", "security_blocked": True, "error": str(pe)}
    except Exception as e:
        return {"status": "error", "error": str(e)}

def list_directory_impl(dir_path: str = ".") -> Dict[str, Any]:
    try:
        target = safe_path(dir_path)
        if not target.exists():
            return {"status": "error", "error": f"Directory '{dir_path}' does not exist."}
        if not target.is_dir():
            return {"status": "error", "error": f"Path '{dir_path}' is not a directory."}
        entries = []
        for item in sorted(target.iterdir()):
            if item.name in {".venv", "node_modules", ".git", "__pycache__", "dist"}:
                continue
            entries.append({
                "name": item.name,
                "type": "directory" if item.is_dir() else "file",
                "size_bytes": item.stat().st_size if item.is_file() else None,
            })
        return {
            "status": "success",
            "directory": str(target.relative_to(WORKSPACE_ROOT)),
            "items": entries[:150],
            "total_items": len(entries),
        }
    except PermissionError as pe:
        return {"status": "error", "security_blocked": True, "error": str(pe)}
    except Exception as e:
        return {"status": "error", "error": str(e)}

def _safe_env() -> Dict[str, str]:
    return {k: v for k, v in os.environ.items() if k in SAFE_ENV_KEYS}