"""Tests for ``scripts/ci/mrt_qualify.py`` -- the qualifier of
``Migration Reversal Tested`` and its non-executable-edit exemption.

Plan ``2026-10-10-small-followups-are-recorded-but-nothing-burns-them-down``,
Phase 1 step 4. What is pinned here:

* **Parity with coord.** :data:`PARITY_ROWS` ports every input pair of coord's
  ``ne2``-``ne20`` tests with coord's verdict, and the port must agree on every
  row. coord's merge engine gates the same PR with that function, so a row that
  disagrees is a defect in one of the two proofs -- never an ``xfail``. The row
  count is printed so a reviewer of either repo can compare it.
* **The eight re-vet rows** (:data:`REVET_ROWS`): shapes an AST comparison would
  wrongly pass and coord's line skeleton refuses.
* **The step 4 pass, fail and mixed cases**, each with the refusal reason.
* **Mutation checks** -- each mutant of the exemption is shown to fail a test
  in this file [policy: a-test-must-be-able-to-fail].
* **The CLI end to end** against a throwaway git repository, the workflow's
  wiring of D9, and the qualifying step and the verdict step executed as the
  shipped ``run:`` bodies.

No database and no network: the proof is pure, the qualifier runs against an
in-memory object reader, and the CLI and step bodies against a repository in
``tmp_path``.
"""

from __future__ import annotations

import ast
import hashlib
import os
import shutil
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any, NamedTuple

import pytest
import yaml  # type: ignore[import-untyped]

