"""Practice insights: streaks, weekly goal, totals and skill trends.

Derived from rows that already exist (sessions, reports, word bank), so no new state has
to be written and nothing can drift out of sync. Pure functions with an injected "today",
which makes streaks and week boundaries testable.
"""
from __future__ import annotations

import datetime
from typing import Any, Iterable, Optional, Sequence

SKILLS = ("fluency", "vocabulary", "grammar", "communication", "pace")
SKILL_LABELS = {
    "fluency": "Fluency",
    "vocabulary": "Vocabulary",
    "grammar": "Grammar",
    "communication": "Communication",
    "pace": "Pace",
}

MIN_SESSION_SECONDS = 30  # a 5-second tap does not count as a practice day


def _as_datetime(value: Any) -> Optional[datetime.datetime]:
    if isinstance(value, datetime.datetime):
        return value if value.tzinfo else value.replace(tzinfo=datetime.timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=datetime.timezone.utc)
    return None


def _field(row: Any, name: str) -> Any:
    if isinstance(row, dict):
        return row.get(name)
    return getattr(row, name, None)


def practice_days(
    sessions: Iterable[Any],
    *,
    min_seconds: int = MIN_SESSION_SECONDS,
) -> set[datetime.date]:
    """UTC dates on which the learner actually practised."""
    days: set[datetime.date] = set()
    for row in sessions:
        started = _as_datetime(_field(row, "started_at"))
        if started is None:
            continue
        duration = _field(row, "duration_s")
        try:
            seconds = int(duration or 0)
        except (TypeError, ValueError):
            seconds = 0
        if seconds < min_seconds:
            continue
        days.add(started.date())
    return days


def current_streak(days: Iterable[datetime.date], today: Optional[datetime.date] = None) -> int:
    """Consecutive days ending today (or yesterday, before today's session).

    Counting from yesterday keeps the streak alive for the whole day: a learner who
    practised yesterday has not lost anything until midnight passes without a session.
    """
    have = set(days)
    if not have:
        return 0
    anchor = today or datetime.datetime.now(datetime.timezone.utc).date()
    if anchor not in have:
        anchor -= datetime.timedelta(days=1)
    streak = 0
    while anchor in have:
        streak += 1
        anchor -= datetime.timedelta(days=1)
    return streak


def week_start(today: datetime.date) -> datetime.date:
    """Monday of the current UTC week."""
    return today - datetime.timedelta(days=today.weekday())


def _mean(values: Sequence[int]) -> Optional[int]:
    return int(round(sum(values) / len(values))) if values else None


def compute_insights(
    *,
    sessions: Sequence[Any],
    progress: Sequence[Any],
    wordbank: dict[str, int],
    today: Optional[datetime.date] = None,
    weekly_goal: int = 5,
) -> dict[str, Any]:
    """Everything the progress screen and the header badge need.

    ``sessions`` are rows with started_at/duration_s; ``progress`` are the newest-first
    scored reports (session_id/started_at/scores); ``wordbank`` is ``wordbank.summarize``.
    """
    moment = today or datetime.datetime.now(datetime.timezone.utc).date()
    monday = week_start(moment)

    total_seconds = 0
    week_seconds = 0
    week_sessions = 0
    today_sessions = 0
    for row in sessions:
        started = _as_datetime(_field(row, "started_at"))
        if started is None:
            continue
        try:
            seconds = int(_field(row, "duration_s") or 0)
        except (TypeError, ValueError):
            seconds = 0
        seconds = max(0, seconds)
        total_seconds += seconds
        day = started.date()
        if day >= monday:
            week_seconds += seconds
            week_sessions += 1
        if day == moment:
            today_sessions += 1

    days = practice_days(sessions)

    overalls: list[int] = []
    per_skill: dict[str, list[int]] = {skill: [] for skill in SKILLS}
    for row in progress:
        scores = _field(row, "scores")
        if not isinstance(scores, dict):
            continue
        overall = scores.get("overall")
        if isinstance(overall, (int, float)):
            overalls.append(int(overall))
        for skill in SKILLS:
            value = scores.get(skill)
            if isinstance(value, (int, float)):
                per_skill[skill].append(int(value))

    averages = {skill: _mean(values) for skill, values in per_skill.items()}
    ranked = [(skill, value) for skill, value in averages.items() if value is not None]
    strongest = max(ranked, key=lambda kv: kv[1], default=None)
    weakest = min(ranked, key=lambda kv: kv[1], default=None)

    improvement = None
    if len(overalls) >= 2:
        improvement = overalls[0] - overalls[-1]  # newest first

    goal = max(0, int(weekly_goal or 0))
    return {
        "today": moment.isoformat(),
        "week_start": monday.isoformat(),
        "streak_days": current_streak(days, moment),
        "active_days": len(days),
        "sessions_total": len(sessions),
        "sessions_today": today_sessions,
        "sessions_this_week": week_sessions,
        "minutes_total": round(total_seconds / 60.0),
        "minutes_this_week": round(week_seconds / 60.0),
        "weekly_goal": goal or None,
        "weekly_goal_met": bool(goal) and week_sessions >= goal,
        "weekly_goal_progress": min(1.0, week_sessions / goal) if goal else None,
        "avg_overall": _mean(overalls),
        "best_overall": max(overalls) if overalls else None,
        "latest_overall": overalls[0] if overalls else None,
        "improvement": improvement,
        "scored_sessions": len(overalls),
        "average_by_skill": averages,
        "strongest_skill": (
            {"skill": strongest[0], "label": SKILL_LABELS[strongest[0]], "score": strongest[1]}
            if strongest
            else None
        ),
        "weakest_skill": (
            {"skill": weakest[0], "label": SKILL_LABELS[weakest[0]], "score": weakest[1]}
            if weakest
            else None
        ),
        "wordbank": {
            "total": int(wordbank.get("total", 0)),
            "due": int(wordbank.get("due", 0)),
            "mastered": int(wordbank.get("mastered", 0)),
        },
    }
