"""Behaviour test for the ``coordinput_01_operator_inputs`` operator-input store.

``migration-reversal.yml`` would only confirm the statements execute against an
empty database. The contracts worth pinning here are the ones a reviewer cannot
read off the DDL at a glance, and every one of them is a way the resulting
metric — or the operator's privacy — could be quietly wrong:

1. **Shape** — the table, both read indexes and the dedup constraint exist
   after upgrade, and are gone after downgrade.
2. **The privacy pin.** The column set is EXACTLY the contract the revision's
   docstring states, and no column is a text / bytes / content-bearing one. A
   later "helpful" column — the first 40 characters of what was typed, a byte
   count per minute — would turn a steering metric into a keylogger. This test
   is what makes adding one a deliberate, reviewed act: it must be edited, in
   the same diff, next to a docstring that says why not.
3. **NULL is a first-class value** for ``session_id`` / ``device_id`` /
   ``operator_id`` (Unavailable, never Absent), and ``occurred_at`` has NO
   default — an emitter that omits it is refused rather than silently re-timed
   to the delivery minute.
4. **The unique idempotency key actually dedupes.** A runner outbox retry must
   collapse to one row; a non-unique index with a hopeful name would let the
   operator-hour inflate silently. This is the contract coord's
   ``ON CONFLICT (idempotency_key) DO NOTHING`` relies on.
5. **No FK on ``tenant_id`` and no CHECK on the vocabulary columns** — both
   deliberate (observation log on a hot path; vocabulary closed at coord's
   write boundary), so both are pinned rather than left to drift in.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    index_exists,
    run_alembic,
    table_exists,
)

_REVISION_ID = "coordinput_01_operator_inputs"
_REVISION_FILENAME = "coordinput_01_operator_inputs.py"


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime.

    Never hardcode the parent. ``alembic-heads-pr`` serialises alembic PRs by
    construction, so any revision that lands ahead of this one re-forks the
    chain and ``down_revision`` is re-pointed at the new head. A pinned constant
    would make this test upgrade to a revision that is no longer this one's
    parent, so the "clean database" it asserts against would be the wrong one.
    """
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    match = re.search(r'^down_revision:.*=\s*"([^"]+)"', source, re.MULTILINE)
    assert match, f"{_REVISION_FILENAME} must declare a down_revision"
    return match.group(1)


_PARENT_REVISION_ID = _parent_revision_id()

_TABLE = "operator_inputs"

_INDEXES = (
    "uq_operator_inputs_idempotency_key",
    "ix_operator_inputs_tenant_occurred_at",
    "ix_operator_inputs_tenant_session_occurred_at",
)

# The column contract, EXACTLY: name -> (data_type, is_nullable). Adding a
# column fails this test on purpose — read the revision's "The privacy rule"
# section before changing this mapping.
_EXPECTED_COLUMNS: dict[str, tuple[str, str]] = {
    "input_id": ("uuid", "NO"),
    "tenant_id": ("uuid", "NO"),
    "session_id": ("uuid", "YES"),
    "device_id": ("uuid", "YES"),
    "operator_id": ("uuid", "YES"),
    "channel": ("text", "NO"),
    "actor_class": ("text", "NO"),
    "session_state_at_input": ("text", "NO"),
    "resource_kind": ("text", "YES"),
    "occurred_at": ("timestamp with time zone", "NO"),
    "idempotency_key": ("text", "NO"),
    "recorded_at": ("timestamp with time zone", "NO"),
}

# The TEXT columns the contract permits — every one a closed vocabulary word or
# a dedup key, never free text a human wrote. A new text column is exactly the
# regression the privacy pin exists to catch.
_ALLOWED_TEXT_COLUMNS = frozenset(
    {
        "channel",
        "actor_class",
        "session_state_at_input",
        "resource_kind",
        "idempotency_key",
    }
)

# Column NAMES that would signal content is being kept, whatever their type.
_CONTENT_NAME = re.compile(
    r"content|text|bytes|data|body|keystroke|byte_count|payload|message|prompt"
    r"|answer|resource_key|input_len|length",
    re.IGNORECASE,
)

_TENANT = uuid.UUID("5b0f3c1e-2a7d-4e61-8f09-3c2d1e0a9b77")
_SESSION = uuid.UUID("c3a19e52-7f40-4b8d-a6e1-0d5f2b9c8e14")
_BUCKET_START = datetime(2026, 9, 30, 9, 0, tzinfo=UTC)


def _columns(engine: Engine) -> dict[str, tuple[str, str]]:
    """``{column_name: (data_type, is_nullable)}`` for ``coord.operator_inputs``."""
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


