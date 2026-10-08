"""coord.success_metric_checkpoint_results — one row per attested checkpoint criterion

Revision ID: coord_smckpt_01_success_metric_checkpoint_results
Revises: gate_arming_02
Create Date: 2026-10-06

Phase 4 of plan
``qontinui-dev-notes/plans/2026-10-06-overview-objectives-view.md``
("Durable results in a sibling table"), **qontinui-web alembic half only**.
The writer (coord's finding-post insert under a SAVEPOINT, plus the
re-runnable backfill) and the read door
(``GET /coord/success-metric-checkpoint-results``) are a separate
``qontinui-coord`` PR that lands after this one; the web's ``objectives.py``
switch to that door is a third PR after that.

What a row is
=============
A session that measures a ``success_metric`` checkpoint posts one coord
finding carrying a typed ``artifact_refs.metric_checkpoint`` block
(``metric-checkpoint/v1``, the plan's Appendix A). Each of the block's
``rows`` — one criterion's verdict — becomes one row here, keyed back to that
finding by ``evidence_finding_id``. A report that carries no block at all
(prose only), or whose block fails the validator, becomes ONE marker row with
``criterion = '*'``, ``verdict = 'unknown'`` and ``unknown_reason`` =
``prose_only`` / ``invalid_block``, so the report is still durable.

Why not ``coord.success_metric_history`` (open PR #1624)
=========================================================
That table's CHECKs describe an *executed numeric measurement*: a verdict
there needs a numeric ``value``, a numeric ``target`` and a ``direction``, a
closed six-reason ``unknown_reason`` set for unexecuted queries, and a
``source_query_digest``. An attested criterion such as "ccfg main green"
satisfies none of them, and criterion rows sharing that table's
``(tenant_id, kind, name, observed_at DESC)`` index would be read as the
metric's latest value by every "latest value per metric" reader. So this is
a second, honest table rather than four bent CHECKs. This revision does not
depend on #1624 and touches nothing it creates.

Columns
=======
* ``tenant_id`` — no FK, like every sibling ``coord.*`` table; tenant comes
  from the posting principal, never a parameter.
* ``kind`` / ``name`` — the prompt-document address (``success_metric`` /
  ``<document.name>``).
* ``document_version`` — the version the measurer read. NULL on a
  ``prose_only`` / ``invalid_block`` marker row, whose finding carries no
  readable block.
* ``checkpoint`` / ``criterion`` — the checkpoint id and the criterion (row)
  id; ``'*'`` on a marker row.
* ``verdict`` / ``value`` / ``unit`` / ``value_text`` / ``unknown_reason`` /
  ``method`` / ``door`` / ``cause`` / ``action`` — the block row verbatim.
  ``window_from`` / ``window_to`` are the row's ``window`` split in two.
* ``gate_id`` — the block's top-level ``gate_id``, if any.
* ``measured_at`` — the block's ``measured_at`` (a marker row uses the
  finding's ``created_at``).
* ``evidence_finding_id`` — the finding the row came from. The read door
  excludes rows whose finding has been superseded, so a corrected re-post's
  rows win even when they carry the same or an earlier ``measured_at``.
* ``recorded_at`` — when coord inserted the row (server clock).

Constraints (names are coord's insert/read contract)
=====================================================
* ``ck_success_metric_checkpoint_results_verdict`` —
  ``verdict IN ('met', 'missed', 'unknown')``.
* ``ck_success_metric_checkpoint_results_unknown_reason`` — Appendix A's five
  reasons (``could_not_run``, ``probe_error``, ``no_data``,
  ``not_measurable_yet``, ``manual_pending``) plus the two TABLE-ONLY marker
  reasons ``prose_only`` and ``invalid_block``, which no block may carry.
* ``ck_success_metric_checkpoint_results_value_text_present`` — a ``met`` /
  ``missed`` verdict must say what was seen: ``value_text`` NOT NULL and not
  empty. Total: ``verdict`` is NOT NULL, so the CHECK never evaluates NULL
  and never passes by omission.
* ``ck_success_metric_checkpoint_results_action_kind`` — when ``action`` is
  set, ``action->>'kind'`` is one of ``plan``, ``pr``, ``gate``,
  ``operator_ask``. Written with ``COALESCE(…, '')`` so it is TOTAL: a bare
  ``action->>'kind' IN (…)`` evaluates NULL — and a NULL CHECK *passes* — for
  a JSON ``null``, an array, a scalar, or an object with no ``kind``, which
  would admit exactly the malformed values the CHECK exists to refuse.
* ``uq_success_metric_checkpoint_results_finding_criterion`` —
  ``UNIQUE (evidence_finding_id, criterion)``: one row per criterion per
  report, which is what makes coord's insert and the backfill idempotent
  (``ON CONFLICT DO NOTHING`` on this key).

Deliberately NOT constrained here, because the plan's table spec does not
ask for it and the validators own it: ``unknown`` ⇒ ``unknown_reason`` NOT
NULL, ``value`` ⇒ ``unit``, and ``window_from <= window_to``.

Index shape is the read's shape
================================
``idx_success_metric_checkpoint_results_criterion_measured`` on
``(tenant_id, kind, name, criterion, measured_at DESC)`` serves the read the
page makes: the LATEST result per criterion per metric (the plan's D7,
"latest result wins per criterion") — ``DISTINCT ON (tenant_id, kind, name,
criterion) … ORDER BY tenant_id, kind, name, criterion, measured_at DESC`` —
and one criterion's history. ``DESC`` is declared so that ORDER BY is an
index scan, not a sort.

It is built ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` inside
``op.get_context().autocommit_block()``, as a static literal: on a table
created one statement earlier a plain build would cost nothing, but coord's
merge-train migration classifier
(``qontinui-coord/crates/coord/src/pr_merge/migration_classifier.rs``) admits
no other standalone index build without a new-table claim, and this form
needs none. ``autocommit_block`` commits the transaction ``env.py`` opened, so
the ``CREATE TABLE`` is durable before the build starts (precedent
``coord_alerts_flakeidx_01``). A KILLED concurrent build leaves an INVALID
index that ``IF NOT EXISTS`` would then skip — check ``pg_index.indisvalid``
and ``DROP INDEX`` + re-run if it is invalid.

The UNIQUE constraint's backing index is built inline by ``CREATE TABLE`` on
an empty table, which is the classifier's plain-column-list form.

No ``lock_timeout``: every statement creates a NEW object, so nothing here
queues behind a lock held on a populated table (the sibling revisions that
set ``SET LOCAL lock_timeout`` do so around an ``ALTER TABLE``).

Idempotency
===========
``CREATE TABLE IF NOT EXISTS`` / ``CREATE INDEX … IF NOT EXISTS`` /
``DROP … IF EXISTS`` throughout, so a re-run is a no-op. The CHECKs and the
UNIQUE are declared inline so they ride the table's guard rather than
needing an ``ADD CONSTRAINT`` that has no ``IF NOT EXISTS`` form.

Deploy ordering (load-bearing)
===============================
Served policy ``production-and-cost`` ``alembic-sole-authorship``: alembic is
the sole author of ``coord.*`` schema, and a coord read or write of a new
``coord.*`` object needs its qontinui-web migration to land FIRST. This
revision lands and deploys before the coord PR that inserts into and reads
this table. That coord PR's row insert runs under a SAVEPOINT and treats
``42P01`` as "rows not yet recorded", so a deploy window in either order
degrades rather than failing the finding post.

Hand-written rather than autogenerated: ``alembic revision --autogenerate``
is banned in this repo (same served clause). ``down_revision`` is the local
head at authoring time; coord re-points it at land time if the head moves.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_smckpt_01_success_metric_checkpoint_results"
down_revision: str | Sequence[str] | None = "gate_arming_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create coord.success_metric_checkpoint_results + its per-criterion index."""
    # Kept for the same collision-safety reason every sibling coord.*
    # revision keeps it.
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")

    # ----------------------------------------------------------------
    # 1. The table. Raw SQL rather than op.create_table, as in every
    #    sibling coord.* revision: the IF NOT EXISTS guard and the named
    #    inline CHECK / UNIQUE constraints want to be stated literally.
    # ----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.success_metric_checkpoint_results (
            id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id            UUID NOT NULL,
            kind                 TEXT NOT NULL,
            name                 TEXT NOT NULL,
            document_version     INTEGER NULL,
            checkpoint           TEXT NOT NULL,
            criterion            TEXT NOT NULL,
            verdict              TEXT NOT NULL,
            value                DOUBLE PRECISION NULL,
            unit                 TEXT NULL,
            value_text           TEXT NULL,
            unknown_reason       TEXT NULL,
            method               TEXT NULL,
            door                 TEXT NULL,
            cause                TEXT NULL,
            action               JSONB NULL,
            window_from          TIMESTAMPTZ NULL,
            window_to            TIMESTAMPTZ NULL,
            gate_id              UUID NULL,
            measured_at          TIMESTAMPTZ NOT NULL,
            evidence_finding_id  UUID NOT NULL,
            recorded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

            CONSTRAINT ck_success_metric_checkpoint_results_verdict
                CHECK (verdict IN ('met', 'missed', 'unknown')),

            -- Appendix A's five block reasons plus the two table-only
            -- marker reasons (prose_only, invalid_block).
            CONSTRAINT ck_success_metric_checkpoint_results_unknown_reason
                CHECK (unknown_reason IS NULL
                       OR unknown_reason IN ('could_not_run',
                                             'probe_error',
                                             'no_data',
                                             'not_measurable_yet',
                                             'manual_pending',
                                             'prose_only',
                                             'invalid_block')),

            -- A met/missed verdict must say what was seen. Total: verdict
            -- is NOT NULL and the right arm is a plain boolean.
            CONSTRAINT ck_success_metric_checkpoint_results_value_text_present
                CHECK (verdict NOT IN ('met', 'missed')
                       OR (value_text IS NOT NULL AND value_text <> '')),

            -- COALESCE keeps this total: a bare action->>'kind' IN (...)
            -- is NULL (and so PASSES) for a JSON null, an array, a scalar
            -- or an object with no kind.
            CONSTRAINT ck_success_metric_checkpoint_results_action_kind
                CHECK (action IS NULL
                       OR COALESCE(action->>'kind', '')
                          IN ('plan', 'pr', 'gate', 'operator_ask')),

            -- One row per criterion per report: the ON CONFLICT DO NOTHING
            -- key for coord's insert and the re-runnable backfill.
            CONSTRAINT uq_success_metric_checkpoint_results_finding_criterion
                UNIQUE (evidence_finding_id, criterion)
        )
        """
    )

    # ----------------------------------------------------------------
    # 2. Latest result per criterion per metric (plan D7). A static
    #    literal, CONCURRENTLY, in an autocommit_block: the index build
    #    coord's migration classifier admits (docstring).
    # ----------------------------------------------------------------
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_success_metric_checkpoint_results_criterion_measured
            ON coord.success_metric_checkpoint_results
               (tenant_id, kind, name, criterion, measured_at DESC)
            """
        )


def downgrade() -> None:
    """Reverse: drop the index, then the table.

    ``DROP TABLE`` would take the index and constraints with it, but the
    index is dropped explicitly first for symmetry with its explicit CREATE,
    and so a partially-applied upgrade downgrades cleanly either way. The
    index name is schema-qualified because ``coord`` is not on the
    migration connection's ``search_path``. Nothing
    references this table, so a plain ``DROP TABLE`` suffices.
    """
    op.execute(
        "DROP INDEX IF EXISTS "
        "coord.idx_success_metric_checkpoint_results_criterion_measured"
    )
    op.execute("DROP TABLE IF EXISTS coord.success_metric_checkpoint_results")
