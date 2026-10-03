"""Behaviour test for the ``findings_dossier_cols_01`` revision.

Phase 2 of plan ``2026-10-03-dossier-query-door-filters-sort-cursor``: six
``GENERATED ALWAYS ... STORED`` columns on ``coord.findings`` plus three
partial indexes ``WHERE kind = 'dossier'``.

Asserted
========

1. Nothing this revision adds exists at the parent revision.
2. Rows seeded BEFORE the upgrade are backfilled by the table rewrite; rows
   INSERTed after it are populated too (a generation expression that can throw
   fails the INSERT, so the adversarial values go in both ways).
3. Adversarial ledger values yield NULL or the right value and never raise:
   ``abc`` / ``99999999999`` / ``-3`` / ``1.5`` recurrence, ``2025-02-29``,
   ``2026-02-30``, ``2026-13-01``, ``0000-01-01``, ``garbage``, ISO timestamps,
   ``2024-02-29``, topic-only slug, no slug at all, numeric readiness,
   string-valued ``remediations``.
4. A non-dossier row has all six columns NULL, whatever its ``artifact_refs``.
5. The three indexes exist, are VALID, are partial on ``kind = 'dossier'``, and
   a ``recent()``-style dossier read still works.
6. Re-running the upgrade body is a no-op (collision-safe); downgrade drops the
   indexes then the columns, keeps the rows, and upgrade works again.
"""

from __future__ import annotations

import datetime as dt
import json
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    index_exists,
    run_alembic,
)

_REVISION_ID = "findings_dossier_cols_01"
_PARENT_REVISION_ID = "coord_agent_sessions_context_01"

_COLUMNS = (
    "dossier_slug",
    "dossier_readiness",
    "dossier_recurrence_count",
    "dossier_first_seen",
    "dossier_last_seen",
    "dossier_has_open_remediation",
)
_INDEXES = (
    "idx_findings_dossier_readiness_last_seen",
    "idx_findings_dossier_recurrence",
    "idx_findings_dossier_slug",
)

_TENANT = uuid.UUID("00000000-0000-4000-8000-00000000d055")

# (label, kind, topic, artifact_refs) -> expected tuple of the six columns.
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
        ("a", "ready_for_pvi", 7, _D(2026, 9, 1), _D(2026, 10, 3), True),
    ),
    (
        "topic-only slug, ISO timestamp last_seen, shipped remediation",
        "dossier",
        "dossier:topic-only",
        {
            "last_seen": "2026-10-03T02:20:34.928669Z",
            "remediations": [{"plan": "p", "status": "SHIPPED 2026-09-23"}],
        },
        ("topic-only", None, None, None, _D(2026, 10, 3), False),
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
        ("s3", None, 12, _D(2024, 2, 29), None, False),
    ),
    (
        "non-leap 02-29, abc recurrence",
        "dossier",
        "dossier:s4",
        {"recurrence_count": "abc", "first_seen": "2025-02-29"},
        ("s4", None, None, None, None, None),
    ),
    (
        "overflow recurrence, Feb 30",
        "dossier",
        "dossier:s5",
        {"recurrence_count": 99999999999, "last_seen": "2026-02-30"},
        ("s5", None, None, None, None, None),
    ),
    (
        "negative / float recurrence, month 13",
        "dossier",
        "dossier:s6",
        {"recurrence_count": -3, "first_seen": "2026-13-01"},
        ("s6", None, None, None, None, None),
    ),
    (
        "float recurrence, year 0000, garbage date",
        "dossier",
        "dossier:s7",
        {"recurrence_count": 1.5, "first_seen": "0000-01-01", "last_seen": "garbage"},
        ("s7", None, None, None, None, None),
    ),
    (
        "numeric readiness, string-valued remediations",
        "dossier",
        "dossier:s8",
        {"readiness": 3, "remediations": "prose"},
        ("s8", None, None, None, None, None),
    ),
    (
        "open remediation with no status key",
        "dossier",
        "dossier:s9",
        {"remediations": [{"plan": "p"}]},
        ("s9", None, None, None, None, True),
    ),
    (
        "no slug anywhere (topic lacks the prefix)",
        "dossier",
        "classification-tripwires",
        {"readiness": "accumulating"},
        (None, "accumulating", None, None, None, None),
    ),
    (
        "null topic, empty slug ref",
        "dossier",
        None,
        {"dossier_slug": ""},
        (None, None, None, None, None, None),
    ),
    (
        "empty topic suffix is not a slug (NULLIF guard)",
        "dossier",
        "dossier:",
        {},
        (None, None, None, None, None, None),
    ),
    (
        "century leap rules: 1900-02-29 invalid, 2000-02-29 valid",
        "dossier",
        "dossier:leap",
        {"first_seen": "1900-02-29", "last_seen": "2000-02-29"},
        ("leap", None, None, None, _D(2000, 2, 29), None),
    ),
    (
        "31st of a 30-day month is invalid, 30th of April is valid",
        "dossier",
        "dossier:m30",
        {"first_seen": "2026-04-31", "last_seen": "2026-04-30"},
        ("m30", None, None, None, _D(2026, 4, 30), None),
    ),
    (
        "10-digit recurrence beyond int range stays NULL (regex is {1,9})",
        "dossier",
        "dossier:big",
        {"recurrence_count": 2147483648},
        ("big", None, None, None, None, None),
    ),
    (
        "recurrence as exponent / padded strings is NULL",
        "dossier",
        "dossier:exp",
        {"recurrence_count": "1e3", "readiness": "in_remediation"},
        ("exp", "in_remediation", None, None, None, None),
    ),
    (
        "array-valued slug ref is ignored; the topic suffix wins",
        "dossier",
        "dossier:from-topic",
        {"dossier_slug": ["a"]},
        ("from-topic", None, None, None, None, None),
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
        (None, None, None, None, None, None),
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
                    f"SELECT {', '.join(_COLUMNS)} FROM coord.findings WHERE finding_id = :f"
                ),
                {"f": str(fid)},
            ).one()
        )


