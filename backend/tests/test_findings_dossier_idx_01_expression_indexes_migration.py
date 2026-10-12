"""Behaviour test for the ``findings_dossier_idx_01`` revision.

Phase 2 of plan ``2026-10-03-dossier-query-door-filters-sort-cursor``: three
partial EXPRESSION indexes ``WHERE kind = 'dossier'`` on ``coord.findings`` (no
new columns: coord's migration classifier rejects generated columns).

Asserted
========

1. Nothing this revision adds exists at the parent revision.
2. Every adversarial ledger value, evaluated as ``SELECT <expression>``, yields
   the right value or NULL and never raises. Rows are seeded BEFORE the upgrade
   (the index build evaluates them) and INSERTed after it (index maintenance
   evaluates them: a throwing expression would fail the write).
3. The three indexes exist, are VALID and partial on ``kind = 'dossier'``
   (exact predicate), so a non-dossier row has no index entry: a query for one
   is not planned onto any of them even with seqscan off.
4. With ``enable_seqscan = off``, an ``EXPLAIN`` of a query written with the
   same expression text uses each index. This is also what pins the migration's
   expression text to the contract: a different expression would not match.
5. Downgrade drops the three indexes and keeps the rows; upgrade works again.
6. The TRAP: an INVALID index (killed CONCURRENTLY build) is skipped by a rerun
   of the upgrade and the revision is stamped applied; dropping it alone leaves
   it missing (upgrading to this revision is a no-op). The DOCUMENTED recovery
   (detection query, drop, then stamp back to the parent or downgrade one step,
   then upgrade this revision; ``-1`` / ``head`` only while it is head) repairs it.
7. Every expression is total, including for 4000-char readiness / slug ref /
   topic suffix (NULL, not a btree size error) and object-valued refs.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    index_exists,
    run_alembic,
)

_REVISION_ID = "findings_dossier_idx_01"
_PARENT_REVISION_ID = "mdroles_01"

_INDEXES = (
    "idx_findings_dossier_readiness_last_seen",
    "idx_findings_dossier_recurrence",
    "idx_findings_dossier_slug",
)

# The expression text is the contract with the coord door (kept in sync by
# hand). These are the Phase 1 accepted expressions.
_SLUG = (
    "CASE WHEN kind = 'dossier' THEN"
    " COALESCE(CASE WHEN jsonb_typeof(artifact_refs->'dossier_slug')"
    " NOT IN ('array', 'object')"
    " AND length(artifact_refs->>'dossier_slug') <= 64"
    " THEN NULLIF(artifact_refs->>'dossier_slug', '') END,"
    " CASE WHEN left(topic, 8) = 'dossier:'"
    " AND length(substr(topic, 9)) <= 64"
    " THEN NULLIF(substr(topic, 9), '') END) END"
)
_READINESS = (
    "CASE WHEN kind = 'dossier'"
    " AND jsonb_typeof(artifact_refs->'readiness') = 'string'"
    " AND length(artifact_refs->>'readiness') <= 64"
    " THEN artifact_refs->>'readiness' END"
)
_RECURRENCE = (
    "CASE WHEN kind = 'dossier'"
    " AND (artifact_refs->>'recurrence_count') ~ '^[0-9]{1,9}$'"
    " THEN (artifact_refs->>'recurrence_count')::int END"
)


def _date_expr(key: str) -> str:
    v = f"(artifact_refs->>'{key}')"
    y, m, d = f"substr({v},1,4)::int", f"substr({v},6,2)::int", f"substr({v},9,2)::int"
    return (
        "CASE WHEN kind = 'dossier'"
        f" AND {v} ~ '^[0-9]{{4}}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])([T ].*)?$'"
        f" THEN CASE WHEN {y} >= 1 AND {d} <= CASE {m}"
        f" WHEN 2 THEN CASE WHEN ({y} % 4 = 0 AND {y} % 100 <> 0)"
        f" OR {y} % 400 = 0 THEN 29 ELSE 28 END"
        " WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30 ELSE 31 END"
        f" THEN make_date({y}, {m}, {d}) END END"
    )


_LAST_SEEN = _date_expr("last_seen")


def _incompressible(n: int) -> str:
    """Text TOAST cannot shrink below the btree entry limit (~2.7 KB)."""
    out = ""
    i = 0
    while len(out) < n:
        out += hashlib.sha256(str(i).encode()).hexdigest()
        i += 1
    return out[:n]


_BIG = _incompressible(4000)

_TENANT = uuid.UUID("00000000-0000-4000-8000-00000000d055")

# (label, kind, topic, artifact_refs) -> expected (slug, readiness,
# recurrence, last_seen).
_D = dt.date
_CASES: list[tuple[str, str, str | None, dict, tuple]] = [
    (
        "full ledger, slug in refs",
        "dossier",
        "dossier:other",
        {
            "dossier_slug": "a",
            "readiness": "ready_for_pvi",
            "recurrence_count": 7,
            "first_seen": "2026-09-01",
            "last_seen": "2026-10-03",
            "remediations": [{"plan": "p", "status": "in_progress"}],
        },
        ("a", "ready_for_pvi", 7, _D(2026, 10, 3)),
    ),
    (
        "topic-only slug, ISO timestamp last_seen, shipped remediation",
        "dossier",
        "dossier:topic-only",
        {
            "last_seen": "2026-10-03T02:20:34.928669Z",
            "remediations": [{"plan": "p", "status": "SHIPPED 2026-09-23"}],
        },
        ("topic-only", None, None, _D(2026, 10, 3)),
    ),
    (
        "string recurrence, leap day, empty remediations",
        "dossier",
        "dossier:s3",
        {
            "recurrence_count": "12",
            "first_seen": "2024-02-29",
            "remediations": [],
        },
        ("s3", None, 12, None),
    ),
    (
        "non-leap 02-29, abc recurrence",
        "dossier",
        "dossier:s4",
        {"recurrence_count": "abc", "first_seen": "2025-02-29"},
        ("s4", None, None, None),
    ),
    (
        "overflow recurrence, Feb 30",
        "dossier",
        "dossier:s5",
        {"recurrence_count": 99999999999, "last_seen": "2026-02-30"},
        ("s5", None, None, None),
    ),
    (
        "negative / float recurrence, month 13",
        "dossier",
        "dossier:s6",
        {"recurrence_count": -3, "first_seen": "2026-13-01"},
        ("s6", None, None, None),
    ),
    (
        "float recurrence, year 0000, garbage date",
        "dossier",
        "dossier:s7",
        {"recurrence_count": 1.5, "first_seen": "0000-01-01", "last_seen": "garbage"},
        ("s7", None, None, None),
    ),
    (
        "numeric readiness, string-valued remediations",
        "dossier",
        "dossier:s8",
        {"readiness": 3, "remediations": "prose"},
        ("s8", None, None, None),
    ),
    (
        "open remediation with no status key",
        "dossier",
        "dossier:s9",
        {"remediations": [{"plan": "p"}]},
        ("s9", None, None, None),
    ),
    (
        "no slug anywhere (topic lacks the prefix)",
        "dossier",
        "classification-tripwires",
        {"readiness": "accumulating"},
        (None, "accumulating", None, None),
    ),
    (
        "null topic, empty slug ref",
        "dossier",
        None,
        {"dossier_slug": ""},
        (None, None, None, None),
    ),
    (
        "empty topic suffix is not a slug (NULLIF guard)",
        "dossier",
        "dossier:",
        {},
        (None, None, None, None),
    ),
    (
        "century leap rules: 1900-02-29 invalid, 2000-02-29 valid",
        "dossier",
        "dossier:leap",
        {"first_seen": "1900-02-29", "last_seen": "2000-02-29"},
        ("leap", None, None, _D(2000, 2, 29)),
    ),
    (
        "31st of a 30-day month is invalid, 30th of April is valid",
        "dossier",
        "dossier:m30",
        {"first_seen": "2026-04-31", "last_seen": "2026-04-30"},
        ("m30", None, None, _D(2026, 4, 30)),
    ),
    (
        "31st of June / September / November is invalid, 31 December is valid",
        "dossier",
        "dossier:m31",
        {"first_seen": "2026-06-31", "last_seen": "2026-12-31"},
        ("m31", None, None, _D(2026, 12, 31)),
    ),
    (
        "31st of September is invalid",
        "dossier",
        "dossier:sep31",
        {"first_seen": "2026-09-31", "last_seen": "2026-11-31"},
        ("sep31", None, None, None),
    ),
    (
        "numeric slug ref reads as text, like the dedup predicate",
        "dossier",
        "dossier:ignored-topic",
        {"dossier_slug": 123},
        ("123", None, None, None),
    ),
    (
        "10-digit recurrence beyond int range stays NULL (regex is {1,9})",
        "dossier",
        "dossier:big",
        {"recurrence_count": 2147483648},
        ("big", None, None, None),
    ),
    (
        "recurrence as exponent / padded strings is NULL",
        "dossier",
        "dossier:exp",
        {"recurrence_count": "1e3", "readiness": "in_remediation"},
        ("exp", "in_remediation", None, None),
    ),
    (
        "array-valued slug ref is ignored; the topic suffix wins",
        "dossier",
        "dossier:from-topic",
        {"dossier_slug": ["a"]},
        ("from-topic", None, None, None),
    ),
    (
        "object-valued slug ref is ignored; the topic suffix wins",
        "dossier",
        "dossier:obj-topic",
        {"dossier_slug": {"a": 1}},
        ("obj-topic", None, None, None),
    ),
    (
        "object-valued readiness is NULL",
        "dossier",
        "dossier:objr",
        {"readiness": {"a": 1}},
        ("objr", None, None, None),
    ),
    (
        "4000-char readiness is NULL, not a btree size error",
        "dossier",
        "dossier:bigr",
        {"readiness": _BIG},
        ("bigr", None, None, None),
    ),
    (
        "4000-char slug ref with no topic is NULL",
        "dossier",
        None,
        {"dossier_slug": _BIG},
        (None, None, None, None),
    ),
    (
        "4000-char slug ref falls back to the topic suffix",
        "dossier",
        "dossier:short-topic",
        {"dossier_slug": _BIG},
        ("short-topic", None, None, None),
    ),
    (
        "2000-char topic suffix is NULL (idx_findings_topic caps topic below 4000)",
        "dossier",
        "dossier:" + _BIG[:2000],
        {},
        (None, None, None, None),
    ),
    (
        "64-char slug ref and readiness are still returned",
        "dossier",
        None,
        {"dossier_slug": "s" * 64, "readiness": "r" * 64},
        ("s" * 64, "r" * 64, None, None),
    ),
    (
        "65-char readiness is NULL, 64-char topic suffix is returned",
        "dossier",
        "dossier:" + "t" * 64,
        {"readiness": "r" * 65},
        ("t" * 64, None, None, None),
    ),
    (
        "non-dossier row with a full ledger stays all NULL",
        "investigation",
        "dossier:nope",
        {
            "dossier_slug": "nope",
            "readiness": "ready_for_pvi",
            "recurrence_count": 9,
            "first_seen": "2026-09-01",
            "last_seen": "2026-10-03",
            "remediations": [{"status": "draft"}],
        },
        (None, None, None, None),
    ),
]


def _insert(engine: Engine, case: tuple) -> uuid.UUID:
    _label, kind, topic, refs, _expected = case
    fid = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.findings
                    (finding_id, tenant_id, kind, topic, title, body,
                     artifact_refs, expires_at)
                VALUES
                    (:fid, :tenant, :kind, :topic, 'seed', 'seed',
                     CAST(:refs AS jsonb), now() + interval '14 days')
                """
            ),
            {
                "fid": str(fid),
                "tenant": str(_TENANT),
                "kind": kind,
                "topic": topic,
                "refs": json.dumps(refs),
            },
        )
    return fid


