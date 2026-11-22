"""Turn assembler: converts a stream of transcription fragments into complete turns.

The assembler lives as long as the session (not as long as one Gemini connection),
so its idx counter survives Gemini reconnects.

Timing is in milliseconds since session start, measured with time.monotonic() (or
an injectable clock for tests). The session-start anchor is set on the first call.
"""
from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Optional

logger = logging.getLogger("liveprep-transcript")

# Hard limits (spec §5A)
_MAX_TURN_CHARS = 8_000
_MAX_TURNS_PER_SESSION = 2_000


def join_fragments(fragments: list[str]) -> str:
    """Joins transcript fragments into one clean string.

    Gemini streams transcription in small pieces and does not always put a space at the
    piece boundary ("a" + "clever", "that" + "introduction"), which glued words together.
    A single space is therefore inserted when a piece starts right after a word character
    and carries no whitespace of its own. Whitespace that is already present is respected,
    and runs of spaces / newlines are collapsed.
    This is the ONE function used server-side so text never disagrees
    with what the client would compute using the same rule.
    """
    raw = ""
    for fragment in fragments:
        if not fragment:
            continue
        if (
            raw
            and not raw[-1].isspace()
            and not fragment[0].isspace()
            and raw[-1].isalnum()
            and fragment[0].isalnum()
        ):
            raw += " "
        raw += fragment
    return re.sub(r"[ \t\n\r]+", " ", raw).strip()


@dataclass
class Turn:
    idx: int
    speaker: str          # "user" or "agent"
    text: str
    started_at_ms: int
    ended_at_ms: int


@dataclass
class _Pending:
    """Accumulator for the in-progress turn."""
    speaker: str
    fragments: list[str] = field(default_factory=list)
    started_at_ms: int = 0
    last_at_ms: int = 0
    char_count: int = 0
    _truncated: bool = False

    def add(self, text: str, now_ms: int) -> None:
        if self._truncated:
            return
        new_chars = len(text)
        if self.char_count + new_chars > _MAX_TURN_CHARS:
            # Accept only the allowed remainder
            allowed = _MAX_TURN_CHARS - self.char_count
            if allowed > 0:
                self.fragments.append(text[:allowed])
                self.char_count += allowed
            self._truncated = True
            return
        self.fragments.append(text)
        self.char_count += new_chars
        self.last_at_ms = now_ms

    def build(self, idx: int) -> Optional[Turn]:
        text = join_fragments(self.fragments)
        if not text:
            return None
        return Turn(
            idx=idx,
            speaker=self.speaker,
            text=text,
            started_at_ms=self.started_at_ms,
            ended_at_ms=self.last_at_ms,
        )


class TurnAssembler:
    """Assembles a stream of transcription fragments into complete Turn objects.

    Usage::

        assembler = TurnAssembler(on_turn=async_callback)
        assembler.add_fragment("user", "Hello")
        assembler.add_fragment("user", " there")
        await assembler.end_turn()   # fires on_turn with the assembled turn
        await assembler.flush()      # call on session end to emit any pending turn

    Speaker-change rule: when add_fragment is called with a different speaker, the
    previous turn is queued in a ready buffer.  It is emitted the next time
    end_turn() or flush() is awaited (so emission is always asynchronous).
    """

    def __init__(
        self,
        on_turn: Callable[[Turn], Awaitable[None]],
        clock: Optional[Callable[[], float]] = None,
    ) -> None:
        self._on_turn = on_turn
        self._clock = clock or time.monotonic
        self._start: Optional[float] = None   # session-start anchor (set on first fragment)
        self._idx: int = 0
        self._pending: Optional[_Pending] = None
        # Turns completed by a speaker-change waiting to be emitted on the next await
        self._ready: list[Turn] = []
        self._total_turns: int = 0
        self._warn_logged: bool = False

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    def add_fragment(self, speaker: str, text: str) -> None:
        """Accept a transcription fragment (synchronous, non-blocking)."""
        if not text or not text.strip():
            return  # ignore empty / whitespace-only

        now_ms = self._now_ms()

        # Cap on session-level turns
        if self._total_turns >= _MAX_TURNS_PER_SESSION:
            if not self._warn_logged:
                logger.warning(
                    "Session turn cap reached (%d turns). Further turns are dropped.",
                    _MAX_TURNS_PER_SESSION,
                )
                self._warn_logged = True
            return

        if self._pending is None:
            self._pending = _Pending(
                speaker=speaker,
                started_at_ms=now_ms,
                last_at_ms=now_ms,
            )
        elif self._pending.speaker != speaker:
            # Speaker changed: synchronously close the old turn into the ready queue.
            # Emission happens on the next end_turn() / flush().
            closed = self._close_pending_sync()
            if closed is not None:
                self._ready.append(closed)
            self._pending = _Pending(
                speaker=speaker,
                started_at_ms=now_ms,
                last_at_ms=now_ms,
            )

        self._pending.add(text, now_ms)
        if self._pending._truncated and not self._warn_logged:
            logger.warning(
                "Turn %d truncated at %d chars (speaker=%s).",
                self._idx, _MAX_TURN_CHARS, speaker,
            )
            self._warn_logged = True

    async def end_turn(self) -> None:
        """Call when the model signals turn_complete or interruption."""
        await self._emit_all()

    async def flush(self) -> None:
        """Call on session end to emit any in-progress turn."""
        await self._emit_all()

    # ------------------------------------------------------------------ #
    # Internal helpers
    # ------------------------------------------------------------------ #

    def _now_ms(self) -> int:
        t = self._clock()
        if self._start is None:
            self._start = t
        return int((t - self._start) * 1000)

    def _close_pending_sync(self) -> Optional[Turn]:
        """Build a Turn from the pending accumulator; does NOT emit it."""
        if self._pending is None:
            return None
        turn = self._pending.build(self._idx)
        self._pending = None
        if turn is not None:
            self._idx += 1
            self._total_turns += 1
            return turn
        return None

    async def _emit_all(self) -> None:
        """Emit all ready turns (speaker-change queue), then the current pending turn."""
        # 1. Drain the ready queue (turns closed by a speaker change)
        to_emit = list(self._ready)
        self._ready.clear()
        for turn in to_emit:
            try:
                await self._on_turn(turn)
            except Exception as e:  # noqa: BLE001
                logger.error("on_turn callback failed: %s", type(e).__name__)

        # 2. Close and emit the current pending turn
        turn = self._close_pending_sync()
        if turn is not None:
            try:
                await self._on_turn(turn)
            except Exception as e:  # noqa: BLE001
                logger.error("on_turn callback failed: %s", type(e).__name__)
