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
  That test upgrades to the 3a revision by ID (never to ``head``) and seeds its
  own synthetic rows in an ephemeral DB, so it is unaffected by this drop and
  keeps guarding the fold's semantics indefinitely.
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
* **The runner's boot gate is clear too** — coord is not the only service that
  hard-fails on a missing ``coord.*`` table. ``qontinui-runner``'s required-table
  set is the ``required`` vec in ``src-tauri/src/coordinator/scheduler.rs``
  (~:127-134, the sole caller of ``PgDb::require_table``, defined in
  ``src-tauri/src/database/pg/mod.rs``); it does not name
  ``plan_pr_citations``, and ``git grep`` over the runner's ``src-tauri/src``
  on ``origin/main`` finds the string nowhere. No runner crash-loops on this
  drop either.
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

**THIS REVISION DESTROYS THEM PERMANENTLY**, and with them the pre-fold per-row
``source`` values of every row the fold MINTED — those rows entered the successor
stamped ``'legacy_backfill'``, so their original ``'pr_body'`` /
``'commit_message'`` label survived only here. (Rows coord had ALREADY
dual-written are unaffected: 3a's ``ON CONFLICT DO NOTHING`` left them alone and
they keep their organic ``source`` in ``coord.work_unit_pr_citations`` — the 3a
test pins exactly that.) For the orphans and for the minted rows' original
``source`` there is no other copy anywhere.

A third, smaller population dies here too, and is worth naming because it is
neither an orphan nor a minted row: 3a EXCLUDED rows where the legacy row and
the matched work unit both carried a non-NULL ``tenant_id`` and they DISAGREED
(counted and logged as cross-tenant drift, not folded). Any such row that coord
had not already dual-written is destroyed outright by this DROP.

**Applying this revision to prod is the last point at which the fold could be
checked against real production legacy rows.**

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

``RESET`` (rather than saving and restoring a prior value) is safe here because
no apply path sets a session-level ``lock_timeout``: not
``.github/workflows/migrate.yml``, not ``backend/start-backend.sh``, not
``backend/alembic.ini`` — nor the retired Elastic-Beanstalk
``backend/.platform/hooks/postdeploy/01_run_migrations.sh``, checked belt-and-braces
— and no ``PGOPTIONS`` anywhere in the repo. There is nothing to clobber, so
``RESET`` and ``SET LOCAL … = DEFAULT`` are equivalent (both land on ``0``).

Downgrade — STRUCTURE ONLY, the rows are gone
=============================================

``downgrade()`` recreates the table and all three indexes with exactly the shape
``coord_plan_pr_citations`` defined. Nothing between them left the shape
different — re-verified empirically, not by inspection: the live catalog shape
(``information_schema.columns`` + ``pg_indexes`` + ``pg_constraint``) at the
creating revision, at this revision's parent 109 revisions later, and after this
``downgrade()`` all compare IDENTICAL, ``NULLS NOT DISTINCT`` and the primary key
included. That diff proves net-identity, which is what reversibility needs; the
stronger "never ALTERed at all" comes from inspection — the only later revision
that MODIFIES the table, ``coord_tenant_backfill_01``, is pure DML (it SETs
``tenant_id``, matching rows on ``repo``), and 3a only READs it. So the chain is
reversible and a later revision that expects the table can still run against a
downgraded DB.

**It restores STRUCTURE ONLY. It cannot restore a single row.** The folded rows
live on in ``coord.work_unit_pr_citations`` under a different key; the orphans,
and the pre-fold ``source`` of every row the fold minted, do not exist anywhere.
A downgrade yields an empty table, not the old data.

Authorship posture
==================

**alembic is the SOLE author of the coord.* schema.** No Rust
``CREATE``/``ALTER``/``DROP`` self-heal exists or may be added (enforced by
``tests/coord_schema_authorship.rs`` in both coord and the runner). This
revision is pure ``coord.*`` DDL, which is exactly where such DDL belongs.

Sequenced cross-repo follow-ups (NOT in this PR, by design)
==========================================================

Two changes in other repos become due only ONCE this drop is applied to prod.
Both are tracked by coord gate **``cda7919f-af71-47d0-8f22-605c5c3ec662``**
(work unit ``2026-07-06-coord-plan-slug-to-work-unit-slug-rename``, predicate
``file_exists`` on this file at ``qontinui-web@main``) — the plan explicitly
ruled that a code comment is not a tracking artifact, and neither is a docstring.

**The gate fires on MERGE, not on prod application.** Merging this auto-triggers
``.github/workflows/migrate.yml`` (``push`` to ``main`` under
``backend/alembic/**``), which dispatches the migrator ECS task, so in practice
merge ≈ applied. But if that run fails or lags, acting on the gate would land
follow-up 1 while the table still physically exists — firing exactly the false
``schema:deprecated_object_present`` it is meant to avoid. **Confirm the table is
absent from the live prod catalog before landing follow-up 1**, whatever the gate
says. (Where this docstring and the gate's ``phase_name`` differ in wording, this
docstring governs — the ``phase_name`` is frozen at registration.)

1. **coord** — add ``"plan_pr_citations"`` to ``DEPRECATED_COORD_TABLES``
   (``qontinui-coord/src/schema_manifest.rs``, the const at :363). It is
   evaluated as ``live catalog ∩ DEPRECATED_COORD_TABLES`` — the intersection
   itself runs in ``src/schema_observer.rs`` (documented :539-544, executed
   :573); ``mcp/tools.rs`` ~:8610 only publishes the already-computed
   ``obs.deprecated_present`` onto the twin. So listing a table that still
   exists fires a false ``schema:deprecated_object_present`` — which is why it
   CANNOT ride this PR. Until it lands, the deprecation guard does not cover
   this table.
   **UPDATE — do NOT delete — the note at ``schema_manifest.rs:217-225.``** Only
   its last clause ("deliberately NOT in ``DEPRECATED_COORD_TABLES`` yet … the
   DROP stage adds it there") goes stale. The rest is load-bearing and must
   survive: it records why ``plan_pr_citations`` MUST stay out of
   ``ALEMBIC_OWNED_TABLES`` (the list it sits in, const at :25) — and out of
   ``CRITICAL_BOOT_TABLES`` (:412) — because a boot gate on a dropped table
   makes every post-drop coord build unbootable. The ``plans`` note directly
   beneath it (:226-229) was deliberately retained after ``plans`` was dropped,
   for exactly this reason; mirror that.
2. **qontinui-runner** — ``src-tauri/schema.pg.sql.generated`` is a checked-in
   ``pg_dump`` of this alembic-managed schema and still contains the
   ``coord.plan_pr_citations`` block (the ``CREATE TABLE``, its PK, and all three
   indexes incl. ``NULLS NOT DISTINCT``). Its ``schema-pg-sql-fresh.yml`` gate
   resolves a qontinui-web ref (a same-named branch if one exists, else ``main``
   — ``main`` for any ordinary runner PR), runs ``alembic upgrade head``, dumps,
   and fails on any diff — so once this lands, the checked-in file is stale. Not
   immediate: the heavy ``schema-fresh-verify`` job only runs when a runner PR
   touches ``src-tauri/queries/**`` or the generated file. But the next such PR
   reddens for an unrelated reason. Regenerate with
   ``src-tauri/scripts/regenerate_schema_pg_sql.sh`` (literally what the verify
   job runs).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_plan_pr_citations_3c_drop"
down_revision: str | Sequence[str] | None = "prompt_doc_proposals_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Drop the retired legacy citation table. Destroys the orphaned rows."""
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
