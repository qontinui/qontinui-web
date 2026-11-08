"""Schema + round-trip test for the ``coord_test_selection_01`` revision.

Phase 4 of plan ``2026-11-07-a-selected-green-is-its-own-verdict`` creates
``coord.test_selection_decisions``, the table coord writes one typed verdict per
check run into (Definition 27: FULL, SELECTED, RED, NOT-A-VERDICT). The contract
a passing ``upgrade`` does not show:

1. **Names, types and nullability are a cross-repo interface.** coord's ingest
   writes these columns and its readers degrade on 42703, so a misspelled column
   is indistinguishable from one that has not shipped.
2. **Every CHECK vocabulary refuses near-misses** (``full``, ``PASS``, ``''``)
   at the NAMED constraint, so a writer bug fails loudly rather than storing a
   word no reader matches.
3. **ingest_state is source-coupled and mode follows it** -- a ``ci_annotation``
   row always carries an ingest state and carries a mode only when ingested, so an
   absent or pending manifest never reads as a typed verdict; a ``coord_selector``
   shadow row carries a mode and NO ingest state, so it never claims an ingest.
4. **The partial UNIQUE is the ingest's conflict target**: it refuses a
   duplicate ``(repo, check_run_id)`` and admits two NULL check_run_ids (a
   ``coord_selector`` row carries none).
5. **Every column carries its COMMENT**, read back from the database.
6. **Up -> down -> up** leaves nothing behind.

Substrate comes from ``_alembic_harness``; a skip proves nothing -- point
``DATABASE_URL`` (which ``_alembic_harness.admin_database_url`` reads) at a live
pgvector instance. The row tests share ONE upgraded database; only the round
trip builds its own.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    comment_body_from_source,
    declared_parent_revision_id,
    ephemeral_database,
    index_exists,
    run_alembic,
    table_exists,
    upgrade_execute_calls,
)

_REVISION_ID = "coord_test_selection_01"
_PARENT_REVISION_ID = "coord_test_result_runs_01"
_REVISION_FILENAME = "coord_test_selection_01_decisions.py"
_TABLE = "test_selection_decisions"

# (column, information_schema.data_type, is_nullable, has_default)
_EXPECTED: tuple[tuple[str, str, str, bool], ...] = (
    ("id", "bigint", "NO", False),
    ("tenant_id", "uuid", "NO", False),
    ("repo", "text", "NO", False),
    ("source", "text", "NO", False),
    ("check_run_id", "bigint", "YES", False),
    ("workflow_run_id", "bigint", "YES", False),
    ("run_attempt", "integer", "YES", False),
    ("job", "text", "NO", False),
    ("head_sha", "text", "NO", False),
    ("base_sha", "text", "YES", False),
    ("tested_sha", "text", "YES", False),
    ("ref_class", "text", "YES", False),
    ("proposal_id", "uuid", "YES", False),
    ("proposal_attempt", "integer", "YES", False),
    ("map_ref", "text", "YES", False),
    ("map_digest", "text", "YES", False),
    ("map_age_lands", "integer", "YES", False),
    ("selector_version", "text", "YES", False),
    ("pinned_digest", "text", "YES", False),
    ("latch_state", "text", "YES", False),
    ("risk_digest", "text", "YES", False),
    ("ladder_index", "integer", "YES", False),
    ("audit_propensity", "double precision", "YES", False),
    ("audit_draw", "double precision", "YES", False),
    ("audit_commitment", "text", "YES", False),
    ("ingest_state", "text", "YES", False),
    ("mode", "text", "YES", False),
    ("unit", "text", "YES", False),
    ("reasons", "ARRAY", "NO", True),
    ("fallback_reason", "text", "YES", False),
    ("selected_count", "integer", "YES", False),
    ("universe_count", "integer", "YES", False),
    ("expected_count", "integer", "YES", False),
    ("executed_count", "integer", "YES", False),
    ("selected_digest", "text", "YES", False),
    ("deferred_digest", "text", "YES", False),
    ("expected_digest", "text", "YES", False),
    ("executed_digest", "text", "YES", False),
    ("input_digest", "text", "YES", False),
    ("shard", "text", "YES", False),
    ("decided_at", "timestamp with time zone", "NO", False),
    ("ingested_at", "timestamp with time zone", "NO", True),
)

_INDEXES = (
    "uq_test_selection_decisions_repo_check_run",
    "idx_test_selection_decisions_repo_head",
    "idx_test_selection_decisions_tenant_decided",
)

_CREATE_INDEX = re.compile(r"\bCREATE\s+(UNIQUE\s+)?INDEX\b", re.IGNORECASE)

_SHA = "a" * 40
_DIGEST = "b" * 64
_TENANT = "c231d9da-0ca8-4fe4-bd81-0e3d6c20339a"


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _expected_comment(column: str) -> str:
    return comment_body_from_source(_revision_source(), f"coord.{_TABLE}.{column}")


# ---------------------------------------------------------------------------
# Guards -- no database, so these never skip.
# ---------------------------------------------------------------------------


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    declared = declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)
    assert declared == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision={declared!r} but this test "
        f"pins {_PARENT_REVISION_ID!r}; re-point both together"
    )


def test_every_column_carries_a_comment_in_the_revision() -> None:
    for name, *_ in _EXPECTED:
        assert _expected_comment(name), f"coord.{_TABLE}.{name} has no COMMENT"


def test_the_mode_comment_states_what_a_selected_green_may_not_do() -> None:
    body = _expected_comment("mode")
    assert "SELECTED green never attests" in body
    assert "NOT-A-VERDICT is neither green nor red" in body
    assert "ingest_state is ingested" in body
    assert "coord_selector" in body


def test_indexes_are_built_concurrently_in_an_autocommit_block() -> None:
    calls = upgrade_execute_calls(_revision_path())
    assert all(c.sql is not None for c in calls), (
        "every upgrade op.execute must be ONE static string literal "
        "(coord's migration classifier cannot read a computed statement)"
    )
    # `CREATE [UNIQUE] INDEX`, not a bare "INDEX" substring: the CREATE TABLE and
    # ladder_index's COMMENT both contain that word without building an index.
    index_calls = [c for c in calls if _CREATE_INDEX.search(c.sql or "")]
    assert len(index_calls) == len(_INDEXES)
    for c in index_calls:
        assert c.in_autocommit_block, c.sql
        assert "CONCURRENTLY" in (c.sql or "").upper(), c.sql


# ---------------------------------------------------------------------------
# Live-schema walks.
# ---------------------------------------------------------------------------


def _columns(engine: Engine) -> dict[str, tuple[str, str, object]]:
    sql = text(
        """
        SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
         WHERE table_schema = 'coord' AND table_name = :t
        """
    )
    with engine.connect() as conn:
        rows = conn.execute(sql, {"t": _TABLE}).fetchall()
    return {r[0]: (r[1], r[2], r[3]) for r in rows}


def _row(**overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "tenant_id": _TENANT,
        "repo": "qontinui/qontinui-claude-config",
        "source": "ci_annotation",
        "check_run_id": 128171737943,
        "job": "frontmatter (1)",
        "head_sha": _SHA,
        "ref_class": "pr_merge_ref",
        "ingest_state": "ingested",
        "mode": "SELECTED",
        "unit": "suite",
        "selected_count": 119,
        "universe_count": 265,
        "expected_count": 10,
        "executed_count": 10,
        "selected_digest": _DIGEST,
        "deferred_digest": _DIGEST,
        "expected_digest": _DIGEST,
        "executed_digest": _DIGEST,
        "decided_at": "2026-11-07T00:00:00Z",
    }
    row.update(overrides)
    return row


def _shadow(**overrides: object) -> dict[str, object]:
    """A ``coord_selector`` shadow row: a mode, no ingest state, no check run."""
    return _row(
        **{"source": "coord_selector", "check_run_id": None, "ingest_state": None}
        | overrides
    )


def _insert(engine: Engine, row: dict[str, object]) -> None:
    cols = ", ".join(row)
    vals = ", ".join(f":{k}" for k in row)
    with engine.begin() as conn:
        conn.execute(text(f"INSERT INTO coord.{_TABLE} ({cols}) VALUES ({vals})"), row)


def _refused_at(engine: Engine, row: dict[str, object], constraint: str) -> None:
    """Insert, require an IntegrityError, and require it at EXACTLY ``constraint``.

    Equality on ``diag.constraint_name``, not a substring of the message:
    ``ck_test_selection_decisions_mode`` is a prefix of ``..._mode_iff_verdict``
    and ``..._ingest_state`` of ``..._ingest_state_iff_annotation``.
    """
    with pytest.raises(IntegrityError) as excinfo:
        _insert(engine, row)
    diag = getattr(excinfo.value.orig, "diag", None)
    got = getattr(diag, "constraint_name", None)
    assert got == constraint, f"refused at {got!r}, expected {constraint!r}"


def _scalar(engine: Engine, sql: str, **params: object) -> object:
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar_one()


def _admin_url_or_skip() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no test Postgres reachable at {url}")
    return url


@pytest.fixture(scope="module")
def decisions_db() -> Iterator[Engine]:
    """One ephemeral database upgraded to the revision, shared by the row tests.

    Each test uses its own ``check_run_id`` range, so rows never collide.
    """
    url = _admin_url_or_skip()
    with ephemeral_database(url, "coord_test_selection_01") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        yield engine


def test_the_column_contract_comments_and_indexes(decisions_db: Engine) -> None:
    engine = decisions_db
    cols = _columns(engine)
    expected_names = {name for name, *_ in _EXPECTED}
    assert set(cols) == expected_names, (
        f"column set drifted: extra {set(cols) - expected_names}, "
        f"missing {expected_names - set(cols)}"
    )
    for name, data_type, nullable, has_default in _EXPECTED:
        got_type, got_nullable, got_default = cols[name]
        assert got_type == data_type, f"{name} is {got_type}, expected {data_type}"
        assert got_nullable == nullable, f"{name} nullable={got_nullable}"
        if name != "id":
            assert (got_default is not None) == has_default, (name, got_default)
        assert column_comment(engine, _TABLE, name) == _expected_comment(name), name
    assert "'{}'::text[]" in str(cols["reasons"][2]), cols["reasons"]
    assert "now()" in str(cols["ingested_at"][2]), cols["ingested_at"]

    identity = _scalar(
        engine,
        "SELECT is_identity || '/' || identity_generation "
        "FROM information_schema.columns "
        "WHERE table_schema = 'coord' AND table_name = :t AND column_name = 'id'",
        t=_TABLE,
    )
    assert identity == "YES/ALWAYS", identity
    pk = _scalar(
        engine,
        "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
        "WHERE conrelid = to_regclass('coord.test_selection_decisions') "
        "AND contype = 'p'",
    )
    assert pk == "PRIMARY KEY (id)", pk

    table_comment = _scalar(
        engine, "SELECT obj_description(to_regclass('coord.test_selection_decisions'))"
    )
    assert table_comment == comment_body_from_source(
        _revision_source(), f"coord.{_TABLE}", object_kind="TABLE"
    )

    for index in _INDEXES:
        assert index_exists(engine, index), f"missing index {index}"
    defs = {
        name: str(
            _scalar(
                engine,
                "SELECT indexdef FROM pg_indexes "
                "WHERE schemaname = 'coord' AND indexname = :n",
                n=name,
            )
        )
        for name in _INDEXES
    }
    unique = defs["uq_test_selection_decisions_repo_check_run"]
    assert "CREATE UNIQUE INDEX" in unique, unique
    assert "(repo, check_run_id)" in unique, unique
    assert "WHERE (check_run_id IS NOT NULL)" in unique, unique
    head = defs["idx_test_selection_decisions_repo_head"]
    assert "UNIQUE" not in head and "(repo, head_sha)" in head, head
    decided = defs["idx_test_selection_decisions_tenant_decided"]
    assert "(tenant_id, decided_at DESC)" in decided, decided


@pytest.mark.parametrize(
    ("column", "accepted", "constraint", "base"),
    [
        (
            "source",
            ["ci_annotation", "coord_selector"],
            "ck_test_selection_decisions_source",
            1000,
        ),
        (
            "mode",
            ["FULL", "SELECTED", "NOT-A-VERDICT"],
            "ck_test_selection_decisions_mode",
            1100,
        ),
        ("unit", ["test", "suite", "block"], "ck_test_selection_decisions_unit", 1200),
        (
            "ref_class",
            ["pr_merge_ref", "candidate", "main_push", "schedule", "dispatch", "other"],
            "ck_test_selection_decisions_ref_class",
            1300,
        ),
    ],
)
def test_each_vocabulary_accepts_its_words_and_refuses_near_misses(
    decisions_db: Engine, column: str, accepted: list[str], constraint: str, base: int
) -> None:
    engine = decisions_db
    for i, word in enumerate(accepted):
        if column == "source" and word == "coord_selector":
            _insert(engine, _shadow())
        else:
            _insert(engine, _row(**{column: word, "check_run_id": base + i}))
    for i, bad in enumerate(["full", "PASS", ""]):
        # A bad `source` satisfies neither coupling arm, so it carries no ingest
        # state and no mode -- otherwise PostgreSQL (which tests CHECKs in name
        # order) would name a coupling constraint before the vocabulary one.
        extra = {"ingest_state": None, "mode": None} if column == "source" else {}
        row = _row(**{column: bad, "check_run_id": base + 50 + i, **extra})
        _refused_at(engine, row, constraint)


def test_ingest_state_vocabulary_and_the_mode_coupling(decisions_db: Engine) -> None:
    engine = decisions_db
    _insert(engine, _row(ingest_state="ingested", mode="FULL", check_run_id=3000))
    for i, state in enumerate(["pending", "absent", "rejected"]):
        _insert(engine, _row(ingest_state=state, mode=None, check_run_id=3001 + i))
    for i, bad in enumerate(["full", "PASS", ""]):
        _refused_at(
            engine,
            _row(ingest_state=bad, mode=None, check_run_id=3100 + i),
            "ck_test_selection_decisions_ingest_state",
        )
    _refused_at(
        engine,
        _row(ingest_state="ingested", mode=None, check_run_id=3200),
        "ck_test_selection_decisions_mode_iff_verdict",
    )
    _refused_at(
        engine,
        _row(ingest_state="absent", mode="FULL", check_run_id=3201),
        "ck_test_selection_decisions_mode_iff_verdict",
    )
    # mode NULL too, so ONLY the annotation coupling can refuse this row.
    _refused_at(
        engine,
        _row(ingest_state=None, mode=None, check_run_id=3202),
        "ck_test_selection_decisions_ingest_state_iff_annotation",
    )


def test_a_shadow_row_carries_a_mode_and_claims_no_ingest(decisions_db: Engine) -> None:
    engine = decisions_db
    _insert(engine, _shadow(mode="SELECTED"))
    for state in ["ingested", "absent"]:
        _refused_at(
            engine,
            _shadow(ingest_state=state, mode="SELECTED"),
            "ck_test_selection_decisions_ingest_state_iff_annotation",
        )
    _refused_at(
        engine, _shadow(mode=None), "ck_test_selection_decisions_mode_iff_verdict"
    )


_SHAPE_CASES: list[tuple[dict[str, object], str]] = [
    ({"selected_count": 266}, "ck_test_selection_decisions_selected_le_universe"),
    ({"executed_count": -1}, "ck_test_selection_decisions_counts_nonnegative"),
    (
        {"universe_count": -1, "selected_count": -2},
        "ck_test_selection_decisions_counts_nonnegative",
    ),
    ({"executed_digest": "B" * 64}, "ck_test_selection_decisions_digests"),
    ({"selected_digest": "b" * 63}, "ck_test_selection_decisions_digests"),
    ({"deferred_digest": ""}, "ck_test_selection_decisions_digests"),
    ({"expected_digest": "g" * 64}, "ck_test_selection_decisions_digests"),
    ({"input_digest": "b" * 65}, "ck_test_selection_decisions_digests"),
    ({"head_sha": "abc"}, "ck_test_selection_decisions_shas"),
    ({"base_sha": "A" * 40}, "ck_test_selection_decisions_shas"),
    ({"tested_sha": "a" * 41}, "ck_test_selection_decisions_shas"),
    ({"audit_draw": 1.0}, "ck_test_selection_decisions_audit_draw"),
    ({"audit_draw": -0.1}, "ck_test_selection_decisions_audit_draw"),
    ({"audit_propensity": 1.5}, "ck_test_selection_decisions_audit_propensity"),
    ({"audit_propensity": -0.1}, "ck_test_selection_decisions_audit_propensity"),
]


@pytest.mark.parametrize(
    ("overrides", "constraint", "check_run_id"),
    [(o, c, 4000 + i) for i, (o, c) in enumerate(_SHAPE_CASES)],
)
def test_counts_digests_shas_and_audit_ranges_are_checked(
    decisions_db: Engine,
    overrides: dict[str, object],
    constraint: str,
    check_run_id: int,
) -> None:
    _refused_at(decisions_db, _row(**overrides, check_run_id=check_run_id), constraint)


def test_the_boundary_values_are_admitted(decisions_db: Engine) -> None:
    _insert(
        decisions_db,
        _row(
            audit_propensity=1.0,
            audit_draw=0.0,
            selected_count=265,
            base_sha="b" * 40,
            tested_sha="c" * 40,
            input_digest="0" * 64,
            check_run_id=4999,
        ),
    )


def test_the_partial_unique_is_the_ingest_conflict_target(decisions_db: Engine) -> None:
    engine = decisions_db
    _insert(engine, _row(check_run_id=5000))
    _refused_at(
        engine, _row(check_run_id=5000), "uq_test_selection_decisions_repo_check_run"
    )
    before = _scalar(
        engine, f"SELECT count(*) FROM coord.{_TABLE} WHERE check_run_id IS NULL"
    )
    _insert(engine, _shadow())
    _insert(engine, _shadow())
    after = _scalar(
        engine, f"SELECT count(*) FROM coord.{_TABLE} WHERE check_run_id IS NULL"
    )
    assert int(str(after)) == int(str(before)) + 2
    with engine.begin() as conn:
        conn.execute(
            text(
                f"""
                INSERT INTO coord.{_TABLE}
                    (tenant_id, repo, source, check_run_id, job, head_sha,
                     ingest_state, decided_at)
                VALUES (:t, 'qontinui/qontinui-claude-config', 'ci_annotation',
                        5000, 'frontmatter (1)', :sha, 'pending', now())
                ON CONFLICT (repo, check_run_id) WHERE check_run_id IS NOT NULL
                DO UPDATE SET ingest_state = EXCLUDED.ingest_state, mode = NULL
                """
            ),
            {"t": _TENANT, "sha": _SHA},
        )
        got = conn.execute(
            text(
                f"SELECT ingest_state, mode FROM coord.{_TABLE} "
                "WHERE check_run_id = 5000"
            )
        ).fetchall()
    assert [tuple(r) for r in got] == [("pending", None)], got


def test_downgrade_then_reupgrade() -> None:
    url = _admin_url_or_skip()
    with ephemeral_database(url, "coord_test_selection_01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", _TABLE)
        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _TABLE)
        for index in _INDEXES:
            assert not index_exists(engine, index), f"{index} survived the downgrade"
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", _TABLE)
        for index in _INDEXES:
            assert index_exists(engine, index), f"{index} missing after re-upgrade"
        _insert(engine, _row(check_run_id=6000))