def _read(engine: Engine, fid: uuid.UUID) -> tuple:
    with engine.connect() as conn:
        return tuple(
            conn.execute(
                text(
                    f"SELECT ({_SLUG}), ({_READINESS}), ({_RECURRENCE}),"
                    f" ({_LAST_SEEN}) FROM coord.findings WHERE finding_id = :f"
                ),
                {"f": str(fid)},
            ).one()
        )


def _expected(case: tuple) -> tuple:
    return case[4]


def _assert_cases(engine: Engine, ids: list[uuid.UUID], phase: str) -> None:
    for case, fid in zip(_CASES, ids, strict=True):
        assert _read(engine, fid) == _expected(case), f"{phase}: {case[0]}"


def _index_rows(engine: Engine) -> list[tuple]:
    with engine.connect() as conn:
        return list(
            conn.execute(
                text(
                    """
                    SELECT c.relname, i.indisvalid,
                           pg_get_expr(i.indpred, i.indrelid)
                      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                     WHERE c.relname = ANY(:names)
                    """
                ),
                {"names": list(_INDEXES)},
            ).all()
        )


def _indexes_valid_and_partial(engine: Engine) -> None:
    rows = _index_rows(engine)
    assert {r[0] for r in rows} == set(_INDEXES)
    for name, valid, pred in rows:
        assert valid, f"{name} is INVALID"
        assert pred is not None and "kind = 'dossier'" in pred, (
            f"{name} predicate: {pred!r}"
        )


