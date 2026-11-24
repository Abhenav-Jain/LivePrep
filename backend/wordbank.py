"""Word bank and spaced repetition for LivePrep.

The word bank turns feedback into practice. Every report already contains
``words_to_upgrade`` (a plain word the learner used plus better alternatives) and
``grammar_mistakes`` (the sentence they said plus the corrected version). Those items are
copied into a per-user deck once, and the learner reviews them with a light
spaced-repetition schedule.

Everything in this module is pure: no database, no network, no clock of its own (``now``
is a parameter), so it is fully unit tested.
"""
from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional, Sequence

# Hard limits: this text later shows up in the UI and in coach prompts.
MAX_TERM_CHARS = 120
MAX_ALTERNATIVE_CHARS = 80
MAX_ALTERNATIVES = 5
MAX_NOTE_CHARS = 300
MAX_ITEMS_PER_REPORT = 12

STATUS_NEW = "new"
STATUS_LEARNING = "learning"
STATUS_MASTERED = "mastered"
VALID_STATUSES = frozenset({STATUS_NEW, STATUS_LEARNING, STATUS_MASTERED})

# Review grades the client may send.
RESULTS = frozenset({"again", "good", "easy"})

# A correct answer grows the interval; an "again" brings the card back within minutes.
_AGAIN_DELAY = timedelta(minutes=10)
_MAX_INTERVAL_DAYS = 180

_WHITESPACE_RE = re.compile(r"\s+")


def clean_text(value: Any, max_len: int) -> str:
    """Single-line, control-character-free text (report/LLM text is untrusted data)."""
    if value is None:
        return ""
    text = str(value)
    # Drop control/format characters (newlines, zero-width, bidi overrides).
    text = "".join(" " if unicodedata.category(ch).startswith("C") else ch for ch in text)
    text = _WHITESPACE_RE.sub(" ", text).strip()
    if len(text) > max_len:
        text = text[: max_len - 1].rstrip() + "\u2026"
    return text


def normalize_term(value: Any) -> Optional[str]:
    """A word or short phrase, ready to store. Returns None when nothing usable is left."""
    term = clean_text(value, MAX_TERM_CHARS)
    if not term or not any(ch.isalnum() for ch in term):
        return None
    return term


def term_key(term: str) -> str:
    """Case-insensitive de-duplication key: 'Actually' and 'actually' are one card."""
    return _WHITESPACE_RE.sub(" ", str(term).strip().lower())


def clean_alternatives(values: Any) -> list[str]:
    """Up to five distinct, non-empty alternatives (the card's model answers)."""
    if not isinstance(values, (list, tuple)):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        alt = clean_text(value, MAX_ALTERNATIVE_CHARS)
        key = alt.lower()
        if not alt or key in seen:
            continue
        seen.add(key)
        out.append(alt)
        if len(out) >= MAX_ALTERNATIVES:
            break
    return out


def extract_items(report_json: Any) -> list[dict[str, Any]]:
    """Word-bank items from a finished report. Never raises on malformed data.

    Both sections are optional and older reports may not have them at all, so every read
    is defensive. Grammar cards keep the corrected sentence as the "model answer", which
    makes the deck useful even when the learner only saved no vocabulary words.
    """
    if not isinstance(report_json, dict):
        return []

    items: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add(term_value: Any, alternatives: Any, note: str, source: str) -> None:
        term = normalize_term(term_value)
        if term is None:
            return
        key = term_key(term)
        if key in seen:
            return
        seen.add(key)
        items.append(
            {
                "term": term,
                "key": key,
                "alternatives": clean_alternatives(alternatives),
                "note": clean_text(note, MAX_NOTE_CHARS),
                "source": source,
            }
        )

    words = report_json.get("words_to_upgrade")
    if isinstance(words, list):
        for row in words:
            if not isinstance(row, dict):
                continue
            add(row.get("used"), row.get("alternatives"), "A better word for this idea.", "vocabulary")

    mistakes = report_json.get("grammar_mistakes")
    if isinstance(mistakes, list):
        for row in mistakes:
            if not isinstance(row, dict):
                continue
            better = clean_text(row.get("better"), MAX_TERM_CHARS)
            rule = clean_text(row.get("rule"), MAX_NOTE_CHARS)
            alternatives = [better] if better else []
            add(row.get("said"), alternatives, rule, "grammar")

    return items[:MAX_ITEMS_PER_REPORT]


def schedule_review(
    *,
    result: str,
    interval_days: int = 0,
    review_count: int = 0,
    correct_count: int = 0,
    now: Optional[datetime] = None,
) -> dict[str, Any]:
    """Next state of a card after one review.

    ``again``  - failed recall: back in ten minutes, counted as a review but not correct.
    ``good``   - recalled: interval doubles (starting at one day) up to 180 days.
    ``easy``   - recalled instantly: starts at three days and grows faster.
    """
    if result not in RESULTS:
        raise ValueError(f"unknown review result: {result!r}")

    moment = now or datetime.now(timezone.utc)
    current = max(0, int(interval_days or 0))
    reviews = max(0, int(review_count or 0)) + 1
    correct = max(0, int(correct_count or 0))

    if result == "again":
        next_interval = 0
        status = STATUS_LEARNING
        next_at = moment + _AGAIN_DELAY
    else:
        if result == "easy":
            grown = max(3, int(round(current * 2.5))) if current else 3
        else:
            grown = max(1, current * 2) if current else 1
        next_interval = min(_MAX_INTERVAL_DAYS, grown)
        correct += 1
        status = STATUS_MASTERED if next_interval >= 14 else STATUS_LEARNING
        next_at = moment + timedelta(days=next_interval)

    return {
        "status": status,
        "interval_days": next_interval,
        "review_count": reviews,
        "correct_count": correct,
        "next_review_at": next_at,
    }


def is_due(next_review_at: Optional[datetime], now: Optional[datetime] = None) -> bool:
    """A card is due when its scheduled moment has passed (or was never set)."""
    if next_review_at is None:
        return True
    moment = now or datetime.now(timezone.utc)
    scheduled = next_review_at
    # SQLite may hand back a naive datetime even for a timezone=True column.
    if scheduled.tzinfo is None:
        scheduled = scheduled.replace(tzinfo=timezone.utc)
    return scheduled <= moment


def summarize(items: Iterable[Any], now: Optional[datetime] = None) -> dict[str, int]:
    """Counts for the badge and the practice screen. Accepts rows or dicts."""
    total = due = mastered = learning = new = 0
    for item in items:
        total += 1
        status = _field(item, "status")
        if status == STATUS_MASTERED:
            mastered += 1
        elif status == STATUS_LEARNING:
            learning += 1
        else:
            new += 1
        if is_due(_field(item, "next_review_at"), now):
            due += 1
    return {
        "total": total,
        "due": due,
        "new": new,
        "learning": learning,
        "mastered": mastered,
    }


def _field(item: Any, name: str) -> Any:
    if isinstance(item, dict):
        return item.get(name)
    return getattr(item, name, None)


def daily_goal_hint(due: int) -> str:
    """One short sentence the UI shows above the deck."""
    if due <= 0:
        return "Nothing due right now. New cards arrive after your next session report."
    if due == 1:
        return "1 word is ready to review. About 20 seconds."
    return f"{due} words are ready to review. About {max(1, round(due * 0.3))} minute(s)."
