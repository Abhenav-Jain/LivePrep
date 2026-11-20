"""Unit tests for the one-time WebSocket ticket store."""
import uuid

import pytest

from tickets import TicketLimitError, TicketStore


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def test_ticket_is_single_use():
    store = TicketStore()
    user = uuid.uuid4()
    ticket = store.issue(user)
    assert store.consume(ticket) == user
    assert store.consume(ticket) is None


def test_ticket_expires():
    clock = Clock()
    store = TicketStore(ttl_seconds=60, clock=clock)
    ticket = store.issue(uuid.uuid4())
    clock.now += 61
    assert store.consume(ticket) is None


def test_ticket_valid_just_before_expiry():
    clock = Clock()
    store = TicketStore(ttl_seconds=60, clock=clock)
    user = uuid.uuid4()
    ticket = store.issue(user)
    clock.now += 59
    assert store.consume(ticket) == user


@pytest.mark.parametrize("bad", ["", "nope", None, 123, b"bytes", "x" * 1000])
def test_unknown_or_invalid_tickets(bad):
    assert TicketStore().consume(bad) is None


def test_tickets_are_unique_and_long():
    store = TicketStore(max_per_user=50)
    user = uuid.uuid4()
    tickets = {store.issue(user) for _ in range(50)}
    assert len(tickets) == 50
    assert all(len(t) >= 32 for t in tickets)


def test_per_user_limit_and_recovery():
    clock = Clock()
    store = TicketStore(ttl_seconds=60, max_per_user=2, clock=clock)
    user = uuid.uuid4()
    first = store.issue(user)
    store.issue(user)
    with pytest.raises(TicketLimitError):
        store.issue(user)
    # another user is not affected
    assert store.issue(uuid.uuid4())
    # using a ticket frees a slot
    assert store.consume(first) == user
    assert store.issue(user)
    # expired tickets free slots too
    clock.now += 61
    assert store.issue(user)


def test_global_limit():
    store = TicketStore(max_per_user=10, max_total=3)
    for _ in range(3):
        store.issue(uuid.uuid4())
    with pytest.raises(TicketLimitError):
        store.issue(uuid.uuid4())


def test_ticket_is_not_stored_in_plain_text():
    store = TicketStore()
    ticket = store.issue(uuid.uuid4())
    assert ticket not in store._tickets  # only the hash is kept
    assert all(ticket not in key for key in store._tickets)


def test_ticket_belongs_to_the_user_it_was_issued_for():
    store = TicketStore()
    a, b = uuid.uuid4(), uuid.uuid4()
    ticket_a, ticket_b = store.issue(a), store.issue(b)
    assert store.consume(ticket_b) == b
    assert store.consume(ticket_a) == a
