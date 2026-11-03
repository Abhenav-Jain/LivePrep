import os
import re
import subprocess
import platform
import json
import datetime
from pathlib import Path
from typing import Any, Dict, List
from google.genai import types

# Working directory constraint for file operations
WORKSPACE_ROOT = Path(os.getenv("PROJECT_WORKSPACE_ROOT", Path(__file__).resolve().parent.parent)).resolve()

# Sensitive filenames that should never be read or written to
PROTECTED_FILES = {
    ".env",
    "id_rsa",
    "id_ed25519",
    "credentials.json",
    "client_secret.json",
    "master.key",
    "sam",
    "system",
}

# Dangerous / Destructive command patterns blocked by the Security Guardrail
DANGEROUS_PATTERNS = [
    r"\brm\s+-[rf]{1,2}\s+[/~]",                     # rm -rf / or ~
    r"\bdel\s+/[sfaq]{1,4}\s+[c-zC-Z]:\\",           # del /s /q C:\
    r"\bformat\s+[c-zC-Z]:",                         # format c:
    r"\bFormat-Volume\b",                             # powershell format volume
    r"\bdiskpart\b",                                 # disk partitioner
    r"\bStop-Computer\b",                            # powershell shutdown
    r"\bRestart-Computer\b",                         # powershell reboot
    r"\bshutdown\b",                                 # shutdown command
    r"\breg\s+delete\b",                             # registry wipe
    r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:",    # fork bomb
    r"\bdrop\s+database\b",                          # drop database
    r"\bmkfs\b",                                     # format linux
    r"\bdd\s+if=.*of=/dev/sd",                       # wipe raw device
]

def safe_path(relative_path: str) -> Path:
    """
    Strictly confines all file operations to the WORKSPACE_ROOT.
    Prevents path traversal, symlink escapes, and absolute disk access.
    """
    clean_path = relative_path.strip().lstrip("/\\")
    target = (WORKSPACE_ROOT / clean_path).resolve()

    # Enforce workspace root boundary
    try:
        target.relative_to(WORKSPACE_ROOT)
    except ValueError:
        raise PermissionError(
            f"Security Violation: Path '{relative_path}' resolves to '{target}', which is outside the workspace root."
        )

    # Check for protected sensitive file names
    if target.name.lower() in PROTECTED_FILES:
        raise PermissionError(f"Security Violation: Access to protected file '{target.name}' is strictly denied.")

    return target

def is_command_safe(command: str) -> tuple[bool, str]:
    """Inspects command line for destructive or unsafe operations."""
    for pattern in DANGEROUS_PATTERNS:
        if re.search(pattern, command, re.IGNORECASE):
            return False, f"Blocked potentially destructive command matching pattern: '{pattern}'"
    return True, "OK"

# --- TOOL IMPLEMENTATIONS ---

