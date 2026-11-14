"""create profiles sessions and turns tables

Revision ID: 44ff8b38f8b8
Revises: 
Create Date: 2026-11-14 15:41:58.662910

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import models


# revision identifiers, used by Alembic.
revision: str = '44ff8b38f8b8'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('profiles',
        sa.Column('user_id', models.GUID(length=36), nullable=False),
        sa.Column('display_name', sa.String(length=255), nullable=True),
        sa.Column('goal', sa.Text(), nullable=True),
        sa.Column('target_role', sa.String(length=255), nullable=True),
        sa.Column('level', sa.String(length=50), nullable=True),
        sa.Column('native_language', sa.String(length=50), nullable=True),
        sa.Column('correction_style', sa.String(length=50), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('user_id')
    )
    op.create_index('idx_profiles_user_id', 'profiles', ['user_id'], unique=False)

    op.create_table('sessions',
        sa.Column('id', models.GUID(length=36), nullable=False),
        sa.Column('user_id', models.GUID(length=36), nullable=False),
        sa.Column('scenario', sa.String(length=100), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('duration_s', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_sessions_user_id', 'sessions', ['user_id'], unique=False)

    op.create_table('turns',
        sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
        sa.Column('session_id', models.GUID(length=36), nullable=False),
        sa.Column('user_id', models.GUID(length=36), nullable=False),
        sa.Column('idx', sa.Integer(), nullable=False),
        sa.Column('speaker', sa.String(length=50), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('started_at_ms', sa.BigInteger(), nullable=True),
        sa.Column('ended_at_ms', sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('session_id', 'idx', name='uq_turns_session_idx')
    )
    op.create_index('idx_turns_session_idx', 'turns', ['session_id', 'idx'], unique=False)
    op.create_index('idx_turns_user_id', 'turns', ['user_id'], unique=False)

    # Enable Row Level Security on each table (deny by default)
    # The backend uses server-side direct/pooler connection bypassing RLS or acting as service role
    op.execute("ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE turns ENABLE ROW LEVEL SECURITY;")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("ALTER TABLE turns DISABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE sessions DISABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;")

    op.drop_index('idx_turns_user_id', table_name='turns')
    op.drop_index('idx_turns_session_idx', table_name='turns')
    op.drop_table('turns')
    op.drop_index('idx_sessions_user_id', table_name='sessions')
    op.drop_table('sessions')
    op.drop_index('idx_profiles_user_id', table_name='profiles')
    op.drop_table('profiles')
