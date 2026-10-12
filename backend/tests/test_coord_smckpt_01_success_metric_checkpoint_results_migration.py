"""Behaviour test for the ``coord_smckpt_01_success_metric_checkpoint_results`` revision.

Pins the contract coord's checkpoint-row insert, its backfill and its read
door rely on (plan ``2026-10-06-overview-objectives-view`` Phase 4):

1. **Classifier shape** (static, no database) — every ``op.execute`` in
   ``upgrade()`` takes one static literal, the table is ``CREATE TABLE IF NOT
   EXISTS``, and the one index is ``CREATE INDEX CONCURRENTLY IF NOT EXISTS``
   inside ``op.get_context().autocommit_block()`` — the forms coord's
   migration classifier admits.
2. **Shape** — the table, its exact column contract, the named constraints and
   the ``(tenant_id, kind, name, criterion, measured_at DESC)`` index exist
   after upgrade and are gone after downgrade.
3. **Vocabularies are enforced by the schema** — verdict, the seven
   ``unknown_reason`` values (five block reasons + the table-only
   ``prose_only`` / ``invalid_block``), ``action->>'kind'`` (including the
   malformed-JSON shapes a bare ``IN`` would let through), and ``met`` /
   ``missed`` ⇒ non-empty ``value_text``.
4. **Idempotency key** — ``UNIQUE (evidence_finding_id, criterion)`` refuses a
   duplicate and ``ON CONFLICT DO NOTHING`` on it is a silent no-op.
5. **Defaults** — ``id`` and ``recorded_at`` are server-generated.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    index_exists,
    run_alembic,
    table_exists,
    upgrade_execute_calls,
)

_REVISION_ID = "coord_smckpt_01_success_metric_checkpoint_results"
_REVISION_FILENAME = "coord_smckpt_01_success_metric_checkpoint_results.py"


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime (it gets re-pointed)."""
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    return declared_parent_revision_id(source, _REVISION_FILENAME)


_PARENT_REVISION_ID = _parent_revision_id()

_TABLE = "success_metric_checkpoint_results"
_INDEX = "idx_success_metric_checkpoint_results_criterion_measured"

_CONSTRAINTS = {
    "ck_success_metric_checkpoint_results_verdict": "c",
    "ck_success_metric_checkpoint_results_unknown_reason": "c",
    "ck_success_metric_checkpoint_results_value_text_present": "c",
    "ck_success_metric_checkpoint_results_action_kind": "c",
    "uq_success_metric_checkpoint_results_finding_criterion": "u",
    "success_metric_checkpoint_results_pkey": "p",
}

# The column contract shared with coord: name -> (data_type, nullable).
_EXPECTED_COLUMNS: dict[str, tuple[str, str]] = {
    "id": ("uuid", "NO"),
    "tenant_id": ("uuid", "NO"),
    "kind": ("text", "NO"),
    "name": ("text", "NO"),
    "document_version": ("integer", "YES"),
    "checkpoint": ("text", "NO"),
    "criterion": ("text", "NO"),
    "verdict": ("text", "NO"),
    "value": ("double precision", "YES"),
    "unit": ("text", "YES"),
    "value_text": ("text", "YES"),
    "unknown_reason": ("text", "YES"),
    "method": ("text", "YES"),
    "door": ("text", "YES"),
    "cause": ("text", "YES"),
    "action": ("jsonb", "YES"),
    "window_from": ("timestamp with time zone", "YES"),
    "window_to": ("timestamp with time zone", "YES"),
    "gate_id": ("uuid", "YES"),
    "measured_at": ("timestamp with time zone", "NO"),
    "evidence_finding_id": ("uuid", "NO"),
    "recorded_at": ("timestamp with time zone", "NO"),
}

_BLOCK_REASONS = (
    "could_not_run",
    "probe_error",
    "no_data",
    "not_measurable_yet",
    "manual_pending",
)
_TABLE_ONLY_REASONS = ("prose_only", "invalid_block")

