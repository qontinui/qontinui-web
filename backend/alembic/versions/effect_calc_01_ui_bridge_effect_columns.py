"""project.ui_bridge_events carries the effect calculus — five nullable columns

Revision ID: effect_calc_01_ui_bridge_effect_columns
Revises: coord_wu_authored_at_01
Create Date: 2026-09-04

Phase 7 ("Durability: the twin must outlive the page") of plan
``2026-09-04-effect-calculus-joins-the-component-action-registry``.

Why
===

The UI Bridge SDK's ``EffectStore`` is a 100-entry ring buffer parked on
``globalThis`` (``ui-bridge/packages/ui-bridge/src/control/effect-store.ts:35``,
``:82``). It dies with the webview. A digital twin that an agent queries
*before* automating needs predict-then-verify history that survives a reload, so
the records drain into the runner's existing event ledger,
``project.ui_bridge_events``, rather than into a parallel table.

This revision is the **whole qontinui-web half of Phase 7, and it must land
first.** alembic is the sole author of this schema, and a runner read of a new
``project.ui_bridge_events`` column before its qontinui-web migration lands
reproduces the 2026-07-13 missing-column incident. The runner-side change (the
``schema.pg.sql.generated`` regeneration, ``queries/ui_bridge.sql``,
``src/database/pg/ui_bridge.rs``, the drain and the extended
``GET /ui-bridge/effects/recent``) is a separate, strictly downstream change.

**Hand-authored.** ``alembic revision --autogenerate`` is prohibited in this
repo (see ``alembic/env.py`` and ``.github/PULL_REQUEST_TEMPLATE.md``): the
``coord`` schema is almost entirely unmodeled, so an autogenerate run would
propose dropping the ~75 tables it cannot see.

The columns
===========

All five are **nullable with no server default**, so the ``ALTER TABLE`` is a
catalog-only change in PG11+ — no table rewrite on what the plan names the
runner's highest-volume ledger. Every existing row keeps five NULLs, and NULL
means *"this event carried no effect record"*, never a defaulted value.

``effect_class`` TEXT NULL
    The **declared** coarse safety class — ``IREffect`` =
    ``'read' | 'write' | 'destructive'``
    (``ui-bridge/packages/ui-bridge/src/core/types.ts:512``), copied from
    ``ComponentAction.effect`` / the element action's declaration. NULL is
    load-bearing and is NOT ``'read'``: it is the "nobody classified this"
    signal that ``core/action-effect.ts:36-44`` exists to preserve, and served
    policy ``operating-rules`` ``what-makes-an-action-destructive`` reads an
    unestablished effect as destructive. Measured 2026-09-04, 0 of 60 runner
    component actions declare one, so this column is expected to be
    overwhelmingly NULL at first and to fill as Phases 2-4 land.

    Deliberately **not** a CHECK-constrained enum or a PG enum type. The SDK
    owns that vocabulary and widens it without a migration; a DB-side enum
    would turn an SDK vocabulary change into a schema migration and, worse,
    would make the runner's drain fail closed on a value it is only recording.
    The same reasoning the sibling ``event_type`` / ``action`` columns already
    embody in this table.

``effect_outcome`` TEXT NULL
    The terminal classification of one predict-then-verify cycle —
    ``EffectOutcome`` = ``'Confirmed' | 'Surprise' | 'Failure' |
    'Contradiction' | 'Partial'`` (``control/effect-types.ts:37-42``).

    This is the column that says a row IS an effect record.
    ``EffectRecordEntry.outcome`` is **required, not optional**
    (``control/effect-store.ts:25``), so every drained record carries one and
    no ordinary ledger row does. That is what makes
    ``effect_outcome IS NOT NULL`` an exact predicate rather than a heuristic,
    and it is why the index below is partial on it (see "The index").

``predicted_delta`` JSONB NULL
    The ``PredictedDelta`` the signature emitted for this invocation
    (``control/effect-types.ts:70-89``) — the executable statement of what the
    action was expected to change.

    **JSONB, not TEXT**, deliberately, and this is the one place this revision
    departs from the shape of its sibling columns. ``params`` / ``result`` /
    ``metadata`` on this table are TEXT, but that is drift preserved verbatim
    from the pre-Postgres ``schema.pg.sql`` source and flagged as such in
    ``consolidation_phase1_06_ui_bridge.py``'s own DRIFT FLAGS block — a
    documented defect to stop propagating, not a house style to extend. The
    twin's entire purpose is *querying predictions before automating* ("which
    actions predict this element disappears?"), which under TEXT is a full scan
    plus a client-side parse and under JSONB is a containment operator.
    Postgres also validates the payload at write, so a malformed drain fails
    closed at the boundary instead of landing an unparseable row that only
    breaks a reader months later. The runner's sqlx/clorinde layer binds
    ``serde_json::Value`` to ``jsonb`` natively, so this costs the downstream
    change nothing.

    No GIN index is created here — see "The index".

``signature_provenance`` TEXT NULL
    ``EffectSignature.provenance`` = ``'declared' | 'inferred'``
    (``control/effect-types.ts:150``). Load-bearing rather than decorative:
    Phase 5 scopes ``assertSignatureEffectConsistency``'s Rule 2 to
    ``provenance === 'declared'`` precisely because
    ``signatureFromInferredEntry`` hard-codes ``reversibility: 'reversible'``
    (``control/effect-signatures.ts:272``). A durable row that does not record
    which arm produced it cannot be re-adjudicated later.

``signature_confidence`` DOUBLE PRECISION NULL
    ``EffectSignature.confidence`` (``control/effect-types.ts:152``) — the mean
    measured confidence across kept consequences, 0..1, present only on
    inferred signatures. DOUBLE PRECISION matches the table's existing
    ``duration_ms`` FLOAT, and no CHECK on the 0..1 range is added: the SDK
    owns that invariant, and a range CHECK here would abort an unattended drain
    on an out-of-band value that the operator would rather see recorded and
    investigated than dropped.

The index
=========

One index: ``ui_bridge_events_effect_idx`` on ``("timestamp", effect_outcome)``,
**partial** ``WHERE effect_outcome IS NOT NULL``. Same shape and naming
convention as this table's existing ``ui_bridge_events_recording_session_idx``
(``section_5b_01_ui_bridge_causal_columns.py``), for the same reason.

*Why partial.* The plan calls this table the runner's highest-volume ledger, so
an unconditional index would carry an entry for every event ever recorded while
only effect rows are ever queried through it — write amplification on the
hottest write path in the runner, paid on every row, to serve a minority. The
partial predicate is not an approximation: as noted above, ``outcome`` is
required on every ``EffectRecordEntry`` and absent from every other row, so the
index stores exactly the effect rows and nothing else. Measured on a scratch
PG16 with 200 000 ledger rows of which 2 000 (1%) are effect rows: this index
is **88 kB** against **4 408 kB** for the table's existing full-column
``idx_ubev_timestamp`` — a 50× difference that is paid back on every INSERT.

*Why ``timestamp`` leads, and not ``effect_outcome``.* Phase 7's read path
extends the existing ``GET /ui-bridge/effects/recent`` to union durable rows
with the live ring, **newest-first**, with ``since`` / ``component_id`` /
``outcome`` filters. Ordering is therefore always present and the ``outcome``
filter is optional, so the ordering column leads. A b-tree is scanned backward
for ``ORDER BY … DESC``, so no ``DESC`` modifier is needed on the key.

This was measured rather than reasoned, because the obvious
filter-column-first ordering loses. Both candidates were built on the fixture
above and all three query shapes were run under ``EXPLAIN (ANALYZE, BUFFERS)``:

===========================================  ==================  ==================
query                                        ``(outcome, ts)``   ``(ts, outcome)``
===========================================  ==================  ==================
``outcome = 'Surprise'`` newest-first        52 buf / 0.047 ms   54 buf / 0.078 ms
``outcome IS NOT NULL`` newest-first         **not chosen**      45 buf / 0.033 ms
``… AND timestamp > N`` newest-first         **not chosen**      45 buf / 0.019 ms
===========================================  ==================  ==================

With ``effect_outcome`` leading, the planner declined the new index entirely
for the two unfiltered shapes and fell back to ``idx_ubev_timestamp``, scanning
the whole ledger backward and discarding **4 851 rows by filter** to return 50
— a cost that grows as effect rows get rarer, and they are rare by design. With
``timestamp`` leading the new index is chosen for all three, the second key
column still satisfies ``outcome=`` as an index condition, and the index is
smaller (88 kB vs 112 kB). One index serves every shape; there is no case for a
second.

*Why no GIN on ``predicted_delta``.* Nothing in Phase 7 queries inside the
predicted delta; the read path filters on outcome, time and component. A GIN
index is the most expensive kind to maintain on a high-volume insert path, and
building one now for a query nobody has written is spend without a consumer.
Add it when a containment query exists to justify it — the column being JSONB
is what keeps that option cheap.

*Why ``CONCURRENTLY``.* A plain ``CREATE INDEX`` takes a write-blocking
``SHARE`` lock for the duration of a full heap scan. ``migrate.yml`` applies
this to the canonical RDS unattended, and blocking writes to the runner's
highest-volume ledger for that window is exactly the incident shape to avoid.
Same precedent as ``coord_alerts_flakeidx_01`` and
``coord_pg_overload_idx_01``/``_02``: ``CONCURRENTLY`` cannot run inside a
transaction and ``env.py`` wraps the whole batch in one, hence
``op.get_context().autocommit_block()``. On a fresh CI database the table is
empty and the build is instant.

**The INVALID-index trap that comes with it**, stated so it is not discovered
later: a killed ``CONCURRENTLY`` build leaves an *INVALID* index of the same
name, which ``IF NOT EXISTS`` then happily skips — a migration that reports
success while the index never serves a query. Verify with
``pg_index.indisvalid``, not mere existence; if it is invalid, ``DROP INDEX``
it and re-run.

Idempotency, and why the DDL is raw SQL
=======================================

Entering ``autocommit_block()`` **commits** everything before it, so this
revision is not one atomic unit: the five columns are durable before the index
build starts. If the build then fails, alembic has not stamped the revision and
a re-run would meet columns that already exist. So the ``ALTER TABLE``
statements use ``ADD COLUMN IF NOT EXISTS`` (and the downgrade ``DROP COLUMN IF
EXISTS``) — the same raw, schema-qualified, re-runnable house style as the
current head ``coord_wu_authored_at_01``. Every statement names ``project.``
explicitly and is a plain string literal, never an f-string, because
``.pre-commit-hooks/check_alembic_schema_args.py`` parses the raw SQL inside
``op.execute(...)`` statically to prove it.

``SET LOCAL lock_timeout = '3s'`` bounds the DDL's lock wait: a queued
``ACCESS EXCLUSIVE`` request itself blocks every reader that arrives behind it,
so the ``ALTER`` fails fast rather than stalling the runner's ledger writes
behind one slow in-flight query.

Downgrade
=========

Exactly reverses this revision and nothing else: the index first (also
``CONCURRENTLY``, so a rollback does not take the ``ACCESS EXCLUSIVE`` lock a
plain ``DROP INDEX`` would), then the five columns. The table, its data and
every column and index that predates this revision — including 5b's
``recording_session_id`` / ``caused_by_event_id`` and their FK — are untouched
in both directions.

Known gap, recorded rather than silently absorbed
=================================================

Phase 7's drain is specified as *"idempotent on ``requestId``; a re-read must
not duplicate rows"*, and ``EffectRecordEntry.requestId``
(``control/effect-store.ts:17``) has **no column in this table**. This revision
adds the five columns the plan enumerates and no sixth: the dedup key is a
runner-side design decision (a new column, a unique index on an existing one,
or a key derived from ``(task_run_id, sequence)``) that belongs with the change
that writes it. Flagged here so it is scheduled, not assumed.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "effect_calc_01_ui_bridge_effect_columns"
down_revision: str | Sequence[str] | None = "coord_wu_authored_at_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Plain string literals, schema-qualified, never f-strings — the
# `alembic-schema-arg-gate` pre-commit hook analyses these statically.
_ADD_COLUMNS = (
    "ALTER TABLE project.ui_bridge_events "
    "ADD COLUMN IF NOT EXISTS effect_class TEXT NULL",
    "ALTER TABLE project.ui_bridge_events "
    "ADD COLUMN IF NOT EXISTS effect_outcome TEXT NULL",
    "ALTER TABLE project.ui_bridge_events "
    "ADD COLUMN IF NOT EXISTS predicted_delta JSONB NULL",
    "ALTER TABLE project.ui_bridge_events "
    "ADD COLUMN IF NOT EXISTS signature_provenance TEXT NULL",
    "ALTER TABLE project.ui_bridge_events "
    "ADD COLUMN IF NOT EXISTS signature_confidence DOUBLE PRECISION NULL",
)

# Dropped newest-first so the statement order mirrors the upgrade's inverse.
_DROP_COLUMNS = (
    "ALTER TABLE project.ui_bridge_events DROP COLUMN IF EXISTS signature_confidence",
    "ALTER TABLE project.ui_bridge_events DROP COLUMN IF EXISTS signature_provenance",
    "ALTER TABLE project.ui_bridge_events DROP COLUMN IF EXISTS predicted_delta",
    "ALTER TABLE project.ui_bridge_events DROP COLUMN IF EXISTS effect_outcome",
    "ALTER TABLE project.ui_bridge_events DROP COLUMN IF EXISTS effect_class",
)

# `timestamp` is double-quoted: it is a reserved-ish word in SQL and the
# column really is named `timestamp` (BIGINT epoch-ms) on this table.
#
# Key order is `("timestamp", effect_outcome)` and NOT the other way round —
# measured, see "The index" in the module docstring. The predicate must stay
# character-comparable with the reader's WHERE clause: Postgres proves
# implication syntactically, so rewriting `effect_outcome IS NOT NULL` into
# anything else silently restores the full scan with no error and no log line.
_CREATE_INDEX = """
CREATE INDEX CONCURRENTLY IF NOT EXISTS
    ui_bridge_events_effect_idx
ON project.ui_bridge_events ("timestamp", effect_outcome)
WHERE effect_outcome IS NOT NULL
"""

_DROP_INDEX = "DROP INDEX CONCURRENTLY IF EXISTS project.ui_bridge_events_effect_idx"


def upgrade() -> None:
    """Additive: five nullable columns plus one partial index. Idempotent."""
    # Fail fast rather than queueing an ACCESS EXCLUSIVE request in front of
    # every reader behind it. Nullable + no default ⇒ catalog-only, so the
    # lock itself is held only for the catalog update.
    op.execute("SET LOCAL lock_timeout = '3s'")
    for statement in _ADD_COLUMNS:
        op.execute(statement)

    # CONCURRENTLY cannot run inside a transaction; entering the block commits
    # the ALTERs above, which is why they are individually idempotent.
    with op.get_context().autocommit_block():
        op.execute(_CREATE_INDEX)


def downgrade() -> None:
    """Reverse exactly this revision: the index, then the five columns."""
    with op.get_context().autocommit_block():
        op.execute(_DROP_INDEX)

    op.execute("SET LOCAL lock_timeout = '3s'")
    for statement in _DROP_COLUMNS:
        op.execute(statement)
