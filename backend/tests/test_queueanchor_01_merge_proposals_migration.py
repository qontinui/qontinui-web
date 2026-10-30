"""Schema + round-trip test for the ``queueanchor_01`` revision.

Phase 3 of plan ``2026-10-01-pr-repair-is-timed-by-cause-not-by-transition``
adds ``coord.merge_proposals.queue_anchor_at``. coord is meant to read it across
a repo boundary as ``COALESCE(queue_anchor_at, created_at)``, so three properties are
the contract, and none of them is visible from a passing ``upgrade``:

1. **The name and type.** ``ADD COLUMN IF NOT EXISTS`` is type-blind, so a
   column of the right name and the wrong type would be a silent no-op here and
   a failed ``row.get`` in coord's reader once it exists. The type is asserted from the catalogue.
2. **Nullable with no default.** A NULL anchor must order exactly as
   ``created_at`` always has. A default (``now()`` for example) would stamp
   every existing row with the migration's apply time and re-order the live
   queue the moment this revision lands, before any coord code reads it.
3. **Up -> down -> up leaves no residue and keeps the proposal rows.**

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. A skip proves nothing — set
``QONTINUI_TEST_PG`` (not ``DATABASE_URL``, which ``conftest.py`` overwrites)
to point it at a live instance.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    column_info,
    comment_body_from_source,
    declared_parent_revision_id,
    ephemeral_database,
    run_alembic,
)

# Pinned rather than "head" so a later revision cannot change what this walks.
# MUST equal the revision's own down_revision (the first test enforces it).
_REVISION_ID = "queueanchor_01"
_PARENT_REVISION_ID = "credprobe_01"
_REVISION_FILENAME = "queueanchor_01_merge_proposals.py"

_TABLE = "merge_proposals"
_COLUMN = "queue_anchor_at"


def _revision_source() -> str:
    path: Path = backend_root() / "alembic" / "versions" / _REVISION_FILENAME
    return path.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    declared = declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)
    assert declared == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision={declared!r} but this test "
        f"pins {_PARENT_REVISION_ID!r}. Re-point both together, and the "
        f"`Revises:` header in the revision docstring with them."
    )


def test_the_revision_comments_the_column() -> None:
    body = comment_body_from_source(_revision_source(), f"coord.{_TABLE}.{_COLUMN}")
    assert "COALESCE(queue_anchor_at, created_at)" in body, (
        "the column comment must state the coalesce rule: it is the only place "
        "in the database that says a NULL anchor orders as created_at"
    )


def test_the_revision_adds_no_default() -> None:
    source = _revision_source()
    add = (
        '"ALTER TABLE coord.merge_proposals "\n'
        '        "ADD COLUMN IF NOT EXISTS queue_anchor_at TIMESTAMPTZ"\n'
    )
    assert add in source, (
        "the ADD COLUMN statement must end at the bare type: anything after "
        "TIMESTAMPTZ (a DEFAULT, NOT NULL) would stamp or constrain every "
        "existing proposal and re-order the live queue"
    )
    assert "server_default" not in source and "DEFAULT" not in source.replace(
        "lock_timeout = DEFAULT", ""
    ), "queue_anchor_at must carry no default"


# ---------------------------------------------------------------------------
# Database-backed walks.
# ---------------------------------------------------------------------------


@pytest.fixture
def _admin_url() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no test Postgres reachable at {url}")
    return url


def _seed_proposal(engine: Engine) -> str:
    with engine.begin() as conn:
        return str(
            conn.execute(
                text(
                    """
                    INSERT INTO coord.merge_proposals (proposal_id, agent_id, description, status)
                    VALUES (gen_random_uuid(), gen_random_uuid(), 'queueanchor fixture', 'queued')
                    RETURNING proposal_id
                    """
                )
            ).scalar_one()
        )


def _assert_column_shape(engine: Engine) -> None:
    info = column_info(engine, _TABLE, _COLUMN)
    assert info is not None, f"coord.{_TABLE}.{_COLUMN} is absent after upgrade"
    data_type, is_nullable, column_default = info
    assert data_type == "timestamp with time zone", data_type
    assert is_nullable == "YES"
    assert column_default is None, column_default
    assert column_comment(engine, _TABLE, _COLUMN) == comment_body_from_source(
        _revision_source(), f"coord.{_TABLE}.{_COLUMN}"
    )


def test_an_existing_proposal_reads_a_null_anchor(_admin_url: str) -> None:
    with ephemeral_database(_admin_url, "queueanchor_01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        proposal_id = _seed_proposal(engine)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_column_shape(engine)
        with engine.connect() as conn:
            anchor, coalesced, created = conn.execute(
                text(
                    "SELECT queue_anchor_at, COALESCE(queue_anchor_at, created_at), created_at "
                    "FROM coord.merge_proposals WHERE proposal_id = :p"
                ),
                {"p": proposal_id},
            ).one()
        assert anchor is None
        assert coalesced == created


def test_up_down_up_leaves_no_residue_and_keeps_the_proposal(_admin_url: str) -> None:
    with ephemeral_database(_admin_url, "queueanchor_01_ud") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        proposal_id = _seed_proposal(engine)
        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) is None
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_column_shape(engine)
        with engine.connect() as conn:
            assert (
                conn.execute(
                    text(
                        "SELECT count(*) FROM coord.merge_proposals WHERE proposal_id = :p"
                    ),
                    {"p": proposal_id},
                ).scalar_one()
                == 1
            )


def test_upgrade_is_idempotent(_admin_url: str) -> None:
    with ephemeral_database(_admin_url, "queueanchor_01_id") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_column_shape(engine)
