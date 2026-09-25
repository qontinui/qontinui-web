"""Behaviour test for the ``coord_pr_files_head_sha_01`` revision.

The revision adds one nullable column to ``coord.pr_files`` and one index::

    ALTER TABLE coord.pr_files ADD COLUMN head_sha TEXT

    CREATE INDEX CONCURRENTLY idx_pr_files_repo_pr_head
    ON coord.pr_files (repo, pr_number, head_sha)

What is asserted
================

1. Neither the column nor the index exists at the parent revision.
2. After upgrade the column exists, is NULLable, has no default and is ``text``
   — and a row that existed before the upgrade reads NULL. That is the
   revision's central safety property: an existing row's head is genuinely
   unknown, and the migration must not manufacture a value for it.
3. **NULL reads as UNKNOWN, in SQL.** coord's Phase 3 read is
   ``WHERE repo = $1 AND pr_number = $2 AND head_sha = $3``; the plan depends on
   that predicate excluding both a row pinned to an OLDER head and a row whose
   ``head_sha`` is NULL (three-valued logic — ``NULL = 'abc'`` is UNKNOWN, not
   true). Fewer rows than the hydration counted is what makes coord hold, so
   this is the property the security hold is built on. Asserted directly.
4. The index exists, is **``indisvalid``** (a killed CONCURRENTLY build leaves
   an INVALID index that ``IF NOT EXISTS`` would skip on re-run), and its
   recorded definition names the three key columns in order.
5. **Idempotency:** with the schema already applied, ``alembic stamp`` back to
   the parent and ``upgrade`` again succeeds and leaves the SAME valid index
   (same oid — a re-run must not drop and rebuild a healthy one).
6. **A failed CONCURRENTLY build is repaired, not kept:** an INVALID index of
   the same name (manufactured by a genuinely failing ``CREATE UNIQUE INDEX
   CONCURRENTLY`` — no catalog poking, no superuser) is dropped and rebuilt by
   a re-run, instead of being skipped by ``IF NOT EXISTS``.
7. Downgrade removes the index and the column; the file rows survive. A second
   upgrade re-applies cleanly after the downgrade.

What is deliberately NOT asserted
=================================

That the head-pinned read PLANS on the new index. Unlike
``coord_alerts_claim_01``'s partial index, this one is a plain superset of the
existing ``idx_pr_files_repo_pr (repo, pr_number)``, and rows per PR are capped
at coord's hydration page size (100). The planner's choice between the two is a
genuine coin-flip at that cardinality, and the revision's own docstring says the
speedup is marginal — the index is there to state the access path, not to buy
time. Asserting a plan choice here would be a flaky test dressed as evidence.
What IS asserted is the catalog definition, which is what the revision promises.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import re

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
)

_REVISION_ID = "coord_pr_files_head_sha_01"
_PARENT_REVISION_ID = "coord_wu_authored_at_02"
_REVISION_FILENAME = "coord_pr_files_head_sha_01_head_pinned_file_rows.py"

_INDEX_NAME = "idx_pr_files_repo_pr_head"
_COLUMN = "head_sha"

_REPO = "qontinui/qontinui-coord"
_PR = 4242
_CURRENT_HEAD = "1111111111111111111111111111111111111111"
_OLD_HEAD = "2222222222222222222222222222222222222222"

# coord's Phase 3 read, verbatim in shape: the file list accepted as THIS
# head's. Everything else — an older head's row, or a row with no head at all —
# is excluded, and a short list is what makes the secrets hold hold.
_HEAD_PINNED_SQL = """
    SELECT path FROM coord.pr_files
     WHERE repo = :repo AND pr_number = :pr AND head_sha = :head
