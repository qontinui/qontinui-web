"""Shape test for the ``coord_agent_worktrees_credentialed_at_01`` revision.

Phase 3 (web half) of plan
``2026-09-13-coord-publishes-agent-jwts-on-a-redis-channel-fronted-by-an-unauthenticated-ws-firehose``
adds ``coord.agent_worktrees.credentialed_at TIMESTAMPTZ NULL`` — the stamp
coord's single-shot ``POST /agents/:agent_id/credential`` sets in the same
transaction as the mint, so a second call is ``409 already_credentialed``.

The revision is a one-column ADD, so what this test pins is the CONTRACT the
coord door depends on rather than the DDL:

1. **Absent at the parent.** Without this the walk below passes vacuously
   against a column some other revision created.
2. **Nullable, no default.** NULL is the value that ADMITS the mint; a
   ``now()`` default would lock every agent out of its own credential, and a
   ``NOT NULL`` would refuse every existing row. Both are asserted from the
   catalog, not inferred from the DDL text.
3. **``timestamp with time zone``.** The door compares it to ``now()`` and
   the runner's clock is not the DB's; a naive ``timestamp`` would bend with
   the session zone.
4. **Idempotent re-run.** ``stamp`` back to the parent and re-upgrade must
   not fail on the column already existing (``IF NOT EXISTS``), which is
   what makes a partially-applied pipeline run recoverable.
5. **Downgrade drops exactly this column** and leaves every other column
   of the table in place; re-upgrade restores it.

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
# it.
_REVISION_ID = "coord_agent_worktrees_credentialed_at_01"
_PARENT_REVISION_ID = "plan_library_06_scan_root_slug_census"
_REVISION_FILENAME = (
    "coord_agent_worktrees_credentialed_at_01_single_shot_credential.py"
)

_TABLE = "agent_worktrees"
_COLUMN = "credentialed_at"


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
    ``deploy-coord.yml``'s drift gate — which is what happened on 2026-09-16
    to the parent revision. Pin the one-line spelling at the source.
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
    """Every column name on ``coord.agent_worktrees``."""
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
        "Postgres not reachable at the conftest URL, so the credentialed_at "
        "column SHAPE was NOT verified — only that the revision file parses and "
        "names its parent. This skip is not a pass: the nullable/no-default "
        "contract below is what lets coord's single-shot credential door admit "
        "a first mint at all. CI provisions a postgres service; locally, bring "
        "one up or point DATABASE_URL at a reachable instance."
    ),
)
def test_coord_agent_worktrees_credentialed_at_01_adds_nullable_stamp() -> None:
    """Walk parent → revision → stamp+re-run → downgrade → re-upgrade."""
    root = backend_root()

    with ephemeral_database(
        admin_database_url(), "coord_agent_worktrees_credentialed_at_01_test"
    ) as (engine, url):
        # ----------------------------------------------------------------
        # 1. Walk the chain to the PARENT revision.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)

        # Precondition, not decoration (case 1).
        assert column_info(engine, _TABLE, _COLUMN) is None, (
            f"{_COLUMN} must not exist before {_REVISION_ID} runs"
        )
        columns_at_parent = _columns(engine)
        assert columns_at_parent, "coord.agent_worktrees must exist at the parent"

        # ----------------------------------------------------------------
        # 2. Apply the revision.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)

        info = column_info(engine, _TABLE, _COLUMN)
        assert info is not None, f"upgrade must add {_COLUMN}"
        data_type, is_nullable, default = info
        # Case 3.
        assert data_type == "timestamp with time zone"
        # Case 2 — NULL admits the mint; a default would lock every agent out.
        assert is_nullable == "YES", "NULL is the 'not yet credentialed' value"
        assert default is None, (
            f"{_COLUMN} must have NO default — the single-shot door reads NULL "
            "as 'admit the mint', so a now() default refuses every first call"
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
