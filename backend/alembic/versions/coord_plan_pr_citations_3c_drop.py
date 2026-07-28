"""coord.plan_pr_citations — CONTRACT: drop the retired legacy citation table

Revision ID: coord_plan_pr_citations_3c_drop
Revises: prompt_doc_proposals_01
Create Date: 2026-07-29

Stage 3c of plan
``D:/qontinui-root/plans/2026-07-06-coord-plan-slug-to-work-unit-slug-rename.md``
("retire the legacy plan_slug path across coord"). This is the final,
irreversible-for-data step of the ``coord.plan_pr_citations`` retirement.

``coord.plan_pr_citations`` (stood up by ``coord_plan_pr_citations``, 2026-06-13)
recorded the provenance edge from a *plan slug* to the PR(s)/commit(s) citing it,
keyed by ``plan_slug TEXT`` under a deliberate SOFT-FK posture. Its successor
``coord.work_unit_pr_citations`` (``coord_workunits_04_work_unit_pr_citations``,
2026-06-18) records the same edge keyed by ``work_unit_id UUID`` with a HARD FK
to ``coord.work_units(id) ON DELETE CASCADE``. The legacy leg is now dead code
on both sides, so this revision removes the table.

Why this is safe now (verified, not assumed)
============================================

* **Stage 3a** (``coord_plan_pr_citations_3a_backfill``, landed + applied to prod
  2026-07-28) folded every RESOLVABLE legacy row into
  ``coord.work_unit_pr_citations``, stamped ``source='legacy_backfill'``. Its DATA
  contract — the fold, the ``ON CONFLICT`` dedupe, ``cited_at``/``tenant_id``
  copied verbatim, orphan retention, cross-tenant-drift exclusion, and the
  targeted downgrade — is pinned by
  ``backend/tests/test_coord_plan_pr_citations_3a_backfill_migration.py``.
  That test upgrades to the 3a revision by ID (never to ``head``), so it is
  unaffected by this drop and keeps guarding the fold's semantics forever.
* **Stage 3b** (coord #1275) deleted coord's legacy read/write path and removed
  ``"plan_pr_citations"`` from ``ALEMBIC_OWNED_TABLES`` in
  ``qontinui-coord/src/schema_manifest.rs``, so a fresh coord boot no longer
  requires this table to exist (the boot gate ``require_table`` would otherwise
  hard-fail — the P4 outage class this plan calls the BOOT-GATE TRAP).
  Verified SERVING on prod before this revision was written, by two independent
  signals: ``GET /health`` → ``build_sha
  6c851966705f8d2cbe83784e09449801d1d3d09e``, and ECS task-def
  ``qontinui-staging-coord:726`` carrying image tag
  ``qontinui-coord:6c851966705f``, ``rolloutState COMPLETED``, 2/2 running.
  Green deploy jobs are NOT a rollout; the serving SHA is.
* No qontinui-web code reads or writes this table — the only remaining
  references in this repo are the migrations that created/backfilled it and the
  3a test, all of which run at revisions strictly before this one.

Permanent data loss (say it plainly)
====================================

Legacy rows whose ``plan_slug`` matched NO ``coord.work_units`` row could not be
folded by 3a: the successor's hard FK admits only citations for a work unit
coord already knows. Those rows were vetted as "orphaned legacy citations for
never-registered work units, acceptable data loss" and were DELIBERATELY not
migrated. They have survived in ``coord.plan_pr_citations`` until now as
forensic residue.

**THIS REVISION DESTROYS THEM PERMANENTLY.** So does it destroy the pre-fold
per-row ``source`` values (``'pr_body'`` / ``'commit_message'``), which 3a
restamped to ``'legacy_backfill'`` in the successor and which were readable in
this table until now. There is no other copy of either. Stage 3a's test run was
the last point at which the fold could be checked against real legacy rows.

Indexes
=======

The table's three indexes —
``idx_plan_pr_citations_plan_slug ON (plan_slug)``,
``idx_plan_pr_citations_repo_pr ON (repo, pr_number)``, and
``uq_plan_pr_citations_dedupe`` (UNIQUE ``NULLS NOT DISTINCT`` on
``(plan_slug, repo, pr_number, commit_sha)``) — are owned by the table and drop
with it. They are NOT dropped separately; doing so would be redundant DDL and
would leave the drop order asserting something Postgres already guarantees.

Lock posture
============

``DROP TABLE`` takes ``ACCESS EXCLUSIVE``. Contention is expected to be nil (no
deployed coord image touches the table any more), but the wait is bounded by
``SET LOCAL lock_timeout`` regardless: a QUEUED ``ACCESS EXCLUSIVE`` request
itself blocks every reader arriving behind it, so failing fast is strictly
better than stalling on one long-lived transaction that happens to hold a lock.

``RESET lock_timeout`` afterwards is REQUIRED, not decorative: ``env.py`` calls
``context.begin_transaction()`` ONCE around ``run_migrations()`` and does not set
``transaction_per_migration``, so every revision in one ``alembic upgrade`` run
shares a single transaction — an unreset ``SET LOCAL`` would leak this 3s
timeout into every migration that lands after this one.

Downgrade — STRUCTURE ONLY, the rows are gone
=============================================

``downgrade()`` recreates the table and all three indexes with exactly the shape
``coord_plan_pr_citations`` defined (re-verified: no intervening revision ever
ALTERed it — ``coord_tenant_backfill_01_pr_surfaces`` only UPDATEs ``repo``
values), so the migration chain is reversible and a later revision that expects
the table can still run against a downgraded DB.

**It restores STRUCTURE ONLY. It cannot restore a single row.** The folded rows
live on in ``coord.work_unit_pr_citations`` under a different key and a
restamped ``source``; the orphans and the pre-fold ``source`` values do not
exist anywhere. A downgrade yields an empty table, not the old data.

Authorship posture
==================

**alembic is the SOLE author of the coord.* schema.** No Rust
``CREATE``/``ALTER``/``DROP`` self-heal exists or may be added (enforced by
``tests/coord_schema_authorship.rs`` in both coord and the runner). This
revision is pure ``coord.*`` DDL, which is exactly where such DDL belongs.

Sequenced coord-side follow-up (NOT in this PR, by design)
==========================================================

The plan requires ``"plan_pr_citations"`` to be added to
``DEPRECATED_COORD_TABLES`` in ``qontinui-coord/src/mcp/tools.rs``. That set is
evaluated as ``live catalog ∩ DEPRECATED_COORD_TABLES``, so listing a table that
still exists fires a false ``schema:deprecated_object_present``. It therefore
CANNOT land before this drop is applied to prod — it is strictly sequential
after it, and is owned by the coord-side session.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_plan_pr_citations_3c_drop"
down_revision: str | Sequence[str] | None = "prompt_doc_proposals_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Bound the DDL's lock wait: a queued ACCESS EXCLUSIVE request blocks every
    # reader that arrives behind it, so fail fast rather than stalling.
    op.execute("SET LOCAL lock_timeout = '3s'")
    # The three indexes (uq_plan_pr_citations_dedupe,
    # idx_plan_pr_citations_plan_slug, idx_plan_pr_citations_repo_pr) are owned
    # by the table and drop with it — no separate DROP INDEX needed.
    op.execute("DROP TABLE IF EXISTS coord.plan_pr_citations")
    # SET LOCAL is transaction-scoped and env.py wraps the WHOLE run in one
    # transaction, so without this reset the 3s timeout leaks into every
    # revision that lands after this one.
    op.execute("RESET lock_timeout")


def downgrade() -> None:
    """Recreate the table + its three indexes. STRUCTURE ONLY — rows are gone.

    Mirrors ``coord_plan_pr_citations.upgrade()`` exactly so the chain is
    reversible. It restores no data: the resolvable rows were folded into
    ``coord.work_unit_pr_citations`` by 3a under a different key, and the
    orphaned rows (plus every pre-fold ``source`` value) were destroyed by
    ``upgrade()`` with no surviving copy anywhere.
    """
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.plan_pr_citations (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id   UUID,
            plan_slug   TEXT NOT NULL,
            repo        TEXT NOT NULL,
            pr_number   INTEGER,
            commit_sha  TEXT,
            source      TEXT NOT NULL,
            cited_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    # Idempotent-ingest key. NULLS NOT DISTINCT (PG15+) so PR-body-only
    # (commit_sha IS NULL) and commit-only (pr_number IS NULL) citations still
    # dedupe under ON CONFLICT DO NOTHING. Implemented as a unique INDEX so
    # ON CONFLICT can bind to it.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_pr_citations_dedupe "
        "ON coord.plan_pr_citations "
        "(plan_slug, repo, pr_number, commit_sha) NULLS NOT DISTINCT"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_plan_pr_citations_plan_slug "
        "ON coord.plan_pr_citations (plan_slug)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_plan_pr_citations_repo_pr "
        "ON coord.plan_pr_citations (repo, pr_number)"
    )
