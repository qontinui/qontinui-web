"""coord.tenant_repo_unenrollments — the repo un-enrollment tombstone

Revision ID: coord_tenant_repo_unenroll_01
Revises: memrestore_01_synthesis_superseded_documents
Create Date: 2026-08-04

Backs the un-enrollment path in the plan
``2026-08-02-coord-repo-unenrollment-path.md``.

## Why a tombstone and not a ``deactivated_at`` flag

A repo enrolled into coord is governed forever: there is no MCP tool, no
operator route and no webhook arm that removes governance, and a plain
``DELETE FROM coord.tenant_repos`` does not survive contact with the
re-enrollment paths. There are FIVE reachable entry points that funnel into
just two INSERT statements, and the decisive one is the ``installation``
webhook arm ``new_permissions_accepted``: it is matched alongside ``created``
and carries the installation's **FULL repo list**, not a delta. The org
installation is ``repository_selection: all``, so **any GitHub App permission
bump re-enrolls every repo the App can see** — an event entirely outside
coord's control. A deleted row simply comes back.

So removal has to be a SUPPRESSION the re-add paths consult. This table is
that suppression, and the row DELETE stays alongside it rather than being
replaced by an in-row ``deactivated_at`` flag on ``coord.tenant_repos``,
because "coord stops governing this repo" is expressed at **~66 read sites
across 34 files** of ``coord.tenant_repos`` — ``EXISTS`` guards, tenant
lookups, ``SELECT DISTINCT repo`` sweeps and JOIN predicates inside long SQL
strings, several of them generated fragments asserted as literal substrings by
tests. A flag would be honoured only where each of those 66 sites learned
``AND deactivated_at IS NULL``, and a partial un-enrollment (un-enrolled for
the merge scheduler, still enrolled for file-conflicts) is worse than none
because it is non-uniform and untraceable. Deleting the row gets all 66 right
with zero code change.

Coord already demonstrates both halves of that argument in its own source:
``canonical_repos::mark_repo_deleted`` IS an in-row flag, and it works there
precisely because it has exactly ONE reader, deliberately co-located with its
writer so the read filter cannot drift from the write.

Nothing referential is lost: no table has a foreign key **to**
``coord.tenant_repos`` (verified fleet-wide), and ``coord.tenants ->
coord.tenant_repos ON DELETE CASCADE`` already makes row deletion that table's
lifecycle idiom.

## Audit posture — this is a net GAIN

``coord.tenant_repos`` carries four columns and no history at all
(``tenant_id, repo, role, created_at``). Deleting a 4-column membership row
while writing a 5-column tombstone records **strictly more** than was
destroyed: it adds *who* un-enrolled and *why*, which the membership table
never had. A ``deactivated_at`` toggled back to NULL on re-enrollment, by
contrast, leaves nothing behind.

Schema:

* ``tenant_id     UUID NOT NULL`` — FK to ``coord.tenants`` ``ON DELETE
  CASCADE``, mirroring ``coord.tenant_repos`` so a deleted tenant leaves no
  orphan tombstones.
* ``repo          TEXT NOT NULL`` — ``owner/name`` slug, the same grain every
  repo-keyed coord table uses.
* ``unenrolled_at TIMESTAMPTZ NOT NULL DEFAULT now()``.
* ``unenrolled_by TEXT NOT NULL`` — the acting principal, as
  ``agent:<uuid>`` / ``operator:<uuid>`` / ``device:<uuid>`` /
  ``webhook:installation_repositories``.
* ``reason        TEXT`` — free text, nullable.

Primary key ``(tenant_id, repo)`` matches the suppression lookup exactly
(``WHERE tenant_id = $1 AND repo = $2``), so no secondary index is created —
the PK IS the suppression index. It is also what makes the suppression check
expressible as a single atomic ``INSERT ... WHERE NOT EXISTS`` rather than a
read-then-write that would race the webhook enrollment paths (they run in
spawned tasks).

## Schema authoring posture

alembic is the SOLE author of ``coord.*`` schema; ``qontinui-coord`` authors
ZERO ``coord.*`` DDL in its production binary (enforced by
``tests/coord_schema_authorship.rs``). This migration deploys BEFORE the coord
build that reads the table — same deploy-ordered posture as the other
single-authored coord tables. Coord registers it in ``ALEMBIC_OWNED_TABLES``
but deliberately NOT in ``CRITICAL_BOOT_TABLES``: a missing tombstone table
must degrade to ``503 schema_migration_pending``, never block boot.

Chains off ``memrestore_01_synthesis_superseded_documents`` — the verified single head
of the alembic graph at authoring time — so the graph does NOT fork.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_tenant_repo_unenroll_01"
# CRITICAL: chain off the current single head so the alembic graph does NOT
# fork. memrestore_01_synthesis_superseded_documents is the verified head.
down_revision: str | Sequence[str] | None = "memrestore_01_synthesis_superseded_documents"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Idempotent: skip if a prior partial apply already created the table.
    if sa.inspect(op.get_bind()).has_table("tenant_repo_unenrollments", schema="coord"):
        return
    op.create_table(
        "tenant_repo_unenrollments",
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("repo", sa.Text(), nullable=False),
        sa.Column(
            "unenrolled_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("unenrolled_by", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["coord.tenants.tenant_id"],
            name="fk_tenant_repo_unenrollments_tenant",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "tenant_id",
            "repo",
            name="pk_tenant_repo_unenrollments",
        ),
        schema="coord",
    )


def downgrade() -> None:
    op.drop_table("tenant_repo_unenrollments", schema="coord")
