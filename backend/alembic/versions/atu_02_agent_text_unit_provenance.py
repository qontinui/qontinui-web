"""agent_text_units: import provenance (source_path, source_commit)

Revision ID: atu_02_atu_provenance
Revises: atu_01_agent_text_units
Create Date: 2026-08-25

Phase 5 of plan ``2026-08-20-fleet-served-agent-skills``.

Phase 5 imports the fleet's real ``.claude/`` corpus into
``project.agent_text_units`` as the fleet-default layer. Two columns record
where each unit's text came from, so an operator looking at a row in the console
can tell an imported unit from one authored there, and can tell WHICH source
revision the text corresponds to.

* ``source_path`` — the **repo-relative** path in the config repo, e.g.
  ``.claude/commands/vet-plan.md`` or ``.claude/skills/coord-revive/`` (a skill
  is a directory, so its provenance is a directory). Repo-relative on purpose:
  an absolute path would pin one build machine's disk layout into account data,
  and the same corpus is importable from any checkout.
* ``source_commit`` — the full 40-char commit of the source repo, or NULL.

**NULL is meaningful in both columns and is not "unknown by accident".** It
means *this text is not a faithful copy of a committed source*: a unit authored
directly in the console has never had one, and an import from a **dirty** tree
deliberately records none, because no commit honestly describes the bytes that
were read. The importer decides that per unit — a clean unit in a tree that is
dirty elsewhere still gets its commit.

The CHECK is what keeps ``source_commit`` a commit. Without it the column
accepts an abbreviated SHA, a branch name, or a ``"dirty"`` sentinel, and every
consumer then has to re-validate what the column claims to be. Full lowercase
hex, 40 characters, or NULL.

Nothing is backfilled: every existing row predates the importer, so none of them
came from a source path, and NULL is the honest value.

These names are DELIBERATELY adjacent to the ``source`` field on
``AgentTextUnitResponse`` and they mean different things.  ``source`` is the
resolution LAYER a row was served from (``"user"`` / ``"fleet"``) and is
computed, never stored. ``source_path`` / ``source_commit`` are the config repo
the text was IMPORTED from and are stored here. The adjacency was flagged when
the canonical Rust type was authored (``qontinui-schemas``
``agent_text_units.rs``, which carries the same warning) and the names were kept
because ``source_path`` is already this backend's word for exactly this concept
(``agent.work_artifacts.source_path``); a private spelling here would be the
inconsistency, not the fix.

Hand-written. ``alembic revision --autogenerate`` is banned in this repo
(served policy ``production-and-cost`` ``alembic-sole-authorship``).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "atu_02_atu_provenance"
down_revision: str | Sequence[str] | None = "atu_01_agent_text_units"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the two provenance columns and the commit-shape CHECK."""
    op.add_column(
        "agent_text_units",
        sa.Column("source_path", sa.Text(), nullable=True),
        schema="project",
    )
    op.add_column(
        "agent_text_units",
        sa.Column("source_commit", sa.String(length=40), nullable=True),
        schema="project",
    )
    op.create_check_constraint(
        "ck_agent_text_unit_source_commit_sha",
        "agent_text_units",
        "source_commit IS NULL OR source_commit ~ '^[0-9a-f]{40}$'",
        schema="project",
    )


def downgrade() -> None:
    """Exact reversal. Provenance is metadata, so dropping it loses no text."""
    op.drop_constraint(
        "ck_agent_text_unit_source_commit_sha",
        "agent_text_units",
        schema="project",
        type_="check",
    )
    op.drop_column("agent_text_units", "source_commit", schema="project")
    op.drop_column("agent_text_units", "source_path", schema="project")
