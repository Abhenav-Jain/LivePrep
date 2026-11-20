"""Tests for TurnAssembler (backend/transcript.py).

Covers:
- Fragment joining (with and without leading spaces)
- Speaker change triggers a turn close
- turn_complete (end_turn) triggers a turn close
- flush on session end emits pending turn
- idx sequence survives a simulated reconnect (assembler lives on)
- Empty fragments are ignored
- Per-turn character cap (8000)
- Per-session turn cap (2000)
- Timing is non-decreasing
- Injectable clock
"""
import asyncio
import pytest

from transcript import TurnAssembler, Turn, join_fragments, _MAX_TURN_CHARS, _MAX_TURNS_PER_SESSION


# ---------------------------------------------------------------------------
# join_fragments
# ---------------------------------------------------------------------------
def test_join_no_fragments():
    assert join_fragments([]) == ""


def test_join_single():
    assert join_fragments(["hello"]) == "hello"


def test_join_concatenates_exactly():
    # Fragments sent by Gemini sometimes start with a space
    assert join_fragments(["Hello", " there", " friend"]) == "Hello there friend"


def test_join_leading_space_on_first_fragment():
    assert join_fragments([" hi"]) == "hi"


def test_join_normalises_runs_of_spaces():
    assert join_fragments(["a  b", "  c"]) == "a b c"


def test_join_normalises_newlines():
    assert join_fragments(["line1\nline2"]) == "line1 line2"


def test_join_trims():
    assert join_fragments(["  x  "]) == "x"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def make_clock(start=0.0):
    """Returns a clock that advances by dt each call."""
    t = [start]

    def _tick(dt=0.1):
        t[0] += dt
        return t[0]

    return _tick


def collect_turns():
    """Returns (callback, list-of-received-turns)."""
    received: list[Turn] = []

    async def _cb(turn: Turn):
        received.append(turn)

    return _cb, received


# ---------------------------------------------------------------------------
# Basic assembly
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_end_turn_emits_joined_text():
    cb, turns = collect_turns()
    tick = make_clock()

    asm = TurnAssembler(on_turn=cb, clock=lambda: tick())
    asm.add_fragment("user", "Hello")
    asm.add_fragment("user", " world")
    await asm.end_turn()

    assert len(turns) == 1
    assert turns[0].text == "Hello world"
    assert turns[0].speaker == "user"
    assert turns[0].idx == 0


@pytest.mark.asyncio
async def test_flush_emits_pending():
    cb, turns = collect_turns()
    tick = make_clock()
    asm = TurnAssembler(on_turn=cb, clock=lambda: tick())
    asm.add_fragment("agent", "Sure thing")
    await asm.flush()
    assert len(turns) == 1
    assert turns[0].text == "Sure thing"


@pytest.mark.asyncio
async def test_flush_on_empty_emits_nothing():
    cb, turns = collect_turns()
    tick = make_clock()
    asm = TurnAssembler(on_turn=cb, clock=lambda: tick())
    await asm.flush()
    assert turns == []


# ---------------------------------------------------------------------------
# Speaker change
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_speaker_change_closes_first_turn():
    cb, turns = collect_turns()
    tick = make_clock()
    asm = TurnAssembler(on_turn=cb, clock=lambda: tick())
    asm.add_fragment("user", "My question")
    # Calling add_fragment with a different speaker triggers a close
    asm.add_fragment("agent", "My answer")
    await asm.end_turn()

    assert len(turns) == 2
    assert turns[0].speaker == "user"
    assert turns[1].speaker == "agent"


@pytest.mark.asyncio
async def test_idx_increments_across_speaker_change():
    cb, turns = collect_turns()
    tick = make_clock()
    asm = TurnAssembler(on_turn=cb, clock=lambda: tick())
    asm.add_fragment("user", "A")
    asm.add_fragment("agent", "B")
    await asm.end_turn()
    assert [t.idx for t in turns] == [0, 1]


