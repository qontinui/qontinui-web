"""Regression tests for the global-state-assertion gate.

``scripts/ci/check_global_state_assertions.py`` is THE single home of the rule
that no exact-count or emptiness assertion may be ADDED over an unscoped read
of shared state. Phase 1 of plan
``2026-08-31-global-state-assertion-inventory-survives-its-plan`` enumerated
that class by hand into a markdown inventory; Phase 2 is this detector, because
an enumeration is true on the day it is written and nothing fails when it goes
stale. The defect it catches is measured, not hypothetical: ``assert 2 == 1``
reddened qontinui-web#1103 — an alembic-only PR — because the session-scoped
app's own ``memory_consolidate`` sweep enqueued a second job row between the
seed and the assertion.

What these tests pin:

1. THE DETECTOR AGAINST KNOWN-POSITIVE INPUT, per rule. A detector that has
   only ever been run over a tree it reported clean is not a tested detector:
   it is indistinguishable from ``return []``. So each rule gets a synthetic
   file that MUST be flagged, written to ``tmp_path`` and parsed for real.
2. THE DETECTOR AGAINST KNOWN-NEGATIVE NEAR-MISSES, per rule — the SAME
   assertion with the discriminator restored (a ``WHERE`` on the test's own
   tenant for Rule A; the keyword-only argument actually passed for Rule B).
   Positives alone would pass for a gate that flags everything, which is the
   failure the first draft of this detector actually had: keyed on dotted-ness
   it flagged 582 assertions of which ~97% were correct tests.
3. THE MEASURED FALSE POSITIVES, as explicit non-findings: ``len()`` of a
   string, a local list the test built, a mock's ``await_count`` (the CORRECT
   "called once" idiom), and any attribute of any object. These are the shapes
   that made the earlier draft useless, and a test that only asserts positives
   would let them back in.
4. THE RATCHET, in all three directions — over its row, under it, and a row
   for a file that no longer exists — because the second and third are what
   stop a stale row from becoming a hole the count climbs back into.
5. VACUITY. An empty scan root, an unreadable allowlist and a file that will
   not parse each exit 2, never 0: ``_gate_lib``'s "silence is never success".
6. THE LANE ROSTER — exactly three files invoke this script, the three the tree
   documents, and the script's own docstring names every one.

Why the fixtures can live here
------------------------------

``backend/tests/`` is the directory this gate scans, so a fixture that is real
code would be counted by the live gate and would need an allowlist row of its
own. They are string constants instead, and the detector reads the parsed AST —
a string literal holds no ``ast.Assert`` node, so it is invisible to a rule
defined by POSITION rather than by text. That is the same property
``tests/gate_lane_roster.py`` relies on to decide what "invokes" means, and it
is why this module needs no exclusion anywhere.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

import pytest

from tests.gate_lane_roster import (
    assert_docstring_names_every_lane,
    assert_lane_roster,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_CI = REPO_ROOT / "scripts" / "ci"
sys.path.insert(0, str(SCRIPTS_CI))

import check_global_state_assertions as gate  # noqa: E402

_SCRIPT_REF = "scripts/ci/check_global_state_assertions.py"
GATE_SCRIPT = REPO_ROOT / _SCRIPT_REF

_DECLARED_LANES = frozenset(
    {
        ".github/workflows/global-state-assertions.yml",
        ".pre-commit-config.yaml",
        ".qontinui/ci.toml",
    }
)


# ---------------------------------------------------------------------------
# Fixtures: one known-positive and one near-miss negative per rule
# ---------------------------------------------------------------------------

#: RULE A, positive — a direct `execute` whose SQL counts a whole table. The
#: shape of `test_coord_wu_authored_at_01_migration.py:394`.
_A_POSITIVE_DIRECT = """
from sqlalchemy import text


def test_the_downgrade_keeps_every_row(conn):
    total = conn.execute(text("SELECT count(*) FROM coord.work_units")).scalar()
    assert total == 6
"""

#: RULE A, positive — the read one call away, in a same-file helper. The shape
#: of `_row_count(engine)` across the migration suites.
_A_POSITIVE_HELPER = """
from sqlalchemy import text


