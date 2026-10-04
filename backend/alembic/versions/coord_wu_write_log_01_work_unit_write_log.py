"""coord.work_unit_write_log — a row for every work-unit write that changes something

Revision ID: coord_wu_write_log_01
Revises: mdroles_01
Create Date: 2026-10-04

Phase 1 of plan
``2026-09-18-a-work-unit-write-leaves-no-history-unless-it-changes-status``.

DDL ONLY. No route change, no query change, no coord change. Coord's reads of
the table this revision creates land AFTER it is applied in production (served
policy ``production-and-cost`` ``alembic-sole-authorship``; the 2026-07-13
missing-column incident, ``database-migrations.md``).

Problem
=======

``coord.work_units`` has roughly fifteen writers — the runner's plan adapter
upsert, the MCP ``coord_work_unit_*`` tools, the derive worker, the shepherd
reconcile, the citation refresh, operator doors, alembic data migrations — and
exactly ONE of them leaves a trace: a status TRANSITION is appended to
``coord.work_unit_status_history``. Every other write overwrites the row in
place. A unit whose ``metadata.phases`` disappeared, whose title changed, or
whose tenant moved carries no record of which write did it, when, or on whose
behalf; the previous value is simply gone. The forensic question the plan was
written for ("which write dropped ``phases``?") had no answer anywhere.

Design
======

**A trigger, not a per-call-site helper — and this is the FIRST
``CREATE TRIGGER`` in the revision chain.** Three docstrings record the house
convention that there is none: ``pdtier_01_prompt_document_agent_write_tier``
(line 164, "there is not one ``CREATE TRIGGER`` in the whole revision chain"),
``coord_displaced_pr_rows_01_create`` (line 89) and
``coord_ci_pool_baselines_01_create`` (line 106). Those revisions declined a
trigger for a ``DEFAULT now()`` refresh, where the writer can be told to set the
column itself. This one is different in kind: the failure being fixed is a
write NOBODY ANTICIPATED, so a Rust helper every writer must remember to call
has exactly the coverage gap that produced the status-only history. An
``AFTER INSERT OR UPDATE OR DELETE ... FOR EACH ROW`` trigger sees every writer
— current, future, ad-hoc ``psql``, an alembic data migration — and cannot be
skipped. The vet confirmed nothing in the tooling assumes zero triggers:
coord's ``schema_manifest.rs`` lists tables only and
``coord_schema_authorship.rs`` scans only ``CREATE TABLE`` / ``INDEX`` /
``SCHEMA``.

**ONE trigger, no ``WHEN`` clause, and the diff is over every column.** The
plan's prose sketched an INSERT trigger plus an UPDATE trigger with a ``WHEN``
over a named watched-column list. What ships instead is one trigger
(``wu_write_log``) on one function (``coord.log_work_unit_write()``) that
diffs ``to_jsonb(OLD)`` against ``to_jsonb(NEW)`` over EVERY column except an
explicit excluded list, and ``RETURN``s without logging when nothing outside
that list changed. Consequences, all deliberate:

* A column added to ``coord.work_units`` after this revision is watched
  automatically — no list to forget to extend, so no column-coverage test is
  needed (the migration test instead asserts a newly ADDED column is logged).
* An ``INSERT ... ON CONFLICT DO UPDATE`` (the production upsert) fires the
  UPDATE arm and is logged as ``op = 'update'``; a fresh insert as ``'insert'``.
* **Excluded columns** — pure tick stamps and immutable keys: ``id``,
  ``created_at``, ``updated_at``, ``derive_checked_at``, ``vet_checked_at``.
  ``updated_at`` being excluded is what makes the plan adapter's ~68 s no-op
  refresh write nothing.
* **Volatile metadata keys** — ``reconcile_checked_at`` (shepherd reconcile,
  up to 500 units per tick) and ``citations_refreshed_at`` (citation refresh)
  are rewritten with a fresh timestamp every cycle. The metadata comparison
  strips both keys first, so a write that changes ONLY them is not logged. When
  metadata DID change for another reason, the stored old/new objects are the
  full, unstripped values.

**Store the change, not two snapshots.** ``changed_fields`` names every
changed watched column. ``status`` and ``title`` get dedicated old/new columns;
``metadata`` gets the full old and new objects ONLY when it changed (on INSERT
only ``new_metadata``, on DELETE only ``old_metadata``), plus the key-level diff
``metadata_keys_removed`` / ``metadata_keys_added`` — the removed-keys column
answers "which write dropped ``phases``" in one read. Every OTHER changed column
goes into ``old_values`` / ``new_values`` as ``{column: value}``. Full objects
rather than a JSON patch, so a reader can restore a lost value from the row.

**Attribution is server-derived or explicitly absent.** The trigger records
``NULLIF(current_setting('coord.write_actor', true), '')`` and the same for
``coord.write_path``. **``actor`` NULL means UNATTRIBUTED** — never a guessed
default. Writers set the two settings TRANSACTION-LOCALLY, with
``set_config('coord.write_actor', <actor>, true)`` inside the write's
transaction; never the session-level ``set_config(..., false)``, which on a
pooled connection would leak one caller's actor onto the next caller's write.
The ``NULLIF`` is load-bearing: once a pooled session has run any
transaction-local ``set_config``, a later transaction reads ``''`` rather than
NULL, and without it "unattributed" would be a mix of the two. **An alembic
data migration that writes ``coord.work_units`` should set
``coord.write_path = 'alembic:<revision id>'``** (transaction-local) before
its ``UPDATE``, so its writes are attributable to it.

**Deletes are logged, and no foreign key.** ``op`` admits ``'delete'`` and
``work_unit_id`` carries NO FK to ``coord.work_units`` (the no-FK ledger
precedent of ``agent_action_reports_01``): with ``ON DELETE CASCADE`` a deleted
unit's history would vanish with it, defeating a forensic log.

``written_at`` defaults to ``clock_timestamp()``, not ``now()``, so two writes
in one transaction order correctly; ``txid`` records the transaction so they
can still be grouped.

**Retention is deliberately NOT decided here.** The plan's instruction is to
measure growth after this lands and decide from data — no blind reaper. The
``written_at`` index exists so a later retention sweep has its range scan.

The DDL is canonical: ``qontinui-coord``'s ``#[cfg(test)]`` fixture mirrors
the table, function and trigger byte-for-byte (its DB tests build the schema
from test DDL, not alembic). Change one, change both.

Lock posture (deliberate)
=========================

``CREATE TABLE`` / ``CREATE INDEX`` / ``CREATE FUNCTION`` touch only objects
this revision creates. ``CREATE TRIGGER`` takes a ``SHARE ROW EXCLUSIVE`` lock
on ``coord.work_units`` — it blocks writers (and is blocked by them) for the
instant of the catalog change, but not plain readers. ``SET LOCAL lock_timeout
= '3s'`` makes it fail FAST rather than queue behind an in-flight write: a
queued lock request itself blocks every later writer that arrives behind it.
The indexes are built non-concurrently because the table is empty at creation.

Rollout ordering
================

1. **THIS revision** (qontinui-web) lands on ``main``; ``migrate.yml`` applies
   it to the canonical RDS. **Safe against the currently-deployed coord**: that
   coord does not read the new table, and the trigger only INSERTs into a table
   created in this same revision, so no existing coord statement can fail
   because of it. The one behavioural change a running coord sees is that each
   logged write also inserts one log row in the same transaction.
2. coord (Phase 2) adds the read core, ``coord_work_unit_history`` and its HTTP
   route, pinned to a migrator image containing this revision.
3. coord (Phase 3) sets ``coord.write_actor`` / ``coord.write_path`` on its
   writers; until then every row reads ``actor`` NULL = unattributed, which is
   the truth.

Idempotency / authorship posture
================================

* ``CREATE TABLE IF NOT EXISTS`` / ``CREATE INDEX IF NOT EXISTS`` /
  ``CREATE OR REPLACE FUNCTION`` / ``DROP TRIGGER IF EXISTS`` + ``CREATE
  TRIGGER``, every object schema-qualified — re-running is a no-op.
* **alembic is the SOLE author of the coord.* schema.** coord only reads the
  table and sets the two transaction-local settings.
* ``downgrade`` drops the trigger, the function and the table (``IF EXISTS``).
  The logged history is lost with the table; ``coord.work_units`` rows are not
  touched.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_wu_write_log_01"
down_revision: str | Sequence[str] | None = "mdroles_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# --- Canonical DDL. Mirrored byte-for-byte by qontinui-coord's test fixture. ---

_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS coord.work_unit_write_log (
    write_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_unit_id          UUID NOT NULL,          -- deliberately NO FK: a deleted unit keeps its history
    slug                  TEXT,
    tenant_id             UUID,
    written_at            TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    op                    TEXT NOT NULL CHECK (op IN ('insert','update','delete')),
    changed_fields        TEXT[] NOT NULL,
    old_status            TEXT,
    new_status            TEXT,
    old_title             TEXT,
    new_title             TEXT,
    old_metadata          JSONB,                  -- only when metadata changed (or on delete)
    new_metadata          JSONB,                  -- only when metadata changed (or on insert)
    metadata_keys_removed TEXT[],
    metadata_keys_added   TEXT[],
    old_values            JSONB,                  -- every OTHER changed watched column, old value
    new_values            JSONB,                  -- every OTHER changed watched column, new value
    actor                 TEXT,                   -- NULL = UNATTRIBUTED, never a guessed default
    write_path            TEXT,
    txid                  BIGINT NOT NULL DEFAULT txid_current()
)
"""

