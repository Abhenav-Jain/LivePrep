import os
import uuid
import datetime
from typing import Optional
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy import (
    String,
    Text,
    Integer,
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    UniqueConstraint,
)
from sqlalchemy.types import TypeDecorator, CHAR
from sqlalchemy.dialects.postgresql import UUID as PG_UUID


class GUID(TypeDecorator):
    """Platform-independent GUID/UUID type.
    Uses PostgreSQL's UUID type, otherwise uses CHAR(36), storing as stringified UUID.
    """
    impl = CHAR(36)
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PG_UUID(as_uuid=True))
        else:
            return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        elif dialect.name == "postgresql":
            return str(value)
        else:
            if isinstance(value, uuid.UUID):
                return str(value)
            else:
                return str(uuid.UUID(str(value)))

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        if isinstance(value, uuid.UUID):
            return value
        return uuid.UUID(str(value))


class Base(DeclarativeBase):
    pass


class Profile(Base):
    __tablename__ = "profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True)
    display_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    goal: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    target_role: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    level: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    native_language: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    correction_style: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.datetime.now(datetime.timezone.utc)
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        onupdate=lambda: datetime.datetime.now(datetime.timezone.utc),
    )

    __table_args__ = (
        Index("idx_profiles_user_id", "user_id"),
    )


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(GUID, nullable=False)
    scenario: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    started_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.datetime.now(datetime.timezone.utc)
    )
    ended_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_s: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="active", nullable=False)

    turns: Mapped[list["Turn"]] = relationship("Turn", back_populates="session", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_sessions_user_id", "user_id"),
    )


class Turn(Base):
    __tablename__ = "turns"

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(GUID, nullable=False)
    idx: Mapped[int] = mapped_column(Integer, nullable=False)
    speaker: Mapped[str] = mapped_column(String(50), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    started_at_ms: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    ended_at_ms: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    session: Mapped["Session"] = relationship("Session", back_populates="turns")

    __table_args__ = (
        Index("idx_turns_user_id", "user_id"),
        Index("idx_turns_session_idx", "session_id", "idx"),
        UniqueConstraint("session_id", "idx", name="uq_turns_session_idx"),
    )