_TENANT = uuid.UUID("6d1c4b2a-8e3f-4a57-9b0c-2f7e5d1a3c84")

_INSERT = text(
    """
    INSERT INTO coord.success_metric_checkpoint_results
        (tenant_id, kind, name, document_version, checkpoint, criterion,
         verdict, value, unit, value_text, unknown_reason, cause, action,
         measured_at, evidence_finding_id)
    VALUES (:tid, 'success_metric', 'merge-train-throughput-2026-10', :dv,
            'checkpoint-1', :criterion, :verdict, :value, :unit, :value_text,
            :unknown_reason, :cause, CAST(:action AS jsonb),
            '2026-10-08T16:05:00Z', :fid)
    """
)


def _row(**overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "tid": _TENANT,
        "dv": 2,
        "criterion": "1.2",
        "verdict": "met",
        "value": 14.0,
        "unit": "lands/day",
        "value_text": "14 lands in the 24 h to 2026-10-08T16:00Z",
        "unknown_reason": None,
        "cause": None,
        "action": None,
        "fid": uuid.uuid4(),
    }
    params.update(overrides)
    return params


def _accepted(engine: Engine, params: dict[str, object]) -> None:
    with engine.begin() as conn:
        conn.execute(_INSERT, params)


def _refused(engine: Engine, params: dict[str, object]) -> None:
    with pytest.raises(IntegrityError):
        with engine.begin() as conn:
            conn.execute(_INSERT, params)


def _columns(engine: Engine) -> dict[str, tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable
                  FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :table
                """
            ),
            {"table": _TABLE},
        ).all()
    return {name: (dtype, nullable) for name, dtype, nullable in rows}


def _constraints(engine: Engine) -> dict[str, str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT conname, contype
                  FROM pg_constraint
                 WHERE conrelid = 'coord.success_metric_checkpoint_results'::regclass
                """
            )
        ).all()
    return {name: str(kind) for name, kind in rows}


