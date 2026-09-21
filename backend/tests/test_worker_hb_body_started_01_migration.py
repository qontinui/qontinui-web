"""Shape test for the ``worker_hb_body_started_01`` revision.

Phase 1 (web half) of plan
``2026-09-19-leader-gated-worker-liveness-reads-a-follower-skip-as-the-work-running``
adds ``coord.worker_heartbeats.body_started_at TIMESTAMPTZ NULL`` — the stamp
coord's worker ledger sets on its leader arm immediately before a loop body is
awaited, and clears to NULL when the finished tick is written. It is what makes
"a body has been in flight for N seconds" a POSITIVE observation, where today it
is byte-identical to a dead loop.

The revision is a one-column ADD, so what this test pins is the CONTRACT the
coord reader depends on rather than the DDL:

1. **Absent at the parent.** Without this the walk below passes vacuously
   against a column some other revision created.
2. **Nullable, no default.** NULL is the column's STEADY STATE — a settled row
   genuinely has no body in flight, and a follower's row is NULL for the whole
   time it is a follower. A ``now()`` default would assert every existing row had
   a body in flight at migration time, and a ``NOT NULL`` would refuse every one
   of them. Both are asserted from the catalog, not inferred from the DDL text.
3. **``timestamp with time zone``.** coord compares this column against SQL
   ``now()`` server-side, in the same clock domain as ``last_tick_at`` (the
   table's only other timestamp, also TIMESTAMPTZ). A naive ``timestamp`` would
   bend with the session zone and silently corrupt every in-flight duration.
4. **Idempotent re-run.** ``stamp`` back to the parent and re-upgrade must not
   fail on the column already existing (``IF NOT EXISTS``), which is what makes a
   partially-applied pipeline run recoverable.
5. **Downgrade drops exactly this column** and leaves the other nine in place;
   re-upgrade restores it.

Case 3 is the one that matters most here and is worth being explicit about: it
mechanically pins the "no replica's clock enters this column" property the
revision's own docstring argues for. The sibling table ``coord.replica_presence``
(``replpres_01``) states the same rule — its ``heartbeat_at`` is *"Written with
the SERVER's now() so a replica with a skewed clock cannot forge freshness"* —
and this column inherits that write path.

Substrate comes from ``_alembic_harness`` (shared with the other migration
tests): an ephemeral DB inside the test Postgres, skipped when none is
reachable. Locally that means pointing ``DATABASE_URL`` at a reachable
instance; CI provisions one at the default ``localhost:5432``.
"""

from __future__ import annotations

import re

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    run_alembic,
)

# The revision under test and its parent. Both are pinned explicitly rather
# than using "head" so a later migration landing on top cannot silently change
# what this test walks.
#
# `_PARENT_REVISION_ID` MUST stay equal to the revision's own `down_revision`;
# `test_the_pinned_parent_matches_the_revisions_down_revision` below enforces
# it. Alembic PRs here serialise under branch protection, so this revision is
# likely to need a re-point before it merges — and `count_alembic_heads.py`
# treats a re-point as THREE edits: `down_revision`, the `Revises:` docstring
# line, and this pin. Move all three together.
_REVISION_ID = "worker_hb_body_started_01"
_PARENT_REVISION_ID = "notif_gate_action_04_drop_dead_prefs"
_REVISION_FILENAME = "worker_hb_body_started_01_add_body_started_at.py"

_TABLE = "worker_heartbeats"
_COLUMN = "body_started_at"


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    """`_PARENT_REVISION_ID` is the revision's real parent — no database needed."""
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    match = re.search(
        r'^down_revision[^=]*=\s*["\'](?P<parent>[^"\']+)["\']',
        source,
        re.MULTILINE,
    )
    assert match is not None, f"no down_revision found in {_REVISION_FILENAME}"
    assert match.group("parent") == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision="
        f"{match.group('parent')!r} but this test pins "
        f"_PARENT_REVISION_ID={_PARENT_REVISION_ID!r}. Re-point both together."
    )


