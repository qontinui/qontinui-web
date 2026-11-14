"""Pins ``_alembic_harness``'s forbidden-clause scan and ALTER finder.

The scan used to live as per-test copies that read only the lines containing
``ADD COLUMN``. These cases are the shapes that let a clause through that way,
plus the false positive a naive substring match would add. No database needed.
"""

from __future__ import annotations

from types import ModuleType

import pytest

from tests._alembic_harness import (
    alter_statement,
    backfill_statements,
    forbidden_add_clauses,
    recorded_sql,
)

_CLEAN = """
    ALTER TABLE coord.t
        ADD COLUMN IF NOT EXISTS a BIGINT,
        ADD COLUMN IF NOT EXISTS b TIMESTAMPTZ
"""


def test_a_clean_add_has_no_forbidden_clause() -> None:
    assert forbidden_add_clauses(_CLEAN) == []


@pytest.mark.parametrize(
    ("statement", "expected"),
    [
        # A clause on a continuation line under its ADD COLUMN line.
        (
            "ALTER TABLE coord.t\n  ADD COLUMN IF NOT EXISTS a BIGINT\n    DEFAULT 0",
            ["DEFAULT"],
        ),
        # NOT NULL split across two lines, and spaced by a tab.
        (
            "ALTER TABLE coord.t\n  ADD COLUMN IF NOT EXISTS a BIGINT NOT\n  NULL",
            ["NOT NULL"],
        ),
        (
            "ALTER TABLE coord.t ADD COLUMN IF NOT EXISTS a BIGINT not\tnull",
            ["NOT NULL"],
        ),
        # A table constraint in the same ALTER, on a line with no ADD COLUMN.
        (
            "ALTER TABLE coord.t\n  ADD COLUMN IF NOT EXISTS a BIGINT,\n"
            "  ADD CONSTRAINT a_pos CHECK (a >= 0)",
            ["CHECK", "CONSTRAINT"],
        ),
        (
            "ALTER TABLE coord.t ADD COLUMN IF NOT EXISTS d UUID REFERENCES coord.x",
            ["REFERENCES"],
        ),
        ("ALTER TABLE coord.t ADD COLUMN IF NOT EXISTS u TEXT UNIQUE", ["UNIQUE"]),
    ],
)
def test_the_scan_reads_the_whole_statement(
    statement: str, expected: list[str]
) -> None:
    assert forbidden_add_clauses(statement) == expected


def test_a_column_named_after_a_clause_is_not_flagged() -> None:
    statement = """
        ALTER TABLE coord.t
            ADD COLUMN IF NOT EXISTS default_level TEXT,
            ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS unique_count BIGINT,
            ADD COLUMN IF NOT EXISTS not_nullable_hint TEXT
    """
    assert forbidden_add_clauses(statement) == []


def test_alter_statement_finds_exactly_one_and_refuses_two() -> None:
    stmts = [
        "SET LOCAL lock_timeout = '3s'",
        _CLEAN,
        "COMMENT ON COLUMN coord.t.a IS 'x'",
    ]
    assert alter_statement(stmts, "coord", "t", "ADD") == _CLEAN
    with pytest.raises(AssertionError, match="expected one ADD"):
        alter_statement([_CLEAN, _CLEAN], "coord", "t", "ADD")
    with pytest.raises(AssertionError, match="expected one DROP"):
        alter_statement(stmts, "coord", "t", "DROP")
    # A different table is not a match, in either prefix direction.
    with pytest.raises(AssertionError):
        alter_statement(stmts, "coord", "t2", "ADD")
    with pytest.raises(AssertionError):
        alter_statement(["ALTER TABLE coord.t2 ADD COLUMN a INT"], "coord", "t", "ADD")


def test_backfill_statements_finds_every_row_write() -> None:
    writes = [
        "  UPDATE coord.t SET a = 0",
        "insert into coord.t values (1)",
        "WITH x AS (SELECT 1) UPDATE coord.t SET a = 1",
        "DO $$ BEGIN UPDATE coord.t SET a = 2; END $$",
        "COPY coord.t FROM STDIN",
    ]
    prose = "COMMENT ON COLUMN coord.t.a IS 'NULL until the first UPDATE'"
    assert backfill_statements([_CLEAN, prose, *writes]) == writes


def test_recorded_sql_captures_each_execute_in_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = ModuleType("_fake_revision")

    def upgrade() -> None:
        module.op.execute("one")  # type: ignore[attr-defined]
        module.op.execute("two")  # type: ignore[attr-defined]

    module.upgrade = upgrade  # type: ignore[attr-defined]
    module.op = object()  # type: ignore[attr-defined]
    assert recorded_sql(module, "upgrade", monkeypatch) == ["one", "two"]
