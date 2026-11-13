import os
import sqlite3
from pathlib import Path
from typing import Any, Dict, List
from google.genai import types

# --- Data Directory for Storage ---
DATA_DIR = Path(os.getenv("DATA_DIR", "./data")).resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)

_DB_PATH = DATA_DIR / "sessions.db"

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

# --- TOOL IMPLEMENTATIONS ---

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


TOOL_DISPATCHER = {
    "search_web": lambda args: search_web_impl(args.get("query", ""), args.get("max_results", 5)),
    "save_note": lambda args: save_note_impl(args.get("session_id", ""), args.get("key", ""), args.get("value", "")),
    "score_answer": lambda args: score_answer_impl(args.get("session_id", ""), args.get("question", ""), args.get("answer", ""), args.get("score", 0)),
    "get_progress": lambda args: get_progress_impl(args.get("session_id", "")),
}


def get_gemini_tools() -> List[types.Tool]:
    declarations = [
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