_CREATE_INDEX_SQLS = (
    """
CREATE INDEX IF NOT EXISTS ix_coord_work_unit_write_log_unit_keyset
    ON coord.work_unit_write_log (work_unit_id, written_at DESC, write_id DESC)
""",
    """
CREATE INDEX IF NOT EXISTS ix_coord_work_unit_write_log_written_at
    ON coord.work_unit_write_log (written_at)
""",
)

_CREATE_FUNCTION_SQL = """
CREATE OR REPLACE FUNCTION coord.log_work_unit_write() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
    -- Columns whose change alone is NOT a write worth logging: pure tick stamps
    -- and immutable keys. EVERY other column of coord.work_units is watched,
    -- including columns added after this revision (the diff is over to_jsonb(row)).
    excluded_cols  CONSTANT TEXT[] := ARRAY['id','created_at','updated_at','derive_checked_at','vet_checked_at'];
    -- metadata keys rewritten with a fresh timestamp on every worker tick
    -- (shepherd_reconcile stamp_checked; work_unit_citation_refresh). A write that
    -- changes ONLY these keys is not logged.
    volatile_keys  CONSTANT TEXT[] := ARRAY['reconcile_checked_at','citations_refreshed_at'];
    o JSONB; n JSONB; r JSONB;
    changed TEXT[] := ARRAY[]::TEXT[];
    k TEXT;
    om JSONB; nm JSONB;
    ov JSONB := '{}'::jsonb; nv JSONB := '{}'::jsonb;
    meta_changed BOOLEAN := false;
BEGIN
    IF TG_OP = 'INSERT' THEN
        n := to_jsonb(NEW); r := n;
    ELSIF TG_OP = 'UPDATE' THEN
        o := to_jsonb(OLD); n := to_jsonb(NEW); r := n;
    ELSE
        o := to_jsonb(OLD); r := o;
    END IF;

    FOR k IN SELECT jsonb_object_keys(r) LOOP
        CONTINUE WHEN k = ANY (excluded_cols);
        IF TG_OP = 'UPDATE' THEN
            IF k = 'metadata' THEN
                IF (coalesce(o->'metadata','{}'::jsonb) - volatile_keys)
                   IS DISTINCT FROM (coalesce(n->'metadata','{}'::jsonb) - volatile_keys) THEN
                    changed := changed || k; meta_changed := true;
                END IF;
            ELSIF (o->k) IS DISTINCT FROM (n->k) THEN
                changed := changed || k;
            END IF;
        ELSE
            changed := changed || k;
            IF k = 'metadata' THEN meta_changed := true; END IF;
        END IF;
    END LOOP;

    IF TG_OP = 'UPDATE' AND cardinality(changed) = 0 THEN
        RETURN NULL;  -- only excluded columns / volatile metadata keys moved: no log row
    END IF;

    FOREACH k IN ARRAY changed LOOP
        CONTINUE WHEN k IN ('status','title','metadata');
        IF o IS NOT NULL THEN ov := ov || jsonb_build_object(k, o->k); END IF;
        IF n IS NOT NULL THEN nv := nv || jsonb_build_object(k, n->k); END IF;
    END LOOP;

    IF meta_changed THEN
        om := o->'metadata'; nm := n->'metadata';
    END IF;

    INSERT INTO coord.work_unit_write_log (
        work_unit_id, slug, tenant_id, op, changed_fields,
        old_status, new_status, old_title, new_title,
        old_metadata, new_metadata, metadata_keys_removed, metadata_keys_added,
        old_values, new_values, actor, write_path
    ) VALUES (
        (r->>'id')::uuid, r->>'slug', (r->>'tenant_id')::uuid, lower(TG_OP), changed,
        CASE WHEN 'status' = ANY (changed) THEN o->>'status' END,
        CASE WHEN 'status' = ANY (changed) THEN n->>'status' END,
        CASE WHEN 'title'  = ANY (changed) THEN o->>'title'  END,
        CASE WHEN 'title'  = ANY (changed) THEN n->>'title'  END,
        om, nm,
        CASE WHEN meta_changed THEN ARRAY(
            SELECT jsonb_object_keys(coalesce(om,'{}'::jsonb))
            EXCEPT SELECT jsonb_object_keys(coalesce(nm,'{}'::jsonb)) ORDER BY 1) END,
        CASE WHEN meta_changed THEN ARRAY(
            SELECT jsonb_object_keys(coalesce(nm,'{}'::jsonb))
            EXCEPT SELECT jsonb_object_keys(coalesce(om,'{}'::jsonb)) ORDER BY 1) END,
        CASE WHEN o IS NOT NULL AND ov <> '{}'::jsonb THEN ov END,
        CASE WHEN n IS NOT NULL AND nv <> '{}'::jsonb THEN nv END,
        NULLIF(current_setting('coord.write_actor', true), ''),
        NULLIF(current_setting('coord.write_path',  true), '')
    );
    RETURN NULL;
END;
$fn$
"""

