"""The lane roster and scan logic of the alembic lock_timeout restore gate.

``scripts/ci/check_lock_timeout_restored.py`` is THE single home of the rule
that a ``SET LOCAL lock_timeout`` bound in one alembic revision's
``upgrade()``/``downgrade()`` must be restored in that same function — see
that script's module docstring for why (coord finding
``b4782f88-49f2-464e-92f9-4f44194dee34``, qontinui-web#1423). THREE lanes
invoke it, the same shape ``test_alembic_head_gate.py`` pins for its sibling:

* ``.github/workflows/alembic-graph-pr.yml``, step "Check lock_timeout is
  restored" — the required PR gate, sharing the ``alembic-heads-pr`` job.
* ``.qontinui/ci.toml``, step ``alembic-lock-timeout-restored``.
* ``.pre-commit-config.yaml``, hook ``alembic-lock-timeout-restored`` —
  shift-left only, same caveat as ``alembic-single-head``: it does not run in
  CI and is bypassable with ``--no-verify``.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

from tests.gate_lane_roster import (
    assert_docstring_names_every_lane,
    assert_lane_roster,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_CI = REPO_ROOT / "scripts" / "ci"
sys.path.insert(0, str(SCRIPTS_CI))

from check_lock_timeout_restored import (  # noqa: E402
    FunctionFinding,
    scan_file,
)

_SCRIPT_REF = "scripts/ci/check_lock_timeout_restored.py"

_DECLARED_LANES = frozenset(
    {
        ".github/workflows/alembic-graph-pr.yml",
        ".qontinui/ci.toml",
        ".pre-commit-config.yaml",
    }
)


def _gate_docstring() -> str | None:
    """The gate's module docstring, read WITHOUT importing the gate.

    Same reasoning as the sibling gates' tests: parsing the file is the read
    that cannot run anything, even though this suite also imports the module
    below to exercise its scan function directly — the docstring check stays
    import-free so it keeps working even if the import path changes.
    """
    source = (REPO_ROOT / _SCRIPT_REF).read_text(encoding="utf-8")
    return ast.get_docstring(ast.parse(source))


def test_the_lane_roster_is_exactly_the_declared_lanes() -> None:
    assert_lane_roster(_SCRIPT_REF, _DECLARED_LANES)


def test_the_scripts_docstring_names_every_lane() -> None:
    assert_docstring_names_every_lane(_gate_docstring(), _SCRIPT_REF, _DECLARED_LANES)


def _write(tmp_path: Path, name: str, body: str) -> Path:
    path = tmp_path / name
    path.write_text(body)
    return path


def test_set_and_default_restore_is_clean(tmp_path: Path) -> None:
    path = _write(
        tmp_path,
        "clean_default.py",
        "def upgrade() -> None:\n"
        "    op.execute(\"SET LOCAL lock_timeout = '3s'\")\n"
        '    op.execute("ALTER TABLE coord.t ADD COLUMN x INT")\n'
        '    op.execute("SET LOCAL lock_timeout = DEFAULT")\n',
    )
    findings, error = scan_file(path)
    assert error is None
    assert not any(f.violated for f in findings)


def test_set_and_reset_restore_is_clean(tmp_path: Path) -> None:
    """``RESET lock_timeout`` is an equally valid restore spelling."""
    path = _write(
        tmp_path,
        "clean_reset.py",
        "def downgrade() -> None:\n"
        "    op.execute(\"SET LOCAL lock_timeout = '3s'\")\n"
        '    op.execute("ALTER TABLE coord.t DROP COLUMN x")\n'
        '    op.execute("RESET lock_timeout")\n',
    )
    findings, error = scan_file(path)
    assert error is None
    assert not any(f.violated for f in findings)


def test_set_with_no_restore_is_a_violation(tmp_path: Path) -> None:
    path = _write(
        tmp_path,
        "leaky.py",
        "def upgrade() -> None:\n"
        "    op.execute(\"SET LOCAL lock_timeout = '3s'\")\n"
        '    op.execute("ALTER TABLE coord.t ADD COLUMN x INT")\n',
    )
    findings, error = scan_file(path)
    assert error is None
    violated = [f for f in findings if f.violated]
    assert len(violated) == 1
    finding: FunctionFinding = violated[0]
    assert finding.func_name == "upgrade"
    assert finding.sets == 1
    assert finding.restores == 0


def test_restore_in_the_other_direction_does_not_cover_this_one(
    tmp_path: Path,
) -> None:
    """Each function is scoped independently — upgrade's set needs upgrade's
    own restore, not downgrade's."""
    path = _write(
        tmp_path,
        "asymmetric.py",
        "def upgrade() -> None:\n"
        "    op.execute(\"SET LOCAL lock_timeout = '3s'\")\n"
        '    op.execute("ALTER TABLE coord.t ADD COLUMN x INT")\n'
        "\n"
        "\n"
        "def downgrade() -> None:\n"
        "    op.execute(\"SET LOCAL lock_timeout = '3s'\")\n"
        '    op.execute("ALTER TABLE coord.t DROP COLUMN x")\n'
        '    op.execute("SET LOCAL lock_timeout = DEFAULT")\n',
    )
    findings, error = scan_file(path)
    assert error is None
    by_name = {f.func_name: f for f in findings}
    assert by_name["upgrade"].violated
    assert not by_name["downgrade"].violated


def test_a_file_with_no_lock_timeout_mention_produces_no_findings(
    tmp_path: Path,
) -> None:
    path = _write(
        tmp_path,
        "unrelated.py",
        "def upgrade() -> None:\n"
        '    op.execute("ALTER TABLE coord.t ADD COLUMN x INT")\n',
    )
    findings, error = scan_file(path)
    assert error is None
    assert findings == []


def test_an_unparseable_file_is_reported_as_a_scan_error(tmp_path: Path) -> None:
    path = _write(tmp_path, "broken.py", "def upgrade(:\n    pass\n")
    findings, error = scan_file(path)
    assert findings == []
    assert error is not None
    assert "broken.py" in error