def test_the_down_revision_is_on_one_line() -> None:
    """Coord's line-scoped alembic-graph parser must see the parent.

    A formatter-wrapped ``down_revision = (\\n"..."\\n)`` yields no parent to
    that parser, counts as a second head, and blocks every coord deploy behind
    ``deploy-coord.yml``'s drift gate — which is what happened on 2026-09-16 to
    an earlier revision. Pin the one-line spelling at the source.
    """
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    one_line = re.search(
        r'^down_revision[^=\n]*=\s*"' + re.escape(_PARENT_REVISION_ID) + r'"\s*$',
        source,
        re.MULTILINE,
    )
    assert one_line is not None, (
        "down_revision must be assigned its string literal on ONE line; a "
        "parenthesised continuation is invisible to coord's graph parser"
    )


def _columns(engine: Engine) -> set[str]:
    """Every column name on ``coord.worker_heartbeats``."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name
                  FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :table
                """
            ),
            {"table": _TABLE},
        ).all()
    return {r[0] for r in rows}


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL, so the body_started_at "
        "column SHAPE was NOT verified — only that the revision file parses and "
        "names its parent. This skip is not a pass: the nullable/no-default "
        "contract below is what keeps the ADD catalog-only on a ledger ~110 "
        "worker loops upsert into, and the TIMESTAMPTZ assertion is what keeps "
        "every in-flight duration in one clock domain. CI provisions a postgres "
        "service; locally, bring one up or point DATABASE_URL at a reachable "
        "instance."
    ),
)
def test_worker_hb_body_started_01_adds_nullable_stamp() -> None:
    """Walk parent → revision → stamp+re-run → downgrade → re-upgrade."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "worker_hb_body_started_01_test") as (
        engine,
        url,
    ):
        # ----------------------------------------------------------------
        # 1. Walk the chain to the PARENT revision.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)

        # Precondition, not decoration (case 1).
        assert column_info(engine, _TABLE, _COLUMN) is None, (
            f"{_COLUMN} must not exist before {_REVISION_ID} runs"
        )
        columns_at_parent = _columns(engine)
        assert columns_at_parent, "coord.worker_heartbeats must exist at the parent"

        # ----------------------------------------------------------------
        # 2. Apply the revision.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)

        info = column_info(engine, _TABLE, _COLUMN)
        assert info is not None, f"upgrade must add {_COLUMN}"
        data_type, is_nullable, default = info
        # Case 3 — the clock-domain pin. coord compares this against SQL now()
        # in the same domain as last_tick_at; a naive timestamp would bend with
        # the session zone.
        assert data_type == "timestamp with time zone"
        # Case 2 — NULL is the steady state, not a gap in the data.
        assert is_nullable == "YES", "NULL is the 'no body in flight' value"
        assert default is None, (
            f"{_COLUMN} must have NO default — a now() default would assert "
            "every existing row had a body in flight at migration time, and "
            "would turn a catalog-only ADD into a full table rewrite holding "
            "ACCESS EXCLUSIVE on a ledger written on every worker tick"
        )
        assert _columns(engine) == columns_at_parent | {_COLUMN}, (
            "the revision adds exactly one column"
        )

        # ----------------------------------------------------------------
        # 3. Re-run over its own output (case 4). `stamp` rewinds only the
        #    version marker, so the ADD re-executes against a table that
        #    already carries the column.
        # ----------------------------------------------------------------
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) == info, (
            "a re-run must be a no-op, not a failure and not a reshape"
        )

        # ----------------------------------------------------------------
        # 4. Downgrade — drops exactly this column (case 5).
        # ----------------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) is None, (
            f"downgrade drops {_COLUMN}"
        )
        assert _columns(engine) == columns_at_parent, (
            "downgrade must leave every other column of the table in place"
        )

        # ----------------------------------------------------------------
        # 5. Re-upgrade — the column comes back with the same shape.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) == info
