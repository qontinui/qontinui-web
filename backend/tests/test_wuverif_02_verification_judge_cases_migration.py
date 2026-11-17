"""Structural and round-trip test for alembic ``wuverif_02``.

``coord.verification_judge_cases`` is the store coord's label door writes and
its judge-agreement metric reads, so the properties that metric rests on are
pinned here rather than in prose:

* ``verification_id`` is NULL **iff** the row is ``seeded`` — both directions
  of the table CHECK are driven (a seeded row naming a verdict is refused; an
  operator/consequence row naming none is refused);
* ``seed_class`` is refused on a non-seeded row;
* the closed vocabularies (``label_source``, ``truth``, ``verifier_verdict``)
  refuse an unknown value;
* the partial unique index refuses a second label of the same verdict from the
  same source, while leaving seeded rows (no ``verification_id``) unbounded;
* the ``ON DELETE CASCADE`` back to ``coord.work_unit_verifications``;
* up -> down -> up leaves no residue, and ``downgrade`` drops only this table;
* re-executing ``upgrade()`` over an already-applied schema (stamp back to the
  parent, upgrade again) errors on nothing and changes no row, index or CHECK;
* the chain still has exactly one head.

**The parent revision is READ from the revision, never pinned** (the
``wuverif_01`` / ``phaseatt_01`` convention): ``down_revision`` is re-pointed
at the merged head at land time, and a pinned copy here would go stale on the
first re-chain.

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
from alembic.config import Config
from alembic.script import ScriptDirectory
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

_REVISION_ID = "wuverif_02"
_REVISION_FILENAME = "wuverif_02_verification_judge_cases.py"

_SCHEMA = "coord"
_TABLE = "verification_judge_cases"
_UNIQUE_INDEX = "uq_verification_judge_cases_verification_source"
_INDEXES = (
    _UNIQUE_INDEX,
    "idx_verification_judge_cases_tenant_source_created",
)
_CK_SEEDED_IFF = "verification_judge_cases_seeded_iff_no_verification_check"
_CK_SEED_CLASS = "verification_judge_cases_seed_class_only_seeded_check"
_CK_LABEL_SOURCE = "verification_judge_cases_label_source_check"
_CK_TRUTH = "verification_judge_cases_truth_check"
_CK_VERDICT = "verification_judge_cases_verifier_verdict_check"
_ALL_CHECKS = (
    _CK_SEEDED_IFF,
    _CK_SEED_CLASS,
    _CK_LABEL_SOURCE,
    _CK_TRUTH,
    _CK_VERDICT,
)

_TENANT = uuid.UUID("00000000-0000-4000-8000-000000000002")

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


def test_the_chain_has_one_head_and_this_revision_is_on_it() -> None:
    """One head, and walking down from it reaches this revision.

    Asserting the head IS this revision would break the day a later revision
    lands on top; asserting it is an ANCESTOR of the one head stays true and
    still catches a fork (two heads) or an orphaned revision (not reachable).
    """
    config = Config(str(backend_root() / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root() / "alembic"))
    script = ScriptDirectory.from_config(config)
    heads = script.get_heads()
    assert len(heads) == 1, f"alembic has {len(heads)} heads: {sorted(heads)}"
    walked = [rev.revision for rev in script.walk_revisions("base", heads[0])]
    assert _REVISION_ID in walked, (
        f"{_REVISION_ID} is not an ancestor of the single head {heads[0]}"
    )
    revision = script.get_revision(_REVISION_ID)
    assert revision is not None
    assert revision.down_revision == _declared_parent()


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------


def _seed_verification(engine: Engine, slug: str) -> tuple[uuid.UUID, uuid.UUID]:
    """A shipped work unit and one ``survived`` verdict on it: (unit, verdict)."""
    with engine.begin() as conn:
        unit = conn.execute(
            text(
                "INSERT INTO coord.work_units (slug, tenant_id, status, title) "
                "VALUES (:slug, :tenant, 'shipped', :title) RETURNING id"
            ),
            {"slug": slug, "tenant": _TENANT, "title": slug},
        ).scalar_one()
        verdict = conn.execute(
            text(
                "INSERT INTO coord.work_unit_verifications ("
                "tenant_id, work_unit_id, verdict, criteria, verified_against, "
                "independence, verifier_session_id, author_sessions, "
                "author_resolution, selection, effective_rate_bp"
                ") VALUES ("
                ":tenant, :unit, 'survived', CAST('[]' AS JSONB), "
                "CAST('{}' AS JSONB), CAST('{}' AS JSONB), :session, "
                "CAST(:authors AS UUID[]), 'disjoint', 'sampled', 500"
                ") RETURNING id"
            ),
            {
                "tenant": _TENANT,
                "unit": unit,
                "session": uuid.uuid4(),
                "authors": [uuid.uuid4()],
            },
        ).scalar_one()
    assert isinstance(unit, uuid.UUID) and isinstance(verdict, uuid.UUID)
    return unit, verdict


def _seeded(**overrides: object) -> dict[str, object]:
    """A complete, valid ``seeded`` row, with ``overrides`` applied on top."""
    params: dict[str, object] = {
        "tenant_id": _TENANT,
        "label_source": "seeded",
        "verification_id": None,
        "seed_class": "planted_false_claim",
        "truth": "fails",
        "verifier_verdict": "refuted",
        "verifier_criteria": None,
        "labelled_by": "agent-session-1",
    }
    params.update(overrides)
    return params


def _labelled(
    verification_id: uuid.UUID | None, **overrides: object
) -> dict[str, object]:
    """A complete, valid ``operator`` label of ``verification_id``."""
    params = _seeded(
        label_source="operator",
        verification_id=verification_id,
        seed_class=None,
        truth="holds",
        verifier_verdict="survived",
        verifier_criteria='[{"id": "c1"}]',
        labelled_by="operator-1",
    )
    params.update(overrides)
    return params


def _insert(engine: Engine, params: dict[str, object]) -> uuid.UUID:
    cols = ", ".join(params)
    binds = ", ".join(
        f"CAST(:{k} AS JSONB)" if k == "verifier_criteria" else f":{k}" for k in params
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


def _count(engine: Engine, labelled_by_prefix: str = "") -> int:
    """Rows of THIS test's tenant — scoped, never a store-wide count."""
    value = scalar(
        engine,
        f"SELECT count(*) FROM coord.{_TABLE} WHERE tenant_id = :tenant "
        "AND labelled_by LIKE :prefix",
        tenant=_TENANT,
        prefix=f"{labelled_by_prefix}%",
    )
    assert isinstance(value, int)
    return value


