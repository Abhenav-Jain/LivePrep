"""Unit tests for the practice insights (streak, weekly goal, totals, trends)."""
import datetime

from insights import compute_insights, current_streak, practice_days, week_start

TODAY = datetime.date(2026, 11, 24)  # a Tuesday


def _session(day_offset=0, seconds=600, today=TODAY):
    started = datetime.datetime.combine(
        today - datetime.timedelta(days=day_offset),
        datetime.time(9, 0),
        tzinfo=datetime.timezone.utc,
    )
    return {"started_at": started, "duration_s": seconds}


def _report(overall, **skills):
    scores = {"overall": overall, "fluency": 60, "vocabulary": 70, "grammar": 50,
              "communication": 80, "pace": 90}
    scores.update(skills)
    return {"session_id": "s", "started_at": None, "scores": scores}


def test_week_start_is_monday():
    assert week_start(TODAY) == datetime.date(2026, 11, 23)


def test_streak_counts_consecutive_days_back_from_today():
    rows = [_session(0), _session(1), _session(2)]
    assert current_streak(practice_days(rows), TODAY) == 3


def test_streak_does_not_break_before_today_is_over():
    rows = [_session(1), _session(2)]  # nothing yet today
    assert current_streak(practice_days(rows), TODAY) == 2


def test_streak_is_zero_after_a_gap():
    rows = [_session(3), _session(4)]
    assert current_streak(practice_days(rows), TODAY) == 0


def test_tiny_sessions_do_not_count_as_a_practice_day():
    rows = [_session(0, seconds=5)]
    assert practice_days(rows) == set()


def test_insights_totals_week_and_goal():
    rows = [
        _session(0, 600),   # today, this week
        _session(1, 300),   # yesterday, this week
        _session(13, 900),  # previous week, still in the 14-day total
    ]
    result = compute_insights(
        sessions=rows,
        progress=[_report(80), _report(60)],
        wordbank={"total": 12, "due": 4, "mastered": 5},
        today=TODAY,
        weekly_goal=6,
    )

    assert result["sessions_total"] == 3
    assert result["sessions_today"] == 1
    assert result["sessions_this_week"] == 2
    assert result["minutes_total"] == 30
    assert result["minutes_this_week"] == 15
    assert result["weekly_goal"] == 6
    assert result["weekly_goal_met"] is False
    assert abs(result["weekly_goal_progress"] - 2 / 6) < 1e-6
    assert result["streak_days"] == 2
    assert result["latest_overall"] == 80
    assert result["best_overall"] == 80
    assert result["avg_overall"] == 70
    assert result["improvement"] == 20  # newest minus oldest
    assert result["wordbank"]["due"] == 4


def test_insights_handle_no_data():
    result = compute_insights(sessions=[], progress=[], wordbank={}, today=TODAY, weekly_goal=0)
    assert result["streak_days"] == 0
    assert result["sessions_total"] == 0
    assert result["avg_overall"] is None
    assert result["best_overall"] is None
    assert result["improvement"] is None
    assert result["weekly_goal"] is None
    assert result["weekly_goal_progress"] is None
    assert result["strongest_skill"] is None


def test_strongest_and_weakest_skill():
    result = compute_insights(
        sessions=[_session(0)],
        progress=[_report(70, fluency=95, pace=40)],
        wordbank={},
        today=TODAY,
    )
    assert result["strongest_skill"]["skill"] == "fluency"
    assert result["weakest_skill"]["skill"] == "pace"
    assert result["strongest_skill"]["label"] == "Fluency"


def test_malformed_rows_are_skipped():
    rows = [{"started_at": "not-a-date", "duration_s": 10}, {"started_at": None}, {}]
    result = compute_insights(
        sessions=rows, progress=[{"scores": "bad"}], wordbank={}, today=TODAY
    )
    assert result["sessions_total"] == 3
    assert result["minutes_total"] == 0
    assert result["avg_overall"] is None