def test_coord_smckpt_01_upgrade_is_shaped_for_the_migration_classifier() -> None:
    """Static: the call shapes qontinui-coord's migration_classifier admits."""
    calls = upgrade_execute_calls(
        backend_root() / "alembic" / "versions" / _REVISION_FILENAME
    )
    assert calls, "upgrade() runs no op.execute"
    dynamic = [i for i, call in enumerate(calls) if call.sql is None]
    assert not dynamic, (
        f"op.execute call(s) {dynamic} in upgrade() do not take ONE inline static "
        "string literal — coord's classifier holds that as dynamic SQL"
    )
    statements = [(" ".join(c.sql.split()).upper(), c) for c in calls if c.sql]
    tables = [s for s, _ in statements if s.startswith("CREATE TABLE")]
    indexes = [(s, c) for s, c in statements if s.startswith("CREATE INDEX")]
    assert len(tables) == 1 and len(indexes) == 1, statements
    assert tables[0].startswith(
        "CREATE TABLE IF NOT EXISTS COORD.SUCCESS_METRIC_CHECKPOINT_RESULTS ("
    ), tables[0]
    statement, call = indexes[0]
    assert statement.startswith("CREATE INDEX CONCURRENTLY IF NOT EXISTS "), statement
    assert call.in_autocommit_block, (
        "the CONCURRENTLY build must sit inside op.get_context().autocommit_block()"
    )
    assert all(s.startswith("CREATE ") for s, _ in statements), statements


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_coord_smckpt_01_creates_the_table_and_enforces_its_contract() -> None:
    """Shape, enforced vocabularies, the idempotency key, defaults, reversal."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "smckpt01_test") as (engine, url):
        # 1. Parent revision — the table does not exist yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _TABLE), (
            "the table must be created by this revision, not an earlier one"
        )

        # 2. Apply — table, exact columns, named constraints, index.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", _TABLE)
        assert _columns(engine) == _EXPECTED_COLUMNS
        assert _constraints(engine) == _CONSTRAINTS
        assert index_exists(engine, _INDEX)
        with engine.connect() as conn:
            indexdef = conn.execute(
                text(
                    "SELECT indexdef FROM pg_indexes "
                    "WHERE schemaname = 'coord' AND indexname = :name"
                ),
                {"name": _INDEX},
            ).scalar_one()
            valid = conn.execute(
                text(
                    "SELECT indisvalid FROM pg_index "
                    "WHERE indexrelid = CAST(:qualified AS regclass)"
                ),
                {"qualified": f"coord.{_INDEX}"},
            ).scalar_one()
        assert "(tenant_id, kind, name, criterion, measured_at DESC)" in indexdef
        assert valid is True, "the CONCURRENTLY build left an INVALID index"

        # 3. Defaults — id and recorded_at are server-generated.
        fid = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(_INSERT, _row(fid=fid))
            generated = conn.execute(
                text(
                    """
                    SELECT id IS NOT NULL, recorded_at IS NOT NULL
                      FROM coord.success_metric_checkpoint_results
                     WHERE evidence_finding_id = :fid
                    """
                ),
                {"fid": fid},
            ).one()
        assert tuple(generated) == (True, True)

        # 4. Idempotency key: a duplicate (finding, criterion) is refused,
        #    and ON CONFLICT DO NOTHING on that key is a silent no-op.
        _refused(engine, _row(fid=fid))
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.success_metric_checkpoint_results
                        (tenant_id, kind, name, checkpoint, criterion, verdict,
                         value_text, measured_at, evidence_finding_id)
                    VALUES (:tid, 'success_metric', 'm', 'checkpoint-1', '1.2',
                            'met', 'x', now(), :fid)
                    ON CONFLICT (evidence_finding_id, criterion) DO NOTHING
                    """
                ),
                {"tid": _TENANT, "fid": fid},
            )
        # Same finding, another criterion is a new row.
        _accepted(engine, _row(fid=fid, criterion="1.3"))

        # 5. Verdict vocabulary.
        _refused(engine, _row(verdict="passed"))

        # 6. met/missed need a non-empty value_text; unknown does not.
        for verdict in ("met", "missed"):
            _refused(engine, _row(verdict=verdict, value_text=None))
            _refused(engine, _row(verdict=verdict, value_text=""))
            _accepted(engine, _row(verdict=verdict))
        _accepted(
            engine,
            _row(
                verdict="unknown",
                value=None,
                unit=None,
                value_text=None,
                unknown_reason="no_data",
            ),
        )

        # 7. unknown_reason: block reasons and table-only marker reasons
        #    pass; anything else (including #1624's vocabulary) is refused.
        for reason in _BLOCK_REASONS + _TABLE_ONLY_REASONS:
            _accepted(
                engine,
                _row(verdict="unknown", value_text=None, unknown_reason=reason),
            )
        for reason in ("manual", "no_target", "absent_source_query", ""):
            _refused(
                engine,
                _row(verdict="unknown", value_text=None, unknown_reason=reason),
            )

        # A prose_only marker row: criterion '*', no document_version.
        _accepted(
            engine,
            _row(
                criterion="*",
                dv=None,
                verdict="unknown",
                value=None,
                unit=None,
                value_text=None,
                unknown_reason="prose_only",
            ),
        )

        # 8. action->>'kind' vocabulary, total over malformed JSON.
        for kind in ("plan", "pr", "gate", "operator_ask"):
            _accepted(
                engine,
                _row(
                    verdict="missed",
                    cause="runner queue saturated",
                    action=json.dumps({"kind": kind, "ref": "x"}),
                ),
            )
        for bad in (
            {"kind": "email", "ref": "x"},
            {"ref": "x"},
            ["plan"],
            "plan",
            None,  # JSON null literal, not SQL NULL
        ):
            _refused(engine, _row(verdict="missed", action=json.dumps(bad)))

        # 9. Downgrade — table and index gone.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _TABLE)
        assert not index_exists(engine, _INDEX), "index survived downgrade"
