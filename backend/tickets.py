"""Single-use, short-lived WebSocket tickets.

Why tickets? A browser WebSocket cannot send an ``Authorization`` header, and putting
the long-lived access token in the URL would leak it into logs. So the browser first
calls ``POST /api/ws-ticket`` (authenticated with its Supabase token) and receives a
random one-time ticket, then sends that ticket as the first WebSocket message.

Properties
* random (256 bits), valid for ``ttl_seconds`` (default 60), usable exactly once;
* only a SHA-256 hash is kept in memory, so a memory dump does not reveal live tickets;
* a user can hold only a few unused tickets at a time (stops ticket flooding);
* the store is bounded in size.

This store lives in process memory, so it only works with ONE server instance.
TODO: move it to Redis when the backend runs on more than one instance.
"""
import hashlib
import secrets
import time
import uuid
from typing import Callable, Dict, Optional, Tuple


class TicketLimitError(Exception):
    """Raised when a user (or the whole server) holds too many unused tickets."""


class TicketStore:
    def __init__(
        self,
        ttl_seconds: float = 60.0,
        max_per_user: int = 5,
        max_total: int = 10_000,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.ttl_seconds = ttl_seconds
        self.max_per_user = max_per_user
        self.max_total = max_total
        self._clock = clock
        # sha256(ticket) -> (user_id, expires_at)
        self._tickets: Dict[str, Tuple[uuid.UUID, float]] = {}

    @staticmethod
    def _key(ticket: str) -> str:
        return hashlib.sha256(ticket.encode("utf-8")).hexdigest()

    def _purge(self, now: float) -> None:
        expired = [k for k, (_, exp) in self._tickets.items() if exp <= now]
        for k in expired:
            del self._tickets[k]

    def issue(self, user_id: uuid.UUID) -> str:
        now = self._clock()
        self._purge(now)
        if len(self._tickets) >= self.max_total:
            raise TicketLimitError("server ticket limit reached")
        if sum(1 for uid, _ in self._tickets.values() if uid == user_id) >= self.max_per_user:
            raise TicketLimitError("too many unused tickets for this user")
        ticket = secrets.token_urlsafe(32)
        self._tickets[self._key(ticket)] = (user_id, now + self.ttl_seconds)
        return ticket

    def consume(self, ticket: str) -> Optional[uuid.UUID]:
        """Return the user id for a valid ticket and burn it. None if unknown/expired/used."""
        if not isinstance(ticket, str) or not ticket:
            return None
        entry = self._tickets.pop(self._key(ticket), None)
        if entry is None:
            return None
        user_id, expires_at = entry
        if expires_at <= self._clock():
            return None
        return user_id

    def clear(self) -> None:
        self._tickets.clear()
