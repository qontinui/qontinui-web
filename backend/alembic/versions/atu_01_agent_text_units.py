"""project.agent_commands -> project.agent_text_units (kind + files map)

Revision ID: atu_01_agent_text_units
Revises: vetev_01
Create Date: 2026-08-24

Phase 2 of plan ``2026-08-20-fleet-served-agent-skills``.

Generalizes the shipped agent-command stack into ONE kind-discriminated text
corpus, so a slash command and an agent skill are the same thing stored the same
way. A command becomes the degenerate single-entry case of a ``files`` map:
``{"<name>.md": body}``. A skill carries ``SKILL.md`` plus siblings.

Four things happen here and each is load-bearing:

1. **Rename** ``agent_commands`` -> ``agent_text_units`` (and its version chain,
   and the chain's FK column) rather than create-and-copy. A rename keeps the
   rows, the PKs and the FK edges, and it is what makes the downgrade a real
   reversal instead of a lossy re-import.

2. **``kind``** — a widenable discriminator, NOT a two-value enum. ``command``
   and ``skill`` ship now; ``.claude/agents/*.md`` is a third unit with the
   identical delivery gap. Existing rows backfill to ``'command'``.

3. **``files`` JSONB** replaces ``body``, on BOTH tables. Backfilled as
   ``{name || '.md': body}``, which is exactly what the runner writes to
   ``.claude/commands/<name>.md`` today, so no content moves.

4. **The unique key becomes a PARTIAL INDEX PAIR**, not a three-column UNIQUE.
   ``organization_id`` is nullable and Postgres does not collide NULLs in a
   plain UNIQUE, so ``UNIQUE (organization_id, kind, name)`` would leave the
   ``organization_id IS NULL`` fleet-default layer **entirely unconstrained** —
   N rows sharing one ``(kind, name)`` would all be legal and "the fleet
   default" would not name a row. The shipped
   ``uq_agent_command_org_name`` already had that hole; widening it inherits it.
   So:

   * ``uq_agent_text_unit_org_kind_name`` UNIQUE ``(organization_id, kind, name)``
     WHERE ``organization_id IS NOT NULL`` — one override per account per unit;
   * ``uq_agent_text_unit_fleet_kind_name`` UNIQUE ``(kind, name)``
     WHERE ``organization_id IS NULL`` — exactly one fleet default per unit.

   That pair IS the two-layer model (``account override -> fleet default ->
   embedded default``), not a precaution against it.

Also: a CHECK that an underscore-prefixed unit can never be marked invocable.
``_gate-registration`` and ``_loop-control`` are copy-source specs the corpus
must carry — other units paste from them — but they are not slash commands. The
leading underscore is the corpus's human marker; ``is_invocable`` is the
machine-readable one; the CHECK is what stops the two disagreeing.

``checksum`` is **nulled** on both tables. Its meaning changes from "digest of
one body" to "canonical digest of the whole files map"
(``agent_text_unit_service.compute_files_checksum``), and Postgres cannot
recompute a sha256 here without pgcrypto. A stale value under a new meaning is
worse than an absent one — the column is nullable and the next write fills it.

The table held two content-free rows when this was authored, which is why the
key widening is cheap; **re-verify the live row count before applying**, do not
trust that sentence.

Hand-written. ``alembic revision --autogenerate`` is banned in this repo
(served policy ``production-and-cost`` ``alembic-sole-authorship``).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "atu_01_agent_text_units"
# `down_revision` is whatever the SOLE head of `main` is at the moment this
# branch was last pushed — `pmf_scope_cols_01` as of 2026-09-02. Do not read
# the token as meaningful: it has been re-pointed three times already
# (authored against `coord_polread_01`, re-pointed to
# `coord_pr_author_nudges_02` on 2026-08-25, to `coordtouch_01` on 2026-09-01,
# and to `pmf_scope_cols_01` today). While this PR stays open, every land on `main`
# that adds a revision makes this one a SIBLING off the old node, `alembic
# heads` reports two heads, and the required `alembic-heads-pr` gate goes red
# until it is re-pointed again. That is a property of the gate on a
# `strict: true` repo, not a defect in this revision.
#
# Re-point; never add a merge revision. A merge revision is correct only when
# both heads have ALREADY LANDED, since landed history cannot be re-pointed.
# This revision is unlanded, so the fix is always the one-token edit — see
# `scripts/ci/notify_forked_open_prs.py`, which comments the exact token to
# adopt on every land, and `scripts/ci/count_alembic_heads.py`, which prints it
# locally in ~2s. There is no data dependency on the parent either way: this
# revision only creates `agent_text_units*`, so ordering is arbitrary and only
# single-headedness matters.
down_revision: str | Sequence[str] | None = "vetev_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Rename the two tables, widen them to (kind, files), re-key the parent."""
    # --- 1. rename the tables and the chain's FK column -------------------
    op.rename_table("agent_commands", "agent_text_units", schema="project")
    op.rename_table(
        "agent_command_versions", "agent_text_unit_versions", schema="project"
    )
    op.alter_column(
        "agent_text_unit_versions",
        "agent_command_id",
        new_column_name="agent_text_unit_id",
        schema="project",
    )

    # --- 2. the new columns ------------------------------------------------
    op.add_column(
        "agent_text_units",
        sa.Column(
            "kind",
            sa.String(64),
            nullable=False,
            server_default=sa.text("'command'"),
        ),
        schema="project",
    )
    op.add_column(
        "agent_text_units",
        sa.Column(
            "is_invocable",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        schema="project",
    )
    op.add_column(
        "agent_text_units",
        sa.Column("files", JSONB(), nullable=True),
        schema="project",
    )
    op.add_column(
        "agent_text_unit_versions",
        sa.Column("files", JSONB(), nullable=True),
        schema="project",
    )

    # --- 3. backfill body -> {name.md: body}, then drop body ---------------
    op.execute(
        """
        UPDATE project.agent_text_units
           SET files = jsonb_build_object(name || '.md', body)
        """
    )
    op.execute(
        """
        UPDATE project.agent_text_unit_versions v
           SET files = jsonb_build_object(u.name || '.md', v.body)
          FROM project.agent_text_units u
         WHERE v.agent_text_unit_id = u.id
        """
    )
    # A version row whose parent vanished cannot exist (FK + ON DELETE CASCADE),
    # but NOT NULL is set below, so leave nothing to chance.
    op.execute(
        """
        UPDATE project.agent_text_unit_versions
           SET files = jsonb_build_object('body.md', body)
         WHERE files IS NULL
        """
    )
    op.alter_column("agent_text_units", "files", nullable=False, schema="project")
    op.alter_column(
        "agent_text_unit_versions", "files", nullable=False, schema="project"
    )
    op.drop_column("agent_text_units", "body", schema="project")
    op.drop_column("agent_text_unit_versions", "body", schema="project")

    # --- 4. the checksum's MEANING changed; null it rather than lie --------
    op.execute("UPDATE project.agent_text_units SET checksum = NULL")
    op.execute("UPDATE project.agent_text_unit_versions SET checksum = NULL")

    # --- 5. re-key the parent: partial unique index PAIR -------------------
    op.drop_constraint(
        "uq_agent_command_org_name",
        "agent_text_units",
        schema="project",
        type_="unique",
    )
    op.create_index(
        "uq_agent_text_unit_org_kind_name",
        "agent_text_units",
        ["organization_id", "kind", "name"],
        unique=True,
        schema="project",
        postgresql_where=sa.text("organization_id IS NOT NULL"),
    )
    # The key being replaced did NOT constrain the NULL-org rows, so the fleet
    # index below can be the first thing that ever notices a duplicate. Say so
    # by name rather than surfacing a bare index-build error — this migration
    # must never quietly delete a row to make itself apply.
    op.execute(
        """
        DO $$
        DECLARE dupes text;
        BEGIN
            SELECT string_agg(format('%s/%s (%s rows)', kind, name, n), ', ')
              INTO dupes
              FROM (SELECT kind, name, count(*) AS n
                      FROM project.agent_text_units
                     WHERE organization_id IS NULL
                     GROUP BY kind, name
                    HAVING count(*) > 1) d;
            IF dupes IS NOT NULL THEN
                RAISE EXCEPTION
                    'project.agent_text_units holds duplicate fleet-default '
                    'rows (organization_id IS NULL) for %. Resolve them before '
                    'applying atu_01_agent_text_units.', dupes;
            END IF;
        END $$;
        """
    )
    op.create_index(
        "uq_agent_text_unit_fleet_kind_name",
        "agent_text_units",
        ["kind", "name"],
        unique=True,
        schema="project",
        postgresql_where=sa.text("organization_id IS NULL"),
    )
    op.create_index(
        "ix_project_agent_text_units_kind",
        "agent_text_units",
        ["kind"],
        unique=False,
        schema="project",
    )
    op.create_check_constraint(
        "ck_agent_text_unit_underscore_not_invocable",
        "agent_text_units",
        "left(name, 1) <> '_' OR is_invocable = false",
        schema="project",
    )

    # --- 6. rename the inherited constraints/indexes to match the tables ---
    op.execute(
        "ALTER TABLE project.agent_text_unit_versions "
        "RENAME CONSTRAINT uq_agent_command_version TO uq_agent_text_unit_version"
    )
    op.execute(
        "ALTER TABLE project.agent_text_units "
        "RENAME CONSTRAINT fk_agent_commands_organization_id "
        "TO fk_agent_text_units_organization_id"
    )
    op.execute(
        "ALTER TABLE project.agent_text_unit_versions "
        "RENAME CONSTRAINT fk_agent_command_versions_agent_command_id "
        "TO fk_agent_text_unit_versions_agent_text_unit_id"
    )
    op.execute(
        "ALTER INDEX project.ix_project_agent_commands_organization_id "
        "RENAME TO ix_project_agent_text_units_organization_id"
    )
    op.execute(
        "ALTER INDEX project.ix_project_agent_commands_created_by_user_id "
        "RENAME TO ix_project_agent_text_units_created_by_user_id"
    )
    op.execute(
        "ALTER INDEX project.ix_project_agent_command_versions_agent_command_id "
        "RENAME TO ix_project_agent_text_unit_versions_agent_text_unit_id"
    )
    op.execute(
        "ALTER INDEX project.ix_project_agent_command_versions_created_by_user_id "
        "RENAME TO ix_project_agent_text_unit_versions_created_by_user_id"
    )
    # The primary keys are inherited too. Leaving `agent_commands_pkey` on a
    # table called `agent_text_units` makes `\d` lie about what this table is.
    op.execute(
        "ALTER TABLE project.agent_text_units "
        "RENAME CONSTRAINT agent_commands_pkey TO agent_text_units_pkey"
    )
    op.execute(
        "ALTER TABLE project.agent_text_unit_versions "
        "RENAME CONSTRAINT agent_command_versions_pkey "
        "TO agent_text_unit_versions_pkey"
    )


def downgrade() -> None:
    """Exact reversal: collapse the files map back to one body, re-narrow the key.

    LOSSY BY CONSTRUCTION for anything the old shape cannot hold — a multi-file
    unit (every skill) and every non-``command`` kind. Those rows are DELETED
    rather than silently flattened into a wrong single body; a downgrade that
    invented a body would be worse than one that says what it dropped.
    """
    op.execute(
        "ALTER TABLE project.agent_text_unit_versions "
        "RENAME CONSTRAINT agent_text_unit_versions_pkey "
        "TO agent_command_versions_pkey"
    )
    op.execute(
        "ALTER TABLE project.agent_text_units "
        "RENAME CONSTRAINT agent_text_units_pkey TO agent_commands_pkey"
    )
    op.execute(
        "ALTER INDEX project.ix_project_agent_text_unit_versions_created_by_user_id "
        "RENAME TO ix_project_agent_command_versions_created_by_user_id"
    )
    op.execute(
        "ALTER INDEX project.ix_project_agent_text_unit_versions_agent_text_unit_id "
        "RENAME TO ix_project_agent_command_versions_agent_command_id"
    )
    op.execute(
        "ALTER INDEX project.ix_project_agent_text_units_created_by_user_id "
        "RENAME TO ix_project_agent_commands_created_by_user_id"
    )
    op.execute(
        "ALTER INDEX project.ix_project_agent_text_units_organization_id "
        "RENAME TO ix_project_agent_commands_organization_id"
    )
    op.execute(
        "ALTER TABLE project.agent_text_unit_versions "
        "RENAME CONSTRAINT fk_agent_text_unit_versions_agent_text_unit_id "
        "TO fk_agent_command_versions_agent_command_id"
    )
    op.execute(
        "ALTER TABLE project.agent_text_units "
        "RENAME CONSTRAINT fk_agent_text_units_organization_id "
        "TO fk_agent_commands_organization_id"
    )
    op.execute(
        "ALTER TABLE project.agent_text_unit_versions "
        "RENAME CONSTRAINT uq_agent_text_unit_version TO uq_agent_command_version"
    )

    op.drop_constraint(
        "ck_agent_text_unit_underscore_not_invocable",
        "agent_text_units",
        schema="project",
        type_="check",
    )
    op.drop_index(
        "ix_project_agent_text_units_kind",
        table_name="agent_text_units",
        schema="project",
    )

    # Drop what the narrow shape cannot represent, BEFORE re-creating a key
    # that would reject it anyway.
    op.execute(
        """
        DELETE FROM project.agent_text_units
         WHERE kind <> 'command'
            OR jsonb_typeof(files) <> 'object'
            OR (SELECT count(*) FROM jsonb_object_keys(files)) <> 1
        """
    )

    op.drop_index(
        "uq_agent_text_unit_fleet_kind_name",
        table_name="agent_text_units",
        schema="project",
    )
    op.drop_index(
        "uq_agent_text_unit_org_kind_name",
        table_name="agent_text_units",
        schema="project",
    )
    op.create_unique_constraint(
        "uq_agent_command_org_name",
        "agent_text_units",
        ["organization_id", "name"],
        schema="project",
    )

    op.add_column(
        "agent_text_units",
        sa.Column("body", sa.Text(), nullable=True),
        schema="project",
    )
    op.add_column(
        "agent_text_unit_versions",
        sa.Column("body", sa.Text(), nullable=True),
        schema="project",
    )
    # The single remaining map entry IS the body.
    op.execute(
        """
        UPDATE project.agent_text_units
           SET body = (SELECT value FROM jsonb_each_text(files) LIMIT 1)
        """
    )
    op.execute(
        """
        UPDATE project.agent_text_unit_versions
           SET body = COALESCE(
                   (SELECT value FROM jsonb_each_text(files) LIMIT 1), ''
               )
        """
    )
    op.execute("UPDATE project.agent_text_units SET body = '' WHERE body IS NULL")
    op.alter_column("agent_text_units", "body", nullable=False, schema="project")
    op.alter_column(
        "agent_text_unit_versions", "body", nullable=False, schema="project"
    )
    op.execute("UPDATE project.agent_text_units SET checksum = NULL")
    op.execute("UPDATE project.agent_text_unit_versions SET checksum = NULL")

    op.drop_column("agent_text_unit_versions", "files", schema="project")
    op.drop_column("agent_text_units", "files", schema="project")
    op.drop_column("agent_text_units", "is_invocable", schema="project")
    op.drop_column("agent_text_units", "kind", schema="project")

    op.alter_column(
        "agent_text_unit_versions",
        "agent_text_unit_id",
        new_column_name="agent_command_id",
        schema="project",
    )
    op.rename_table(
        "agent_text_unit_versions", "agent_command_versions", schema="project"
    )
    op.rename_table("agent_text_units", "agent_commands", schema="project")