"""


def _revision_source() -> str:
    return (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    """`_PARENT_REVISION_ID` is the revision's real parent — no database needed."""
    source = _revision_source()
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
    ``deploy-coord.yml``'s drift gate. Pin the one-line spelling at the source.
    """
    source = _revision_source()
    assert re.search(
        r'^down_revision[^=\n]*=\s*["\'][^"\'\n]+["\']\s*$', source, re.MULTILINE
    ), (
        f"{_REVISION_FILENAME} must declare down_revision as a single-line "
        "string literal; a wrapped or parenthesised spelling is invisible to "
        "the line-scoped graph parser and reads as a second head."
    )


def test_the_upgrade_adds_no_default_and_no_backfill() -> None:
    """The no-backfill promise is in the source, not only in the catalog.

    The DB assertions below prove the SHIPPED shape, but they skip wherever no
    Postgres is reachable — which is most local runs. This one always runs, and
    it guards the property that a reviewer would most plausibly "fix" by
    helpfully adding a DEFAULT or an UPDATE: existing rows' heads are UNKNOWN,
    and a manufactured value would let coord's secrets hold clear on a stale
    file list.
    """
    source = _revision_source()
    upgrade = source.split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]
    assert "DEFAULT" not in upgrade.upper(), (
        "head_sha must have no default — an existing row's head is UNKNOWN"
    )
    assert "UPDATE" not in upgrade.upper(), (
        "the upgrade must not backfill head_sha from any source; a guessed "
        "head is exactly the false confidence this column removes"
    )
    assert "NOT NULL" not in upgrade.upper(), "head_sha must be nullable"


def _index_row(engine: Engine) -> tuple[bool, str]:
    """``(indisvalid, pg_get_indexdef)`` for the index."""
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT i.indisvalid, pg_get_indexdef(i.indexrelid)
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'coord' AND c.relname = :idx
                """
            ),
            {"idx": _INDEX_NAME},
        ).one()
    return bool(row[0]), str(row[1] or "")


def _file_count(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(text("SELECT count(*) FROM coord.pr_files")).scalar_one()
        )


