"""Model tools for the Live session.

LivePrep deliberately exposes NO tools to the model right now.

History: earlier versions allowed shell commands, file access, web search and
SQLite note-taking. None of these are needed for a mock-interview coach, and each one
is an attack surface (code execution, prompt injection through search results, and
session ids chosen by the model). Scoring and notes now happen AFTER the session in
the report pipeline, on the server, from the stored transcript.

If a tool is ever added again:
* the server must inject user_id / session_id itself, never take them from the model;
* treat every tool result as untrusted data;
* register it in TOOL_DISPATCHER and describe it in get_gemini_tools().
"""
from typing import Any, Callable, Dict, List

from google.genai import types

TOOL_DISPATCHER: Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]] = {}


def get_gemini_tools() -> List[types.Tool]:
    return []