# ---------------------------------------------------------------------------
# Empty fragments are ignored
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_empty_fragments_ignored():
    cb, turns = collect_turns()
    tick = make_clock()
    asm = TurnAssembler(on_turn=cb, clock=lambda: tick())
    asm.add_fragment("user", "")
    asm.add_fragment("user", "   ")
    await asm.flush()
    assert turns == []


@pytest.mark.asyncio
async def test_whitespace_only_fragment_ignored():
    cb, turns = collect_turns()
    tick = make_clock()
    asm = TurnAssembler(on_turn=cb, clock=lambda: tick())
    asm.add_fragment("user", "\t\n")
    asm.add_fragment("user", "real text")
    await asm.end_turn()
    assert len(turns) == 1
    assert turns[0].text == "real text"


# ---------------------------------------------------------------------------
# idx sequence survives a Gemini reconnect
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_idx_survives_reconnect():
    """Simulate two Gemini connections but one assembler (as the spec requires)."""
    cb, turns = collect_turns()
    tick = make_clock()
    asm = TurnAssembler(on_turn=cb, clock=lambda: tick())

    # First "Gemini connection"
    asm.add_fragment("user", "Before reconnect")
    await asm.end_turn()

    # Second "Gemini connection" (same assembler continues)
    asm.add_fragment("agent", "After reconnect")
    await asm.end_turn()

    assert [t.idx for t in turns] == [0, 1]


# ---------------------------------------------------------------------------
# Per-turn character cap
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_turn_char_cap_truncates():
    cb, turns = collect_turns()
    tick = make_clock()
    asm = TurnAssembler(on_turn=cb, clock=lambda: tick())

    # Add just over the limit
    asm.add_fragment("user", "A" * _MAX_TURN_CHARS)
    asm.add_fragment("user", "extra")
    await asm.end_turn()

    assert len(turns) == 1
    assert len(turns[0].text) == _MAX_TURN_CHARS


# ---------------------------------------------------------------------------
# Per-session turn cap
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_session_turn_cap_drops_beyond_limit():
    cb, turns = collect_turns()
    tick = make_clock()
    asm = TurnAssembler(on_turn=cb, clock=lambda: tick())

    for i in range(_MAX_TURNS_PER_SESSION + 5):
        # Alternate speakers to close each turn
        speaker = "user" if i % 2 == 0 else "agent"
        asm.add_fragment(speaker, f"turn {i}")
        await asm.end_turn()

    assert len(turns) == _MAX_TURNS_PER_SESSION


# ---------------------------------------------------------------------------
# Timing is non-decreasing
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_timing_non_decreasing():
    cb, turns = collect_turns()
    t_values = [0.0, 0.1, 0.5, 1.0, 2.0, 2.3]
    idx = [0]

    def clock():
        v = t_values[idx[0]]
        idx[0] = min(idx[0] + 1, len(t_values) - 1)
        return v

    asm = TurnAssembler(on_turn=cb, clock=clock)
    asm.add_fragment("user", "first")
    asm.add_fragment("user", "second")
    await asm.end_turn()
    asm.add_fragment("agent", "reply")
    await asm.end_turn()

    assert len(turns) == 2
    assert turns[0].started_at_ms <= turns[0].ended_at_ms
    assert turns[0].ended_at_ms <= turns[1].started_at_ms


# ---------------------------------------------------------------------------
# Multiple end_turn calls on empty pending do nothing
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_multiple_end_turn_on_empty():
    cb, turns = collect_turns()
    tick = make_clock()
    asm = TurnAssembler(on_turn=cb, clock=lambda: tick())
    await asm.end_turn()
    await asm.end_turn()
    assert turns == []


# ---------------------------------------------------------------------------
# Callback failure does not propagate
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_failing_callback_does_not_raise():
    async def bad_cb(turn):
        raise RuntimeError("db down")

    tick = make_clock()
    asm = TurnAssembler(on_turn=bad_cb, clock=lambda: tick())
    asm.add_fragment("user", "hello")
    await asm.end_turn()   # must not raise