@_needs_pg
def test_verification_id_is_null_iff_the_row_is_seeded() -> None:
    with ephemeral_database(admin_database_url(), "wuverif02_iff") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _, verdict = _seed_verification(engine, "wuverif02-iff")

        # The legal shapes: a plant with no verdict, an operator label and a
        # consequence label of a real one.
        _insert(engine, _seeded())
        _insert(engine, _labelled(verdict))
        _insert(
            engine,
            _labelled(verdict, label_source="consequence", labelled_by="coord-sweep"),
        )
        assert _count(engine) == 3

        # A seeded case naming a real verdict.
        _refused_by(engine, _seeded(verification_id=verdict), _CK_SEEDED_IFF)
        # An operator / consequence label naming none.
        _refused_by(engine, _labelled(None), _CK_SEEDED_IFF)
        _refused_by(
            engine,
            _labelled(None, label_source="consequence"),
            _CK_SEEDED_IFF,
        )
        assert _count(engine) == 3


@_needs_pg
def test_seed_class_is_refused_on_a_non_seeded_row() -> None:
    with ephemeral_database(admin_database_url(), "wuverif02_seed") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _, verdict = _seed_verification(engine, "wuverif02-seed")

        _refused_by(
            engine, _labelled(verdict, seed_class="planted_false_claim"), _CK_SEED_CLASS
        )
        _refused_by(
            engine,
            _labelled(verdict, label_source="consequence", seed_class="x"),
            _CK_SEED_CLASS,
        )
        assert _count(engine) == 0


@_needs_pg
def test_closed_vocabularies_refuse_unknown_values() -> None:
    with ephemeral_database(admin_database_url(), "wuverif02_vocab") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _, verdict = _seed_verification(engine, "wuverif02-vocab")

        _refused_by(engine, _labelled(verdict, label_source="human"), _CK_LABEL_SOURCE)
        _refused_by(engine, _seeded(truth="maybe"), _CK_TRUTH)
        _refused_by(engine, _seeded(verifier_verdict="passed"), _CK_VERDICT)
        assert _count(engine) == 0


