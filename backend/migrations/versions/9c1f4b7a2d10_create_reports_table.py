"""create reports table

Revision ID: 9c1f4b7a2d10
Revises: 44ff8b38f8b8
Create Date: 2026-11-20 10:12:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import models


# revision identifiers, used by Alembic.
revision: str = '9c1f4b7a2d10'
down_revision: Union[str, Sequence[str], None] = '44ff8b38f8b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('reports',
        sa.Column('session_id', models.GUID(length=36), nullable=False),
        sa.Column('user_id', models.GUID(length=36), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('rubric_version', sa.String(length=20), nullable=True),
        sa.Column('metrics_json', sa.JSON(), nullable=True),
        sa.Column('report_json', sa.JSON(), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('session_id')
    )
    op.create_index('idx_reports_user_id', 'reports', ['user_id'], unique=False)

    # Same deny-by-default posture as the other tables (see README "Row Level Security").
    op.execute("ALTER TABLE reports ENABLE ROW LEVEL SECURITY;")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("ALTER TABLE reports DISABLE ROW LEVEL SECURITY;")
    op.drop_index('idx_reports_user_id', table_name='reports')
    op.drop_table('reports')
