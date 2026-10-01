"""Behaviour test for the ``overlord_01_interventions`` ledger.

``migration-reversal.yml`` would only confirm the statements execute against an
empty database. The contracts pinned here are the ones coord's Rust write path
relies on and a reviewer cannot read off the DDL at a glance:

1. **Shape** — the table, its exact column contract, and all three indexes
   exist after upgrade, and are gone after downgrade.
2. **The vocabularies are enforced** — an unknown ``stop_class`` / ``verb`` /
   ``mode`` / ``outcome`` / ``operator_label`` and an out-of-range ``strike``
   are refused by the schema, not merely by coord.
3. **The chain shape is enforced** — a root row names itself
   (``intervention_id = id``, ``supersedes IS NULL``) and a successor does not;
   both wrong combinations are refused. A root and its outcome row read back as
   ONE chain through the newest-row-per-intervention read.
4. **NULL session identities are accepted** — NULL means "not proven".

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

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
    ephemeral_database,
    index_exists,
    run_alembic,
    table_exists,
)

_REVISION_ID = "overlord_01_interventions"
_REVISION_FILENAME = "overlord_01_interventions.py"


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime.

    Never hardcode the parent: the revision is re-pointed at whatever head lands
    ahead of it, and a pinned constant would make this test upgrade to a
    revision that is no longer its parent.
    """
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    match = re.search(r'^down_revision:.*=\s*"([^"]+)"', source, re.MULTILINE)
    assert match, f"{_REVISION_FILENAME} must declare a down_revision"
    return match.group(1)


_PARENT_REVISION_ID = _parent_revision_id()

_TABLE = "overlord_interventions"

_INDEXES = (
    "ix_overlord_interventions_tenant_chain",
    "ix_overlord_interventions_tenant_observed_at",
    "ix_overlord_interventions_tenant_session",
)

# The column contract shared with coord's Rust code: name -> (data_type, nullable).
_EXPECTED_COLUMNS: dict[str, tuple[str, str]] = {
    "id": ("uuid", "NO"),
    "intervention_id": ("uuid", "NO"),
    "supersedes": ("uuid", "YES"),
    "tenant_id": ("uuid", "NO"),
    "session_id": ("uuid", "YES"),
    "claude_code_session_id": ("uuid", "YES"),
    "observed_at": ("timestamp with time zone", "NO"),
    "recorded_at": ("timestamp with time zone", "NO"),
    "stop_class": ("text", "NO"),
    "strike": ("smallint", "YES"),
    "catalog_hits": ("jsonb", "NO"),
    "evidence": ("jsonb", "NO"),
    "inputs_unreadable": ("ARRAY", "NO"),
    "verb": ("text", "NO"),
    "mode": ("text", "NO"),
    "message_id": ("uuid", "YES"),
    "question_id": ("uuid", "YES"),
    "touch_key": ("text", "YES"),
    "outcome": ("text", "YES"),
    "outcome_observed_at": ("timestamp with time zone", "YES"),
    "operator_label": ("text", "YES"),
    "brief_version": ("text", "YES"),
    "judge_model": ("text", "YES"),
    "recorded_by_device_id": ("uuid", "YES"),
}

_TENANT = uuid.UUID("7e3c9a14-5b2f-4d81-9c06-2a8f1e4b7d93")
_SESSION = uuid.UUID("a41d8c27-3e95-4f0b-8b6a-9c2e7f1d5a08")

_INSERT = text(
    """
    INSERT INTO coord.overlord_interventions
        (id, intervention_id, supersedes, tenant_id, session_id,
         stop_class, strike, verb, mode, outcome, operator_label)
    VALUES (:id, :iid, :sup, :tid, :sid,
            :stop_class, :strike, :verb, :mode, :outcome, :label)
    """
)


def _row(**overrides: object) -> dict[str, object]:
    """A valid chain-root row's parameters, with ``overrides`` applied."""
    rid = uuid.uuid4()
    params: dict[str, object] = {
        "id": rid,
        "iid": rid,
        "sup": None,
        "tid": _TENANT,
        "sid": None,
        "stop_class": "A",
        "strike": 1,
        "verb": "nudge",
        "mode": "shadow",
        "outcome": None,
        "label": None,
    }
    params.update(overrides)
    return params


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


def _refused(engine: Engine, params: dict[str, object]) -> None:
    with pytest.raises(IntegrityError):
        with engine.begin() as conn:
            conn.execute(_INSERT, params)


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_overlord_01_creates_the_ledger_and_enforces_vocabulary_and_chain() -> None:
    """Shape, enforced vocabularies, enforced chain shape, and reversal."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "overlord01_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — the ledger does not exist yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _TABLE), (
            "the ledger must be created by this revision, not an earlier one"
        )

        # 2. Apply — table, exact columns, indexes.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", _TABLE)
        assert _columns(engine) == _EXPECTED_COLUMNS
        for name in _INDEXES:
            assert index_exists(engine, name), f"missing index {name}"

        # 3. A shadow root row with NULL sessions is accepted, defaults honest.
        root_row = _row(sid=None)
        with engine.begin() as conn:
            conn.execute(_INSERT, root_row)
        with engine.connect() as conn:
            defaults = conn.execute(
                text(
                    """
                    SELECT catalog_hits, evidence, inputs_unreadable,
                           claude_code_session_id, outcome
                      FROM coord.overlord_interventions WHERE id = :id
                    """
                ),
                {"id": root_row["id"]},
            ).one()
        assert tuple(defaults) == ([], {}, [], None, None)

        # 4. Its outcome row joins the same chain; the chain reads as ONE
        #    intervention whose newest row carries the outcome.
        outcome_row = _row(iid=root_row["id"], sup=root_row["id"], outcome="did_work")
        with engine.begin() as conn:
            conn.execute(_INSERT, outcome_row)
        with engine.connect() as conn:
            chains = conn.execute(
                text(
                    """
                    SELECT DISTINCT ON (intervention_id)
                           intervention_id, id, outcome
                      FROM coord.overlord_interventions
                     WHERE tenant_id = :tid AND intervention_id = :iid
                     ORDER BY intervention_id, recorded_at DESC, id
                    """
                ),
                {"tid": _TENANT, "iid": root_row["id"]},
            ).all()
            history = conn.execute(
                text(
                    """
                    SELECT COUNT(*) FROM coord.overlord_interventions
                     WHERE tenant_id = :tid AND intervention_id = :iid
                    """
                ),
                {"tid": _TENANT, "iid": root_row["id"]},
            ).scalar_one()
        assert len(chains) == 1 and chains[0][2] == "did_work"
        assert history == 2

        # 5. Chain shape: a root that names another chain, and a successor
        #    that names itself, are both refused.
        _refused(engine, _row(iid=uuid.uuid4()))
        self_root = uuid.uuid4()
        _refused(engine, _row(id=self_root, iid=self_root, sup=root_row["id"]))

        # 6. Every vocabulary is enforced by the schema.
        _refused(engine, _row(stop_class="G"))
        _refused(engine, _row(verb="shout"))
        _refused(engine, _row(mode="dry"))
        _refused(engine, _row(outcome="maybe"))
        _refused(engine, _row(label="U"))
        _refused(engine, _row(strike=3))
        with engine.begin() as conn:
            conn.execute(
                _INSERT,
                _row(
                    stop_class="U",
                    strike=None,
                    verb="leave",
                    mode="live",
                    outcome="unknown",
                    label="F",
                    sid=_SESSION,
                ),
            )

        # 7. Downgrade — the ledger and every index gone.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _TABLE)
        for name in _INDEXES:
            assert not index_exists(engine, name), f"index {name} survived downgrade"