from tests.gate_lane_roster import (
    assert_docstring_names_every_lane,
    assert_lane_roster,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_CI = REPO_ROOT / "scripts" / "ci"
sys.path.insert(0, str(SCRIPTS_CI))

import mrt_qualify as mq  # noqa: E402

SCRIPT = SCRIPTS_CI / "mrt_qualify.py"
SCRIPT_REF = "scripts/ci/mrt_qualify.py"
DECLARED_LANES = frozenset({".github/workflows/migration-reversal.yml"})
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "migration-reversal.yml"
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "mrt_qualify"

QUALIFY_STEP = "Qualify the PR's migration and switch to the base tree"
VERDICT_STEP = "Non-executable edits only (no migration to exercise)"
ERROR_B = "::error title=Migration Reversal Tested - condition (b) failed::"
ERROR_A = "::error title=Migration Reversal Tested - condition (a) failed::"

BASE_SHA = "b" * 40
HEAD_SHA = "c" * 40
VERSIONS = "backend/alembic/versions/"


def _git_blob_id(data: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


# ---------------------------------------------------------------------------
# The parity table
# ---------------------------------------------------------------------------
#
# Source: qontinui-coord crates/coord/src/pr_merge/migration_classifier.rs
# (blob 32bca598b3, last changed in 17c7fc4f0), module `tests`, functions
# `ne2_*` .. `ne20_*`: every `is_non_executable_edit(path, base, head)` input
# pair those tests assert, with the verdict they assert -- 51 pairs. `ne1` and
# `ne3` make no such call (no base side), and `ne13` reuses `ne2`'s pair. The
# `WU_AUTHORED_02_BASE` / `_HEAD` fixtures are qontinui-web's own revision text,
# byte copies of coord's `migration_classifier_fixtures/` files (their git blob
# ids are pinned below). Every row's verdict was also confirmed against coord's
# function itself, compiled from that blob, when this table was written.


class ParityRow(NamedTuple):
    name: str
    path: str
    base: bytes
    head: bytes
    expected: bool


WU_PATH = "backend/alembic/versions/coord_wu_authored_at_02_refill_dated_slugs.py"
WU_BASE_FIXTURE = FIXTURES / "coord_wu_authored_at_02_base.py.txt"
WU_HEAD_FIXTURE = FIXTURES / "coord_wu_authored_at_02_head_web1476.py.txt"
# coord: `coord_wu_authored_at_02_base.py` = web 7f3e2b06, blob ffc63b0d...;
# `coord_wu_authored_at_02_head_web1476.py` = web#1476 head 8bb5af0a, blob
# e821bf52... (and byte-identical to the revision on web's main).
WU_BASE_BLOB = "ffc63b0db9924613b94a7f847c7ef271517de540"
WU_HEAD_BLOB = "e821bf52ace5d11378c4680b25f9e6dbeffe4f7d"
WB = WU_BASE_FIXTURE.read_bytes()
WH = WU_HEAD_FIXTURE.read_bytes()

P = "a/alembic/versions/x.py"
NE_INPUT_PAIRS = 51


def _b(text: str) -> bytes:
    return text.encode("utf-8")


def _parity_rows() -> list[ParityRow]:
    rows: list[ParityRow] = []

    def row(name: str, path: str, base: str | bytes, head: str | bytes, ok: bool):
        rows.append(
            ParityRow(
                name,
                path,
                base if isinstance(base, bytes) else _b(base),
                head if isinstance(head, bytes) else _b(head),
                ok,
            )
        )

    # ne2 / ne4 / ne5: the web#1476 docstring-only edit, then two real edits.
    row("ne2", WU_PATH, WB, WH, True)
    row(
        "ne4",
        WU_PATH,
        WB,
        WH.replace(
            b"            UPDATE coord.work_units",
            b"            DELETE FROM coord.work_units",
        ),
        False,
    )
    row(
        "ne5",
        WU_PATH,
        WB,
        WH.replace(b"op.execute(_BACKFILL_SQL)", b"op.execute(_OTHER)"),
        False,
    )
    # ne6 / ne7: comments, docstrings and blank lines; a docstring may not be
    # added or removed.
    tiny = (
        '"""doc one"""\n\nfrom alembic import op\n\nSQL = "DROP TABLE t"\n\n\n'
        'def upgrade() -> None:\n    """up doc"""\n    op.execute(SQL)  # run it\n'
    )
    ne6_head = (
        tiny.replace("doc one", "doc one, rewritten\nacross lines")
        .replace("up doc", "a different up doc")
        .replace("# run it", "# new comment")
        .replace(
            "from alembic import op\n",
            "# a new comment line\nfrom alembic import op\n\n\n",
        )
    )
    row("ne6", P, tiny, ne6_head, True)
    removed = tiny.replace('    """up doc"""\n', "")
    row("ne7.removed", P, tiny, removed, False)
    row("ne7.added", P, removed, tiny, False)
    # ne8: a string that is an operand is code, even at line start.
    base = 'def upgrade():\n    op.execute(\n        "CREATE TABLE a (x int)"\n    )\n'
    row("ne8.operand", P, base, base.replace("TABLE a", "TABLE b"), False)
    base = '"a".join([])\nx = 1\n'
    row("ne8.method", P, base, base.replace('"a"', '"b"'), False)
    row("ne8.concat", P, '"a" "b"\n', '"a" "c"\n', False)
    # ne9: an f-string statement is executable.
    row("ne9", P, "f\"{op.execute('x')}\"\n", "f\"{op.execute('y')}\"\n", False)
    # ne10: a backslash continuation refuses the proof.
    base = "x = 1 + \\\n    2\n"
    row("ne10.same", P, base, base, False)
    row("ne10.string", P, 'x = \\\n"a"\n', 'x = \\\n"b"\n', False)
    # ne11: a coding-cookie change is executable; an unchanged one is not.
    base = "# -*- coding: utf-8 -*-\nx = '\u00e9'\n"
    row("ne11.changed", P, base, "# -*- coding: latin-1 -*-\nx = '\u00e9'\n", False)
    row("ne11.kept", P, base, base + "# unrelated\n", True)
    # ne12: an unlexable side and a .sql path are not proven.
    row("ne12.unlexable", P, "x = '\n", "x = '\n", False)
    row("ne12.sql", "migrations/001.sql", "SELECT 1;", "SELECT 1;", False)
    # ne14 / ne15: code that can read its docstring or source.
    readers = [
        ("ne14.0", "op.execute(__doc__)"),
        ("ne14.1", "op.execute(upgrade.__doc__)"),
        ("ne14.2", "op.execute(inspect.getdoc(upgrade))"),
        ("ne14.3", "op.execute(open(__file__).read())"),
        ("ne14.4", "op.execute(getattr(upgrade, 'x'))"),
        ("ne15.0", 'op.execute(f"{upgrade.__doc__}")'),
        ("ne15.1", 'op.execute("{0.__doc__}".format(upgrade))'),
        ("ne15.2", "op.execute(context.script.get_revision(revision).longdoc)"),
        ("ne15.3", "op.execute(traceback.extract_stack()[-1].line)"),
    ]
    for name, reader in readers:
        base = f'"""CREATE TABLE a (x int)"""\n\ndef upgrade():\n    {reader}\n'
        row(name, P, base, base.replace("TABLE a", "TABLE b"), False)
    # ne16: a docstring that would not compile is not masked; raw may hold `\`.
    base = '"""doc"""\nx = 1\n'
    for i, bad in enumerate(
        [
            '"""C:\\Users\\x"""\nx = 1\n',
            '"""see \\N{BOGUS}"""\nx = 1\n',
            '"""hex \\x4"""\nx = 1\n',
            'b"""caf\u00e9"""\nx = 1\n',
            '"""a\x00b"""\nx = 1\n',
        ]
    ):
        row(f"ne16.{i}", P, base, bad, False)
    row("ne16.raw", P, 'r"""C:\\old"""\nx = 1\n', 'r"""C:\\new\\N{X}"""\nx = 1\n', True)
    # ne17: cookie placement is compared two-sided.
    row(
        "ne17.moved",
        P,
        '"""doc"""\n# -*- coding: latin-1 -*-\nx = "\u00e9"\n',
        '\n# -*- coding: latin-1 -*-\n"""doc"""\nx = "\u00e9"\n',
        False,
    )
    row(
        "ne17.trailing",
        P,
        '# -*- coding: latin-1 -*-\nimport alembic\nx = "\u00e9"\n',
        'import alembic  # -*- coding: latin-1 -*-\nx = "\u00e9"\n',
        False,
    )
    # ne18: bare CR, a non-ASCII spelling of a reader, a doctest runner; CRLF ok.
    row("ne18.bare_cr", P, base, '"doc\rmore"\nx = 1\n', False)
    for name, reader in [
        ("ne18.0", "op.execute(upgrade.__\uff44oc__)"),
        ("ne18.1", "doctest.run_docstring_examples(upgrade, {})"),
    ]:
        reader_base = f'"""CREATE TABLE a (x int)"""\n\ndef upgrade():\n    {reader}\n'
        row(name, P, reader_base, reader_base.replace("TABLE a", "TABLE b"), False)
    row("ne18.crlf", P, '"""doc"""\r\nx = 1\r\n', '"""other doc"""\r\nx = 1\r\n', True)
    # ne19: a non-UTF-8 cookie refuses; UTF-8 spellings pass; empty sides refuse.
    for i, cookie in enumerate(
        ["# -*- coding: ascii -*-", "# vim: set fileencoding=cp1252 :"]
    ):
        cookie_base = f'{cookie}\nrevision = "x"\n"""doc"""\nx = 1\n'
        cookie_head = cookie_base.replace('"""doc"""', '"""doc \u00e9"""')
        row(f"ne19.bad.{i}", P, cookie_base, cookie_head, False)
    for i, cookie in enumerate(
        ["# -*- coding: utf-8 -*-", "# coding=UTF_8", "# coding: utf-8-sig"]
    ):
        cookie_base = f'{cookie}\nrevision = "x"\n"""doc"""\nx = 1\n'
        cookie_head = cookie_base.replace('"""doc"""', '"""doc \u00e9"""')
        row(f"ne19.ok.{i}", P, cookie_base, cookie_head, True)
    sig_base = '# coding: utf8-sig\nx = 1\n"""doc"""\n'
    row("ne19.utf8_sig", P, sig_base, sig_base.replace("doc", "other"), False)
    prose_base = '# see the coding guide\nx = 1\n"""doc"""\n'
    row(
        "ne19.not_a_cookie",
        P,
        prose_base,
        prose_base.replace('"doc"', '"other"'),
        True,
    )
    row("ne19.empty.0", P, "# c\n", "", False)
    row("ne19.empty.1", P, "", "", False)
    row("ne19.empty.2", P, "  \n", "  \n", False)
    # ne20: uppercase prefixes, a line-number observer and a formatter.
    for i, bad in enumerate(
        ['B"""caf\u00e9"""\nx = 1\n', "F\"{op.execute('x')}\"\nx = 1\n"]
    ):
        row(f"ne20.{i}", P, base, bad, False)
    for i, reader in enumerate(
        [
            "if w[0].lineno > 20: op.drop_table('users')",
            "op.execute(string.Formatter().vformat('{0.__doc__}', (upgrade,), {}))",
        ]
    ):
        reader_base = f'"""CREATE TABLE a (x int)"""\n\ndef upgrade():\n    {reader}\n'
        row(
            f"ne20.reader.{i}",
            P,
            reader_base,
            reader_base.replace("TABLE a", "TABLE b"),
            False,
        )
    return rows


PARITY_ROWS = _parity_rows()

# Re-vet rows: AST-equal (an `ast.dump` comparison would pass them) but
# skeleton-different, so coord refuses every one -- as must the port.
REVET_ROWS = [
    ParityRow(name, P, _b(base), _b(head), False)
    for name, base, head in [
        (
            "intra-line whitespace in code",
            '"""d"""\nop.execute(SQL)\n',
            '"""e"""\nop.execute( SQL )\n',
        ),
        (
            "a call re-wrapped over lines",
            '"""d"""\nop.execute(SQL, x)\n',
            '"""d"""\nop.execute(\n    SQL,\n    x,\n)\n',
        ),
        ("a statement string after ;", 'x = 1; "doc"\n', 'x = 1; "other"\n'),
        ("a parenthesised docstring", '("doc")\nx = 1\n', '("other")\nx = 1\n'),
        (
            "a non-statement quote-style change",
            "op.execute('DROP')\n",
            'op.execute("DROP")\n',
        ),
        ("a bare CR", '"""d"""\nx = 1\r# c\n', '"""e"""\nx = 1\r# c\n'),
        ("a one-line compound", 'if x: "doc"\n', 'if x: "other"\n'),
        ("two statements joined by ;", "a = 1\nb = 2\n", "a = 1; b = 2\n"),
    ]
]


def test_wu_fixtures_are_coords_bytes() -> None:
    """The fixtures are byte copies of coord's, or the ne2/ne4/ne5 rows prove
    nothing about coord's verdict on them."""
    assert _git_blob_id(WB) == WU_BASE_BLOB
    assert _git_blob_id(WH) == WU_HEAD_BLOB


def test_parity_table_ports_every_ne_input_pair(capsys: pytest.CaptureFixture) -> None:
    names = [r.name for r in PARITY_ROWS]
    assert len(names) == len(set(names)), "duplicate parity row names"
    assert len(PARITY_ROWS) == NE_INPUT_PAIRS, (
        f"coord's ne2-ne20 tests assert {NE_INPUT_PAIRS} input pairs; the table "
        f"ports {len(PARITY_ROWS)}. A new ne* case in coord needs its row here."
    )
    # Both verdicts occur, so neither a constant True nor a constant False
    # implementation could agree with every row.
    assert {r.expected for r in PARITY_ROWS} == {True, False}
    with capsys.disabled():
        print(
            f"\nmrt_qualify parity table: {len(PARITY_ROWS)} rows ported from "
            f"coord's ne2-ne20 input pairs (migration_classifier.rs blob "
            f"32bca598b3), plus {len(REVET_ROWS)} re-vet rows"
        )


@pytest.mark.parametrize("row", PARITY_ROWS, ids=[r.name for r in PARITY_ROWS])
def test_parity_with_coord(row: ParityRow) -> None:
    verdict = mq.is_non_executable_edit(row.path, row.base, row.head)
    assert verdict.ok is row.expected, (
        f"{row.name}: coord says {row.expected}, the port says {verdict.ok} "
        f"({verdict.reason}). A disagreement is a defect in one of the two "
        "proofs, never an xfail."
    )


@pytest.mark.parametrize("row", REVET_ROWS, ids=[r.name for r in REVET_ROWS])
def test_revet_rows_are_refused(row: ParityRow) -> None:
    verdict = mq.is_non_executable_edit(row.path, row.base, row.head)
    assert not verdict.ok, f"{row.name}: coord refuses it; the port said ok"


def _ast_shape(source: bytes) -> str:
    """``ast.dump`` with every string-constant expression statement's text
    blanked: the comparison the plan's draft proposed instead of the skeleton."""

    class Blank(ast.NodeTransformer):
        def visit_Expr(self, node: ast.Expr) -> ast.AST:
            if isinstance(node.value, ast.Constant) and isinstance(
                node.value.value, str
            ):
                return ast.Expr(value=ast.Constant(value=""))
            return self.generic_visit(node)

    return ast.dump(Blank().visit(ast.parse(source)), include_attributes=False)


def test_revet_rows_would_pass_an_ast_comparison() -> None:
    """Why the proof is a port of coord's line skeleton and not an AST
    comparison: every re-vet row is AST-equal once docstring text is blanked,
    so an AST comparison admits all eight -- and coord, like the port, refuses
    all eight (test_revet_rows_are_refused)."""
    for row in REVET_ROWS:
        assert _ast_shape(row.base) == _ast_shape(row.head), row.name


def test_the_qualifier_source_is_ascii() -> None:
    """An invisible character in the proof module -- a zero-width or exotic
    space inside SOURCE_READERS, the whitespace set or a literal -- would change
    the proof without showing in a review diff. Non-ASCII is written as an
    escape there."""
    source = SCRIPT.read_bytes()
    assert source.isascii(), [
        n for n, line in enumerate(source.split(b"\n"), 1) if not line.isascii()
    ]


def test_source_readers_is_coords_list() -> None:
    """coord's `SOURCE_READERS` at blob 32bca598b3 holds 100 names (a quoted
    string inside one of its comments is not a name). The copy must stay
    verbatim; a spot check of each comment group guards against a truncated
    paste."""
    assert len(mq.SOURCE_READERS) == 100
    for name in (
        "__doc__",
        "__name__",
        "read_bytes",
        "format_map",
        "longdoc",
        "codecs",
        "dis",
        "MigrationContext",
        "ctypes",
        "findCaller",
        "get_field",
        "__init_subclass__",
    ):
        assert name in mq.SOURCE_READERS, name
    # The spot check above cannot see a typo in any of the other names
    # (`getsource` -> `getsourc` keeps the count at 100 and drops a reader,
    # making the port looser than coord). So the WHOLE set is pinned: the
    # sha256 of coord's names, sorted and newline-joined, computed from the
    # Rust array at blob 32bca598b3 (string literals outside `//` comments).
    digest = hashlib.sha256(
        "\n".join(sorted(mq.SOURCE_READERS)).encode("utf-8")
    ).hexdigest()
    assert (
        digest == "b2dad91244a9afe4f63d2318cb4499562a3b78ba8d0d1d09a99013f828c4ae8c"
    ), digest


# ---------------------------------------------------------------------------
# Phase 1 step 4: pass, fail and mixed cases
# ---------------------------------------------------------------------------

REV_PATH = VERSIONS + "example_extension_tables.py"

# A synthetic revision in the shape of the Phase 1 example: a long module
# docstring describing where the matching ORM classes live, then ordinary
# alembic code.
REVISION = '''"""example extension tables

Revision ID: example_extension_tables
Revises: example_parent_revision
Create Date: 2026-04-30

Creates the extension-only tables inside the ``ext`` schema. The matching ORM
classes live in the private example-extension repo and are registered with
SQLAlchemy metadata only when that extension is installed.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "example_extension_tables"
down_revision: str | None = "example_parent_revision"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the extension tables."""
    op.create_table(
        "subscriptions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tier", sa.String(length=32), nullable=False),
        schema="ext",
    )
    "Rows are written by the extension, never by this revision."
    op.execute("COMMENT ON TABLE ext.subscriptions IS 'one row per user'")


def downgrade() -> None:
    """Drop the extension tables."""
    op.drop_table("subscriptions", schema="ext")
'''


class Case(NamedTuple):
    name: str
    base: bytes
    head: bytes
    path: str = REV_PATH


def _edit(old: str, new: str, *, text: str = REVISION) -> bytes:
    assert text.count(old) == 1, old
    return _b(text.replace(old, new))


PASS_CASES = [
    Case(
        "module docstring reworded",
        _b(REVISION),
        _edit(
            "classes live in the private example-extension repo and are",
            "classes live in the example-extension package and are",
        ),
    ),
    Case(
        "function docstring edited",
        _b(REVISION),
        _edit(
            '"""Create the extension tables."""',
            '"""Create the extension tables in the ``ext`` schema."""',
        ),
    ),
    Case(
        "comment added",
        _b(REVISION),
        _edit(
            '        sa.Column("id", sa.Integer(), primary_key=True),\n',
            "        # The surrogate key; nothing outside this table reads it.\n"
            '        sa.Column("id", sa.Integer(), primary_key=True),  # pk\n',
        ),
    ),
    Case(
        "blank lines and trailing whitespace",
        _b(REVISION),
        _edit(
            "import sqlalchemy as sa\nfrom alembic import op\n",
            "import sqlalchemy as sa   \n\n\nfrom alembic import op\t\n",
        ),
    ),
    Case(
        "bare mid-body string statement edited",
        _b(REVISION),
        _edit(
            '    "Rows are written by the extension, never by this revision."\n',
            '    "Rows are written only by the extension, never here."\n',
        ),
    ),
]


class FailCase(NamedTuple):
    name: str
    base: bytes
    head: bytes
    reason: str
    path: str = REV_PATH


def _prefixed(prefix: str, text: str = REVISION) -> str:
    return prefix + text


# The edit lands below physical line 2, so the cookie lines stay identical and
# the refusal is the codec, not the cookie's placement.
ASCII_BASE = _prefixed("# -*- coding: ascii -*-\n")
ASCII_HEAD = ASCII_BASE.replace(
    "Creates the extension-only tables", "Creates the caf\u00e9 tables", 1
)

FAIL_CASES = [
    FailCase(
        "statement changed in upgrade()",
        _b(REVISION),
        _edit("nullable=False", "nullable=True"),
        "executable_diff",
    ),
    FailCase(
        "op.execute literal changed",
        _b(REVISION),
        _edit("'one row per user'", "'one row per account'"),
        "executable_diff",
    ),
    FailCase(
        "down_revision changed",
        _b(REVISION),
        _edit(
            'down_revision: str | None = "example_parent_revision"',
            'down_revision: str | None = "another_parent_revision"',
        ),
        "executable_diff",
    ),
    FailCase(
        "docstring added",
        _edit('    """Drop the extension tables."""\n', ""),
        _b(REVISION),
        "executable_diff",
    ),
    FailCase(
        "docstring removed",
        _b(REVISION),
        _edit('    """Create the extension tables."""\n', ""),
        "executable_diff",
    ),
    FailCase(
        "implicitly concatenated string statement edited",
        _b(REVISION + '\n"part one" "part two"\n'),
        _b(REVISION + '\n"part one" "part 2"\n'),
        "executable_diff",
    ),
    FailCase(
        "non-raw docstring gains a backslash",
        _b(REVISION),
        _edit("inside the ``ext`` schema.", "inside the ``ext\\cloud`` schema."),
        "executable_diff",
    ),
    FailCase(
        "unchanged f-string field reads __doc__",
        _b(REVISION + 'NOTE = f"{upgrade.__doc__}"\n'),
        _b(
            REVISION.replace("Create the extension tables.", "Create them.")
            + 'NOTE = f"{upgrade.__doc__}"\n'
        ),
        "fstring_field",
    ),
    FailCase(
        "__doc__ read in the file",
        _b(REVISION + "NOTE = upgrade.__doc__\n"),
        _b(
            REVISION.replace("Create the extension tables.", "Create them.")
            + "NOTE = upgrade.__doc__\n"
        ),
        "source_reader:__doc__",
    ),
    FailCase(
        "a metaclass= keyword",
        _b(REVISION + 'class Holder(Base, metaclass=Meta):\n    """doc"""\n'),
        _b(REVISION + 'class Holder(Base, metaclass=Meta):\n    """new doc"""\n'),
        "source_reader:metaclass",
    ),
    FailCase(
        "a def __init_subclass__",
        _b(
            REVISION + 'class Base:\n    """doc"""\n\n'
            "    def __init_subclass__(cls):\n        pass\n"
        ),
        _b(
            REVISION + 'class Base:\n    """new doc"""\n\n'
            "    def __init_subclass__(cls):\n        pass\n"
        ),
        "source_reader:__init_subclass__",
    ),
    FailCase(
        "coding cookie changed",
        _b(_prefixed("# -*- coding: utf-8 -*-\n")),
        _b(_prefixed("# -*- coding: utf8 -*-\n")),
        "encoding_cookie",
    ),
    FailCase(
        "an ascii cookie with a docstring gaining a non-ASCII letter",
        _b(ASCII_BASE),
        _b(ASCII_HEAD),
        "non_utf8_cookie",
    ),
    FailCase(
        "a non-ASCII identifier",
        _b(REVISION + "caf\u00e9 = 1\n"),
        _b(
            REVISION.replace("Create the extension tables.", "Create them.")
            + "caf\u00e9 = 1\n"
        ),
        "non_ascii_identifier",
    ),
    FailCase(
        "a syntax error at the base",
        _edit("def downgrade() -> None:", "def downgrade( -> None:"),
        _b(REVISION),
        "parse_error_base",
    ),
    FailCase(
        "a syntax error at the head",
        _b(REVISION),
        _edit("def downgrade() -> None:", "def downgrade( -> None:"),
        "parse_error_head",
    ),
    FailCase("an empty side", b"", _b(REVISION), "empty_side"),
    FailCase("a whitespace-only side", _b(REVISION), b" \n\t\n", "empty_side"),
    FailCase(
        "a .sql path",
        b"SELECT 1;\n",
        b"SELECT 1; -- note\n",
        "not_py",
        VERSIONS + "raw.sql",
    ),
    FailCase(
        "a bare CR",
        _b(REVISION),
        _edit("never by this revision.", "never by\rthis revision."),
        "bare_cr",
    ),
    FailCase(
        "a backslash line continuation",
        _b(REVISION + "TOTAL = 1 + \\\n    2\n"),
        _b(
            REVISION.replace("Create the extension tables.", "Create them.")
            + "TOTAL = 1 + \\\n    2\n"
        ),
        "line_continuation",
    ),
    FailCase(
        "a form feed outside a literal",
        _b(REVISION + "\x0c\nLIMIT = 1\n"),
        _b(
            REVISION.replace("Create the extension tables.", "Create them.")
            + "\x0c\nLIMIT = 1\n"
        ),
        "form_feed",
    ),
    FailCase(
        "a UTF-8 byte-order mark",
        b"\xef\xbb\xbf" + _b(REVISION),
        b"\xef\xbb\xbf"
        + _b(REVISION.replace("Create the extension tables.", "Create them.")),
        "bom",
    ),
    FailCase(
        "a one-line literal continued over CRLF",
        _b(
            (REVISION + 'NOTE = "a\\\nb"\n').replace("\n", "\r\n"),
        ),
        _b(
            (
                REVISION.replace("Create the extension tables.", "Create them.")
                + 'NOTE = "a\\\nb"\n'
            ).replace("\n", "\r\n")
        ),
        "string_crlf_continuation",
    ),
]


def _assert_exempt(case: Case) -> None:
    verdict = mq.is_non_executable_edit(case.path, case.base, case.head)
    assert verdict.ok, f"{case.name}: refused ({verdict.reason})"


def _assert_refused(case: FailCase) -> None:
    verdict = mq.is_non_executable_edit(case.path, case.base, case.head)
    assert not verdict.ok, f"{case.name}: the port admitted it"
    assert verdict.reason == case.reason, (
        f"{case.name}: refused for {verdict.reason}, expected {case.reason}"
    )


@pytest.mark.parametrize("case", PASS_CASES, ids=[c.name for c in PASS_CASES])
def test_pass_case_is_a_non_executable_edit(case: Case) -> None:
    assert case.base != case.head
    _assert_exempt(case)


@pytest.mark.parametrize("case", FAIL_CASES, ids=[c.name for c in FAIL_CASES])
def test_fail_case_is_refused_with_its_reason(case: FailCase) -> None:
    _assert_refused(case)


def test_an_ascii_cookie_is_refused_although_a_text_decoded_parse_passes() -> None:
    """Why the proof parses BYTES: decoded text ignores the cookie, so the head
    parses as text while the interpreter -- which reads the bytes and honours
    the cookie -- cannot import it."""
    ast.parse(ASCII_HEAD)  # text: no error
    with pytest.raises(SyntaxError):
        ast.parse(_b(ASCII_HEAD))  # bytes, `coding: ascii`: the import would fail
    _assert_refused(
        FailCase("ascii cookie", _b(ASCII_BASE), _b(ASCII_HEAD), "non_utf8_cookie")
    )


def test_identical_sides_pass() -> None:
    assert mq.is_non_executable_edit(REV_PATH, _b(REVISION), _b(REVISION)).ok


def test_skeleton_keeps_code_and_masks_statement_strings() -> None:
    lines = mq.executable_skeleton(_b(REVISION))
    assert isinstance(lines, list)
    placeholder = mq.DOCSTRING_PLACEHOLDER
    assert lines[0] == placeholder  # the module docstring
    assert '    """Create the extension tables."""' not in lines
    assert f"    {placeholder}" in lines  # function docstrings, the bare string
    assert (
        "    op.execute(\"COMMENT ON TABLE ext.subscriptions IS 'one row per user'\")"
        in lines
    )
    assert 'revision: str = "example_extension_tables"' in lines
    assert all(line.strip() and line == line.rstrip() for line in lines)


# ---------------------------------------------------------------------------
# The qualifier (conditions (a) and (b)), in process
# ---------------------------------------------------------------------------


class FakeObjects:
    """An in-memory :class:`mrt_qualify.ObjectReader`: ``{sha: {path: (mode,
    bytes)}}``. A path absent from a commit is absent; ``fail`` names commits
    whose reads raise."""

    def __init__(
        self,
        trees: dict[str, dict[str, tuple[str, bytes]]],
        fail: frozenset[str] = frozenset(),
    ) -> None:
        self.trees = trees
        self.fail = fail
        self.blobs: dict[str, bytes] = {}

    def entry(self, sha: str, path: str) -> tuple[str, str, str] | None:
        if sha in self.fail:
            raise mq.GitReadError(f"cannot read {sha}")
        found = self.trees.get(sha, {}).get(path)
        if found is None:
            return None
        mode, data = found
        oid = _git_blob_id(data)
        self.blobs[oid] = data
        return mode, "blob", oid

    def blob(self, oid: str) -> bytes:
        return self.blobs[oid]


def _objects(
    base: dict[str, bytes | tuple[str, bytes]],
    head: dict[str, bytes | tuple[str, bytes]],
    **kwargs: frozenset[str],
) -> FakeObjects:
    def tree(
        files: dict[str, bytes | tuple[str, bytes]],
    ) -> dict[str, tuple[str, bytes]]:
        return {
            p: v if isinstance(v, tuple) else ("100644", v) for p, v in files.items()
        }

    return FakeObjects({BASE_SHA: tree(base), HEAD_SHA: tree(head)}, **kwargs)


def _qualify(entries: list[mq.Entry], objects: FakeObjects) -> mq.Qualified:
    return mq.qualify(entries, BASE_SHA, HEAD_SHA, objects, say=lambda _line: None)


def _m(path: str = REV_PATH) -> mq.Entry:
    return mq.Entry("M", (path,))


def _a(path: str) -> mq.Entry:
    return mq.Entry("A", (path,))


DOC_EDIT = PASS_CASES[0]
CODE_EDIT = FAIL_CASES[0]
NEW_MIGRATION = VERSIONS + "example_follow_up_01.py"


def test_doc_only_change_set_is_a_positive_verdict() -> None:
    objects = _objects({REV_PATH: DOC_EDIT.base}, {REV_PATH: DOC_EDIT.head})
    result = _qualify([_m()], objects)
    assert result == mq.Qualified(migration=None, non_executable_edits=(REV_PATH,))
    assert result.env_lines() == [
        "MRT_DOC_ONLY=1",
        "MRT_NON_EXECUTABLE_EDITS=1",
        f"MRT_NON_EXECUTABLE_FILES={REV_PATH}",
    ]


def test_mixed_added_migration_and_exempt_edit_tests_the_added_file() -> None:
    other = VERSIONS + "other_revision.py"
    objects = _objects(
        {other: DOC_EDIT.base},
        {other: DOC_EDIT.head, NEW_MIGRATION: _b(REVISION)},
    )
    result = _qualify([_m(other), _a(NEW_MIGRATION)], objects)
    assert result.migration == NEW_MIGRATION
    assert result.non_executable_edits == (other,)
    assert result.env_lines() == ["MRT_DOC_ONLY=0", f"MRT_MIGRATION={NEW_MIGRATION}"]


def test_an_added_migration_alone_qualifies_as_before() -> None:
    objects = _objects({}, {NEW_MIGRATION: _b(REVISION)})
    result = _qualify([_a(NEW_MIGRATION)], objects)
    assert result == mq.Qualified(migration=NEW_MIGRATION, non_executable_edits=())


def test_upgrade_change_still_fails_condition_b_with_its_reason() -> None:
    objects = _objects({REV_PATH: CODE_EDIT.base}, {REV_PATH: CODE_EDIT.head})
    with pytest.raises(mq.ConditionError) as failed:
        _qualify([_m()], objects)
    assert failed.value.cond == "b"
    assert f"M {REV_PATH} (not exempt: executable_diff)" in failed.value.message


def test_one_exempt_and_one_non_exempt_edit_fail_condition_b() -> None:
    other = VERSIONS + "other_revision.py"
    objects = _objects(
        {REV_PATH: DOC_EDIT.base, other: CODE_EDIT.base},
        {REV_PATH: DOC_EDIT.head, other: CODE_EDIT.head},
    )
    with pytest.raises(mq.ConditionError) as failed:
        _qualify([_m(), _m(other)], objects)
    assert failed.value.cond == "b"
    assert f"M {other} (not exempt: executable_diff)" in failed.value.message
    assert f"M {REV_PATH}" not in failed.value.message  # the exempt one is not refused


@pytest.mark.parametrize(
    "entry",
    [
        mq.Entry("R100", (REV_PATH, VERSIONS + "renamed_identical.py")),
        mq.Entry("D", (REV_PATH,)),
        mq.Entry("T", (REV_PATH,)),
        mq.Entry("C75", (REV_PATH, VERSIONS + "copied.py")),
    ],
    ids=["rename R100 of a byte-identical file", "deletion", "type change", "copy"],
)
def test_non_m_changes_still_fail_condition_b(entry: mq.Entry) -> None:
    objects = _objects({REV_PATH: _b(REVISION)}, {REV_PATH: _b(REVISION)})
    with pytest.raises(mq.ConditionError) as failed:
        _qualify([entry], objects)
    assert failed.value.cond == "b"
    assert entry.shown in failed.value.message
    assert "(not exempt:" not in failed.value.message


@pytest.mark.parametrize(
    ("base", "head", "fail", "reason"),
    [
        (
            ("100644", DOC_EDIT.base),
            ("100755", DOC_EDIT.head),
            frozenset(),
            "mode_changed",
        ),
        (
            ("120000", DOC_EDIT.base),
            ("120000", DOC_EDIT.head),
            frozenset(),
            "not_regular_file",
        ),
        (None, ("100644", DOC_EDIT.head), frozenset(), "absent_at_base"),
        (("100644", DOC_EDIT.base), None, frozenset(), "absent_at_head"),
        (
            ("100644", DOC_EDIT.base),
            ("100644", DOC_EDIT.head),
            frozenset({BASE_SHA}),
            "unreadable_base",
        ),
        (
            ("100644", DOC_EDIT.base),
            ("100644", DOC_EDIT.head),
            frozenset({HEAD_SHA}),
            "unreadable_head",
        ),
    ],
    ids=[
        "mode change",
        "symlink",
        "absent at the base tip",
        "absent at the head",
        "base unreadable",
        "head unreadable",
    ],
)
def test_a_doc_edit_is_never_exempt_without_two_readable_regular_blobs(
    base: tuple[str, bytes] | None,
    head: tuple[str, bytes] | None,
    fail: frozenset[str],
    reason: str,
) -> None:
    objects = FakeObjects(
        {
            BASE_SHA: {REV_PATH: base} if base else {},
            HEAD_SHA: {REV_PATH: head} if head else {},
        },
        fail=fail,
    )
    assert mq.exemption(REV_PATH, BASE_SHA, HEAD_SHA, objects) == mq.Verdict(
        False, reason
    )
    with pytest.raises(mq.ConditionError) as failed:
        _qualify([_m()], objects)
    assert f"(not exempt: {reason})" in failed.value.message


def test_a_non_py_edit_is_refused_before_any_read() -> None:
    objects = FakeObjects({}, fail=frozenset({BASE_SHA, HEAD_SHA}))
    assert mq.exemption(
        VERSIONS + "README.md", BASE_SHA, HEAD_SHA, objects
    ) == mq.Verdict(False, "not_py")


@pytest.mark.parametrize(
    ("entries", "message"),
    [
        ([], "this PR adds 0"),
        ([_a(NEW_MIGRATION), _a(VERSIONS + "second_01.py")], "this PR adds 2"),
        ([_a(VERSIONS + "sub/nested_01.py")], "is not a top-level .py migration file"),
        ([_a(VERSIONS + "notes.txt")], "is not a top-level .py migration file"),
    ],
    ids=["nothing added", "two added", "a nested file", "a non-.py file"],
)
def test_condition_a_is_unchanged_for_added_files(
    entries: list[mq.Entry], message: str
) -> None:
    objects = _objects({}, {e.paths[0]: _b(REVISION) for e in entries})
    with pytest.raises(mq.ConditionError) as failed:
        _qualify(entries, objects)
    assert failed.value.cond == "a"
    assert message in failed.value.message


def test_a_change_outside_versions_is_ignored() -> None:
    objects = _objects({}, {NEW_MIGRATION: _b(REVISION)})
    entries = [mq.Entry("M", ("backend/app/models/x.py",)), _a(NEW_MIGRATION)]
    assert _qualify(entries, objects).migration == NEW_MIGRATION


def test_name_status_parser() -> None:
    raw = (
        f"M\0{REV_PATH}\0R100\0{VERSIONS}a.py\0{VERSIONS}b.py\0A\0{NEW_MIGRATION}\0"
    ).encode()
    assert mq.parse_name_status(raw) == [
        mq.Entry("M", (REV_PATH,)),
        mq.Entry("R100", (f"{VERSIONS}a.py", f"{VERSIONS}b.py")),
        mq.Entry("A", (NEW_MIGRATION,)),
    ]
    with pytest.raises(mq.ConditionError) as failed:
        mq.parse_name_status(f"R100\0{VERSIONS}a.py\0".encode())
    assert failed.value.cond == "b"
    assert "refusing to guess" in failed.value.message


def test_a_path_that_could_break_the_env_line_is_escaped() -> None:
    odd = VERSIONS + "a\nMRT_DOC_ONLY=0,b.py"
    lines = mq.Qualified(migration=None, non_executable_edits=(odd,)).env_lines()
    assert all("\n" not in line for line in lines)
    assert (
        lines[2]
        == "MRT_NON_EXECUTABLE_FILES=" + VERSIONS + "a\\nMRT_DOC_ONLY=0\\x2cb.py"
    )


# ---------------------------------------------------------------------------
# Mutation checks [policy: a-test-must-be-able-to-fail]
# ---------------------------------------------------------------------------


def _with_exemption(
    monkeypatch: pytest.MonkeyPatch,
    impl: Callable[[str, bytes, bytes], mq.Verdict],
) -> None:
    monkeypatch.setattr(mq, "is_non_executable_edit", impl)


def test_mutant_without_the_exemption_fails_every_pass_case(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _with_exemption(monkeypatch, lambda *_: mq.Verdict(False, "exemption_removed"))
    for case in PASS_CASES:
        with pytest.raises(AssertionError):
            _assert_exempt(case)
        objects = _objects({case.path: case.base}, {case.path: case.head})
        with pytest.raises(mq.ConditionError) as failed:
            _qualify([_m(case.path)], objects)
        assert failed.value.cond == "b", case.name


def test_mutant_that_always_exempts_fails_the_upgrade_case(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _with_exemption(monkeypatch, lambda *_: mq.OK)
    with pytest.raises(AssertionError):
        _assert_refused(CODE_EDIT)
    objects = _objects({REV_PATH: CODE_EDIT.base}, {REV_PATH: CODE_EDIT.head})
    # Under the mutant the upgrade() change would "qualify" as doc-only --
    # exactly what test_upgrade_change_still_fails_condition_b_with_its_reason
    # refuses.
    assert _qualify([_m()], objects).migration is None


# ---------------------------------------------------------------------------
# The CLI, end to end, against a throwaway repository
# ---------------------------------------------------------------------------


def _clean_env() -> dict[str, str]:
    """The environment minus every GIT_* variable, so a test run from inside a
    git hook (GIT_DIR / GIT_INDEX_FILE set) cannot point the throwaway repo's
    git at the real one."""
    return {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}


class Repo:
    def __init__(self, root: Path) -> None:
        self.root = root
        hooks = root.parent / f"{root.name}-no-hooks"
        hooks.mkdir()
        root.mkdir()
        self.git("init", "--quiet", "--initial-branch=main")
        for key, value in (
            ("user.name", "mrt-qualify test"),
            ("user.email", "mrt-qualify@example.invalid"),
            ("core.autocrlf", "false"),
            ("core.hooksPath", str(hooks)),
            ("commit.gpgsign", "false"),
        ):
            self.git("config", key, value)

    def git(self, *args: str) -> str:
        proc = subprocess.run(
            ["git", *args],
            cwd=self.root,
            env=_clean_env(),
            capture_output=True,
            check=True,
        )
        return proc.stdout.decode("utf-8", "replace").strip()

    def write(self, rel: str, data: bytes) -> None:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def commit(self, message: str) -> str:
        self.git("add", "--all")
        self.git("commit", "--quiet", "--allow-empty", "-m", message)
        return self.git("rev-parse", "HEAD")


def _run_cli(repo: Repo, base: str, head: str) -> tuple[int, str, str]:
    diff = repo.root.parent / "mrt-diff.bin"
    diff.write_bytes(
        subprocess.run(
            ["git", "diff", "-z", "--name-status", "-M", f"{base}...{head}"],
            cwd=repo.root,
            env=_clean_env(),
            capture_output=True,
            check=True,
        ).stdout
    )
    env_out = repo.root.parent / "mrt-env"
    if env_out.exists():
        env_out.unlink()
    proc = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--diff",
            str(diff),
            "--base",
            base,
            "--head",
            head,
            "--env-out",
            str(env_out),
        ],
        cwd=repo.root,
        env=_clean_env(),
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    written = env_out.read_text(encoding="utf-8") if env_out.exists() else ""
    return proc.returncode, proc.stdout, written


@pytest.fixture
def repo(tmp_path: Path) -> Repo:
    return Repo(tmp_path / "repo")


def _base_and_branch(repo: Repo, files: dict[str, bytes]) -> str:
    for rel, data in files.items():
        repo.write(rel, data)
    base = repo.commit("base")
    repo.git("checkout", "--quiet", "-b", "pr")
    return base


def test_cli_doc_only_pr_writes_the_doc_only_verdict(repo: Repo) -> None:
    base = _base_and_branch(repo, {REV_PATH: DOC_EDIT.base})
    repo.write(REV_PATH, DOC_EDIT.head)
    head = repo.commit("docstring only")
    code, out, env = _run_cli(repo, base, head)
    assert code == 0, out
    assert env == (
        "MRT_DOC_ONLY=1\nMRT_NON_EXECUTABLE_EDITS=1\n"
        f"MRT_NON_EXECUTABLE_FILES={REV_PATH}\n"
    )
    assert f"  exempt: {REV_PATH} is a proven non-executable edit" in out


def test_cli_upgrade_change_fails_condition_b(repo: Repo) -> None:
    base = _base_and_branch(repo, {REV_PATH: CODE_EDIT.base})
    repo.write(REV_PATH, CODE_EDIT.head)
    head = repo.commit("code change")
    code, out, env = _run_cli(repo, base, head)
    assert code == 1
    assert out.splitlines()[-1].startswith(ERROR_B)
    assert "(not exempt: executable_diff)" in out
    assert env == ""  # nothing is written on failure


def test_cli_mixed_pr_tests_the_added_migration(repo: Repo) -> None:
    base = _base_and_branch(repo, {REV_PATH: DOC_EDIT.base})
    repo.write(REV_PATH, DOC_EDIT.head)
    repo.write(NEW_MIGRATION, _b(REVISION))
    head = repo.commit("doc edit plus a new migration")
    code, out, env = _run_cli(repo, base, head)
    assert code == 0, out
    assert env == f"MRT_DOC_ONLY=0\nMRT_MIGRATION={NEW_MIGRATION}\n"


def test_cli_rename_of_an_identical_file_fails_condition_b(repo: Repo) -> None:
    base = _base_and_branch(repo, {REV_PATH: _b(REVISION)})
    repo.git("mv", REV_PATH, VERSIONS + "renamed_tables.py")
    head = repo.commit("rename")
    code, out, _ = _run_cli(repo, base, head)
    assert code == 1
    assert out.splitlines()[-1].startswith(ERROR_B)
    assert f"R100 {REV_PATH} -> {VERSIONS}renamed_tables.py" in out


def test_cli_mode_change_fails_condition_b(repo: Repo) -> None:
    base = _base_and_branch(repo, {REV_PATH: DOC_EDIT.base})
    repo.write(REV_PATH, DOC_EDIT.head)
    # The mode is set on disk AND in the index: with core.filemode=true
    # (Linux) `commit`'s `add --all` re-stages the working-tree mode, so an
    # index-only chmod would be undone; with core.filemode=false (Windows) the
    # disk bit is ignored and the index flag is what persists.
    target = repo.root / REV_PATH
    target.chmod(target.stat().st_mode | 0o111)
    repo.git("add", REV_PATH)
    repo.git("update-index", "--chmod=+x", REV_PATH)
    head = repo.commit("doc edit and chmod +x")
    # Prove the fixture did what it claims before judging the verdict.
    assert repo.git("ls-tree", head, REV_PATH).startswith("100755 ")
    code, out, _ = _run_cli(repo, base, head)
    assert code == 1
    assert "(not exempt: mode_changed)" in out


def test_cli_judges_an_edit_against_the_base_tip_not_the_merge_base(
    repo: Repo,
) -> None:
    """coord compares the land target's text. A docstring-only PR branched
    before main changed the same revision's code is NOT a non-executable edit
    of what it lands on."""
    fork = _base_and_branch(repo, {REV_PATH: DOC_EDIT.base})
    repo.write(REV_PATH, DOC_EDIT.head)
    head = repo.commit("docstring only, on the old base")
    repo.git("checkout", "--quiet", "main")
    repo.write(REV_PATH, CODE_EDIT.head)
    tip = repo.commit("main changes the code")
    assert repo.git("merge-base", tip, head) == fork
    code, out, _ = _run_cli(repo, tip, head)
    assert code == 1
    assert "(not exempt: executable_diff)" in out


def test_cli_unreadable_diff_is_not_a_pass(tmp_path: Path) -> None:
    proc = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--diff",
            str(tmp_path / "missing.bin"),
            "--base",
            BASE_SHA,
            "--head",
            HEAD_SHA,
            "--env-out",
            str(tmp_path / "env"),
        ],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 1
    assert proc.stdout.startswith(ERROR_B)
    assert not (tmp_path / "env").exists()


# ---------------------------------------------------------------------------
# The workflow: lane roster, D9 wiring, and the shipped step bodies
# ---------------------------------------------------------------------------


def _tested_steps() -> list[dict[str, Any]]:
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    steps: list[dict[str, Any]] = doc["jobs"]["tested"]["steps"]
    return steps


def _step(name: str) -> dict[str, Any]:
    matches = [s for s in _tested_steps() if s.get("name") == name]
    assert len(matches) == 1, f"job `tested` has {len(matches)} steps named {name!r}"
    return matches[0]


def test_lane_roster() -> None:
    assert_lane_roster(SCRIPT_REF, DECLARED_LANES)
    assert_docstring_names_every_lane(mq.__doc__, SCRIPT_REF, DECLARED_LANES)


def test_the_qualifying_step_runs_the_script_not_an_inline_copy() -> None:
    body = _step(QUALIFY_STEP)["run"]
    assert "python3 scripts/ci/mrt_qualify.py" in body
    for flag in ("--diff", "--base", "--head", "--env-out"):
        assert flag in body, flag
    assert "python3 -" not in body and "<<'PY'" not in body


def test_python_is_set_up_before_the_qualifier() -> None:
    names = [s.get("name") for s in _tested_steps()]
    assert names.index("Set up Python") < names.index(QUALIFY_STEP)
    assert names.count("Set up Python") == 1


POST_MORTEMS = {
    "Name an unavailable postgresql client",
    "Explain infrastructure timeout vs external cancellation",
}


def test_every_later_step_is_skipped_on_a_doc_only_change_set() -> None:
    """D9: every step after the qualifier is guarded, except the verdict step
    (which runs ONLY then) and the two failure post-mortems (see the comment
    above the verdict step)."""
    steps = _tested_steps()
    names = [s.get("name") for s in steps]
    later = steps[names.index(QUALIFY_STEP) + 1 :]
    guarded = 0
    for step in later:
        name = step.get("name")
        condition = " ".join(str(step.get("if", "")).split())
        if name == VERDICT_STEP:
            assert condition == "env.MRT_DOC_ONLY == '1'"
        elif name in POST_MORTEMS:
            assert "MRT_DOC_ONLY" not in condition
        else:
            assert condition == "env.MRT_DOC_ONLY != '1'", (
                f"step {name!r} would run on a doc-only change set ({condition!r})"
            )
            guarded += 1
    assert guarded >= 9, f"only {guarded} guarded steps found; the scan is vacuous"
    assert VERDICT_STEP in names


def _bash() -> str:
    bash = shutil.which("bash")
    assert bash, "bash is required to execute the shipped step bodies"
    return bash


def _run_step(
    body: str, env: dict[str, str], cwd: Path
) -> subprocess.CompletedProcess[str]:
    """Run a `run:` body the way GitHub does: `bash --noprofile --norc -eo
    pipefail`."""
    return subprocess.run(
        [_bash(), "--noprofile", "--norc", "-eo", "pipefail", "-s"],
        input=body,
        env=env,
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


def _posix(path: Path | str) -> str:
    return str(path).replace("\\", "/")


@pytest.fixture
def step_env(tmp_path: Path) -> dict[str, str]:
    """RUNNER_TEMP, GITHUB_ENV and GITHUB_STEP_SUMMARY in tmp_path, and a
    `python3` on PATH that is this interpreter (the step calls `python3`)."""
    runner_temp = tmp_path / "runner-temp"
    runner_temp.mkdir()
    shim_dir = tmp_path / "bin"
    shim_dir.mkdir()
    shim = shim_dir / "python3"
    shim.write_text(
        f'#!/bin/sh\nexec "{_posix(sys.executable)}" "$@"\n',
        encoding="utf-8",
        newline="\n",
    )
    shim.chmod(0o755)
    env = _clean_env()
    env["PATH"] = str(shim_dir) + os.pathsep + env.get("PATH", "")
    env["RUNNER_TEMP"] = _posix(runner_temp)
    env["GITHUB_ENV"] = _posix(tmp_path / "github-env")
    env["GITHUB_STEP_SUMMARY"] = _posix(tmp_path / "step-summary.md")
    (tmp_path / "github-env").write_text("", encoding="utf-8")
    return env


def _install_script(repo: Repo) -> None:
    target = repo.root / "scripts" / "ci" / "mrt_qualify.py"
    target.parent.mkdir(parents=True)
    shutil.copyfile(SCRIPT, target)


def test_qualifying_step_skips_its_remainder_on_a_doc_only_change_set(
    repo: Repo, step_env: dict[str, str]
) -> None:
    """D9 (i): the head-mode check, the base-tip check and the switch to the
    base read MRT_MIGRATION, so on a doc-only change set they are skipped IN the
    step -- the tree is left where it was."""
    base = _base_and_branch(repo, {REV_PATH: DOC_EDIT.base})
    repo.write(REV_PATH, DOC_EDIT.head)
    head = repo.commit("docstring only")
    _install_script(repo)
    env = {**step_env, "BASE_SHA": base, "HEAD_SHA": head}
    proc = _run_step(_step(QUALIFY_STEP)["run"], env, repo.root)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    github_env = Path(step_env["GITHUB_ENV"]).read_text(encoding="utf-8")
    assert "MRT_DOC_ONLY=1\n" in github_env
    assert "MRT_MIGRATION" not in github_env
    assert repo.git("rev-parse", "HEAD") == head  # never switched to the base
    assert "Tree is the pure base" not in proc.stdout


def test_qualifying_step_switches_to_the_base_for_an_added_migration(
    repo: Repo, step_env: dict[str, str]
) -> None:
    base = _base_and_branch(repo, {REV_PATH: DOC_EDIT.base})
    repo.write(REV_PATH, DOC_EDIT.head)
    repo.write(NEW_MIGRATION, _b(REVISION))
    head = repo.commit("doc edit plus a new migration")
    _install_script(repo)
    env = {**step_env, "BASE_SHA": base, "HEAD_SHA": head}
    proc = _run_step(_step(QUALIFY_STEP)["run"], env, repo.root)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    github_env = Path(step_env["GITHUB_ENV"]).read_text(encoding="utf-8")
    assert f"MRT_MIGRATION={NEW_MIGRATION}\n" in github_env
    assert "MRT_DOC_ONLY=0\n" in github_env
    assert repo.git("rev-parse", "HEAD") == base
    assert f"Tree is the pure base {base}." in proc.stdout


def test_qualifying_step_fails_an_upgrade_change(
    repo: Repo, step_env: dict[str, str]
) -> None:
    base = _base_and_branch(repo, {REV_PATH: CODE_EDIT.base})
    repo.write(REV_PATH, CODE_EDIT.head)
    head = repo.commit("code change")
    _install_script(repo)
    env = {**step_env, "BASE_SHA": base, "HEAD_SHA": head}
    proc = _run_step(_step(QUALIFY_STEP)["run"], env, repo.root)
    assert proc.returncode != 0
    assert ERROR_B in proc.stdout
    assert Path(step_env["GITHUB_ENV"]).read_text(encoding="utf-8") == ""


def test_verdict_step_names_what_was_proven(
    tmp_path: Path, step_env: dict[str, str]
) -> None:
    """D9: the job's success on a doc-only change set rests on this line."""
    env = {
        **step_env,
        "MRT_NON_EXECUTABLE_EDITS": "2",
        "MRT_NON_EXECUTABLE_FILES": f"{REV_PATH},{NEW_MIGRATION}",
    }
    proc = _run_step(_step(VERDICT_STEP)["run"], env, tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    verdict = f"MRT_VERDICT ok non_executable_edits=2 files={REV_PATH},{NEW_MIGRATION}"
    assert proc.stdout.splitlines()[-1] == verdict
    assert verdict in Path(step_env["GITHUB_STEP_SUMMARY"]).read_text(encoding="utf-8")


@pytest.mark.parametrize(
    ("count", "files"),
    [("", REV_PATH), ("0", REV_PATH), ("1", ""), ("x", REV_PATH)],
    ids=["no count", "zero", "no files", "not a number"],
)
def test_verdict_step_refuses_an_absent_verdict(
    tmp_path: Path, step_env: dict[str, str], count: str, files: str
) -> None:
    env = {
        **step_env,
        "MRT_NON_EXECUTABLE_EDITS": count,
        "MRT_NON_EXECUTABLE_FILES": files,
    }
    proc = _run_step(_step(VERDICT_STEP)["run"], env, tmp_path)
    assert proc.returncode == 1
    assert proc.stdout.startswith(ERROR_B)
    assert "MRT_VERDICT" not in proc.stdout
