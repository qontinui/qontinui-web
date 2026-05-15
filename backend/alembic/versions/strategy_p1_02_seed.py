"""strategy Phase 1 seed — dogfood space + 6 substrate documents

Revision ID: strategy_p1_02_seed
Revises: strategy_p1_01_schema
Create Date: 2026-05-15

Seeds the dogfood deployment: one ``strategy.spaces`` row pointing at
the existing substrate (``qontinui-dev-notes`` repo,
``project-strategy/`` prefix) plus the 6 ``strategy.documents`` rows
for the seeded Markdown files (README + the 5 strategy docs).

``organization_id`` is NULL by design — Phase 1 is single-tenant
dogfood mode (see ``strategy_p1_01_schema`` docstring §2; Phase 7
multi-tenant is the constraint-tightening migration).

``head_commit_sha`` is the 40-char zero sentinel: coord's git-read
sync (Phase 1, ``qontinui-coord/src/strategy.rs``) overwrites it
with the real HEAD on first poll. The schema-consistency
verification compares the ``relative_path`` set, not the SHA.

Idempotent: fixed space UUID + ``ON CONFLICT DO NOTHING`` so a
re-apply (or apply on a DB that already has the dogfood space) is a
no-op. Reversible: downgrade deletes exactly the seeded rows.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "strategy_p1_02_seed"
down_revision: str = "strategy_p1_01_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Deterministic dogfood space id — stable across environments so
# coord's sync + the verification harnesses can address it directly.
DOGFOOD_SPACE_ID = "f9b3a1e2-5c4d-4a8b-9e6f-000000000001"
ZERO_SHA = "0" * 40

# (relative_path, title) — title is the file's H1, captured
# 2026-05-15. Coord's sync refreshes title from the live H1 on poll;
# these are the initial values so the row is valid pre-first-sync.
SEED_DOCS = [
    ("README.md", "Project Strategy"),
    ("business-goals.md", "Business Goals"),
    ("strategic-priorities.md", "Strategic Priorities"),
    ("customer-context.md", "Customer Context"),
    ("architectural-decisions.md", "Load-Bearing Architectural Decisions"),
    ("human-preferences.md", "Human Preferences"),
]


def upgrade() -> None:
    op.execute(
        f"""
        INSERT INTO strategy.spaces
            (space_id, organization_id, name, git_repo,
             git_branch, git_path_prefix)
        VALUES
            ('{DOGFOOD_SPACE_ID}', NULL, 'Project Strategy',
             'qontinui-dev-notes', 'main', 'project-strategy/')
        ON CONFLICT (space_id) DO NOTHING
        """
    )
    for rel_path, title in SEED_DOCS:
        safe_title = title.replace("'", "''")
        op.execute(
            f"""
            INSERT INTO strategy.documents
                (space_id, relative_path, title, head_commit_sha)
            VALUES
                ('{DOGFOOD_SPACE_ID}', '{rel_path}',
                 '{safe_title}', '{ZERO_SHA}')
            ON CONFLICT (space_id, relative_path) DO NOTHING
            """
        )


def downgrade() -> None:
    op.execute(
        f"DELETE FROM strategy.documents "
        f"WHERE space_id = '{DOGFOOD_SPACE_ID}'"
    )
    op.execute(
        f"DELETE FROM strategy.spaces "
        f"WHERE space_id = '{DOGFOOD_SPACE_ID}'"
    )
