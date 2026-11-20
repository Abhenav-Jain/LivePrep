"""Unit tests for deterministic metrics & scoring (backend/report_metrics.py)."""
import pytest
from report_metrics import (
    calculate_metrics,
    compute_pace_score,
    compute_code_fluency_score,
    compute_final_scores,
    tokenize,
    count_fillers,
)


class MockTurn:
    def __init__(self, idx, speaker, text, started_at_ms=None, ended_at_ms=None):
        self.idx = idx
        self.speaker = speaker
        self.text = text
        self.started_at_ms = started_at_ms
        self.ended_at_ms = ended_at_ms


def test_tokenize_english_and_hinglish():
    text = "Hello world! I'm practicing for my interview, matlab technical round."
    tokens = tokenize(text)
    assert "Hello" in tokens
    assert "matlab" in tokens
    assert "interview" in tokens

    # Hindi Unicode
    hindi_text = "नमस्ते दुनिया main tayar hoon"
    h_tokens = tokenize(hindi_text)
    assert len(h_tokens) == 5
    assert "नमस्ते" in h_tokens


def test_count_fillers():
    text = "Um, so basically, like you know, actually I was working on that, matlab."
    assert count_fillers(text) >= 5


def test_empty_turns():
    metrics = calculate_metrics([])
    assert metrics.user_word_count == 0
    assert metrics.user_turn_count == 0
    assert metrics.is_too_short is True
    assert metrics.wpm == 0.0


def test_one_word_turn():
    turns = [MockTurn(idx=0, speaker="user", text="Hi", started_at_ms=0, ended_at_ms=500)]
    metrics = calculate_metrics(turns)
    assert metrics.user_word_count == 1
    assert metrics.user_turn_count == 1
    assert metrics.is_too_short is True


def test_too_short_detection():
    # 2 turns, 10 words each = 20 words (< 30 words and < 3 turns)
    turns = [
        MockTurn(idx=0, speaker="agent", text="Tell me about yourself"),
        MockTurn(idx=1, speaker="user", text="I am a software engineer with three years experience here"),
        MockTurn(idx=2, speaker="agent", text="What is your tech stack?"),
        MockTurn(idx=3, speaker="user", text="I work mostly with React, Node, and Python daily"),
    ]
    metrics = calculate_metrics(turns)
    assert metrics.is_too_short is True

    # 3 turns, 35 words total -> is_too_short should be False
    turns.append(MockTurn(idx=4, speaker="agent", text="Good. What was your hardest bug?"))
    turns.append(MockTurn(idx=5, speaker="user", text="One time our production database had a severe deadlock issue caused by unindexed foreign keys and high concurrent update transactions."))
    metrics2 = calculate_metrics(turns)
    assert metrics2.is_too_short is False
    assert metrics2.user_turn_count == 3
    assert metrics2.user_word_count > 30


def test_pace_score_bands():
    # Ideal band (110-160) -> 90-100
    assert 90 <= compute_pace_score(135.0) <= 100
    assert 90 <= compute_pace_score(120.0) <= 100
    assert 90 <= compute_pace_score(155.0) <= 100

    # 90-110 or 160-180 -> 75-90
    assert 75 <= compute_pace_score(100.0) <= 90
    assert 75 <= compute_pace_score(170.0) <= 90

    # 70-90 or 180-200 -> 55-75
    assert 55 <= compute_pace_score(80.0) <= 75
    assert 55 <= compute_pace_score(190.0) <= 75

    # Extreme bounds (<70 or >200) -> 30-55
    assert 30 <= compute_pace_score(50.0) <= 55
    assert 30 <= compute_pace_score(240.0) <= 55
    assert compute_pace_score(0) == 30


def test_code_fluency_and_final_scores_formula():
    turns = [
        MockTurn(idx=0, speaker="agent", text="Hello", started_at_ms=0, ended_at_ms=1000),
        MockTurn(idx=1, speaker="user", text="Hello there, thank you for inviting me to this interview today.", started_at_ms=2000, ended_at_ms=6000),
        MockTurn(idx=2, speaker="agent", text="Can you explain your background?", started_at_ms=6500, ended_at_ms=8000),
        MockTurn(idx=3, speaker="user", text="I have worked at several fast paced startups building distributed backend systems.", started_at_ms=9000, ended_at_ms=14000),
        MockTurn(idx=4, speaker="agent", text="What is your favorite language?", started_at_ms=14500, ended_at_ms=16000),
        MockTurn(idx=5, speaker="user", text="I really enjoy Python because of its expressive syntax, readable codebase, and great ecosystem.", started_at_ms=17000, ended_at_ms=22000),
    ]
    metrics = calculate_metrics(turns)
    assert metrics.user_turn_count == 3
    assert metrics.user_word_count > 30

    llm_scores = {
        "grammar": 80,
        "communication": 85,
        "fluency": 82,
        "vocabulary": 78,
        "overall": 99,  # This should be IGNORED by the code
    }

    result = compute_final_scores(metrics, llm_scores)
    scores = result["scores"]

    # Verify LLM overall was ignored and computed in code
    expected_overall = int(round(
        scores["grammar"] * 0.25 +
        scores["communication"] * 0.25 +
        scores["fluency"] * 0.20 +
        scores["vocabulary"] * 0.20 +
        scores["pace"] * 0.10
    ))
    assert result["overall"] == expected_overall
    assert result["overall"] != 99

    # Pronunciation must be None (never invented)
    assert scores["pronunciation"] is None

    # Estimated CEFR level
    assert result["estimated_level"] in ("A2", "B1", "B1+", "B2", "C1")
