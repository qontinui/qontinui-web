"""coord: repair the four ``tenant_id`` foreign keys that never landed in prod.

Root cause
==========

``coord_tenant_scope_columns.py:147-154`` adds ``tenant_id`` to six tables in a
loop, carrying the constraint *inline*::

    ALTER TABLE coord.{table}
        ADD COLUMN IF NOT EXISTS tenant_id UUID
            REFERENCES coord.tenants(tenant_id) ON DELETE SET NULL

``ADD COLUMN IF NOT EXISTS`` skips the **entire statement** when the column
already exists — and that includes the inline ``REFERENCES``. Wherever a
since-deleted Rust self-heal (plan ``2026-05-29-delete-stale-rust-table-self-heals``)
had already created a bare ``tenant_id UUID``, the migration silently did
nothing and the FK never landed. No error, no log line.

So a **fresh** database migrated to head gets the FK on all six; prod got it on
one. This revision converges prod *up* to the chain. Nothing about a fresh
database changes — the guard below makes it a no-op there.

Live prod evidence (2026-08-07, read-only ECS RunTask, FK presence read from
``pg_constraint`` rather than a cached catalog view):

===================  ==========  ===========  ==================  =======
Table                FK present  Rows         ``tenant_id`` NULL  Orphans
===================  ==========  ===========  ==================  =======
``plans``            --          absent in prod (dropped by ``coord_p4_03_drop_plans``)
``agent_worktrees``  yes         1,051        0                   0
``agent_questions``  **NO**      12,398       0                   0
``agent_logs``       **NO**      4,056,877    0                   0
``memories``         **NO**      209          0                   0
``primary_trees``    **NO**      1,243        0                   0
===================  ==========  ===========  ==================  =======

Zero orphans and zero NULLs everywhere, so all four take the constraint without
any data repair. ``agent_worktrees`` is deliberately NOT in this revision's list:
it is already correct, and ``coord/src/fleet_health.rs:603`` has been documenting
that asymmetry ("only ``agent_worktrees`` does") accurately for some time.

Why this is not a plain ``ADD CONSTRAINT``
=========================================

``coord.agent_logs`` had 4.06M rows at the reading above — and on an
append-heavy table that number is a floor, not a current value. A plain
``ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY`` takes ``ACCESS EXCLUSIVE`` on
the child table and scans every row to validate *before* releasing it, which on
coord's highest-volume append path is a production incident, not a slow step.

The two-step (``ADD ... NOT VALID`` then ``VALIDATE CONSTRAINT``) fixes that —
**but only if the two statements land in separate transactions.**
``backend/alembic/env.py:133-134`` calls ``context.begin_transaction()`` ONCE
around ``run_migrations()`` and does not set ``transaction_per_migration``, so
every revision in one ``alembic upgrade`` run shares a single transaction
(stated in the repo's own words at
``coord_plan_pr_citations_3c_drop.py:105-108``). Inside one transaction
PostgreSQL holds every lock until COMMIT, so an in-transaction two-step would
hold ``ACCESS EXCLUSIVE`` through the 4M-row validate AND through every later
revision in the batch — strictly WORSE than the plain ``ADD CONSTRAINT`` it was
meant to avoid, for the same blocking scan plus an extra statement.

Hence ``op.get_context().autocommit_block()`` (same idiom and precedent as
``coord_pg_overload_idx_01`` / ``gate_action_02`` / ``uh32g7h8i9d0``), with the
guard driven from Python rather than a ``DO $$`` block — a ``DO`` body is itself
a single statement, hence a single transaction, and would re-create exactly the
problem. With each statement autocommitted:

* ``ADD CONSTRAINT ... NOT VALID`` holds ``ACCESS EXCLUSIVE`` for milliseconds
  and commits. It already enforces the constraint on **new** rows.
* ``VALIDATE CONSTRAINT`` then runs in its own transaction under
  ``SHARE UPDATE EXCLUSIVE``, which blocks neither reads nor writes.

The cost, stated plainly: ``autocommit_block()`` commits the outer transaction,
so revisions applied *before* this one in the same batch commit early and the
batch loses all-or-nothing. That is accepted and already precedented here, and
this revision is idempotent and re-runnable by construction (below), so a
partial batch is recoverable by re-running.

Locks are bounded
=================

A **queued** ``ACCESS EXCLUSIVE`` request blocks every reader arriving behind
it, so an unbounded acquisition on ``coord.agent_logs`` stalls coord's log write
path behind whatever long-lived transaction happens to hold a conflicting lock.
``SET lock_timeout`` is house style for exactly this (``coord_sessions_drop_plan_slug``,
``coord_tenant_warm_bytes_01``, and four more). There is a second lock that is
easy to miss: ``ADD CONSTRAINT ... REFERENCES coord.tenants`` also takes
``SHARE ROW EXCLUSIVE`` on **``coord.tenants``** — the table behind every session
registration — which ``coord_tenant_warm_bytes_01`` names verbatim. Four FKs
means four acquisitions.

Two mechanical consequences of running inside an autocommit block:

* There is no transaction in there, so ``SET LOCAL`` would be inert. This uses a
  session-level ``SET lock_timeout``.
* ``RESET lock_timeout`` is therefore **required, not decorative** — outside the
  block the single shared transaction would otherwise leak the 3s timeout into
  every later revision in the batch. The ``finally`` guarantees it. ``RESET`` is
  safe because no apply path sets a session-level ``lock_timeout``: not
  ``.github/workflows/migrate.yml``, not ``backend/start-backend.sh``, not
  ``backend/alembic.ini``, and no ``PGOPTIONS`` anywhere in the repo (verified in
  ``coord_plan_pr_citations_3c_drop``).

A ``lock_timeout`` abort is the **correct** outcome, not something to retry
blindly: it means something is holding a conflicting lock, and this revision is
safe to re-run once that clears.

Idempotence, and what a crash leaves behind
===========================================

The guard matches on ``pg_get_constraintdef`` rather than on the constraint's
name, because the auto-generated ``<table>_tenant_id_fkey`` name produced by the
inline ``REFERENCES`` is conventional, not guaranteed. ``ADD CONSTRAINT`` has no
``IF NOT EXISTS`` in PostgreSQL, so without this guard the revision would error
on **every fresh database** — including CI's, where all six constraints already
exist.

A crash *between* the two statements leaves a valid intermediate state: the
constraint exists as ``NOT VALID``, already enforcing new rows. The guard matches
``NOT VALID`` constraints too, so a re-run **skips** it rather than re-validating
— which is deliberate. Re-validating on every run would make every future
``alembic upgrade`` pay the 4M-row scan; a left-behind ``NOT VALID`` constraint is
instead finished by hand with a one-line ``VALIDATE CONSTRAINT``.

The ``to_regclass`` skip is not hypothetical: ``plans`` was in this same
``_SCOPED_TABLES`` list and ``coord_p4_03_drop_plans.py:126`` dropped it. This
revision has to survive that happening to another one.

Downgrade
=========

Drops the four constraints with ``IF EXISTS``, in the same autocommit block under
the same lock bound — ``DROP CONSTRAINT`` also takes ``ACCESS EXCLUSIVE``. It
does NOT try to restore the pre-migration asymmetry on a fresh database (where
these constraints predate this revision), because "which databases had the FK
before" is not recoverable from the catalog. Downgrading therefore converges a
fresh database *down* to prod's old shape, which is the honest inverse of what
upgrade does.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_tenant_fk_01"
down_revision: str | None = "obsappfill_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# The four tables from `coord_tenant_scope_columns._SCOPED_TABLES` that are
# missing the FK in prod. Deliberately excludes:
#   * `plans`            — dropped by `coord_p4_03_drop_plans`
#   * `agent_worktrees`  — already carries the constraint; must not be re-added
_FK_TABLES: tuple[str, ...] = (
    "agent_questions",
    "agent_logs",
    "memories",
    "primary_trees",
)

# Match by DEFINITION, not by name — the inline `REFERENCES` auto-names the
# constraint `<table>_tenant_id_fkey` by convention, not by guarantee. Matches a
# `NOT VALID` constraint too (its def carries the same prefix), which is what
# makes a crashed run re-runnable without re-paying the validation scan.
_HAS_TENANT_FK = sa.text(
    """
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class     r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname = 'coord'
        AND r.relname = :t
        AND c.contype = 'f'
        AND pg_get_constraintdef(c.oid)
            ILIKE '%(tenant_id)%REFERENCES coord.tenants%'
    )
    """
)

_TABLE_EXISTS = sa.text("SELECT to_regclass(:r)")


def upgrade() -> None:
    """Add the four missing FKs, NOT VALID then VALIDATE, out of transaction."""
    with op.get_context().autocommit_block():
        # Session-level, NOT `SET LOCAL`: there is no transaction in here.
        op.execute("SET lock_timeout = '3s'")
        bind = op.get_bind()
        try:
            for table in _FK_TABLES:
                # The table may have been dropped by a later revision, exactly
                # as `plans` was. Skipping is correct; erroring is not.
                if bind.scalar(_TABLE_EXISTS, {"r": f"coord.{table}"}) is None:
                    continue

                # Fresh database (constraint came from the inline REFERENCES),
                # already-repaired database, or a NOT VALID left by a crashed
                # earlier run — all three are "leave it alone".
                if bind.scalar(_HAS_TENANT_FK, {"t": table}):
                    continue

                name = f"{table}_tenant_id_fkey"

                # 1. ACCESS EXCLUSIVE, no scan. Commits on its own, so the lock
                #    is released before the scan below starts.
                op.execute(
                    f'ALTER TABLE coord."{table}" ADD CONSTRAINT "{name}" '
                    f"FOREIGN KEY (tenant_id) "
                    f"REFERENCES coord.tenants(tenant_id) ON DELETE SET NULL "
                    f"NOT VALID"
                )

                # 2. SHARE UPDATE EXCLUSIVE, scans. Separate transaction, so it
                #    does NOT inherit statement 1's ACCESS EXCLUSIVE.
                op.execute(f'ALTER TABLE coord."{table}" VALIDATE CONSTRAINT "{name}"')
        finally:
            # REQUIRED: the shared batch transaction outside this block would
            # otherwise inherit the 3s timeout for every later revision.
            op.execute("RESET lock_timeout")


def downgrade() -> None:
    """Drop the four constraints. `DROP CONSTRAINT` is also ACCESS EXCLUSIVE."""
    with op.get_context().autocommit_block():
        op.execute("SET lock_timeout = '3s'")
        bind = op.get_bind()
        try:
            for table in _FK_TABLES:
                if bind.scalar(_TABLE_EXISTS, {"r": f"coord.{table}"}) is None:
                    continue
                op.execute(
                    f'ALTER TABLE coord."{table}" '
                    f'DROP CONSTRAINT IF EXISTS "{table}_tenant_id_fkey"'
                )
        finally:
            op.execute("RESET lock_timeout")
