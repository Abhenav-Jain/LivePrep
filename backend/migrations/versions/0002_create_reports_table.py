"""create reports table

Revision ID: 0002_create_reports_table
Revises: 44ff8b38f8b8
Create Date: 2026-11-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import models


# revision identifiers, used by Alembic.
revision: str = '0002_create_reports_table'
down_revision: Union[str, Sequence[str], None] = '44ff8b38f8b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'reports',
        sa.Column('session_id', models.GUID(length=36), nullable=False),
        sa.Column('user_id', models.GUID(length=36), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=False),
        sa.Column('rubric_version', sa.String(length=20), nullable=False),
        sa.Column('metrics_json', sa.Text(), nullable=True),
        sa.Column('report_json', sa.Text(), nullable=True),
        sa.Column('error_code', sa.String(length=50), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('session_id'),
    )
    op.create_index('idx_reports_user_id', 'reports', ['user_id'], unique=False)

    # Enable Row Level Security (deny by default, backend server connection manages access)
    conn = op.get_bind()
    if conn.dialect.name == "postgresql":
        op.execute("ALTER TABLE reports ENABLE ROW LEVEL SECURITY;")


def downgrade() -> None:
    """Downgrade schema."""
    conn = op.get_bind()
    if conn.dialect.name == "postgresql":
        op.execute("ALTER TABLE reports DISABLE ROW LEVEL SECURITY;")

    op.drop_index('idx_reports_user_id', table_name='reports')
    op.drop_table('reports')