def execute_command_impl(command: str) -> Dict[str, Any]:
    """Execute a safe shell or powershell command in the project workspace."""
    cmd_clean = command.strip()
    if not cmd_clean:
        return {"status": "error", "error": "Empty command string."}

    # Security Guardrail Check
    safe, reason = is_command_safe(cmd_clean)
    if not safe:
        return {
            "status": "error",
            "security_blocked": True,
            "error": f"Security Guardrail: {reason}. To protect your system, this operation was halted.",
        }

    try:
        is_win = platform.system() == "Windows"
        shell_cmd = ["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd_clean] if is_win else ["bash", "-c", cmd_clean]

        proc = subprocess.run(
            shell_cmd,
            cwd=str(WORKSPACE_ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=35,
        )
        stdout = proc.stdout.strip()
        stderr = proc.stderr.strip()

        # Prevent huge output flooding
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
    except subprocess.TimeoutExpired:
        return {"status": "error", "error": "Command execution timed out after 35 seconds."}
    except Exception as e:
        return {"status": "error", "error": str(e)}

def read_file_impl(file_path: str, max_lines: int = 400) -> Dict[str, Any]:
    """Read contents of a file within the workspace safely."""
    try:
        target = safe_path(file_path)
        if not target.exists():
            return {"status": "error", "error": f"File '{file_path}' does not exist."}
        if not target.is_file():
            return {"status": "error", "error": f"Path '{file_path}' is a directory, not a file."}

        # Check file size (limit to 500KB)
        file_size = target.stat().st_size
        if file_size > 500 * 1024:
            return {
                "status": "error",
                "error": f"File is too large ({file_size / 1024:.1f} KB). Maximum readable size is 500 KB."
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
    """Write or overwrite content into a project file safely within workspace bounds."""
    try:
        target = safe_path(file_path)

        # Size constraint (limit 1MB)
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
    """List files and folders inside the workspace."""
    try:
        target = safe_path(dir_path)
        if not target.exists():
            return {"status": "error", "error": f"Directory '{dir_path}' does not exist."}
        if not target.is_dir():
            return {"status": "error", "error": f"Path '{dir_path}' is not a directory."}

        entries = []
        for item in sorted(target.iterdir()):
            # Filter heavy ignore folders
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

def search_web_impl(query: str, max_results: int = 5) -> Dict[str, Any]:
    """Search DuckDuckGo with fallback and rate limit resilience."""
    query_clean = query.strip()
    if not query_clean:
        return {"status": "error", "error": "Empty search query."}

    try:
        from duckduckgo_search import DDGS
        with DDGS(timeout=10) as ddgs:
            results = list(ddgs.text(query_clean, max_results=max_results))

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
    """Retrieve system platform details, memory, and workspace bounds."""
    return {
        "status": "success",
        "current_time": datetime.datetime.now().isoformat(),
        "platform": platform.platform(),
        "python_version": platform.python_version(),
        "workspace_root": str(WORKSPACE_ROOT),
        "security_sandbox_active": True,
    }

# --- TOOL REGISTRY DISPATCHER ---

TOOL_DISPATCHER = {
    "execute_command": lambda args: execute_command_impl(args.get("command", "")),
    "read_file": lambda args: read_file_impl(args.get("file_path", ""), args.get("max_lines", 400)),
    "write_file": lambda args: write_file_impl(args.get("file_path", ""), args.get("content", "")),
    "list_directory": lambda args: list_directory_impl(args.get("dir_path", ".")),
    "search_web": lambda args: search_web_impl(args.get("query", ""), args.get("max_results", 5)),
    "get_system_telemetry": lambda args: get_system_telemetry_impl(),
}

# --- GEMINI FUNCTION DECLARATIONS ---

def get_gemini_tools() -> List[types.Tool]:
    """Returns the non-blocking function declarations for Gemini 3.8 Live."""
    declarations = [
        types.FunctionDeclaration(
            name="execute_command",
            description="Run a terminal shell command (powershell/bash) in the project workspace. Use to run tests, build projects, or inspect files. Dangerous/destructive commands are safely guarded.",
            behavior="NON_BLOCKING",
            parameters={
                "type": "OBJECT",
                "properties": {
                    "command": {
                        "type": "STRING",
                        "description": "The exact shell command line string to run."
                    }
                },
                "required": ["command"],
            },
        ),
        types.FunctionDeclaration(
            name="read_file",
            description="Read the text content of a file strictly inside the project workspace.",
            behavior="NON_BLOCKING",
            parameters={
                "type": "OBJECT",
                "properties": {
                    "file_path": {
                        "type": "STRING",
                        "description": "Relative path to the file inside the project workspace."
                    },
                    "max_lines": {
                        "type": "INTEGER",
                        "description": "Max number of lines to read (default 400)."
                    }
                },
                "required": ["file_path"],
            },
        ),
        types.FunctionDeclaration(
            name="write_file",
            description="Write or overwrite content into a project file in the workspace.",
            behavior="NON_BLOCKING",
            parameters={
                "type": "OBJECT",
                "properties": {
                    "file_path": {
                        "type": "STRING",
                        "description": "Relative path of the file to create or overwrite."
                    },
                    "content": {
                        "type": "STRING",
                        "description": "The full text content to write into the file."
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
                        "description": "Relative path of directory to list (e.g. '.' or 'backend')."
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
                        "description": "Search query terms."
                    },
                    "max_results": {
                        "type": "INTEGER",
                        "description": "Max number of search results to retrieve (default: 5)."
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
    ]

    return [types.Tool(function_declarations=declarations)]