def _rows(engine):
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT job_id, kind FROM coord.memory_jobs")
        ).mappings().all()


def test_one_job_was_enqueued(engine):
    jobs = _rows(engine)
    assert len(jobs) == 1
"""

#: RULE A, near-miss NEGATIVE — byte-for-byte the same read, scoped by a WHERE
#: on the tenant the test minted. This is what the fix looks like.
_A_NEGATIVE_WHERE = """
from uuid import uuid4

from sqlalchemy import text


def _rows(engine, tenant):
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT job_id, kind FROM coord.memory_jobs WHERE tenant_id = :t"),
            {"t": tenant},
        ).mappings().all()


def test_one_job_was_enqueued(engine):
    tenant = uuid4()
    jobs = _rows(engine, tenant)
    assert len(jobs) == 1
"""

#: RULE B, positive — `_job_rows` declares keyword-only discriminators and this
#: call passes neither. Verbatim the seam of commit `164e25f4a`.
_B_POSITIVE = """
from uuid import uuid4


def _job_rows(db, tenant, *, input_hash=None, kind=None):
    return _read(db, tenant, input_hash, kind)


def test_one_job_was_enqueued(db):
    tenant = uuid4()
    assert len(_job_rows(db, tenant)) == 1


def test_no_job_was_enqueued(db):
    tenant = uuid4()
    assert _job_rows(db, tenant) == []
"""

#: RULE B, near-miss NEGATIVE — the same helper, the same assertions, with the
#: discriminator the helper declares actually passed.
_B_NEGATIVE_PASSED = """
from uuid import uuid4


def _job_rows(db, tenant, *, input_hash=None, kind=None):
    return _read(db, tenant, input_hash, kind)


def test_one_job_was_enqueued(db):
    tenant = uuid4()
    assert len(_job_rows(db, tenant, kind="embedding")) == 1


def test_no_job_was_enqueued(db):
    tenant = uuid4()
    assert _job_rows(db, tenant, input_hash="abc") == []
"""

#: RULE B, negative — a helper with no keyword-only parameters declares no
#: discriminator, so there is none to ignore. The gate is not a ban on `len`.
_B_NEGATIVE_NO_KWONLY = """
def _own_dispatches(dispatch, db):
    return dispatch.rows


def test_one_dispatch(dispatch, db):
    assert len(_own_dispatches(dispatch, db)) == 1
"""

#: RULE B, negative — the keyword-only helper built an ARGUMENT, not the value.
#: Following arguments blamed seven correct assertions in `test_scheduler_db.py`
#: on a discriminator belonging to a different value.
_B_NEGATIVE_ARGUMENT_PROVENANCE = """
def _patch_dispatcher(monkeypatch, *, raises=None):
    return object()


def _own_dispatches(dispatch, db):
    return dispatch.rows


def test_one_dispatch(monkeypatch, db):
    dispatch = _patch_dispatcher(monkeypatch)
    assert len(_own_dispatches(dispatch, db)) == 1
"""

#: RULE B, negative — `**overrides` may well carry them. An unknown is not a
#: violation.
_B_NEGATIVE_SPLAT = """
def _job_rows(db, tenant, *, input_hash=None, kind=None):
    return _read(db, tenant, input_hash, kind)


def test_one_job(db, tenant, overrides):
    assert len(_job_rows(db, tenant, **overrides)) == 1
"""

#: The measured false positives of the FIRST draft of this detector. Every one
#: of these is a correct assertion and none may be flagged.
_MEASURED_NON_FINDINGS = """
def _manager(*, target_connected=True):
    return object()


def test_correct_idioms(session, pubsub, frame, db):
    manager = _manager()
    errors = []
    errors.append("boom")

    assert len(frame["request_id"]) == 32       # the length of a STRING
    assert len(errors) == 1                     # a local list the test built
    assert manager.send_terminal.await_count == 1   # the "called once" idiom
    assert manager.send_terminal.await_args_list == []
    assert pubsub.close_count == 1              # a per-test fake's counter
    assert session.grants == {}                 # a per-test fake's attribute
    assert session.listeners == {}
    assert db.enabled is True
    assert len(session.rows) == len(errors)     # no fixed extent at all