def _invalidate(engine: Engine, name: str) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE pg_index SET indisvalid = false "
                "WHERE indexrelid = CAST(:n AS regclass)"
            ),
            {"n": f"coord.{name}"},
        )


def _invalid_names(engine: Engine) -> list[str]:
    """The detection query documented in the revision docstring."""
    with engine.connect() as conn:
        return [
            r[0]
            for r in conn.execute(
                text(
                    "SELECT c.relname FROM pg_index i "
                    "JOIN pg_class c ON c.oid = i.indexrelid "
                    "WHERE NOT i.indisvalid AND c.relname LIKE 'idx_findings_dossier_%'"
                )
            ).all()
        ]


def _explain(engine: Engine, sql: str) -> str:
    with engine.connect() as conn:
        conn.execute(text("SET enable_seqscan = off"))
        return "\n".join(r[0] for r in conn.execute(text("EXPLAIN " + sql)).all())


def _has_index_cond(plan: str, name: str) -> bool:
    lines = plan.splitlines()
    return any(
        name in line and any("Index Cond" in n for n in lines[i + 1 : i + 3])
        for i, line in enumerate(lines)
    )


def _assert_indexes_used(engine: Engine) -> None:
    plans = {
        "idx_findings_dossier_slug": (
            f"SELECT finding_id FROM coord.findings WHERE kind = 'dossier'"
            f" AND ({_SLUG}) = 'a'"
        ),
        "idx_findings_dossier_readiness_last_seen": (
            f"SELECT finding_id FROM coord.findings WHERE kind = 'dossier'"
            f" AND ({_READINESS}) = 'accumulating'"
            f" ORDER BY ({_LAST_SEEN}) DESC, finding_id LIMIT 5"
        ),
        "idx_findings_dossier_recurrence": (
            f"SELECT finding_id FROM coord.findings WHERE kind = 'dossier'"
            f" AND ({_RECURRENCE}) >= 0"
            f" ORDER BY ({_RECURRENCE}) DESC, finding_id LIMIT 5"
        ),
    }
    for name, sql in plans.items():
        plan = _explain(engine, sql)
        assert name in plan and (
            "Index Scan" in plan or "Index Only Scan" in plan or "Bitmap Index" in plan
        ), f"{name} not used:\n{plan}"
        # The index must carry an Index Cond: a mismatched expression is still
        # scanned (the partial predicate is implied) but only as a Filter.
        assert _has_index_cond(plan, name), f"{name} has no Index Cond:\n{plan}"
        # ORDER BY must be satisfied by the index itself (no Sort node): this is
        # what pins the sort-key expression text, not just the leading key.
        assert "Sort" not in plan, f"{name} needs a Sort:\n{plan}"


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="Postgres not reachable at the conftest URL.",
)
def test_findings_dossier_idx_01_expression_indexes() -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "findings_dossier_idx_test") as (
        engine,
        url,
    ):
        # 1. Parent revision: nothing exists yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        for idx in _INDEXES:
            assert not index_exists(engine, idx)

        # 2a. Rows that pre-date the revision are evaluated by the index build.
        before = [_insert(engine, c) for c in _CASES]
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_cases(engine, before, "pre-upgrade rows")

        # 2b. INSERT-time evaluation: no adversarial value may raise.
        after = [_insert(engine, c) for c in _CASES]
        _assert_cases(engine, after, "post-upgrade inserts")

        # 3. Indexes valid + partial; non-dossier rows have no index entries.
        _indexes_valid_and_partial(engine)
        assert any(c[1] != "dossier" for c in _CASES)
        for name, _valid, pred in _index_rows(engine):
            assert pred == "(kind = 'dossier'::text)", f"{name}: {pred!r}"
        # A non-dossier row cannot be served from (so is not in) any index: the
        # partial predicate does not cover it, even with seqscan off.
        non_dossier_plan = _explain(
            engine,
            f"SELECT finding_id FROM coord.findings WHERE kind = 'investigation'"
            f" AND ({_SLUG}) = 'nope'",
        )
        assert not any(n in non_dossier_plan for n in _INDEXES), non_dossier_plan

        # 4. The same expression text is served by each index.
        _assert_indexes_used(engine)

        # 5. Downgrade drops the indexes and keeps the rows; upgrade again.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        for idx in _INDEXES:
            assert not index_exists(engine, idx)
        with engine.connect() as conn:
            assert conn.execute(
                text("SELECT count(*) FROM coord.findings")
            ).scalar() == 2 * len(_CASES), "downgrade keeps the rows"
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_cases(engine, before, "re-upgrade")
        _indexes_valid_and_partial(engine)
        _assert_indexes_used(engine)

        # 6. THE TRAP: a killed CONCURRENTLY build leaves an INVALID index; the
        #    re-run deploy skips it (IF NOT EXISTS) and stamps the revision
        #    applied. Stamp back to the parent so alembic re-runs the body, as a
        #    deploy rerun after a killed upgrade does.
        _invalidate(engine, "idx_findings_dossier_slug")
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _invalid_names(engine) == ["idx_findings_dossier_slug"], (
            "IF NOT EXISTS skips an invalid index and the revision is stamped"
        )
        #    Documented recovery: detect, drop, step the stamp back, upgrade.
        #    The drop alone does nothing: upgrading to this revision is a no-op
        #    while it is stamped.
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            conn.execute(
                text(
                    "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_findings_dossier_slug"
                )
            )
        #    Targets are pinned to this revision, not "head": once later revisions
        #    chain on top (journey_01, coord_ci_pool_observations_01, ...), "head"
        #    and "-1" address THEM, and the recovery under test never runs.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert not index_exists(engine, "idx_findings_dossier_slug"), (
            "upgrade after the drop is a no-op while the revision is stamped"
        )
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _invalid_names(engine) == []
        _indexes_valid_and_partial(engine)
        _assert_indexes_used(engine)
        _assert_cases(engine, before, "after stamp-based repair")

        #    Alternative documented step: downgrade one step instead of stamp
        #    ("downgrade -1" while this revision is head; spelled as the parent
        #    here so the step still targets this revision once it is not).
        #    TEST DB ONLY: it stops at this revision. On a real database with
        #    descendants, `downgrade mdroles_01` would also undo every later
        #    revision; use the revision's documented stamp recipe there.
        _invalidate(engine, "idx_findings_dossier_recurrence")
        assert _invalid_names(engine) == ["idx_findings_dossier_recurrence"]
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _invalid_names(engine) == []
        _indexes_valid_and_partial(engine)
        _assert_indexes_used(engine)
        _assert_cases(engine, before, "after downgrade-based repair")
