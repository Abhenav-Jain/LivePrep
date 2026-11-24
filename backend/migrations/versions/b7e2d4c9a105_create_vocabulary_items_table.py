"""create vocabulary_items table

Revision ID: b7e2d4c9a105
Revises: 9c1f4b7a2d10
Create Date: 2026-11-24 16:05:00.000000

The word bank is new in v2: it stores one card per word/correction per user, with the
spaced-repetition state (interval, next review moment, counts).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import models


# revision identifiers, used by Alembic.
revision: str = 'b7e2d4c9a105'
down_revision: Union[str, Sequence[str], None] = '9c1f4b7a2d10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('vocabulary_items',
        sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
        sa.Column('user_id', models.GUID(length=36), nullable=False),
        sa.Column('term', sa.String(length=120), nullable=False),
        sa.Column('term_key', sa.String(length=120), nullable=False),
        sa.Column('alternatives', sa.JSON(), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('source', sa.String(length=20), nullable=False),
        sa.Column('session_id', models.GUID(length=36), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('review_count', sa.Integer(), nullable=False),
        sa.Column('correct_count', sa.Integer(), nullable=False),
        sa.Column('interval_days', sa.Integer(), nullable=False),
        sa.Column('next_review_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'term_key', name='uq_vocab_user_term')
    )
    op.create_index('idx_vocab_user_id', 'vocabulary_items', ['user_id'], unique=False)

    # Same deny-by-default posture as the other tables (see README "Row Level Security").
    op.execute("ALTER TABLE vocabulary_items ENABLE ROW LEVEL SECURITY;")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("ALTER TABLE vocabulary_items DISABLE ROW LEVEL SECURITY;")
    op.drop_index('idx_vocab_user_id', table_name='vocabulary_items')
    op.drop_table('vocabulary_items')