"""

#: An assert both rules could claim. It is ONE finding, and Rule A wins.
_BOTH_RULES = """
from sqlalchemy import text


def _rows(engine, *, tenant=None):
    with engine.connect() as conn:
        return conn.execute(text("SELECT id FROM coord.gates")).mappings().all()


def test_one_gate(engine):
    assert len(_rows(engine)) == 1
"""


# --- Evasion fixtures. Each of these returned [] from an earlier build of the
# --- detector, and each is a one-token, NON-adversarial edit that turned a red
# --- into a green without scoping anything. A ratchet that is easier to
# --- silence than to satisfy is not a ratchet, so every one of them is pinned.

_A_POSITIVE_PROSE_WHERE = """
from sqlalchemy import text


def _rows(engine):
    msg = "where the rows are"
    with engine.connect() as conn:
        return conn.execute(text("SELECT id FROM coord.jobs")).mappings().all()


def test_one_row(engine):
    assert len(_rows(engine)) == 1
"""

_A_POSITIVE_DOCSTRING_WHERE = '''
from sqlalchemy import text


def _rows(engine):
    """Every job row. Used where a test needs the raw table."""
    with engine.connect() as conn:
        return conn.execute(text("SELECT id FROM coord.jobs")).mappings().all()


def test_one_row(engine):
    assert len(_rows(engine)) == 1
'''

_B_POSITIVE_NONE_KWARG = """
def _job_rows(db, tenant, *, input_hash=None, kind=None):
    return db.execute("SELECT id FROM coord.jobs WHERE t = :t", {"t": tenant}).all()


def test_one_job(db):
    assert len(_job_rows(db, 1, input_hash=None)) == 1
"""

_B_POSITIVE_WRAPPED = """
def _job_rows(db, tenant, *, input_hash=None, kind=None):
    return db.execute("SELECT id FROM coord.jobs WHERE t = :t", {"t": tenant}).all()


def test_list(db):
    assert len(list(_job_rows(db, 1))) == 1


def test_sorted(db):
    assert len(sorted(_job_rows(db, 1))) == 1


def test_comprehension(db):
    assert len([r for r in _job_rows(db, 1)]) == 1
"""

_NOT_POSITIVE = """
from sqlalchemy import text


def _rows(engine):
    with engine.connect() as conn:
        return conn.execute(text("SELECT id FROM coord.jobs")).mappings().all()


def test_nothing_remains(engine):
    assert not _rows(engine)
"""

_NOT_NEGATIVE = """
def test_local_list_and_bare_flag(db):
    errors = []
    assert not errors
    flag = db.enabled
    assert not flag
"""


_A_NEGATIVE_WHERE_EXPRESSION = """
from sqlalchemy import text


def _rows(engine):
    with engine.connect() as conn:
        return conn.execute(
            text(
                "SELECT id FROM coord.policy_rules "
                "WHERE COALESCE(decision_domain, kind) = 'pr_fix' "
                "ORDER BY created_at"
            )
        ).mappings().all()


def test_one_row(engine):
    rows = _rows(engine)
    assert len(rows) == 1
    assert rows[0]["condition"] == {}
"""


def _write(tmp_path: Path, name: str, source: str) -> Path:
    path = tmp_path / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(source, encoding="utf-8")
    return path


def _rules(tmp_path: Path, name: str, source: str) -> list[str]:
    """The rule of each finding, in line order — the detector's whole verdict."""
    return [f.rule for f in gate.find_violations(_write(tmp_path, name, source))]


# ---------------------------------------------------------------------------
# 1-2. The detector, against known-positive and near-miss input
# ---------------------------------------------------------------------------


def test_rule_a_flags_a_direct_unfiltered_count(tmp_path: Path) -> None:
    assert _rules(tmp_path, "a_direct.py", _A_POSITIVE_DIRECT) == [gate.RULE_A]


def test_rule_a_flags_a_read_through_a_same_file_helper(tmp_path: Path) -> None:
    assert _rules(tmp_path, "a_helper.py", _A_POSITIVE_HELPER) == [gate.RULE_A]


