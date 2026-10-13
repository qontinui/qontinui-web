"""Behaviour test for the ``escalation_verdicts_01`` verdict store.

``migration-reversal.yml`` only shows that the statements execute. This test
pins the contracts a reviewer cannot read off the DDL, each of which is a way
the unnecessary-escalation rate could quietly come out wrong:

1. **Shape**: the exact column set, all three indexes over the right keys
   AND the right partial predicates, the self-FK's delete action, the table
   comment, and a clean downgrade.
2. **The subject vocabulary is closed** by a CHECK, and ``verdict`` is not.
   coord closes ``verdict`` at its write boundary, because the
   ``session_close`` half has not defined its words yet.
3. **Replayability is mandatory.** A row with no ``corpus_snapshot``, a
   non-object snapshot, or a non-array ``citations`` is refused.
4. **Independence cannot be skipped by omission.** A row with no
   ``judge_agent_session_id`` is refused, and so is a row that does not say
   whether the asker was resolved (``asker_session_resolved`` has no
   default). Its column comment states the rate exclusion.
5. **Each subject has ONE linear chain.** A supersede of a missing row fails
   the self-FK. A second ROOT verdict for the same subject fails
   ``uq_escalation_verdicts_subject_root``. A second supersede of the same row
   fails ``uq_escalation_verdicts_supersedes``. Together these mean "the latest
   verdict for a subject" can never fork.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres. The test is skipped when no Postgres is reachable.
"""

from __future__ import annotations

import json
import re
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    declared_parent_revision_id,
    ephemeral_database,
    index_exists,
    run_alembic,
    table_exists,
)

