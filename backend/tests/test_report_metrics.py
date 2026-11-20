"""Unit tests for the objective half of Step 6 (no LLM, no network)."""
import math

import pytest

from reports import compute_metrics


class T:
    """Minimal duck-typed turn (models.Turn / transcript.Turn have the same fields)."""

    def __init__(self, idx, speaker, text, started_at_ms=None, ended_at_ms=None):
        self.idx = idx
        self.speaker = speaker
        self.text = text
        self.started_at_ms = started_at_ms
        self.ended_at_ms = ended_at_ms


SAMPLE = [
    T(0, "user", "Um, I think I, you know, like working with teams.", 0, 3000),
    T(1, "agent", "Tell me about a project.", 3500, 5000),
    T(2, "user", "I basically led a small team and actually shipped a feature.", 6000, 12000),
    T(3, "agent", "Great.", 12500, 13000),
]


def test_word_counts_and_speaking_time():
    m = compute_metrics(SAMPLE, duration_s=15)
    assert m["user_word_count"] == 21
    assert m["user_turn_count"] == 2
    assert m["agent_turn_count"] == 2
    assert m["total_turn_count"] == 4
    assert m["session_duration_s"] == 15
    # 3 s + 6 s of user speech
    assert m["user_speaking_s"] == 9.0


def test_words_per_minute_uses_speaking_time_not_session_length():
    m = compute_metrics(SAMPLE, duration_s=600)
    # 21 words in 9 s of speech -> 140 wpm (session length is irrelevant)
    assert m["words_per_minute"] == pytest.approx(140.0, abs=0.1)


def test_pauses_between_turns():
    m = compute_metrics(SAMPLE)
    # 0.5 s, 1.0 s, 0.5 s
    assert m["pause_count"] == 3
    assert m["longest_pause_s"] == 1.0
    assert m["avg_pause_s"] == pytest.approx(0.7, abs=0.05)


def test_fillers_and_breakdown():
    m = compute_metrics(SAMPLE)
    assert m["filler_count"] == 5
    assert m["filler_breakdown"] == {
        "um": 1, "you know": 1, "like": 1, "basically": 1, "actually": 1,
    }
    assert m["approximate"]["filler"] is True
    assert m["approximate"]["pronunciation"] == "coming_soon"


def test_type_token_ratio_and_unique_words():
    m = compute_metrics(SAMPLE)
    assert m["unique_word_count"] == 18
    assert m["type_token_ratio"] == pytest.approx(round(18 / 21, 3))


def test_avg_turn_length_and_top_repeated_words():
    repeated = [
        T(0, "user", "The project was hard. The project shipped.", 0, 4000),
        T(1, "user", "The project worked.", 5000, 7000),
    ]
    m = compute_metrics(repeated)
    assert m["user_word_count"] == 10
    assert m["avg_turn_length_words"] == pytest.approx(5.0)
    assert m["top_repeated_words"][0] == {"word": "project", "count": 3}


def test_empty_transcript_is_all_zeros_not_crash():
    m = compute_metrics([])
    assert m["user_word_count"] == 0
    assert m["words_per_minute"] is None
    assert m["type_token_ratio"] is None
    assert m["avg_pause_s"] is None
    assert m["longest_pause_s"] is None
    assert m["top_repeated_words"] == []


def test_negative_gaps_are_ignored():
    overlapping = [
        T(0, "user", "hello there", 0, 5000),
        T(1, "agent", "hi", 4000, 6000),  # started before previous ended (barge-in)
    ]
    m = compute_metrics(overlapping)
    assert m["pause_count"] == 0


def test_missing_timings_give_no_wpm_and_no_pauses():
    no_timing = [T(0, "user", "hello there friend", None, None)]
    m = compute_metrics(no_timing, duration_s=None)
    assert m["words_per_minute"] is None
    assert m["pause_count"] == 0
    assert m["user_word_count"] == 3