def test_rule_a_does_not_flag_the_same_read_scoped_by_a_where(
    tmp_path: Path,
) -> None:
    """The near-miss: one ``WHERE`` apart from the positive above.

    If this ever starts failing, the gate has become a ban on counting rather
    than a gate on counting SHARED rows — and the remediation it prints would
    be advice a developer cannot act on.
    """
    assert _rules(tmp_path, "a_where.py", _A_NEGATIVE_WHERE) == []


def test_rule_b_flags_a_call_that_ignores_the_declared_discriminators(
    tmp_path: Path,
) -> None:
    """Both spellings: ``len(helper(...)) == 1`` and ``helper(...) == []``."""
    assert _rules(tmp_path, "b_pos.py", _B_POSITIVE) == [gate.RULE_B, gate.RULE_B]


def test_rule_b_does_not_flag_a_call_that_passes_one(tmp_path: Path) -> None:
    assert _rules(tmp_path, "b_passed.py", _B_NEGATIVE_PASSED) == []


def test_rule_b_needs_a_declared_discriminator_to_ignore(tmp_path: Path) -> None:
    assert _rules(tmp_path, "b_nokw.py", _B_NEGATIVE_NO_KWONLY) == []


def test_rule_b_does_not_follow_arguments_into_their_provenance(
    tmp_path: Path,
) -> None:
    source = _B_NEGATIVE_ARGUMENT_PROVENANCE
    assert _rules(tmp_path, "b_arg.py", source) == []


def test_rule_b_treats_a_kwargs_splat_as_unknown_not_as_ignored(
    tmp_path: Path,
) -> None:
    assert _rules(tmp_path, "b_splat.py", _B_NEGATIVE_SPLAT) == []


def test_the_measured_false_positives_are_not_findings(tmp_path: Path) -> None:
    """Nine correct assertions, every one of which an earlier draft flagged."""
    assert _rules(tmp_path, "correct.py", _MEASURED_NON_FINDINGS) == []


def test_one_assertion_is_one_finding_and_rule_a_wins(tmp_path: Path) -> None:
    assert _rules(tmp_path, "both.py", _BOTH_RULES) == [gate.RULE_A]


def test_a_finding_names_the_line_and_the_statement(tmp_path: Path) -> None:
    """The report has to be actionable: the line, and WHY it was flagged."""
    found = gate.find_violations(_write(tmp_path, "a_direct.py", _A_POSITIVE_DIRECT))
    assert [f.lineno for f in found] == [7]
    assert "coord.work_units" in found[0].detail
    assert found[0].source.startswith("assert total ==")


def test_a_commented_out_assertion_is_not_counted(tmp_path: Path) -> None:
    """``ast`` drops comments, so no comment-prefix rule is needed."""
    source = _A_POSITIVE_DIRECT.replace(
        "    assert total == 6", "    # assert total == 6"
    )
    assert _rules(tmp_path, "commented.py", source) == []


def test_the_live_tests_root_parses_and_is_not_empty() -> None:
    """The detector must survive the real suite, not just the fixtures.

    ``find_violations`` raises ``SyntaxError`` rather than returning ``[]`` for
    a file it cannot parse, so this is also the assertion that every file in
    ``backend/tests`` was actually READ — the ratchet's rows mean nothing about
    a file the parser skipped.
    """
    files = gate.scan_files()
    assert files, f"no Python files under {gate.TESTS_ROOT}"
    for path in files:
        gate.find_violations(path)


# ---------------------------------------------------------------------------
# 4-5. The ratchet and its vacuity guards
# ---------------------------------------------------------------------------