_REVISION_ID = "escalation_verdicts_01"
_REVISION_FILENAME = "escalation_verdicts_01_escalation_verdicts.py"
_TABLE = "escalation_verdicts"


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` instead of pinning it.

    ``alembic-graph-pr.yml`` re-points ``down_revision`` whenever another
    revision lands first, so a hard-coded parent would go stale.
    """
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    return declared_parent_revision_id(source, _REVISION_FILENAME)


_PARENT_REVISION_ID = _parent_revision_id()

_EXPECTED_COLUMNS: dict[str, tuple[str, str]] = {
    "id": ("uuid", "NO"),
    "tenant_id": ("uuid", "NO"),
    "subject_kind": ("text", "NO"),
    "subject_id": ("uuid", "NO"),
    "verdict": ("text", "NO"),
    "citations": ("jsonb", "NO"),
    "corpus_snapshot": ("jsonb", "NO"),
    "facets": ("jsonb", "YES"),
    "judge_agent_session_id": ("uuid", "NO"),
    "asker_session_resolved": ("boolean", "NO"),
    "judge_model": ("text", "NO"),
    "brief_version": ("text", "NO"),
    "judged_at": ("timestamp with time zone", "NO"),
    "supersedes": ("uuid", "YES"),
}

# index name -> (key columns, partial predicate or None). The predicate is
# load-bearing: an index with the right name and keys but no WHERE would either
# forbid every re-judge (root index) or every root (supersedes index).
_EXPECTED_INDEXES: dict[str, tuple[tuple[str, ...], str | None]] = {
    "ix_escalation_verdicts_tenant_subject": (
        ("tenant_id", "subject_kind", "subject_id", "judged_at"),
        None,
    ),
    "uq_escalation_verdicts_supersedes": (
        ("supersedes",),
        "(supersedes IS NOT NULL)",
    ),
    "uq_escalation_verdicts_subject_root": (
        ("tenant_id", "subject_kind", "subject_id"),
        "(supersedes IS NULL)",
    ),
}

_TENANT = uuid.UUID("7d1c2e40-55a3-4f0e-9b21-6a0c3e8f4d12")
_QUESTION = uuid.UUID("0e6f9a31-2b7c-4d58-8e14-5c3a7b9d2f60")
_JUDGE = uuid.UUID("a4b8c2d6-1e3f-4a5b-9c7d-8e0f1a2b3c4d")


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


def _index_shapes(
    engine: Engine,
) -> dict[str, tuple[tuple[str, ...], str | None]]:
    """``{index_name: (key columns, partial predicate)}`` from ``indexdef``."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT indexname, indexdef FROM pg_indexes
                 WHERE schemaname = 'coord' AND tablename = :table
                   AND indexname <> 'escalation_verdicts_pkey'
                """
            ),
            {"table": _TABLE},
        ).all()
    parsed: dict[str, tuple[tuple[str, ...], str | None]] = {}
    for name, indexdef in rows:
        match = re.search(r"USING btree \(([^)]*)\)(?: WHERE (.+))?$", indexdef)
        assert match, f"unexpected index definition for {name}: {indexdef}"
        columns = tuple(col.strip() for col in match.group(1).split(","))
        parsed[name] = (columns, match.group(2))
    return parsed


def _insert(
    engine: Engine,
    *,
    subject_kind: str = "question",
    verdict: str = "not_answerable",
    citations: object | None = None,
    corpus_snapshot: object | None = None,
    judge: uuid.UUID | None = _JUDGE,
    asker_resolved: bool | None = True,
    supersedes: uuid.UUID | None = None,
    subject: uuid.UUID = _QUESTION,
) -> uuid.UUID:
    """Insert one verdict and return its id. Raises on a refused row."""
    snapshot = (
        {"policy/escalation-bar": 4} if corpus_snapshot is None else corpus_snapshot
    )
    with engine.begin() as conn:
        return conn.execute(
            text(
                """
                INSERT INTO coord.escalation_verdicts
                    (tenant_id, subject_kind, subject_id, verdict, citations,
                     corpus_snapshot, judge_agent_session_id,
                     asker_session_resolved, judge_model, brief_version,
                     supersedes)
                VALUES (:tid, :kind, :sid, :verdict,
                        CAST(:citations AS jsonb), CAST(:snapshot AS jsonb),
                        :judge, :asker_resolved, 'test-model', 'v1',
                        :supersedes)
                RETURNING id
                """
            ),
            {
                "tid": _TENANT,
                "kind": subject_kind,
                "sid": subject,
                "verdict": verdict,
                "citations": json.dumps([] if citations is None else citations),
                "snapshot": json.dumps(snapshot),
                "judge": judge,
                "asker_resolved": asker_resolved,
                "supersedes": supersedes,
            },
        ).scalar_one()


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_escalation_verdicts_01_is_append_only_replayable_and_linear() -> None:
    """Shape, the closed subject set, mandatory replay inputs, linear supersede."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "escverdict01_test") as (
        engine,
        url,
    ):
        # 1. Parent revision: the store does not exist yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _TABLE), (
            "the store must be created by this revision, not an earlier one"
        )

        # 2. Apply: exact columns, indexes over the right keys.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", _TABLE)
        assert _columns(engine) == _EXPECTED_COLUMNS
        assert _index_shapes(engine) == _EXPECTED_INDEXES
        with engine.connect() as conn:
            delete_action = conn.execute(
                text(
                    """
                    SELECT confdeltype::text FROM pg_constraint
                     WHERE conname = 'fk_escalation_verdicts_supersedes'
                    """
                )
            ).scalar_one()
            comment = conn.execute(
                text("SELECT obj_description('coord.escalation_verdicts'::regclass)")
            ).scalar_one()
        assert delete_action == "a", "the self-FK must be ON DELETE NO ACTION"
        assert comment and "Append-only" in comment
        resolved_info = column_info(engine, _TABLE, "asker_session_resolved")
        assert resolved_info is not None and resolved_info[2] is None, (
            "asker_session_resolved must have no default: a writer must say it"
        )
        with engine.connect() as conn:
            resolved_comment = conn.execute(
                text(
                    """
                    SELECT col_description('coord.escalation_verdicts'::regclass,
                                           a.attnum)
                      FROM pg_attribute a
                     WHERE a.attrelid = 'coord.escalation_verdicts'::regclass
                       AND a.attname = 'asker_session_resolved'
                    """
                )
            ).scalar_one()
        assert resolved_comment and "EXCLUDED" in resolved_comment
        judged_at = column_info(engine, _TABLE, "judged_at")
        assert judged_at is not None and judged_at[2] == "now()"
        citations_default = column_info(engine, _TABLE, "citations")
        assert citations_default is not None and citations_default[2] == "'[]'::jsonb"

        # 3. A well-formed question verdict lands, with facets NULL.
        first = _insert(
            engine,
            verdict="answerable_from_corpus",
            citations=[
                {
                    "kind": "policy",
                    "name": "escalation-bar",
                    "version": 4,
                    "quote": "closed list",
                }
            ],
        )
        with engine.connect() as conn:
            facets = conn.execute(
                text("SELECT facets FROM coord.escalation_verdicts WHERE id = :id"),
                {"id": first},
            ).scalar_one()
        assert facets is None

        # An unresolved-asker verdict is recordable; the flag says so.
        _insert(engine, asker_resolved=False, subject=uuid.uuid4())

        # `verdict` carries no CHECK: coord closes it at the write boundary.
        _insert(engine, verdict="a_word_coord_would_refuse", subject=uuid.uuid4())

        # 4. Refusals the database itself enforces. Each uses a FRESH subject,
        #    so the root index cannot be what refuses it.
        refused_rows: list[dict[str, object]] = [
            {"subject_kind": "session"},  # outside the closed subject set
            {"citations": {"kind": "policy"}},  # not an array
            {"corpus_snapshot": ["policy/escalation-bar"]},  # not an object
            {"judge": None},  # independence cannot be checked
            {"asker_resolved": None},  # must say whether the asker was resolved
        ]
        for overrides in refused_rows:
            with pytest.raises(IntegrityError):
                _insert(engine, subject=uuid.uuid4(), **overrides)  # type: ignore[arg-type]

        # 5a. A second ROOT for the same subject is refused: a re-judge must
        #     supersede, not start a parallel chain.
        with pytest.raises(IntegrityError) as two_roots:
            _insert(engine, verdict="not_answerable")
        assert "uq_escalation_verdicts_subject_root" in str(two_roots.value)
        # The same subject in another kind is a different subject.
        _insert(engine, subject_kind="session_close")

        # 5b. The supersede chain: a missing target is refused by the self-FK,
        #     one re-judge lands, and a SECOND re-judge of the same row is
        #     refused by the supersedes index.
        with pytest.raises(IntegrityError):
            _insert(engine, supersedes=uuid.UUID(int=1))
        rejudge = _insert(engine, verdict="not_answerable", supersedes=first)
        with pytest.raises(IntegrityError) as double_supersede:
            _insert(engine, verdict="unknown", supersedes=first)
        assert "uq_escalation_verdicts_supersedes" in str(double_supersede.value)
        # Chaining onward from the newest row is fine: the chain stays linear.
        _insert(engine, verdict="unknown", supersedes=rejudge)

        # 6. Downgrade: table and indexes gone.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _TABLE)
        for name in _EXPECTED_INDEXES:
            assert not index_exists(engine, name), f"index {name} survived downgrade"
