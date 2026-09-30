"""Structural and round-trip test for alembic ``wuverif_01``.

``coord.work_unit_verifications`` is the contract coord's verification writer
and demotion reader code against, so the properties their safety argument rests
on are pinned here rather than in prose:

* ``unverifiable_reason`` is set **iff** ``verdict = 'unverifiable'`` — both
  directions of the table CHECK are driven, because "an unverifiable row with
  no reason is refused" and "a survived row with a reason is refused" are two
  different claims;
* the closed vocabularies refuse an unknown value;
* the idempotency key collides on a retried write even when
  ``plan_content_sha256`` is NULL (``NULLS NOT DISTINCT``);
* the ``ON DELETE CASCADE`` back to ``coord.work_units``;
* up -> down -> up leaves no residue.

**The parent revision is READ from the revision, never pinned** (the
``phaseatt_01`` convention): ``down_revision`` is re-pointed at the merged head
at land time, and a pinned copy here would go stale on the first re-chain.

Substrate is ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable. A skip proves nothing — point it at a
live instance with ``QONTINUI_TEST_PG=host:port`` (NOT ``DATABASE_URL``, which
``conftest.py`` overwrites at import time).
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
import sqlalchemy
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    index_exists,
    load_revision_module,
    run_alembic,
    scalar,
    table_exists,
)

_REVISION_ID = "wuverif_01"
_REVISION_FILENAME = "wuverif_01_work_unit_verifications.py"

_SCHEMA = "coord"
_TABLE = "work_unit_verifications"
_IDEMPOTENCY_INDEX = "uq_work_unit_verifications_idempotency"
_INDEXES = (
    _IDEMPOTENCY_INDEX,
    "idx_work_unit_verifications_tenant_created",
    "idx_work_unit_verifications_unit_created",
    "idx_work_unit_verifications_live_refuted",
)
_CK_IFF = "work_unit_verifications_reason_iff_unverifiable_check"
_CK_VERDICT = "work_unit_verifications_verdict_check"
_CK_REASON = "work_unit_verifications_unverifiable_reason_check"
_CK_AUTHOR_RESOLUTION = "work_unit_verifications_author_resolution_check"
_CK_SELECTION = "work_unit_verifications_selection_check"

_TENANT = uuid.UUID("00000000-0000-4000-8000-000000000001")

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "test Postgres unreachable via DATABASE_URL (under pytest, conftest.py "
        "derives DATABASE_URL from QONTINUI_TEST_PG=host:port, so set that)"
    ),
)


# ---------------------------------------------------------------------------
# source helpers — no database, never skip
# ---------------------------------------------------------------------------


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _declared_parent() -> str:
    """The parent this revision currently names — READ, never pinned."""
    module = load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")
    assert module.revision == _REVISION_ID
    parent = module.down_revision
    assert isinstance(parent, str) and parent, (
        f"down_revision is {parent!r}; this revision takes exactly one parent, "
        "named as a plain string (a tuple would make it a merge revision)"
    )
    return parent


def test_the_revision_takes_exactly_one_parent() -> None:
    _declared_parent()


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------


def _seed_work_unit(engine: Engine, slug: str) -> uuid.UUID:
    with engine.begin() as conn:
        row = conn.execute(
            text(
                "INSERT INTO coord.work_units (slug, tenant_id, status, title) "
                "VALUES (:slug, :tenant, 'shipped', :title) RETURNING id"
            ),
            {"slug": slug, "tenant": _TENANT, "title": slug},
        ).one()
    assert isinstance(row[0], uuid.UUID)
    return row[0]


def _row(work_unit_id: uuid.UUID, **overrides: object) -> dict[str, object]:
    """A complete, valid ``survived`` row, with ``overrides`` applied on top."""
    params: dict[str, object] = {
        "tenant_id": _TENANT,
        "work_unit_id": work_unit_id,
        "verdict": "survived",
        "unverifiable_reason": None,
        "criteria": '[{"id": "c1", "text": "route answers 200"}]',
        "verified_against": '{"repo": "qontinui-coord", "sha": "abc123"}',
        "independence": '{"basis": "session_disjoint"}',
        "verifier_session_id": uuid.uuid4(),
        "author_sessions": [uuid.uuid4()],
        "author_resolution": "disjoint",
        "selection": "sampled",
        "effective_rate_bp": 500,
        "plan_content_sha256": "0" * 64,
    }
    params.update(overrides)
    return params


_JSONB_COLUMNS = ("criteria", "verified_against", "independence")


def _insert(engine: Engine, params: dict[str, object]) -> uuid.UUID:
    cols = ", ".join(params)
    binds = ", ".join(
        f"CAST(:{k} AS JSONB)" if k in _JSONB_COLUMNS else f":{k}" for k in params
    )
    with engine.begin() as conn:
        row = conn.execute(
            text(f"INSERT INTO coord.{_TABLE} ({cols}) VALUES ({binds}) RETURNING id"),
            params,
        ).one()
    assert isinstance(row[0], uuid.UUID)
    return row[0]


def _refused_by(engine: Engine, params: dict[str, object], constraint: str) -> None:
    """Insert ``params`` and assert the named constraint is what refuses it."""
    with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
        _insert(engine, params)
    diag = getattr(excinfo.value.orig, "diag", None)
    assert diag is not None and diag.constraint_name == constraint, (
        f"expected {constraint} to refuse {params!r}, got "
        f"{getattr(diag, 'constraint_name', None)!r}: {excinfo.value.orig!r}"
    )


def _count(engine: Engine, work_unit_id: uuid.UUID) -> int:
    """Rows for ONE unit — scoped, never a store-wide count."""
    value = scalar(
        engine,
        f"SELECT count(*) FROM coord.{_TABLE} WHERE work_unit_id = :unit",
        unit=work_unit_id,
    )
    assert isinstance(value, int)
    return value


@_needs_pg
def test_reason_is_set_iff_the_verdict_is_unverifiable() -> None:
    with ephemeral_database(admin_database_url(), "wuverif01_iff") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        unit = _seed_work_unit(engine, "wuverif-iff")

        # The three legal shapes.
        _insert(engine, _row(unit))
        _insert(engine, _row(unit, verdict="refuted"))
        _insert(
            engine,
            _row(
                unit, verdict="unverifiable", unverifiable_reason="surface_unreachable"
            ),
        )
        assert _count(engine, unit) == 3

        # unverifiable with no reason.
        _refused_by(engine, _row(unit, verdict="unverifiable"), _CK_IFF)
        # survived / refuted carrying a reason.
        _refused_by(engine, _row(unit, unverifiable_reason="budget_exhausted"), _CK_IFF)
        _refused_by(
            engine,
            _row(unit, verdict="refuted", unverifiable_reason="other"),
            _CK_IFF,
        )
        assert _count(engine, unit) == 3


@_needs_pg
def test_closed_vocabularies_refuse_unknown_values() -> None:
    with ephemeral_database(admin_database_url(), "wuverif01_vocab") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        unit = _seed_work_unit(engine, "wuverif-vocab")

        _refused_by(engine, _row(unit, verdict="passed"), _CK_VERDICT)
        _refused_by(
            engine,
            _row(unit, verdict="unverifiable", unverifiable_reason="tired"),
            _CK_REASON,
        )
        _refused_by(engine, _row(unit, author_resolution="same"), _CK_AUTHOR_RESOLUTION)
        _refused_by(engine, _row(unit, selection="random"), _CK_SELECTION)
        assert _count(engine, unit) == 0


@_needs_pg
def test_idempotency_key_collides_even_with_a_null_plan_sha() -> None:
    with ephemeral_database(admin_database_url(), "wuverif01_idem") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        unit = _seed_work_unit(engine, "wuverif-idem")
        session = uuid.uuid4()

        _insert(engine, _row(unit, verifier_session_id=session))
        _refused_by(engine, _row(unit, verifier_session_id=session), _IDEMPOTENCY_INDEX)

        # The NULL-sha retry is the case NULLS NOT DISTINCT exists for.
        null_sha = {
            "verifier_session_id": session,
            "plan_content_sha256": None,
            "verdict": "unverifiable",
            "unverifiable_reason": "plan_body_unreadable",
        }
        _insert(engine, _row(unit, **null_sha))
        _refused_by(engine, _row(unit, **null_sha), _IDEMPOTENCY_INDEX)

        # A different verifier session is a different verification.
        _insert(engine, _row(unit))
        assert _count(engine, unit) == 3


@_needs_pg
def test_defaults_supersession_and_the_cascade_back_to_the_work_unit() -> None:
    with ephemeral_database(admin_database_url(), "wuverif01_fk") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        unit = _seed_work_unit(engine, "wuverif-fk")

        old = _insert(engine, _row(unit, verdict="refuted"))
        with engine.connect() as conn:
            side_effects, has_created = conn.execute(
                text(
                    f"SELECT side_effects, created_at IS NOT NULL "
                    f"FROM coord.{_TABLE} WHERE id = :id"
                ),
                {"id": old},
            ).one()
        assert (side_effects, has_created) == ({}, True)

        # A recheck supersedes the refutation; the live-refuted set empties.
        new = _insert(engine, _row(unit, selection="recheck", supersedes=old))
        with engine.begin() as conn:
            conn.execute(
                text(f"UPDATE coord.{_TABLE} SET superseded_by = :new WHERE id = :old"),
                {"new": new, "old": old},
            )
        live_refuted = scalar(
            engine,
            f"SELECT count(*) FROM coord.{_TABLE} WHERE work_unit_id = :unit "
            "AND verdict = 'refuted' AND superseded_by IS NULL",
            unit=unit,
        )
        assert live_refuted == 0

        # A dangling supersession pointer is refused.
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _insert(engine, _row(unit, supersedes=uuid.uuid4()))

        # A verification of a unit that no longer exists is not evidence.
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM coord.work_units WHERE id = :id"), {"id": unit}
            )
        assert _count(engine, unit) == 0


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    parent = _declared_parent()
    with ephemeral_database(admin_database_url(), "wuverif01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        for index in _INDEXES:
            assert index_exists(engine, index, _SCHEMA), index
        flags = scalar(
            engine,
            """
            SELECT i.indisunique::text || ',' || i.indnullsnotdistinct::text
              FROM pg_index i
              JOIN pg_class c ON c.oid = i.indexrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = :schema AND c.relname = :idx
            """,
            schema=_SCHEMA,
            idx=_IDEMPOTENCY_INDEX,
        )
        assert flags == "true,true", f"{_IDEMPOTENCY_INDEX}: {flags!r}"

        run_alembic(backend_root(), db_url, "downgrade", parent)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        for index in _INDEXES:
            assert not index_exists(engine, index, _SCHEMA), index
        assert table_exists(engine, _SCHEMA, "work_units"), (
            "downgrade() must drop its own table, never coord.work_units"
        )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
