"""Behaviour test for the ``coord_pr_files_head_sha_01`` revision.

The revision adds one nullable column to ``coord.pr_files``, and nothing else::

    ALTER TABLE coord.pr_files ADD COLUMN IF NOT EXISTS head_sha TEXT

What is asserted
================

1. The column does not exist at the parent revision.
2. After upgrade it exists, is NULLable, has no default and is ``text`` — and a
   row that existed before the upgrade reads NULL. That is the revision's
   central safety property: an existing row's head is genuinely unknown, and the
   migration must not manufacture a value for it.
3. **NULL reads as UNKNOWN, in SQL.** coord's Phase 3 read is
   ``WHERE repo = $1 AND pr_number = $2 AND head_sha = $3``; the plan depends on
   that predicate excluding both a row pinned to an OLDER head and a row whose
   ``head_sha`` is NULL (three-valued logic — ``NULL = 'abc'`` is UNKNOWN, not
   true). Fewer rows than the hydration counted is what makes coord hold, so
   this is the property the security hold is built on. Asserted directly.
4. **The pre-existing ``idx_pr_files_repo_pr`` is untouched**, through the
   upgrade and through the downgrade. This revision creates no index and drops
   none; the deployed coord build reads ``coord.pr_files`` by ``(repo,
   pr_number)`` alone, so that index is load-bearing and a future edit disturbing
   it would break a running reader with every other assertion here still green.
5. **Idempotency:** with the column already added, ``alembic stamp`` back to the
   parent and ``upgrade`` again succeeds and leaves the data alone.
6. Downgrade removes the column; the file rows survive. A second upgrade
   re-applies cleanly, and every head pin is gone — UNKNOWN again, which holds.

And, without needing a database at all: the ``_PARENT_REVISION_ID`` pin, the
one-line ``down_revision`` spelling, that the upgrade path adds no ``DEFAULT``,
no ``UPDATE`` and no ``NOT NULL``, and that it creates **no index**, contains no
``DROP`` and keeps its ``IF NOT EXISTS`` guard. Those last are NECESSARY
conditions for the AutoSafe classification this revision expects, not sufficient
ones — the classifier checks more than a keyword scan can (see
``test_the_upgrade_creates_no_index``).

There is no index, deliberately
===============================

An earlier draft created ``idx_pr_files_repo_pr_head (repo, pr_number,
head_sha)``. It was removed, and the tests for it with it. The existing
``idx_pr_files_repo_pr`` already narrows Phase 3's read to at most
``HYDRATION_FILES_PAGE_CAP`` = 100 rows, so a third key column buys nothing
measurable — while a correct concurrent build would have required an autocommit
block and a ``DROP INDEX CONCURRENTLY`` repair path, and that ``DROP`` on the
upgrade path is rejected by coord's migration classifier. The revision's own
docstring carries the full reasoning; ``test_the_upgrade_creates_no_index``
below is what makes an accidental re-add loud — it scans for the bare ``INDEX``
token over the classifier's own surface, so ``op.create_index`` and a helper
above ``upgrade()`` are both caught, but a determined editor deleting that test
is not something a test can stop.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import ast
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
    index_exists,
    run_alembic,
)

_REVISION_ID = "coord_pr_files_head_sha_01"
_PARENT_REVISION_ID = "coord_wu_authored_at_02"
_REVISION_FILENAME = "coord_pr_files_head_sha_01_head_pinned_file_rows.py"

# The one statement in upgrade() that legitimately spells the SQL keyword
# DEFAULT — the lock-guard restore. See
# `test_the_upgrade_adds_no_default_and_no_backfill`.
_LOCK_GUARD_RESTORE = 'op.execute("SET LOCAL lock_timeout = DEFAULT")'

# The index this revision must NOT disturb: the deployed coord build reads
# coord.pr_files by (repo, pr_number) alone, so it is still load-bearing.
_PRE_EXISTING_INDEX = "idx_pr_files_repo_pr"
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


def _classifier_surface() -> str:
    """The revision source coord's migration classifier actually judges, as code.

    Two deliberate choices, both of which a narrower slice gets wrong:

    * **Module-level helpers are INCLUDED.** The classifier's surface is the
      whole module minus the body of ``downgrade()`` — including every
      module-level helper, because a lexer cannot prove which of them
      ``downgrade()`` alone reaches. Slicing only ``upgrade()`` would leave a
      blind spot exactly where this revision's deleted ``_index_is_invalid``
      helper lived: a reintroduced helper holding a ``DROP INDEX CONCURRENTLY``
      would make coord Reject the revision while every assertion here stayed
      green. ``scripts/ci/check_coord_column_drops.py`` scans the same surface.
    * **Docstrings and comments are stripped**, so the keyword scans below read
      CODE and not prose. Without that, the revision's own sentence "Idempotent,
      additive, no index." would fail the ``INDEX`` assertion, and any docstring
      that happened to say "drops nothing" would fail the ``DROP`` one — a false
      failure with a baffling message.

    Docstrings are located with ``ast``, NOT by a triple-quote regex. That is not
    fussiness: this revision's SQL lives in triple-quoted ``op.execute(\"\"\"…\"\"\")``
    literals, so a regex that removed every triple-quoted string would delete the
    very statements this surface exists to scan — and the positive
    ``ADD COLUMN IF NOT EXISTS`` assertion would then fail on correct code. A
    docstring is the first statement of a module, class or function and nothing
    else; ``ast`` says which those are, and only their lines are blanked.

    The ``def downgrade(`` anchor is column-0 and regex-anchored so a mention in
    prose cannot move the cut.
    """
    src = _revision_source()
    lines = src.splitlines(keepends=True)
    for node in ast.walk(ast.parse(src)):
        if not isinstance(
            node, ast.Module | ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef
        ):
            continue
        body = node.body
        if not body:
            continue
        first = body[0]
        if (
            isinstance(first, ast.Expr)
            and isinstance(first.value, ast.Constant)
            and isinstance(first.value.value, str)
            and first.end_lineno is not None
        ):
            for i in range(first.lineno - 1, first.end_lineno):
                lines[i] = "\n"
    blanked = "".join(lines)
    surface = re.split(r"^def downgrade\(", blanked, maxsplit=1, flags=re.MULTILINE)[0]
    return re.sub(r"#[^\n]*", "", surface)


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

    coord parses ``down_revision`` line by line and requires the value to start
    with a quote on the SAME line (``crates/coord/src/enrichment.rs``), so a
    formatter-wrapped ``down_revision = (\\n"..."\\n)`` yields no parent there at
    all — the revision drops out of the edges coord derives for a PR touching
    alembic. qontinui-web's own head gate tolerates the wrapped form, so this is
    a coord-side constraint that nothing in THIS repo would catch. Pin the
    one-line spelling at the source.
    """
    source = _revision_source()
    assert re.search(
        r'^down_revision[^=\n]*=\s*["\'][^"\'\n]+["\']\s*$', source, re.MULTILINE
    ), (
        f"{_REVISION_FILENAME} must declare down_revision as a single-line "
        "string literal; a wrapped or parenthesised spelling yields no parent "
        "to coord's line-scoped graph parser at all."
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
    surface = _classifier_surface()

    # `DEFAULT` has one legitimate occurrence on the upgrade path: the
    # lock-guard restore, which spells the SQL keyword for an unrelated reason.
    # Exempt exactly that statement, so the assertion still reads the DDL. The
    # exemption is guarded rather than assumed — if the restore is ever renamed
    # or removed this test says so instead of silently widening.
    assert surface.count(_LOCK_GUARD_RESTORE) == 1, (
        f"expected exactly one {_LOCK_GUARD_RESTORE!r} on the upgrade path; "
        "the DEFAULT exemption below is scoped to it, so a change here must be "
        "made deliberately"
    )
    ddl = surface.replace(_LOCK_GUARD_RESTORE, "").upper()
    assert "DEFAULT" not in ddl, (
        "head_sha must have no default — an existing row's head is UNKNOWN"
    )
    assert "UPDATE" not in ddl, (
        "the upgrade must not backfill head_sha from any source; a guessed "
        "head is exactly the false confidence this column removes"
    )
    assert "NOT NULL" not in ddl, "head_sha must be nullable"


def test_the_upgrade_creates_no_index() -> None:
    """No index, no ``DROP``, and the idempotency guard intact.

    The obvious reflex on reading Phase 3's ``WHERE repo = $1 AND pr_number = $2
    AND head_sha = $3`` is to add a matching index, and this revision
    deliberately does not. The existing ``idx_pr_files_repo_pr`` already narrows
    that read to at most 100 rows (coord's hydration page cap), so a third key
    column buys nothing measurable — while a correct concurrent build drags in
    an autocommit block and a ``DROP INDEX CONCURRENTLY`` repair, and coord's
    migration classifier rejects any statement on the upgrade path beginning
    ``DROP``. The resulting ``migrations`` block is ``clearable_by: classifier``,
    so no agent evidence clears it and an operator must.

    These are NECESSARY conditions for an AutoSafe classification, not
    sufficient ones — the classifier also requires both ``lock_timeout`` values
    to be in its admitted set, every ``op.execute`` argument to be a static
    literal, and no unclassifiable receiver. What is asserted here is the part a
    future edit is most likely to break by being helpful.

    If a measurement ever justifies the index, add it in a revision of its own
    rather than making this one unlandable; then delete this test with that
    change, deliberately.
    """
    sql_only = _classifier_surface().upper()
    # Bare `INDEX`, not `CREATE INDEX`: the idiomatic re-add is
    # `op.create_index(..., schema="coord")`, which contains no raw SQL at all,
    # and a plain (non-CONCURRENTLY) one would also slip past the autocommit
    # check below while taking the write-blocking SHARE lock this revision
    # exists to avoid. `sa.Index(...)` is caught by the same token.
    assert "INDEX" not in sql_only, (
        "this revision creates no index on purpose, in raw SQL or via "
        "op.create_index / sa.Index — see the revision docstring's 'NO INDEX' "
        "section before adding one back"
    )
    assert "DROP" not in sql_only, (
        "a DROP anywhere on the upgrade path makes coord's migration "
        "classifier reject the revision, and the resulting block is "
        "clearable_by: classifier — an operator, not an agent, would have to "
        "clear it"
    )
    assert "AUTOCOMMIT_BLOCK" not in sql_only, (
        "no autocommit block is needed without a CONCURRENTLY build, and it "
        "would commit the ADD COLUMN before alembic_version is stamped"
    )
    # The one POSITIVE assertion here, and it is load-bearing twice over:
    # `IF NOT EXISTS` is what makes the ADD COLUMN idempotent across the
    # up -> downgrade -1 -> up walk, and it is also the `has_idempotency_guard`
    # marker without which the classifier refuses the ADD COLUMN outright.
    assert "ADD COLUMN IF NOT EXISTS" in sql_only, (
        "the ADD COLUMN must keep its IF NOT EXISTS guard — it is both the "
        "idempotency this revision claims and what coord's classifier requires "
        "to admit an ADD COLUMN at all"
    )


def _file_count(engine: Engine) -> int:
    """Rows for THIS test's own PR.

    Scoped by ``(repo, pr_number)`` rather than counting the table: the
    substrate is an ephemeral database, but an exact count over an unscoped
    read is the shape `scripts/ci/check_global_state_assertions.py` ratchets
    against, and the discriminator is one this test controls anyway.
    """
    with engine.connect() as conn:
        return int(
            conn.execute(
                text(
                    "SELECT count(*) FROM coord.pr_files "
                    "WHERE repo = :repo AND pr_number = :pr"
                ),
                {"repo": _REPO, "pr": _PR},
            ).scalar_one()
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
def test_coord_pr_files_head_sha_01_adds_a_nullable_head_sha() -> None:
    """Add head_sha; prove NULL and a stale head both read as not-this-head."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_pr_files_head_sha_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — the column does not exist yet. Seed a
        #    pre-existing file row so the upgrade runs against a non-empty
        #    table and the no-backfill claim has something to bite on.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert column_info(engine, "pr_files", _COLUMN) is None, (
            "coord.pr_files.head_sha must be added by this revision"
        )
        assert index_exists(engine, _PRE_EXISTING_INDEX), (
            f"{_PRE_EXISTING_INDEX} is created by pr_merge_01 and must already "
            "be present at the parent — otherwise the survival assertions "
            "below prove nothing"
        )

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
        # The NULL-head row is IN the table and in NEITHER answer above — which
        # is three-valued logic doing the work, not a filter anyone wrote
        # (`NULL = '1111…'` is UNKNOWN, so the row drops). The exact-set
        # equalities above already exclude it; this counts the rows to prove
        # they excluded it rather than that it was never inserted.
        assert _file_count(engine) == 4, (
            "all four rows must be present — the two head-pinned reads above "
            "exclude the NULL-head row by predicate, not by absence"
        )

        # 4. The one index this revision must not disturb is still there. This
        #    proves SURVIVAL only — it cannot detect an index the revision ADDS.
        #    That direction is `test_the_upgrade_creates_no_index`'s job.
        assert index_exists(engine, _PRE_EXISTING_INDEX), (
            f"{_PRE_EXISTING_INDEX} must survive this revision — coord's "
            "deployed build still reads coord.pr_files by (repo, pr_number) "
            "alone, so dropping it here breaks a running reader"
        )

        # 5. Idempotency — re-running the revision over its own schema.
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert column_info(engine, "pr_files", _COLUMN) == ("text", "YES", None), (
            "a re-run must leave the column exactly as it was"
        )
        assert _paths_at_head(engine, _CURRENT_HEAD) == {
            "src/current_a.rs",
            "src/current_b.rs",
        }, "a re-run must not disturb the data"

        # 6. Downgrade removes the column; the file rows survive. Re-upgrade
        #    works, and every head pin is gone — which is the correct reversal:
        #    every row reverts to the UNKNOWN it held before this revision.
        rows_before = _file_count(engine)
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert column_info(engine, "pr_files", _COLUMN) is None, (
            "downgrade must drop coord.pr_files.head_sha"
        )
        assert _file_count(engine) == rows_before, (
            "downgrade must not delete pr_files rows"
        )
        assert index_exists(engine, _PRE_EXISTING_INDEX), (
            f"downgrade must leave {_PRE_EXISTING_INDEX} alone — it is not "
            "this revision's to drop"
        )

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert column_info(engine, "pr_files", _COLUMN) == ("text", "YES", None)
        assert _paths_at_head(engine, _CURRENT_HEAD) == set(), (
            "the head pins do not survive a downgrade/upgrade round trip — "
            "every row is UNKNOWN again, which holds rather than releases"
        )
        assert _file_count(engine) == rows_before
