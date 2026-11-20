"""Deterministic metrics and scoring for mock interview transcripts.

Pure Python, zero LLM dependencies. All calculations are unit tested.
Handles English, Hindi, and Hinglish speech gracefully.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional, Tuple


# Standard English & common Hinglish stop words to exclude from top repeated words
STOP_WORDS = {
    # English
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
    "aren't", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both",
    "but", "by", "can", "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does",
    "doesn't", "doing", "don't", "down", "during", "each", "few", "for", "from", "further", "had",
    "hadn't", "has", "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her",
    "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's", "i", "i'd",
    "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it", "it's", "its", "itself",
    "let's", "me", "more", "most", "mustn't", "my", "myself", "no", "nor", "not", "of", "off",
    "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out", "over", "own",
    "same", "shan't", "she", "she'd", "she'll", "she's", "should", "shouldn't", "so", "some",
    "such", "than", "that", "that's", "the", "their", "theirs", "them", "themselves", "then",
    "there", "there's", "these", "they", "they'd", "they'll", "they're", "they've", "this",
    "those", "through", "to", "too", "under", "until", "up", "very", "was", "wasn't", "we", "we'd",
    "we'll", "we're", "we've", "were", "weren't", "what", "what's", "when", "when's", "where",
    "where's", "which", "while", "who", "who's", "whom", "why", "why's", "with", "won't", "would",
    "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours", "yourself",
    "yourselves",
    # Fillers / Conversational tokens
    "um", "uh", "er", "ah", "like", "okay", "yeah", "yes", "so", "right",
    # Hindi / Hinglish common stop words
    "hai", "hain", "ke", "ka", "ki", "ko", "se", "me", "mein", "par", "bhi", "tha", "thi", "the",
    "ho", "karna", "kar", "raha", "rahi", "rahe", "yeh", "woh", "kya", "kyun", "kaise",
}

# Fillers in English and common Hindi/Hinglish
FILLER_PATTERNS = [
    r"\bum+\b",
    r"\buh+\b",
    r"\ber+\b",
    r"\bah+\b",
    r"\blike\b",
    r"\byou know\b",
    r"\bbasically\b",
    r"\bactually\b",
    r"\bmatlab\b",
    r"\bmtlb\b",
    r"\btoh\b",
    r"\byaani\b",
    r"\byani\b",
]

_COMPILED_FILLERS = [re.compile(p, re.IGNORECASE | re.UNICODE) for p in FILLER_PATTERNS]

_PUNCT_STRIP = ".,!?:;\"'()[]{}~`@#$%^&*-+=/\\|<>–—…"


def tokenize(text: str) -> List[str]:
    """Extracts words from text, preserving Unicode/Hindi tokens cleanly."""
    if not text:
        return []
    words = []
    for token in text.split():
        clean = token.strip(_PUNCT_STRIP)
        if clean:
            words.append(clean)
    return words


def count_fillers(text: str) -> int:
    """Counts occurrences of filler words/phrases."""
    if not text:
        return 0
    total = 0
    for pattern in _COMPILED_FILLERS:
        total += len(pattern.findall(text))
    return total


@dataclass
class SessionMetrics:
    user_word_count: int
    user_turn_count: int
    avg_turn_words: float
    longest_turn_words: int
    speaking_time_s: float
    wpm: float  # Labelled approximate in UI
    filler_count: int  # Labelled approximate in UI
    filler_per_100_words: float
    avg_response_gap_s: float
    max_response_gap_s: float
    unique_words: int
    type_token_ratio: float
    top_repeated_words: List[Dict[str, Any]]
    is_too_short: bool

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def calculate_metrics(turns: List[Any]) -> SessionMetrics:
    """Computes all deterministic metrics from a list of stored turns.

    turns: list of objects (or dicts) with attributes:
      idx, speaker ("user" | "agent"), text, started_at_ms, ended_at_ms
    """
    user_turns: List[Any] = []
    agent_turns_by_idx: Dict[int, Any] = {}

    for t in turns:
        speaker = getattr(t, "speaker", None) or (t.get("speaker") if isinstance(t, dict) else "")
        if speaker == "user":
            user_turns.append(t)
        elif speaker == "agent":
            idx = getattr(t, "idx", None) if hasattr(t, "idx") else (t.get("idx") if isinstance(t, dict) else None)
            if idx is not None:
                agent_turns_by_idx[idx] = t

    user_turn_count = len(user_turns)
    all_user_words: List[str] = []
    total_speaking_time_s = 0.0
    longest_turn_words = 0
    total_fillers = 0

    for t in user_turns:
        text = getattr(t, "text", "") if hasattr(t, "text") else (t.get("text", "") if isinstance(t, dict) else "")
        words = tokenize(text)
        all_user_words.extend([w.lower() for w in words])
        w_count = len(words)
        if w_count > longest_turn_words:
            longest_turn_words = w_count

        total_fillers += count_fillers(text)

        # Duration in seconds
        start_ms = getattr(t, "started_at_ms", None) if hasattr(t, "started_at_ms") else (t.get("started_at_ms") if isinstance(t, dict) else None)
        end_ms = getattr(t, "ended_at_ms", None) if hasattr(t, "ended_at_ms") else (t.get("ended_at_ms") if isinstance(t, dict) else None)
        if start_ms is not None and end_ms is not None and end_ms >= start_ms:
            duration_s = (end_ms - start_ms) / 1000.0
            total_speaking_time_s += duration_s
        elif w_count > 0:
            # Fallback estimation if timing missing: ~130 WPM
            total_speaking_time_s += (w_count / 130.0) * 60.0

    user_word_count = len(all_user_words)
    avg_turn_words = round(user_word_count / max(1, user_turn_count), 1)

    speaking_minutes = total_speaking_time_s / 60.0
    if speaking_minutes > 0.05 and user_word_count > 0:
        wpm = round(user_word_count / speaking_minutes, 1)
    else:
        wpm = 0.0

    filler_per_100_words = round((total_fillers / max(1, user_word_count)) * 100.0, 1)

    # Calculate response gaps: time from preceding agent turn end to user turn start
    response_gaps: List[float] = []
    for t in user_turns:
        user_idx = getattr(t, "idx", 0) if hasattr(t, "idx") else (t.get("idx", 0) if isinstance(t, dict) else 0)
        user_start_ms = getattr(t, "started_at_ms", None) if hasattr(t, "started_at_ms") else (t.get("started_at_ms") if isinstance(t, dict) else None)
        # Preceding turn is user_idx - 1
        agent_turn = agent_turns_by_idx.get(user_idx - 1)
        if agent_turn and user_start_ms is not None:
            agent_end_ms = getattr(agent_turn, "ended_at_ms", None) if hasattr(agent_turn, "ended_at_ms") else (agent_turn.get("ended_at_ms") if isinstance(agent_turn, dict) else None)
            if agent_end_ms is not None and user_start_ms >= agent_end_ms:
                gap_s = (user_start_ms - agent_end_ms) / 1000.0
                if gap_s < 30.0:  # Ignore gaps longer than 30s as user disengaged / paused
                    response_gaps.append(gap_s)

    avg_response_gap_s = round(sum(response_gaps) / max(1, len(response_gaps)), 2) if response_gaps else 0.0
    max_response_gap_s = round(max(response_gaps), 2) if response_gaps else 0.0

    # Vocabulary diversity
    unique_words_set = set(all_user_words)
    unique_words = len(unique_words_set)
    type_token_ratio = round(unique_words / max(1, user_word_count), 2)

    # Top repeated non-stop words
    word_freq: Dict[str, int] = {}
    for w in all_user_words:
        if w not in STOP_WORDS and len(w) > 2 and not w.isdigit():
            word_freq[w] = word_freq.get(w, 0) + 1

    sorted_words = sorted(word_freq.items(), key=lambda x: x[1], reverse=True)
    top_repeated_words = [{"word": w, "count": c} for w, c in sorted_words[:5] if c >= 2]

    is_too_short = user_word_count < 30 or user_turn_count < 3

    return SessionMetrics(
        user_word_count=user_word_count,
        user_turn_count=user_turn_count,
        avg_turn_words=avg_turn_words,
        longest_turn_words=longest_turn_words,
        speaking_time_s=round(total_speaking_time_s, 1),
        wpm=wpm,
        filler_count=total_fillers,
        filler_per_100_words=filler_per_100_words,
        avg_response_gap_s=avg_response_gap_s,
        max_response_gap_s=max_response_gap_s,
        unique_words=unique_words,
        type_token_ratio=type_token_ratio,
        top_repeated_words=top_repeated_words,
        is_too_short=is_too_short,
    )


def compute_pace_score(wpm: float) -> int:
    """Computes pace score 0-100 based on WPM bands (spec 6A).

    - 110-160 -> 90-100
    - 90-110 or 160-180 -> 75-90
    - 70-90 or 180-200 -> 55-75
    - below 70 or above 200 -> 30-55
    """
    if wpm <= 0:
        return 30

    if 110.0 <= wpm <= 160.0:
        # Ideal speaking pace: peak at 135 WPM
        dist_from_center = abs(wpm - 135.0) / 25.0
        score = 90.0 + 10.0 * (1.0 - dist_from_center)
    elif 90.0 <= wpm < 110.0:
        score = 75.0 + 15.0 * ((wpm - 90.0) / 20.0)
    elif 160.0 < wpm <= 180.0:
        score = 90.0 - 15.0 * ((wpm - 160.0) / 20.0)
    elif 70.0 <= wpm < 90.0:
        score = 55.0 + 20.0 * ((wpm - 70.0) / 20.0)
    elif 180.0 < wpm <= 200.0:
        score = 75.0 - 20.0 * ((wpm - 180.0) / 20.0)
    elif wpm < 70.0:
        score = 30.0 + 25.0 * max(0.0, wpm / 70.0)
    else:  # wpm > 200.0
        score = max(30.0, 55.0 - 25.0 * min(1.0, (wpm - 200.0) / 60.0))

    return int(round(max(0, min(100, score))))


def compute_code_fluency_score(metrics: SessionMetrics) -> int:
    """Computes pure code fluency component from filler rate and response gaps."""
    # 1. Filler rate score
    f_rate = metrics.filler_per_100_words
    if f_rate <= 1.5:
        filler_score = 95.0
    elif f_rate <= 3.0:
        filler_score = 85.0 - (f_rate - 1.5) * 6.0
    elif f_rate <= 6.0:
        filler_score = 75.0 - (f_rate - 3.0) * 6.0
    else:
        filler_score = max(30.0, 55.0 - (f_rate - 6.0) * 4.0)

    # 2. Response gap score
    gap = metrics.avg_response_gap_s
    if gap <= 1.5:
        gap_score = 95.0
    elif gap <= 3.0:
        gap_score = 85.0 - (gap - 1.5) * 8.0
    elif gap <= 5.0:
        gap_score = 70.0 - (gap - 3.0) * 8.0
    else:
        gap_score = max(35.0, 50.0 - (gap - 5.0) * 3.0)

    score = 0.5 * filler_score + 0.5 * gap_score
    return int(round(max(0, min(100, score))))


def compute_final_scores(
    metrics: SessionMetrics,
    llm_scores: Optional[Dict[str, int]] = None,
) -> Dict[str, Any]:
    """Computes final 0-100 rubric scores and CEFR estimated level.

    The LLM provides subjective assessments for grammar, vocabulary, communication,
    and a judgement for fluency. All final values are strictly computed in code.
    The LLM's own 'overall' is ignored.
    """
    llm = llm_scores or {}

    pace = compute_pace_score(metrics.wpm)
    code_fluency = compute_code_fluency_score(metrics)

    # Fluency: 50% code + 50% LLM judgement (or 100% code if no LLM)
    llm_fluency = llm.get("fluency", code_fluency)
    fluency = int(round(0.5 * code_fluency + 0.5 * llm_fluency))

    # Grammar from LLM (default 70 if not supplied)
    grammar = int(round(llm.get("grammar", 70)))

    # Communication from LLM (default 70 if not supplied)
    communication = int(round(llm.get("communication", 70)))

    # Vocabulary: LLM score nudged by Type-Token Ratio (+/- 5)
    raw_vocab = float(llm.get("vocabulary", 70))
    ttr = metrics.type_token_ratio
    if ttr >= 0.65:
        ttr_nudge = 5.0
    elif ttr >= 0.50:
        ttr_nudge = 2.0
    elif ttr <= 0.25:
        ttr_nudge = -5.0
    elif ttr <= 0.35:
        ttr_nudge = -2.0
    else:
        ttr_nudge = 0.0
    vocabulary = int(round(raw_vocab + ttr_nudge))

    # Clamp all subscores to [0, 100]
    pace = max(0, min(100, pace))
    fluency = max(0, min(100, fluency))
    grammar = max(0, min(100, grammar))
    communication = max(0, min(100, communication))
    vocabulary = max(0, min(100, vocabulary))

    # Weighted overall computed in code (Spec 6A):
    # grammar 0.25, communication 0.25, fluency 0.20, vocabulary 0.20, pace 0.10
    overall = int(round(
        grammar * 0.25 +
        communication * 0.25 +
        fluency * 0.20 +
        vocabulary * 0.20 +
        pace * 0.10
    ))
    overall = max(0, min(100, overall))

    # CEFR Level estimation
    if overall >= 85:
        estimated_level = "C1"
    elif overall >= 75:
        estimated_level = "B2"
    elif overall >= 65:
        estimated_level = "B1+"
    elif overall >= 50:
        estimated_level = "B1"
    else:
        estimated_level = "A2"

    return {
        "overall": overall,
        "estimated_level": estimated_level,
        "scores": {
            "fluency": fluency,
            "vocabulary": vocabulary,
            "grammar": grammar,
            "communication": communication,
            "pace": pace,
            "pronunciation": None,  # Explicitly None ("coming soon" in UI, never invented)
        },
    }