_CREATE_TRIGGER_SQLS = (
    "DROP TRIGGER IF EXISTS wu_write_log ON coord.work_units",
    """
CREATE TRIGGER wu_write_log
    AFTER INSERT OR UPDATE OR DELETE ON coord.work_units
    FOR EACH ROW EXECUTE FUNCTION coord.log_work_unit_write()
""",
)

_TABLE_COMMENT = (
    "One row per write to coord.work_units that changed a watched column "
    "(every column except id, created_at, updated_at, derive_checked_at, "
    "vet_checked_at; metadata compared without the volatile keys "
    "reconcile_checked_at and citations_refreshed_at). Written by the "
    "wu_write_log trigger for every writer. No FK to work_units: a deleted "
    "unit keeps its history. Retention not yet decided (measure first)."
)

_ACTOR_COMMENT = (
    "Who made the write, from the transaction-local setting coord.write_actor "
    "(set_config(..., true)). NULL = UNATTRIBUTED: the writer set no actor. "
    "Never a guessed default."
)


def upgrade() -> None:
    # Bound the CREATE TRIGGER's SHARE ROW EXCLUSIVE wait on coord.work_units:
    # a queued lock request blocks every writer that arrives behind it, so fail
    # fast instead of stalling coord's upserts behind one slow in-flight write.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(_CREATE_TABLE_SQL)
    for sql in _CREATE_INDEX_SQLS:
        op.execute(sql)
    op.execute(_CREATE_FUNCTION_SQL)
    for sql in _CREATE_TRIGGER_SQLS:
        op.execute(sql)
    op.execute(f"COMMENT ON TABLE coord.work_unit_write_log IS '{_TABLE_COMMENT}'")
    op.execute(
        f"COMMENT ON COLUMN coord.work_unit_write_log.actor IS '{_ACTOR_COMMENT}'"
    )


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("DROP TRIGGER IF EXISTS wu_write_log ON coord.work_units")
    op.execute("DROP FUNCTION IF EXISTS coord.log_work_unit_write()")
    op.execute("DROP TABLE IF EXISTS coord.work_unit_write_log")
