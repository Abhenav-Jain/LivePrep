"""Small in-memory rate limiter for endpoints that spend money.

Each key (a user id, or an IP) gets a sliding window budget: a fixed number of attempts
per window. In process memory, so it only covers ONE server instance; move it to Redis
together with the ticket store (see tickets.py) before running more than one.

Typical use: rebuilding a report costs up to two model calls, so a user cannot hammer
the retry endpoint and drain the Gemini quota.
"""
import time
from collections import deque
from typing import Callable, Deque, Dict, Optional


class RateLimitError(Exception):
    """Raised when a key has spent its budget. Carries how long the caller should wait."""

    def __init__(self, retry_after_s: float) -> None:
        super().__init__(f"rate limited, retry in {retry_after_s:.0f}s")
        self.retry_after_s = retry_after_s


class SlidingWindowLimiter:
    """At most ``max_events`` attempts per key in any ``window_s`` seconds."""

    def __init__(
        self,
        max_events: int,
        window_s: float,
        clock: Callable[[], float] = time.monotonic,
        max_keys: int = 50_000,
    ) -> None:
        self.max_events = max(0, int(max_events))  # 0 disables the limit
        self.window_s = max(0.0, float(window_s))
        self._clock = clock
        self._max_keys = max(1, int(max_keys))
        self._events: Dict[str, Deque[float]] = {}

    def _bucket(self, key: str) -> Deque[float]:
        bucket = self._events.get(key)
        if bucket is None:
            if len(self._events) >= self._max_keys:
                # Bounded memory: drop buckets whose window has already gone quiet.
                now = self._clock()
                for stale in [k for k, b in self._events.items() if not b or b[-1] <= now - self.window_s]:
                    del self._events[stale]
            bucket = deque()
            self._events[key] = bucket
        return bucket

    def hit(self, key) -> None:
        """Record one attempt. Raises RateLimitError when the budget is already spent."""
        if self.max_events <= 0:
            return
        name = str(key)
        now = self._clock()
        bucket = self._bucket(name)
        cutoff = now - self.window_s
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()
        if len(bucket) >= self.max_events:
            wait = bucket[0] + self.window_s - now
            raise RateLimitError(retry_after_s=max(1.0, wait))
        bucket.append(now)

    def remaining(self, key) -> Optional[int]:
        """Attempts left for this key (None when the limiter is disabled)."""
        if self.max_events <= 0:
            return None
        now = self._clock()
        bucket = self._events.get(str(key))
        if bucket is None:
            return self.max_events
        cutoff = now - self.window_s
        used = sum(1 for t in bucket if t > cutoff)
        return max(0, self.max_events - used)

    def clear(self) -> None:
        self._events.clear()