def _assert_cases(engine: Engine, ids: list[uuid.UUID], phase: str) -> None:
    for case, fid in zip(_CASES, ids, strict=True):
        assert _read(engine, fid) == case[4], f"{phase}: {case[0]}"


def _indexes_valid_and_partial(engine: Engine) -> None:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT c.relname, i.indisvalid, pg_get_expr(i.indpred, i.indrelid)
                  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                 WHERE c.relname = ANY(:names)
                """
            ),
            {"names": list(_INDEXES)},
        ).all()
    assert {r[0] for r in rows} == set(_INDEXES)
    for name, valid, pred in rows:
        assert valid, f"{name} is INVALID"
        assert "dossier" in (pred or ""), f"{name} predicate: {pred!r}"


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="Postgres not reachable at the conftest URL.",
)
def test_findings_dossier_cols_01_generated_columns_and_indexes() -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "findings_dossier_cols_test") as (
        engine,
        url,
    ):
        # 1. Parent revision: nothing exists yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        for col in _COLUMNS:
            assert column_info(engine, "findings", col) is None
        for idx in _INDEXES:
            assert not index_exists(engine, idx)

        # 2a. Rows that pre-date the revision are backfilled by the rewrite.
        before = [_insert(engine, c) for c in _CASES]
        run_alembic(root, url, "upgrade", _REVISION_ID)
        for col in _COLUMNS:
            assert column_info(engine, "findings", col) is not None, col
        _assert_cases(engine, before, "backfill")

        # 2b. INSERT-time evaluation: no adversarial value may raise.
        after = [_insert(engine, c) for c in _CASES]
        _assert_cases(engine, after, "insert")

        # 4. Non-dossier rows: all six NULL (also covered by the last case).
        with engine.connect() as conn:
            assert (
                conn.execute(
                    text(
                        "SELECT count(*) FROM coord.findings WHERE kind <> 'dossier' AND ("
                        + " OR ".join(f"{c} IS NOT NULL" for c in _COLUMNS)
                        + ")"
                    )
                ).scalar()
                == 0
            )

        # 5. Indexes valid + partial; a recent()-style dossier read works.
        _indexes_valid_and_partial(engine)
        with engine.connect() as conn:
            live = len(
                conn.execute(
                    text(
                        """
                    SELECT f.finding_id FROM coord.findings f
                     WHERE (f.tenant_id = :t OR f.scope = 'fleet-infra')
                       AND f.expires_at > now()
                       AND NOT EXISTS (SELECT 1 FROM coord.findings s
                                        WHERE s.supersedes = f.finding_id)
                       AND f.kind = 'dossier'
                     ORDER BY f.created_at DESC LIMIT 100
                    """
                    ),
                    {"t": str(_TENANT)},
                ).all()
            )
            with_slug = conn.execute(
                text(
                    "SELECT count(*) FROM coord.findings "
                    "WHERE kind = 'dossier' AND dossier_slug IS NOT NULL"
                )
            ).scalar()
        n_dossier = sum(1 for c in _CASES if c[1] == "dossier")
        assert live == 2 * n_dossier
        expected_slugged = sum(
            1 for c in _CASES if c[1] == "dossier" and c[4][0] is not None
        )
        assert with_slug == 2 * expected_slugged

        # 6a. Downgrade drops indexes then columns and keeps the rows;
        #     upgrade works again afterwards.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        for col in _COLUMNS:
            assert column_info(engine, "findings", col) is None
        for idx in _INDEXES:
            assert not index_exists(engine, idx)
        with engine.connect() as conn:
            assert conn.execute(
                text("SELECT count(*) FROM coord.findings")
            ).scalar() == 2 * len(_CASES), "downgrade keeps the rows"

        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_cases(engine, before, "re-upgrade backfill")
        _indexes_valid_and_partial(engine)

        # 6b. Collision-safe: with the objects already present (stamp back to
        #     the parent, so alembic re-runs the body) AND one index INVALID
        #     (a killed CONCURRENTLY build), upgrade repairs rather than skips.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE pg_index SET indisvalid = false WHERE indexrelid = "
                    "'coord.idx_findings_dossier_slug'::regclass"
                )
            )
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _indexes_valid_and_partial(engine)
        _assert_cases(engine, before, "collision-safe rerun")
