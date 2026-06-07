"""coord.migration_reservations — the coord-authoritative migration head queue

Revision ID: resq_01_migration_reservations
Revises: coord_commit_lineage
Create Date: 2026-06-07

Phase 1 (P1) of plan
``D:/qontinui-root/plans/2026-06-08-coord-migration-reservation-queue.md``
(coord-authoritative migration reservation queue — replaces the alembic
head-claim mutex).

Creates the single new table the reservation queue is built on. Clients no
longer compute ``down_revision`` from a local checkout and race for a
``kind=alembic_revision`` claim; instead coord becomes the authority for chain
succession — a client asks for a SLOT, coord assigns the ``down_revision``
(the merged head, or the queue tail), and the reservation binds to a PR and is
released by MERGE rather than by a TTL. The chain state per repo is the
``revision`` of that repo's last ``merged`` reservation.

## The table

One row per reservation:

* ``id`` — surrogate PK.
* ``repo`` — the repository the chain belongs to (e.g. ``qontinui-web``).
* ``revision`` — the alembic revision id this reservation will author.
* ``down_revision`` — the head coord ASSIGNED at reserve time (the merged head
  or the queue tail). This is authoritative; the client does not supply it.
* ``state`` — the lifecycle position, TEXT + CHECK (not a PG enum, mirroring
  ``coord.deploy_*`` / ``coord.land_verifications``: text+CHECK evolves without
  ``ALTER TYPE`` acrobatics). One of:
  ``queued`` (assigned, authoring; deadline running) →
  ``pr_bound`` (a PR was server-side verified to add a migration file whose
  exact ``(revision, down_revision)`` matches this reservation; deadline
  cleared) →
  ``merged`` (coord's merge-watch flipped it; the chain advances) — or the two
  terminal failures ``expired`` (deadline passed, never bound) /
  ``withdrawn`` (explicit).
* ``pr_number`` / ``pr_url`` — the bound PR (NULL while ``queued``; retained for
  the rechain comment even after a cascade demotes ``pr_bound → queued``).
* ``requested_by_machine`` — the requesting machine (UUID; NULL carve-out for
  machine-less callers, same posture as the ``claims_audit`` FK-to-devices
  writes).
* ``requested_by_session`` — the requesting agent session (TEXT, heterogeneous
  subject — not a UUID column, same rationale as
  ``coord.gates.continuation_cancelled_by``).
* ``tenant_id`` — nullable. The reservation routes keep the unauthenticated,
  machine-scoped, NO-tenant posture of ``/claims/*`` today; this column is here
  so a future multi-tenant auth-hardening plan (explicitly out of scope here)
  needs no migration.
* ``authoring_deadline`` — when a ``queued`` reservation expires if never bound
  (~45 min, set by coord). NULL once bound.
* ``created_at`` — the position-of-record: queue order within a repo is by
  ``created_at`` ascending.
* ``bound_at`` / ``merged_at`` / ``terminated_at`` — lifecycle stamps for the
  ``pr_bound`` / ``merged`` / (``expired``|``withdrawn``) transitions.
* ``terminal_reason`` — free-form reason for an ``expired`` / ``withdrawn`` row.

## Indexes (IMMUTABLE-only predicates — NO now())

* ``ux_migration_reservations_repo_revision_live`` — a PARTIAL UNIQUE index on
  ``(repo, revision)`` WHERE ``state NOT IN ('expired','withdrawn')``. Two LIVE
  reservations can never claim the same ``(repo, revision)``; a terminated one
  frees the slot so a corrected re-reserve is possible. This is the structural
  successor to the old head-claim mutex.
* ``ix_migration_reservations_repo_active`` — the queue-scan index on
  ``(repo, created_at)`` WHERE ``state IN ('queued','pr_bound')``, serving the
  per-repo active-queue read (assignment / cascade re-point / dashboard).

CRITICAL: neither index predicate references ``now()`` (or any non-IMMUTABLE
function). PostgreSQL REJECTS non-IMMUTABLE functions in a partial-index
predicate — this exact mistake shipped once and only surfaced against a real PG
(see ``reference_alembic_now_index_and_offline_sql_gap``, the rule also
documented in the sibling ``replaycols_01_gates_continuation``). Any freshness
window (e.g. the authoring deadline) is evaluated at QUERY time, never in an
index predicate.

## BOOT-GATED coord-side (deploy order is LOAD-BEARING)

Unlike the best-effort ``coord.deploy_*`` overlay tables, this table is
LOAD-BEARING for the reserve API — coord adds it to ``ALEMBIC_OWNED_TABLES`` and
fail-closes at boot via ``state::require_table`` if it is absent. Therefore the
HARD deploy-order rule (same documented posture as ``release_observations`` /
``route_serving_observations``):

    THIS migration MUST be confirmed applied on prod RDS BEFORE the coord image
    that depends on the table is deployed.

A coord deploy that lands before the migration runs crash-loops on
``require_table``. Gate the coord deploy on an actual
``coord.migration_reservations`` existence check, not merely "the P1 PR merged".
A coord ROLLBACK after this migration is fine — expand-only; the table sits
idle.

## House conventions followed

Raw ``op.execute`` DDL, every statement schema-qualified to ``coord`` (the
``check_alembic_schema_args.py`` gate requires it; web alembic is the SOLE
author of ``coord.*`` DDL — ``proj_alembic_sole_author_coord_schema`` — and
coord's ``coord_schema_authorship.rs`` CI gate forbids coord-side CREATE TABLE).
``IF NOT EXISTS`` everywhere keeps the migration idempotent and collision-safe
against any canonical PG that already carries the table from a self-heal mirror;
the ``coord`` schema already exists (many coord.* tables live there) so it is
NOT created. ``state`` is TEXT + CHECK, not a PG enum. Downgrade drops the table
(its indexes drop with it).

## Head reservation — the LAST old-style claim ever (dogfood irony)

Both ``revision`` and ``down_revision`` are RESERVED one final time via the OLD
coord head-claim handshake this very plan RETIRES
(``kind=alembic_revision resource_key=coord_commit_lineage``, result
``claimed`` TTL 1800s, machine ``c79a07d5…``, session ``4bbf3f51``) — do not
re-derive from a later ``alembic heads``. The dogfood irony is intentional and
recorded for posterity: this migration reserves its own head with the mutex it
exists to replace. After the coord side (P2a–P2c) ships, ``alembic_revision``
claims return 410 and the table created here is the authority.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
# NOTE: both ``revision`` and ``down_revision`` are RESERVED via a coord
# head-claim (resource_key=coord_commit_lineage, result ``claimed`` TTL 1800s,
# session 4bbf3f51) — do not re-derive from a later ``alembic heads``. This is
# the LAST old-style head-claim ever (see the module docstring).
revision: str = "resq_01_migration_reservations"
down_revision: str | Sequence[str] | None = "coord_commit_lineage"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the boot-gated coord.migration_reservations queue table."""

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.migration_reservations (
            id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            repo                 TEXT NOT NULL,
            revision             TEXT NOT NULL,
            down_revision        TEXT NOT NULL,
            state                TEXT NOT NULL DEFAULT 'queued',
            pr_number            INTEGER NULL,
            pr_url               TEXT NULL,
            requested_by_machine UUID NULL,
            requested_by_session TEXT NULL,
            tenant_id            UUID NULL,
            authoring_deadline   TIMESTAMPTZ NULL,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            bound_at             TIMESTAMPTZ NULL,
            merged_at            TIMESTAMPTZ NULL,
            terminated_at        TIMESTAMPTZ NULL,
            terminal_reason      TEXT NULL,
            CONSTRAINT migration_reservations_state_chk
                CHECK (state IN ('queued','pr_bound','merged','expired','withdrawn'))
        )
        """
    )

    # Partial UNIQUE: only ONE live reservation per (repo, revision). A
    # terminated row (expired/withdrawn) frees the slot for a corrected
    # re-reserve. IMMUTABLE-only predicate — NO now().
    op.create_index(
        "ux_migration_reservations_repo_revision_live",
        "migration_reservations",
        ["repo", "revision"],
        unique=True,
        schema="coord",
        postgresql_where=sa.text("state NOT IN ('expired','withdrawn')"),
    )

    # Queue-scan index: per-repo active queue ordered by created_at.
    # IMMUTABLE-only predicate — NO now().
    op.create_index(
        "ix_migration_reservations_repo_active",
        "migration_reservations",
        ["repo", "created_at"],
        schema="coord",
        postgresql_where=sa.text("state IN ('queued','pr_bound')"),
    )


def downgrade() -> None:
    """Drop the table (its indexes drop with it)."""
    op.execute("DROP TABLE IF EXISTS coord.migration_reservations")
