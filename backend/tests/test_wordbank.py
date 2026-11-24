"""Unit tests for the word bank: cleaning, report extraction and spaced repetition."""
import datetime
import uuid

import pytest

from wordbank import (
    MAX_ALTERNATIVES,
    STATUS_LEARNING,
    STATUS_MASTERED,
    STATUS_NEW,
    clean_alternatives,
    daily_goal_hint,
    extract_items,
    is_due,
    normalize_term,
    schedule_review,
    summarize,
    term_key,
)

NOW = datetime.datetime(2026, 11, 24, 10, 0, tzinfo=datetime.timezone.utc)


class Row:
    """Stand-in for a stored card."""

    def __init__(self, status="new", next_review_at=None):
        self.status = status
        self.next_review_at = next_review_at


def test_normalize_term_rejects_empty_and_cleans_control_characters():
    assert normalize_term(None) is None
    assert normalize_term("   ") is None
    assert normalize_term("...") is None
    assert normalize_term("  actually  ") == "actually"
    assert normalize_term("line\nbreak") == "line break"
    assert normalize_term("a" * 500).endswith("\u2026")
    assert len(normalize_term("a" * 500)) == 120


def test_term_key_is_case_insensitive_and_whitespace_stable():
    assert term_key("  In Order To ") == term_key("in order to")
    assert term_key("Don't") == "don't"


def test_clean_alternatives_drops_duplicates_and_caps_the_list():
    alts = clean_alternatives(["better", "Better", "", None, "best", "x", "y", "z"])
    assert alts[:2] == ["better", "best"]
    assert len(alts) == MAX_ALTERNATIVES


def test_extract_items_reads_vocabulary_and_grammar():
    report = {
        "words_to_upgrade": [
            {"used": "good", "alternatives": ["excellent", "solid"]},
            {"used": "good", "alternatives": ["duplicate is dropped"]},
        ],
        "grammar_mistakes": [
            {"said": "I has a car", "better": "I have a car", "rule": "subject-verb agreement"},
            {"said": "", "better": "ignored"},
        ],
    }
    items = extract_items(report)

    assert [item["term"] for item in items] == ["good", "I has a car"]
    assert items[0]["alternatives"] == ["excellent", "solid"]
    assert items[0]["source"] == "vocabulary"
    assert items[1]["alternatives"] == ["I have a car"]
    assert items[1]["note"] == "subject-verb agreement"
    assert items[1]["source"] == "grammar"
    assert items[1]["key"] == "i has a car"


def test_extract_items_is_defensive():
    assert extract_items(None) == []
    assert extract_items({}) == []
    assert extract_items({"words_to_upgrade": "nope", "grammar_mistakes": [1, None]}) == []


def test_extract_items_caps_the_number_of_cards():
    report = {
        "words_to_upgrade": [
            {"used": f"word{i}", "alternatives": ["x"]} for i in range(40)
        ]
    }
    assert len(extract_items(report)) == 12


def test_first_good_review_schedules_one_day():
    state = schedule_review(result="good", interval_days=0, review_count=0, correct_count=0, now=NOW)
    assert state["interval_days"] == 1
    assert state["status"] == STATUS_LEARNING
    assert state["review_count"] == 1
    assert state["correct_count"] == 1
    assert state["next_review_at"] == NOW + datetime.timedelta(days=1)


def test_intervals_grow_and_are_capped():
    state = schedule_review(result="good", interval_days=8, now=NOW)
    assert state["interval_days"] == 16
    assert state["status"] == STATUS_MASTERED

    capped = schedule_review(result="easy", interval_days=170, now=NOW)
    assert capped["interval_days"] == 180


def test_again_resets_to_ten_minutes_and_keeps_learning():
    state = schedule_review(
        result="again", interval_days=30, review_count=4, correct_count=4, now=NOW
    )
    assert state["interval_days"] == 0
    assert state["status"] == STATUS_LEARNING
    assert state["review_count"] == 5
    assert state["correct_count"] == 4  # a failure never counts as a success
    assert state["next_review_at"] == NOW + datetime.timedelta(minutes=10)


def test_unknown_result_is_rejected():
    with pytest.raises(ValueError):
        schedule_review(result="perfect", now=NOW)


def test_is_due_handles_missing_and_naive_timestamps():
    assert is_due(None, NOW) is True
    assert is_due(NOW + datetime.timedelta(days=1), NOW) is False
    naive_past = datetime.datetime(2020, 1, 1)
    assert is_due(naive_past, NOW) is True


def test_summarize_counts_statuses_and_due_cards():
    rows = [
        Row(STATUS_NEW, None),
        Row(STATUS_LEARNING, NOW + datetime.timedelta(days=2)),
        Row(STATUS_MASTERED, NOW - datetime.timedelta(days=1)),
        {"status": STATUS_NEW, "next_review_at": None},
    ]
    counts = summarize(rows, NOW)
    assert counts == {"total": 4, "due": 3, "new": 2, "learning": 1, "mastered": 1}


def test_daily_goal_hint_is_short_and_honest():
    assert "Nothing due" in daily_goal_hint(0)
    assert daily_goal_hint(1).startswith("1 word")
    assert "10 words" in daily_goal_hint(10)