def _paths_at_head(engine: Engine, head: str) -> set[str]:
    with engine.connect() as conn:
        return {
            r[0]
            for r in conn.execute(
                text(_HEAD_PINNED_SQL), {"repo": _REPO, "pr": _PR, "head": head}
            )
        }


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_coord_pr_files_head_sha_01_adds_nullable_head_sha_and_index() -> None:
    """Add head_sha + its index; prove NULL and a stale head both read as not-this-head."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_pr_files_head_sha_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — neither the column nor the index exists yet.
        #    Seed a pre-existing file row so the upgrade runs against a
        #    non-empty table and the no-backfill claim has something to bite on.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert column_info(engine, "pr_files", _COLUMN) is None, (
            "coord.pr_files.head_sha must be added by this revision"
        )
        assert not index_exists(engine, _INDEX_NAME)

        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.pr_files
                        (repo, pr_number, path, additions, deletions, status)
                    VALUES (:repo, :pr, '.github/workflows/ci.yml', 5, 1, 'modified')
                    """
                ),
                {"repo": _REPO, "pr": _PR},
            )

        # 2. Apply — nullable text, no default, and the pre-existing row is
        #    left at NULL. A backfilled guess here would be the exact false
        #    confidence the plan exists to remove.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        info = column_info(engine, "pr_files", _COLUMN)
        assert info is not None, "coord.pr_files.head_sha missing after upgrade"
        assert info == ("text", "YES", None), (
            "expected a nullable text column with no default, got "
            f"{info!r} — a default would backfill every legacy row with a "
            "head it cannot be known to belong to"
        )
        with engine.connect() as conn:
            pre = conn.execute(
                text(
                    "SELECT head_sha FROM coord.pr_files "
                    "WHERE repo = :repo AND pr_number = :pr"
                ),
                {"repo": _REPO, "pr": _PR},
            ).scalar_one()
        assert pre is None, (
            "a row that predates this revision has an UNKNOWN head; the "
            "migration must not invent one"
        )

        # 3. The head-pinned read: NULL and a stale head are both excluded.
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.pr_files
                        (repo, pr_number, path, additions, deletions, status, head_sha)
                    VALUES
                        (:repo, :pr, 'src/current_a.rs', 1, 0, 'added',    :cur),
                        (:repo, :pr, 'src/current_b.rs', 2, 0, 'modified', :cur),
                        (:repo, :pr, 'src/stale.rs',     3, 0, 'modified', :old)
                    """
                ),
                {"repo": _REPO, "pr": _PR, "cur": _CURRENT_HEAD, "old": _OLD_HEAD},
            )

        assert _paths_at_head(engine, _CURRENT_HEAD) == {
            "src/current_a.rs",
            "src/current_b.rs",
        }, (
            "the head-pinned read must return this head's rows only — a row "
            "pinned to an older head and a row with a NULL head are both "
            "'not this head's list', which is what makes coord hold"
        )
        assert _paths_at_head(engine, _OLD_HEAD) == {"src/stale.rs"}
        # The NULL row is in the table and in neither answer. Stated as its own
        # assertion because it is three-valued logic doing the work, not a
        # filter anyone wrote: `NULL = '1111…'` is UNKNOWN, so the row drops.
        assert _file_count(engine) == 4, "all four rows are present in the table"
        assert ".github/workflows/ci.yml" not in _paths_at_head(
            engine, _CURRENT_HEAD
        ), "a NULL head_sha must never satisfy a head equality predicate"

        # 4. The index exists, is VALID, and keys the three columns in order.
        assert index_exists(engine, _INDEX_NAME)
        valid, indexdef = _index_row(engine)
        assert valid, (
            "a killed CONCURRENTLY build leaves an INVALID index that "
            "IF NOT EXISTS would skip on re-run — existence is not enough"
        )
        assert "(repo, pr_number, head_sha)" in indexdef, indexdef
        assert "UNIQUE" not in indexdef, (
            f"the index must not be unique — a PR has many files: {indexdef!r}"
        )

        # 5. Idempotency — re-running the revision over its own schema leaves
        #    the healthy index alone rather than rebuilding it.
        with engine.connect() as conn:
            oid_before = conn.execute(
                text(f"SELECT 'coord.{_INDEX_NAME}'::regclass::oid")
            ).scalar_one()
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _index_row(engine)[0], "a re-run must leave a VALID index"
        with engine.connect() as conn:
            oid_after = conn.execute(
                text(f"SELECT 'coord.{_INDEX_NAME}'::regclass::oid")
            ).scalar_one()
        assert oid_after == oid_before, (
            "a re-run must leave a VALID index untouched, not drop and rebuild it"
        )
        # The re-run must also not disturb the data it now indexes.
        assert _paths_at_head(engine, _CURRENT_HEAD) == {
            "src/current_a.rs",
            "src/current_b.rs",
        }

        # 6. A failed CONCURRENTLY build is repaired. Replace the index with a
        #    same-named UNIQUE build over `head_sha`: two rows share
        #    `_CURRENT_HEAD`, so the build fails and leaves an INVALID index
        #    under our name.
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            conn.execute(text(f"DROP INDEX CONCURRENTLY coord.{_INDEX_NAME}"))
            with pytest.raises(IntegrityError):
                conn.execute(
                    text(
                        f"""
                        CREATE UNIQUE INDEX CONCURRENTLY {_INDEX_NAME}
                        ON coord.pr_files (head_sha)
                        """
                    )
                )
        assert index_exists(engine, _INDEX_NAME)
        assert not _index_row(engine)[0], "fixture must leave an INVALID index"

        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        valid, indexdef = _index_row(engine)
        assert valid, "the re-run must drop the INVALID index and rebuild it"
        assert "UNIQUE" not in indexdef and "(repo, pr_number, head_sha)" in indexdef, (
            f"the rebuilt index must be the revision's own, got {indexdef!r}"
        )

        # 7. Downgrade removes index + column; the file rows survive. Re-upgrade
        #    works, and every head pin is gone — which is the correct reversal:
        #    every row reverts to the UNKNOWN it held before this revision.
        rows_before = _file_count(engine)
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        assert column_info(engine, "pr_files", _COLUMN) is None, (
            "downgrade must drop coord.pr_files.head_sha"
        )
        assert _file_count(engine) == rows_before, (
            "downgrade must not delete pr_files rows"
        )

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX_NAME)
        assert _index_row(engine)[0], "re-applied index must be VALID"
        assert _paths_at_head(engine, _CURRENT_HEAD) == set(), (
            "the head pins do not survive a downgrade/upgrade round trip — "
            "every row is UNKNOWN again, which holds rather than releases"
        )
        assert _file_count(engine) == rows_before