def _constraint_types(engine: Engine) -> list[str]:
    """Every ``pg_constraint.contype`` on ``coord.operator_inputs``."""
    with engine.connect() as conn:
        return [
            row[0]
            for row in conn.execute(
                text(
                    """
                    SELECT contype::text FROM pg_constraint
                     WHERE conrelid = 'coord.operator_inputs'::regclass
                    """
                )
            ).all()
        ]


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_coordinput_01_creates_a_content_free_store_and_enforces_the_dedup_key() -> (
    None
):
    """Shape, the privacy pin, honest NULLs, the enforced key, and reversal."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coordinput01_test") as (
        engine,
        url,
    ):
        # ----------------------------------------------------------------
        # 1. Parent revision — the store does not exist yet.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _TABLE), (
            "the store must be created by this revision, not an earlier one"
        )

        # ----------------------------------------------------------------
        # 2. Apply — the table, both indexes and the dedup constraint exist.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", _TABLE)
        for name in _INDEXES:
            assert index_exists(engine, name), f"missing index {name}"

        # ----------------------------------------------------------------
        # 3. The privacy pin — the column set is EXACTLY the contract.
        # ----------------------------------------------------------------
        columns = _columns(engine)
        assert columns == _EXPECTED_COLUMNS, (
            "coord.operator_inputs' column set moved. It is a privacy contract: "
            "no text, bytes, byte count or content-bearing column. Read the "
            "revision docstring's 'The privacy rule' before widening it."
        )
        content_named = sorted(c for c in columns if _CONTENT_NAME.search(c))
        assert content_named == [], (
            f"content-bearing column name(s) {content_named} on an operator-input "
            "store that must record the event, never what was typed"
        )
        binary = sorted(c for c, (dtype, _) in columns.items() if dtype == "bytea")
        assert binary == [], f"bytes column(s) {binary} on a content-free store"
        text_columns = {
            c
            for c, (dtype, _) in columns.items()
            if dtype in {"text", "character varying", "character", "json", "jsonb"}
        }
        assert text_columns <= _ALLOWED_TEXT_COLUMNS, (
            f"unexpected free-text column(s) {sorted(text_columns - _ALLOWED_TEXT_COLUMNS)}"
        )

        # Defaults: the vocabulary column defaults to the honest `unknown`,
        # recorded_at is server-stamped, and occurred_at has NO default.
        state = column_info(engine, _TABLE, "session_state_at_input")
        assert state is not None and state[2] == "'unknown'::text"
        recorded = column_info(engine, _TABLE, "recorded_at")
        assert recorded is not None and recorded[2] == "now()"
        occurred = column_info(engine, _TABLE, "occurred_at")
        assert occurred is not None and occurred[2] is None, (
            "occurred_at must have no default — a server default would re-time "
            "every delayed outbox row to its delivery minute"
        )

        # No FK (observation log on a hot path) and no CHECK (vocabulary is
        # closed at coord's write boundary). Primary key + unique only.
        assert sorted(_constraint_types(engine)) == ["p", "u"]

        # ----------------------------------------------------------------
        # 4. A bare emit: NULL identities are accepted, defaults are honest.
        # ----------------------------------------------------------------
        insert_input = text(
            """
            INSERT INTO coord.operator_inputs
                (tenant_id, channel, actor_class, occurred_at, idempotency_key)
            VALUES (:tid, 'local_terminal', 'human', :at, :key)
            """
        )
        duplicate_key = f"{_TENANT}:{_SESSION}:input:local_terminal:1790758800"
        with engine.begin() as conn:
            conn.execute(
                insert_input,
                {"tid": _TENANT, "at": _BUCKET_START, "key": duplicate_key},
            )
        with engine.connect() as conn:
            bare = conn.execute(
                text(
                    """
                    SELECT session_id, device_id, operator_id,
                           session_state_at_input, resource_kind,
                           recorded_at IS NOT NULL
                      FROM coord.operator_inputs
                     WHERE idempotency_key = :key
                    """
                ),
                {"key": duplicate_key},
            ).one()
        assert tuple(bare) == (None, None, None, "unknown", None, True)

        # ----------------------------------------------------------------
        # 5. The unique key is ENFORCED, not merely declared.
        # ----------------------------------------------------------------
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(
                    insert_input,
                    {"tid": _TENANT, "at": _BUCKET_START, "key": duplicate_key},
                )
        # ON CONFLICT (idempotency_key) — the arbiter coord's write names — must
        # infer against this constraint and absorb the repeat.
        with engine.begin() as conn:
            absorbed = conn.execute(
                text(
                    """
                    INSERT INTO coord.operator_inputs
                        (tenant_id, channel, actor_class, occurred_at,
                         idempotency_key)
                    VALUES (:tid, 'local_terminal', 'human', :at, :key)
                    ON CONFLICT (idempotency_key) DO NOTHING
                    """
                ),
                {"tid": _TENANT, "at": _BUCKET_START, "key": duplicate_key},
            )
            assert absorbed.rowcount == 0
        with engine.connect() as conn:
            assert (
                conn.execute(
                    text(
                        """
                        SELECT COUNT(*) FROM coord.operator_inputs
                         WHERE idempotency_key = :key
                        """
                    ),
                    {"key": duplicate_key},
                ).scalar_one()
                == 1
            ), "a repeated key must not produce a second row"

        # occurred_at has no default, so an emitter that omits it is REFUSED.
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        """
                        INSERT INTO coord.operator_inputs
                            (tenant_id, channel, actor_class, idempotency_key)
                        VALUES (:tid, 'coord_answer', 'unknown', :key)
                        """
                    ),
                    {"tid": _TENANT, "key": f"{_TENANT}:untimed"},
                )

        # ----------------------------------------------------------------
        # 6. Downgrade — the table and every index gone.
        # ----------------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _TABLE)
        for name in _INDEXES:
            assert not index_exists(engine, name), f"index {name} survived downgrade"