def _tree(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, files: dict[str, str]
) -> Path:
    """A repo-shaped tmp tree with ``backend/tests/`` and the gate pointed at it."""
    tests = tmp_path / "backend" / "tests"
    tests.mkdir(parents=True)
    for name, source in files.items():
        (tests / name).write_text(source, encoding="utf-8")
    monkeypatch.setattr(gate, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(gate, "TESTS_ROOT", tests)
    monkeypatch.setattr(gate, "ALLOWLIST", tests / ALLOWLIST_NAME)
    return tests


ALLOWLIST_NAME = ".global-state-assertions-allowlist"
_ROW = "backend/tests/a_direct.py"


def _allowlist(tests: Path, body: str) -> None:
    (tests / ALLOWLIST_NAME).write_text(gate.ALLOWLIST_HEADER + body, encoding="utf-8")


def test_a_tree_matching_its_allowlist_is_clean(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    tests = _tree(tmp_path, monkeypatch, {"a_direct.py": _A_POSITIVE_DIRECT})
    _allowlist(tests, f"{_ROW} 1\n")
    assert gate.main([]) == 0
    out = capsys.readouterr().out
    assert "scanned 1 file(s)" in out, (
        f"a clean run must say what it scanned, or a vacuous run would be "
        f"indistinguishable from it: {out!r}"
    )


def test_a_file_over_its_row_is_a_violation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    tests = _tree(tmp_path, monkeypatch, {"a_direct.py": _A_POSITIVE_DIRECT})
    _allowlist(tests, "")
    assert gate.main([]) == gate.EXIT_VIOLATION
    stderr = capsys.readouterr().err
    assert "OVER" in stderr
    assert f"{_ROW}:7" in stderr, "the report must name the line to fix"


def test_a_file_under_its_row_is_a_violation_too(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """A stale row is a hole the count can silently climb back into."""
    tests = _tree(tmp_path, monkeypatch, {"a_direct.py": _A_POSITIVE_DIRECT})
    _allowlist(tests, f"{_ROW} 4\n")
    assert gate.main([]) == gate.EXIT_VIOLATION
    stderr = capsys.readouterr().err
    assert "UNDER" in stderr
    assert "lower the row to 1" in stderr


def test_a_row_for_a_vanished_file_is_a_violation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    tests = _tree(tmp_path, monkeypatch, {"a_where.py": _A_NEGATIVE_WHERE})
    _allowlist(tests, "backend/tests/deleted_test.py 2\n")
    assert gate.main([]) == gate.EXIT_VIOLATION
    stderr = capsys.readouterr().err
    assert "MISSING" in stderr
    assert "deleted_test.py" in stderr


def test_write_allowlist_regenerates_the_rows(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    tests = _tree(
        tmp_path,
        monkeypatch,
        {
            "a_direct.py": _A_POSITIVE_DIRECT,
            "b_pos.py": _B_POSITIVE,
            "a_where.py": _A_NEGATIVE_WHERE,
        },
    )
    assert gate.main(["--write-allowlist"]) == 0
    written = (tests / ALLOWLIST_NAME).read_text(encoding="utf-8")
    rows = [line for line in written.splitlines() if not line.startswith("#")]
    assert rows == [f"{_ROW} 1", "backend/tests/b_pos.py 2"], (
        "only files with a non-zero count get a row, sorted by path"
    )
    # ...and what it wrote is what the gate then accepts.
    assert gate.main([]) == 0


def test_an_empty_scan_root_is_vacuous_not_clean(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    tests = _tree(tmp_path, monkeypatch, {})
    _allowlist(tests, "")
    with pytest.raises(SystemExit) as exc:
        gate.main([])
    assert exc.value.code == gate.EXIT_VACUOUS


def test_a_missing_allowlist_is_vacuous_not_clean(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Without it every file is allowed 0 — a broken gate, not a finding."""
    _tree(tmp_path, monkeypatch, {"a_where.py": _A_NEGATIVE_WHERE})
    assert gate.main([]) == gate.EXIT_VACUOUS


def test_a_malformed_allowlist_row_is_vacuous_not_clean(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    tests = _tree(tmp_path, monkeypatch, {"a_where.py": _A_NEGATIVE_WHERE})
    _allowlist(tests, "backend/tests/a_where.py not-a-number\n")
    assert gate.main([]) == gate.EXIT_VACUOUS


def test_a_file_that_will_not_parse_is_vacuous_not_clean(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """An unscanned file must never read as a clean one."""
    tests = _tree(
        tmp_path,
        monkeypatch,
        {"a_direct.py": _A_POSITIVE_DIRECT, "broken.py": "def (:\n"},
    )
    _allowlist(tests, f"{_ROW} 1\n")
    assert gate.main([]) == gate.EXIT_VACUOUS
    assert "could not be parsed" in capsys.readouterr().err


# ---------------------------------------------------------------------------
# 6. The lane roster
# ---------------------------------------------------------------------------


def _gate_docstring() -> str | None:
    """The gate's module docstring, read WITHOUT importing the gate a second
    time — ``ast`` never executes a line of one."""
    source = GATE_SCRIPT.read_text(encoding="utf-8")
    return ast.get_docstring(ast.parse(source))


def test_the_lane_roster_is_exactly_the_declared_lanes() -> None:
    assert_lane_roster(_SCRIPT_REF, _DECLARED_LANES)


def test_the_scripts_docstring_names_every_lane() -> None:
    """The roster in prose must be the roster in the tree.

    The gate opens by naming its three lanes. That list is what a reader trusts
    instead of grepping, so a lane added without touching it leaves the script
    confidently describing a shape the repo no longer has — the state
    ``a208240e2`` left the tree in for 90 commits.
    """
    assert_docstring_names_every_lane(_gate_docstring(), _SCRIPT_REF, _DECLARED_LANES)


# ---------------------------------------------------------------------------
# Evasions. Every one of these was a measured false GREEN before it was pinned.
# ---------------------------------------------------------------------------


def test_rule_a_survives_prose_containing_the_word_where(tmp_path: Path) -> None:
    """A log line is not a WHERE clause.

    The WHERE test runs over the whole dataflow reach, so before
    ``_is_sql_fragment`` any English string carrying the word silenced Rule A —
    on an assertion whose printed remediation is "add a WHERE". An author who
    followed that advice badly got a green.
    """
    assert _rules(tmp_path, "a_prose.py", _A_POSITIVE_PROSE_WHERE) == [gate.RULE_A]


def test_rule_a_survives_a_docstring_containing_the_word_where(
    tmp_path: Path,
) -> None:
    """Same hole, reached through a docstring rather than a statement."""
    assert _rules(tmp_path, "a_doc.py", _A_POSITIVE_DOCSTRING_WHERE) == [gate.RULE_A]


def test_rule_b_treats_an_explicit_none_as_not_passed(tmp_path: Path) -> None:
    """``input_hash=None`` is byte-equivalent to the bare call.

    The helper's own body is ``if input_hash is not None:``, so an explicit
    ``None`` constrains nothing. Counting it as "passed" made the cheapest
    possible silencer, one token from the fix the rule prints.
    """
    assert _rules(tmp_path, "b_none.py", _B_POSITIVE_NONE_KWARG) == [gate.RULE_B]


def test_rule_b_sees_through_a_builtin_passthrough(tmp_path: Path) -> None:
    """``list()``, ``sorted()`` and a comprehension re-shape, they do not scope."""
    assert _rules(tmp_path, "b_wrapped.py", _B_POSITIVE_WRAPPED) == [
        gate.RULE_B,
        gate.RULE_B,
        gate.RULE_B,
    ]


def test_assert_not_is_the_same_claim_as_equals_empty(tmp_path: Path) -> None:
    """``assert not rows`` is the idiomatic spelling of ``assert rows == []``."""
    assert _rules(tmp_path, "not_pos.py", _NOT_POSITIVE) == [gate.RULE_A]


def test_assert_not_does_not_flag_a_local_list_or_a_bare_flag(
    tmp_path: Path,
) -> None:
    """The near-miss for the arm above — neither reads shared state."""
    assert _rules(tmp_path, "not_neg.py", _NOT_NEGATIVE) == []


def test_a_where_clause_over_an_expression_still_scopes(tmp_path: Path) -> None:
    """``WHERE COALESCE(a, b) = 'x'`` is a real clause, not a bare column.

    The WHERE-clause predicate replaced a bare ``\\bwhere\\b`` to stop prose
    silencing Rule A, and the first version of it only allowed a single
    identifier after WHERE. That turned every function-call, parenthesised or
    NOT predicate into "no WHERE at all" and flagged 8 correct assertions in
    `test_pr_fix_default_on_01_migration.py` — a false RED introduced by a
    false-green fix, which is exactly the trade this gate must not make.
    """
    assert _rules(tmp_path, "a_expr.py", _A_NEGATIVE_WHERE_EXPRESSION) == []
