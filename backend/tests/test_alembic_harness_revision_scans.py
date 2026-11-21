"""Pins ``_alembic_harness``'s revision readers: the statement shape and the E6 scan.

``statement_shape`` is what a golden comparison of a revision's ``upgrade()`` or
``downgrade()`` reads, so it must refuse a statement it cannot render rather
than skip it. ``destructive_words_outside_downgrade`` claims to read at least
the region coord's alembic re-point (its E6 clause) reads, with a rule that
matches every token E6 matches; these cases pin both halves of that claim, that
prose E6 blanks is not read while a docstring E6 reads as code is, and the one
named exception (a module E6 cannot lex). No database needed.
"""

from __future__ import annotations

import ast

import pytest

from tests._alembic_harness import (
    E6_FORMS,
    ENTER_AUTOCOMMIT,
    LEAVE_AUTOCOMMIT,
    destructive_words_outside_downgrade,
    downgrade_body_lines,
    statement_shape,
    synthetic_revision,
)

_SCAN = destructive_words_outside_downgrade


def _upgrade(body: str) -> ast.FunctionDef:
    """``def upgrade()`` with ``body`` (already indented) as its body."""
    tree = ast.parse(f"def upgrade() -> None:\n{body}")
    fn = tree.body[0]
    assert isinstance(fn, ast.FunctionDef)
    return fn


def test_statement_shape_renders_executes_and_autocommit_blocks_in_order() -> None:
    fn = _upgrade(
        '    """A docstring is skipped."""\n'
        "    op.execute(\"SET LOCAL lock_timeout = '3s'\")\n"
        "    with op.get_context().autocommit_block():\n"
        '        op.execute("SELECT   1")\n'
        "    with op.get_context().autocommit_block():\n"
        "        pass\n"
    )
    assert statement_shape(fn) == (
        "SET LOCAL lock_timeout = '3s'",
        ENTER_AUTOCOMMIT,
        "SELECT 1",
        LEAVE_AUTOCOMMIT,
        ENTER_AUTOCOMMIT,
        LEAVE_AUTOCOMMIT,
    )


@pytest.mark.parametrize(
    "line",
    [
        # The review of the session-liveness revision's shape test: an op other
        # than execute, appended after the last block, passed every check that
        # read op.execute calls only.
        'op.alter_column("t", "c", schema="coord", nullable=True)',
        "op.execute(SQL)",
        'op.execute("SELECT 1", execution_options=None)',
        "helper()",
        "sql = 'SELECT 1'",
        "with open('x') as f:\n        pass",
    ],
)
def test_statement_shape_refuses_any_other_statement(line: str) -> None:
    fn = _upgrade(f'    op.execute("SELECT 1")\n    {line}\n')
    with pytest.raises(AssertionError):
        statement_shape(fn)


def test_the_scan_reads_every_form_e6_refuses() -> None:
    missed = [form for form in E6_FORMS if not _SCAN(synthetic_revision(form))]
    assert missed == [], f"forms E6 refuses that the scan lets through: {missed}"


def test_the_scan_reads_outside_upgrade_too() -> None:
    """E6 reads every line outside downgrade(): a module constant, a helper
    defined after downgrade(), and downgrade()'s own decorators."""
    constant = synthetic_revision(module_line='_SQL = "DROP TABLE coord.t"')
    assert _SCAN(constant)
    helper = synthetic_revision() + (
        '\n\ndef _helper() -> None:\n    op.execute("TRUNCATE coord.t")\n'
    )
    assert _SCAN(helper)
    decorated = synthetic_revision().replace(
        "def downgrade()", "@drop_table\ndef downgrade()"
    )
    assert _SCAN(decorated) == ["line 11: 'drop_table'"]


def test_the_scan_leaves_prose_and_the_downgrade_body_unread() -> None:
    """Both docstrings, a ``#`` comment and the downgrade() body all spell
    destructive SQL in ``synthetic_revision``; none of it is read. Nor is a
    flush-left ``#`` comment inside downgrade(), which does not end E6's skip.
    """
    assert _SCAN(synthetic_revision()) == []
    flush_left_comment = (
        "# a flush-left comment inside downgrade()\n"
        '    op.drop_table("u", schema="coord")\n'
    )
    assert _SCAN(synthetic_revision(downgrade_body=flush_left_comment)) == []