@_needs_pg
def test_one_label_per_verdict_and_source_and_seeded_rows_are_unbounded() -> None:
    with ephemeral_database(admin_database_url(), "wuverif02_uniq") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _, verdict = _seed_verification(engine, "wuverif02-uniq")

        _insert(engine, _labelled(verdict))
        # A second operator label of the same verdict, even with another truth.
        _refused_by(engine, _labelled(verdict, truth="fails"), _UNIQUE_INDEX)
        # A different source on the same verdict is a different label.
        _insert(
            engine,
            _labelled(verdict, label_source="consequence", labelled_by="coord-sweep"),
        )
        _refused_by(
            engine,
            _labelled(verdict, label_source="consequence", labelled_by="coord-again"),
            _UNIQUE_INDEX,
        )
        # Plants carry no verification_id, so any number of identical ones land.
        _insert(engine, _seeded())
        _insert(engine, _seeded())
        assert _count(engine) == 4


@_needs_pg
def test_defaults_and_the_cascade_back_to_the_verdict() -> None:
    with ephemeral_database(admin_database_url(), "wuverif02_fk") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        unit, verdict = _seed_verification(engine, "wuverif02-fk")

        label = _insert(engine, _labelled(verdict, labelled_by="op-cascade"))
        plant = _insert(engine, _seeded(labelled_by="plant-cascade"))
        with engine.connect() as conn:
            has_created = conn.execute(
                text(
                    f"SELECT created_at IS NOT NULL FROM coord.{_TABLE} WHERE id = :id"
                ),
                {"id": label},
            ).scalar_one()
        assert has_created is True

        # A label of a verdict that does not exist is refused.
        _refused_by(
            engine,
            _labelled(uuid.uuid4()),
            "verification_judge_cases_verification_id_fkey",
        )

        # Deleting the unit cascades through its verdict to the label; the
        # plant, which names no verdict, survives.
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM coord.work_units WHERE id = :id"), {"id": unit}
            )
        assert _count(engine, "op-cascade") == 0
        assert (
            scalar(
                engine,
                f"SELECT count(*) FROM coord.{_TABLE} WHERE id = :id",
                id=plant,
            )
            == 1
        )


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    parent = _declared_parent()
    with ephemeral_database(admin_database_url(), "wuverif02_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        for index in _INDEXES:
            assert index_exists(engine, index, _SCHEMA), index
        flags = scalar(
            engine,
            """
            SELECT i.indisunique::text || ',' || (i.indpred IS NOT NULL)::text
              FROM pg_index i
              JOIN pg_class c ON c.oid = i.indexrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = :schema AND c.relname = :idx
            """,
            schema=_SCHEMA,
            idx=_UNIQUE_INDEX,
        )
        assert flags == "true,true", f"{_UNIQUE_INDEX}: {flags!r}"

        run_alembic(backend_root(), db_url, "downgrade", "-1")
        assert scalar(engine, "SELECT version_num FROM alembic_version") == parent
        assert not table_exists(engine, _SCHEMA, _TABLE)
        for index in _INDEXES:
            assert not index_exists(engine, index, _SCHEMA), index
        assert table_exists(engine, _SCHEMA, "work_unit_verifications"), (
            "downgrade() must drop its own table, never coord.work_unit_verifications"
        )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)


def _check_names(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT conname FROM pg_constraint "
                "WHERE conrelid = 'coord.verification_judge_cases'::regclass "
                "AND contype = 'c'"
            )
        ).all()
    return {r[0] for r in rows}


@_needs_pg
def test_re_executing_upgrade_over_an_applied_schema_is_a_no_op() -> None:
    parent = _declared_parent()
    with ephemeral_database(admin_database_url(), "wuverif02_rerun") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _, verdict = _seed_verification(engine, "wuverif02-rerun")
        kept = _insert(engine, _labelled(verdict, truth="fails"))
        checks_before = _check_names(engine)
        assert set(_ALL_CHECKS) <= checks_before

        # Stamp back WITHOUT running downgrade(), so the next upgrade genuinely
        # re-executes this revision's upgrade() body over the live table.
        run_alembic(backend_root(), db_url, "stamp", parent)
        assert scalar(engine, "SELECT version_num FROM alembic_version") == parent
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert scalar(engine, "SELECT version_num FROM alembic_version") == _REVISION_ID

        assert _count(engine) == 1
        assert (
            scalar(engine, f"SELECT truth FROM coord.{_TABLE} WHERE id = :id", id=kept)
            == "fails"
        )
        for index in _INDEXES:
            assert index_exists(engine, index, _SCHEMA), index
        assert _check_names(engine) == checks_before
        # The CHECKs still bite after the re-run.
        _refused_by(engine, _seeded(verification_id=verdict), _CK_SEEDED_IFF)