def test_a_flush_left_line_in_a_downgrade_string_ends_the_skip_as_in_e6() -> None:
    """E6 stops skipping at the first column-0 line that is not blank or a
    comment, even one inside a string, and reads everything after it."""
    body = (
        '    op.execute("""\n'
        "DROP TABLE coord.t\n"
        '""")\n'
        '    op.drop_table("u", schema="coord")\n'
    )
    source = synthetic_revision(downgrade_body=body)
    def_line = source.split("\n").index("def downgrade() -> None:") + 1
    assert downgrade_body_lines(source) == {def_line, def_line + 1}
    assert _SCAN(source) == [
        f"line {def_line + 1}: '\\nDROP TABLE coord.t\\n'",
        f"line {def_line + 4}: 'drop_table'",
    ]


def test_a_module_naming_a_docstring_reader_has_its_docstrings_read() -> None:
    """A module that names ``__doc__`` could execute a docstring, so E6 reads
    its docstrings as code, and so does the scan."""
    source = synthetic_revision("op.execute(upgrade.__doc__)")
    assert len(_SCAN(source)) == 2


#: Docstrings, as the AST calls them, that E6's lexer does NOT blank: it blanks
#: a string statement only at bracket depth 0, after a statement boundary, with
#: nothing but a newline or a comment after it, and not across a backslash.
_DOCSTRINGS_E6_READS_AS_CODE = {
    "parenthesised": 'def upgrade() -> None:\n    ("""DROP TABLE coord.t""")\n',
    "parenthesised over lines": (
        'def upgrade() -> None:\n    (\n        "DROP TABLE coord.t"\n    )\n'
    ),
    "after the colon of a one-line def": (
        'def upgrade() -> None: """DROP TABLE coord.t"""\n'
    ),
    "followed by a semicolon": (
        'def upgrade() -> None:\n    """DROP TABLE coord.t"""; pass\n'
    ),
    "literals a backslash joins": (
        'def upgrade() -> None:\n    "DROP TABLE " \\\n    "coord.t"\n'
    ),
}

#: Docstrings E6 does blank, which the scan leaves unread too.
_DOCSTRINGS_E6_BLANKS = {
    "plain": 'def upgrade() -> None:\n    """DROP TABLE coord.t"""\n',
    "a comment after it": (
        'def upgrade() -> None:\n    """DROP TABLE coord.t"""  # prose\n'
    ),
    "adjacent literals on one line": (
        'def upgrade() -> None:\n    "DROP TABLE " "coord.t"\n'
    ),
    "a raw prefix": 'def upgrade() -> None:\n    r"""DROP TABLE coord.t"""\n',
}


@pytest.mark.parametrize(
    "source",
    list(_DOCSTRINGS_E6_READS_AS_CODE.values()),
    ids=list(_DOCSTRINGS_E6_READS_AS_CODE),
)
def test_a_docstring_e6_reads_as_code_is_read(source: str) -> None:
    found = _SCAN(source)
    assert found, "E6 reads this docstring as code; the scan must read it too"
    assert all("DROP TABLE" in hit for hit in found), found


@pytest.mark.parametrize(
    "source", list(_DOCSTRINGS_E6_BLANKS.values()), ids=list(_DOCSTRINGS_E6_BLANKS)
)
def test_a_docstring_e6_blanks_stays_unread(source: str) -> None:
    assert _SCAN(source) == []


def test_named_exception_a_module_e6_cannot_lex_keeps_its_prose_unread() -> None:
    """The scan's one documented exception, pinned so that widening it and
    updating its docstring happen together: an f-string quoting inside a
    replacement field makes E6's lexer give up and read the raw text, so E6
    would refuse this module for the destructive SQL in its docstrings and
    comment, while the scan, which still skips prose there, reads nothing."""
    source = synthetic_revision("op.execute(f\"SELECT {row['id']}\")")
    assert _SCAN(source) == []
