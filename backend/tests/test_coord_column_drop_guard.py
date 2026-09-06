"""Regression tests for the coord column-drop guard.

Plan ``2026-09-03-coord-column-drop-guard-on-web-migrations``, Phase 2. The
gate is ``scripts/ci/check_coord_column_drops.py``; these tests pin the eight
cases the plan names plus the parser edges the design rests on:

1. ``pdtier_01`` VERBATIM (the 2026-08-27 incident, ``b888f351``) is a
   violation — and with no ``COORD_SCHEMA_DROPS`` the unresolved-placeholder
   violation fires BEFORE the manifest is consulted (no fetch is attempted).
2. The same fixture with the declaration appended is a violation naming both
   surfaces and the coord sha(s) that still read them.
3. A plain ``op.drop_column(..., schema="coord")`` on a read surface fails;
   on a surface nothing reads it passes.
4. A ``downgrade()``-only drop passes with no network call.
5. A ``project.*`` drop (web#805's shape) passes with no network call.
6. A fetch failure, ``main: null``, or empty ``deployed.surfaces`` is exit 2
   naming the half — UNKNOWN, never a pass.
7. A ``*`` wildcard row on the dropped table is exit 2 naming the waiver.
8. web#1180's ``pdtier_03`` (the queued customer) against a manifest WITHOUT
   ``agent_writable`` passes — the guard is precise, not blanket. Its SQL is
   composed (``_RECONCILE_AND_DROP.format(table=table, ...)``), so the test
   appends the ``COORD_SCHEMA_DROPS`` declaration the gate demands; web#1180
   must carry the same line before this check becomes required.

Fixtures live under ``tests/fixtures/coord_column_drop_guard/`` as ``.py.txt``
so that nothing treats them as real revisions: the single-head gate scans only
``backend/alembic/versions/``, the schema-arg hook is scoped there too, and
ruff never sees a ``.txt``. Every test writes its fixture into ``tmp_path``.

No test touches the network. In-process tests inject a fetcher that FAILS the
test if called; subprocess tests always pass ``--manifest-json``.
"""

from __future__ import annotations

import ast
import json
import subprocess
import sys
import urllib.error
from pathlib import Path

import pytest

from tests.gate_lane_roster import (
    assert_docstring_names_every_lane,
    assert_lane_roster,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_CI = REPO_ROOT / "scripts" / "ci"
sys.path.insert(0, str(SCRIPTS_CI))

import check_coord_column_drops as guard  # noqa: E402

GUARD = SCRIPTS_CI / "check_coord_column_drops.py"
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "coord_column_drop_guard"
PDTIER_01 = FIXTURES / "pdtier_01_b888f351.py.txt"
PDTIER_03 = FIXTURES / "pdtier_03_web1180_e3dfb672.py.txt"

DEPLOYED_SHA = "a19f0586943ea1bed1558825765aa13b55be1b83"
MAIN_SHA = "4fe1a7c2d9b04e6f8a1c3e5d7b9f0a2c4e6d8b0f"

DECLARATION = (
    "\nCOORD_SCHEMA_DROPS: list[tuple[str, str]] = ["
    '("prompt_documents", "agent_writable"), '
    '("prompt_document_versions", "agent_writable")]\n'
)

HEADER = (
    '"""a revision"""\n'
    "from collections.abc import Sequence\n"
    "from alembic import op\n"
    'revision: str = "t01"\n'
    "down_revision: str | Sequence[str] | None = None\n"
    "branch_labels: str | Sequence[str] | None = None\n"
    "depends_on: str | Sequence[str] | None = None\n"
)


def _manifest(
    *surfaces: tuple[str, str, str],
    main: list | None | str = "same",
    deployed_surfaces: list | None = None,
) -> dict:
    rows = [list(s) for s in surfaces]
    payload: dict = {
        "deployed": {
            "build_sha": DEPLOYED_SHA,
            "built_at": "2026-09-03T10:38:12Z",
            "surfaces": rows if deployed_surfaces is None else deployed_surfaces,
        },
        "main_unavailable_reason": None,
    }
    if main == "same":
        payload["main"] = {
            "sha": MAIN_SHA,
            "pushed_at": "2026-09-03T11:00:00Z",
            "surfaces": rows,
        }
    elif main is None:
        payload["main"] = None
        payload["main_unavailable_reason"] = "no snapshot ingested since boot"
    else:
        payload["main"] = {
            "sha": MAIN_SHA,
            "pushed_at": "2026-09-03T11:00:00Z",
            "surfaces": main,
        }
    return payload


READS_AGENT_WRITABLE = _manifest(
    ("prompt_documents", "agent_writable", "sql"),
    ("prompt_documents", "agent_write_tier", "sql"),
    ("prompt_document_versions", "agent_writable", "sql"),
    ("tasks", "id", "readiness_required"),
)
# Today's world after the coord read-removal deployed: the tier, not the bool.
READS_TIER_ONLY = _manifest(
    ("prompt_documents", "agent_write_tier", "sql"),
    ("prompt_document_versions", "agent_write_tier", "sql"),
    ("tasks", "id", "readiness_required"),
)


def _write(tmp_path: Path, name: str, source: str) -> Path:
    path = tmp_path / name
    path.write_text(source, encoding="utf-8")
    return path


def _write_manifest(tmp_path: Path, payload: dict) -> Path:
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def _forbid_fetch(url: str) -> bytes:
    raise AssertionError(f"the gate fetched {url}; this case must stay offline")


def _fetch_of(payload: dict):
    def fetch(url: str) -> bytes:
        assert url == guard.DEFAULT_COORD_URL + guard.MANIFEST_ROUTE
        return json.dumps(payload).encode()

    return fetch


def _run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(GUARD), *args],
        capture_output=True,
        text=True,
        check=False,
        cwd=REPO_ROOT,
    )


# ---------------------------------------------------------------------------
# 1-2. pdtier_01 — the incident, verbatim
# ---------------------------------------------------------------------------


def test_pdtier_01_verbatim_is_unresolved_and_never_reaches_the_manifest(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    fixture = _write(tmp_path, "pdtier_01.py", PDTIER_01.read_text(encoding="utf-8"))
    code = guard.main(["--files", str(fixture)], fetch=_forbid_fetch)
    assert code == guard.EXIT_VIOLATION
    captured = capsys.readouterr()
    assert "COORD_SCHEMA_DROPS" in captured.err
    assert "cannot resolve statically" in captured.err
    assert "'{table}'" in captured.err
    assert "manifest" not in captured.out


def test_pdtier_01_verbatim_fails_by_subprocess_even_with_a_manifest(
    tmp_path: Path,
) -> None:
    fixture = _write(tmp_path, "pdtier_01.py", PDTIER_01.read_text(encoding="utf-8"))
    manifest = _write_manifest(tmp_path, READS_AGENT_WRITABLE)
    result = _run("--files", str(fixture), "--manifest-json", str(manifest))
    assert result.returncode == 1, result.stdout + result.stderr
    assert "COORD_SCHEMA_DROPS" in result.stderr
    # Fired before the manifest was consulted: no manifest line on stdout.
    assert "manifest:" not in result.stdout


def test_pdtier_01_with_declaration_names_both_surfaces_and_the_shas(
    tmp_path: Path,
) -> None:
    fixture = _write(
        tmp_path,
        "pdtier_01.py",
        PDTIER_01.read_text(encoding="utf-8") + DECLARATION,
    )
    manifest = _write_manifest(tmp_path, READS_AGENT_WRITABLE)
    result = _run("--files", str(fixture), "--manifest-json", str(manifest))
    assert result.returncode == 1, result.stdout + result.stderr
    assert "coord.prompt_documents.agent_writable" in result.stderr
    assert "coord.prompt_document_versions.agent_writable" in result.stderr
    assert DEPLOYED_SHA in result.stderr
    assert MAIN_SHA in result.stderr
    assert "Land the coord change that stops reading" in result.stderr
    assert "/health" in result.stderr


def test_pdtier_01_with_declaration_passes_once_coord_stopped_reading(
    tmp_path: Path,
) -> None:
    """The same drop is fine once neither coord half names the surface."""
    fixture = _write(
        tmp_path,
        "pdtier_01.py",
        PDTIER_01.read_text(encoding="utf-8") + DECLARATION,
    )
    manifest = _write_manifest(tmp_path, READS_TIER_ONLY)
    result = _run("--files", str(fixture), "--manifest-json", str(manifest))
    assert result.returncode == 0, result.stdout + result.stderr
    assert "OK: none of the 2 dropped surface(s)" in result.stdout


def test_report_only_downgrades_the_violation_but_still_reports_it(
    tmp_path: Path,
) -> None:
    fixture = _write(
        tmp_path,
        "pdtier_01.py",
        PDTIER_01.read_text(encoding="utf-8") + DECLARATION,
    )
    manifest = _write_manifest(tmp_path, READS_AGENT_WRITABLE)
    result = _run(
        "--files", str(fixture), "--manifest-json", str(manifest), "--report-only"
    )
    assert result.returncode == 0
    assert "coord.prompt_documents.agent_writable" in result.stderr
    assert "--report-only" in result.stdout


# ---------------------------------------------------------------------------
# The declaration is cross-checked, not trusted
# ---------------------------------------------------------------------------


def test_a_stale_declaration_naming_a_column_absent_from_the_module_fails(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source = (
        PDTIER_01.read_text(encoding="utf-8")
        + '\nCOORD_SCHEMA_DROPS = [("prompt_documents", "no_such_column")]\n'
    )
    fixture = _write(tmp_path, "pdtier_01.py", source)
    code = guard.main(["--files", str(fixture)], fetch=_forbid_fetch)
    assert code == guard.EXIT_VIOLATION
    err = capsys.readouterr().err
    assert "'no_such_column'" in err
    assert "appears nowhere else in the module" in err


def test_a_declaration_cannot_launder_by_naming_only_a_docstring_mention(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """A name that appears only in prose is not a name the SQL drops."""
    source = (
        HEADER.replace('"""a revision"""', '"""mentions ghost_column in prose"""')
        + "_SQL = 'ALTER TABLE {table} DROP COLUMN {col}'\n"
        + "def upgrade() -> None:\n"
        + "    op.execute(_SQL.format(table='coord.prompt_documents', col='x'))\n"
        + "def downgrade() -> None:\n    pass\n"
        + 'COORD_SCHEMA_DROPS = [("prompt_documents", "ghost_column")]\n'
    )
    fixture = _write(tmp_path, "r.py", source)
    code = guard.main(["--files", str(fixture)], fetch=_forbid_fetch)
    assert code == guard.EXIT_VIOLATION
    assert "'ghost_column'" in capsys.readouterr().err


def test_an_empty_declaration_does_not_assert_no_coord_drops(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source = PDTIER_01.read_text(encoding="utf-8") + "\nCOORD_SCHEMA_DROPS = []\n"
    fixture = _write(tmp_path, "pdtier_01.py", source)
    code = guard.main(["--files", str(fixture)], fetch=_forbid_fetch)
    assert code == guard.EXIT_VIOLATION
    assert "is empty" in capsys.readouterr().err


def test_a_declaration_of_a_non_coord_table_is_rejected(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source = (
        HEADER
        + "_T = 'project.pr_watch_state'\n"
        + "def upgrade() -> None:\n"
        + "    op.execute(f'ALTER TABLE {_T} DROP COLUMN authoring_session_id')\n"
        + "def downgrade() -> None:\n    pass\n"
        + 'COORD_SCHEMA_DROPS = [("project.pr_watch_state", "authoring_session_id")]\n'
    )
    fixture = _write(tmp_path, "r.py", source)
    code = guard.main(["--files", str(fixture)], fetch=_forbid_fetch)
    assert code == guard.EXIT_VIOLATION
    assert "not a coord.* table" in capsys.readouterr().err


def test_a_declaration_is_unioned_with_what_the_scan_resolved_itself(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """A declaration must not HIDE a literal drop elsewhere in the file."""
    source = (
        HEADER
        + "_SQL = 'ALTER TABLE {table} DROP COLUMN {col}'\n"
        + "def upgrade() -> None:\n"
        + "    op.execute(_SQL.format(table='coord.prompt_documents', col='x'))\n"
        + '    op.drop_column("tasks", "id", schema="coord")\n'
        + "def downgrade() -> None:\n    pass\n"
        + 'COORD_SCHEMA_DROPS = [("prompt_documents", "x")]\n'
    )
    fixture = _write(tmp_path, "r.py", source)
    code = guard.main(["--files", str(fixture)], fetch=_fetch_of(READS_AGENT_WRITABLE))
    assert code == guard.EXIT_VIOLATION
    err = capsys.readouterr().err
    assert "coord.tasks.id" in err
    assert "readiness_required" in err


# ---------------------------------------------------------------------------
# 3. plain op.drop_column
# ---------------------------------------------------------------------------


def _drop_column_revision(table: str, column: str, schema: str = "coord") -> str:
    return (
        HEADER
        + "def upgrade() -> None:\n"
        + f'    op.drop_column("{table}", "{column}", schema="{schema}")\n'
        + "def downgrade() -> None:\n"
        + f'    op.add_column("{table}", sa.Column("{column}", sa.Boolean()), '
        + f'schema="{schema}")\n'
    ).replace(
        "from alembic import op\n", "import sqlalchemy as sa\nfrom alembic import op\n"
    )


def test_plain_drop_column_on_a_read_surface_is_a_violation(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    fixture = _write(
        tmp_path, "r.py", _drop_column_revision("prompt_documents", "agent_writable")
    )
    code = guard.main(["--files", str(fixture)], fetch=_fetch_of(READS_AGENT_WRITABLE))
    assert code == guard.EXIT_VIOLATION
    err = capsys.readouterr().err
    assert "coord.prompt_documents.agent_writable (op.drop_column)" in err
    assert DEPLOYED_SHA in err


def test_plain_drop_column_on_a_surface_nothing_reads_passes(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    fixture = _write(
        tmp_path, "r.py", _drop_column_revision("prompt_documents", "scratch")
    )
    code = guard.main(["--files", str(fixture)], fetch=_fetch_of(READS_AGENT_WRITABLE))
    assert code == 0
    assert "OK: none of the 1 dropped surface(s)" in capsys.readouterr().out


def test_coord_qualified_table_name_counts_without_schema_kwarg(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source = (
        HEADER
        + "def upgrade() -> None:\n"
        + '    op.drop_column("coord.prompt_documents", "agent_writable")\n'
        + "def downgrade() -> None:\n    pass\n"
    )
    fixture = _write(tmp_path, "r.py", source)
    code = guard.main(["--files", str(fixture)], fetch=_fetch_of(READS_AGENT_WRITABLE))
    assert code == guard.EXIT_VIOLATION
    assert "coord.prompt_documents.agent_writable" in capsys.readouterr().err


def test_deployed_only_reader_is_named_as_the_deployed_build(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """main stopped reading, the deployed build has not: still a violation,
    and the message says WHICH half."""
    payload = _manifest(
        ("prompt_documents", "agent_writable", "sql"),
        main=[["prompt_documents", "agent_write_tier", "sql"]],
    )
    fixture = _write(
        tmp_path, "r.py", _drop_column_revision("prompt_documents", "agent_writable")
    )
    code = guard.main(["--files", str(fixture)], fetch=_fetch_of(payload))
    assert code == guard.EXIT_VIOLATION
    err = capsys.readouterr().err
    assert f"deployed build {DEPLOYED_SHA}" in err
    assert f"main {MAIN_SHA}" not in err


# ---------------------------------------------------------------------------
# 4-5. no network when nothing in coord.* is dropped
# ---------------------------------------------------------------------------


def test_downgrade_only_drop_passes_with_no_network(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source = (
        HEADER
        + "def upgrade() -> None:\n"
        + '    op.add_column("prompt_documents", sa.Column("agent_writable", sa.Boolean()), schema="coord")\n'
        + "def downgrade() -> None:\n"
        + '    op.drop_column("prompt_documents", "agent_writable", schema="coord")\n'
        + '    op.execute("ALTER TABLE coord.prompt_documents DROP COLUMN agent_writable")\n'
    ).replace(
        "from alembic import op\n", "import sqlalchemy as sa\nfrom alembic import op\n"
    )
    fixture = _write(tmp_path, "r.py", source)
    code = guard.main(["--files", str(fixture)], fetch=_forbid_fetch)
    assert code == 0
    assert "nothing to check against coord" in capsys.readouterr().out


def test_project_schema_drop_passes_with_no_network(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """web#805's shape: pr_shepherd_retire_01's raw SQL, on project.*."""
    real = (
        REPO_ROOT
        / "backend/alembic/versions/pr_shepherd_retire_01_drop_watch_state_shepherd_columns.py"
    )
    code = guard.main(["--files", str(real)], fetch=_forbid_fetch)
    assert code == 0
    out = capsys.readouterr().out
    assert "0 resolved coord.* DROP/RENAME site(s) and 0 unresolved" in out


def test_project_schema_op_calls_pass_even_with_a_dynamic_table(
    tmp_path: Path,
) -> None:
    """`schema="project"` settles it whatever the table expression is."""
    source = (
        HEADER
        + "_T = 'pr_watch_state'\n"
        + "def upgrade() -> None:\n"
        + '    op.drop_column(_T, "authoring_session_id", schema="project")\n'
        + '    op.drop_table(_T, schema="project")\n'
        + "def downgrade() -> None:\n    pass\n"
    )
    fixture = _write(tmp_path, "r.py", source)
    assert guard.main(["--files", str(fixture)], fetch=_forbid_fetch) == 0


def test_the_pr_that_ships_this_gate_drops_nothing(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """The base-ref lane on this checkout: an empty in-scope diff is an honest
    pass, and no network is touched. If origin/main is absent the gate reports
    UNKNOWN (exit 2), never a violation — assert that split rather than
    assume the ref exists on every CI checkout."""
    code = guard.main(["--base-ref", "origin/main"], fetch=_forbid_fetch)
    captured = capsys.readouterr()
    if code == guard.EXIT_VACUOUS:
        assert "could not list changed revision files" in captured.err
    else:
        assert code == 0, captured.err
        assert "changed vs origin/main" in captured.out


# ---------------------------------------------------------------------------
# 6. the manifest is UNKNOWN unless both halves are usable
# ---------------------------------------------------------------------------


def test_fetch_failure_is_vacuous_not_a_pass(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    def failing(url: str) -> bytes:
        raise guard.ManifestUnavailableError(f"{url}: HTTP Error 404: Not Found")

    fixture = _write(
        tmp_path, "r.py", _drop_column_revision("prompt_documents", "agent_writable")
    )
    code = guard.main(["--files", str(fixture)], fetch=failing)
    assert code == guard.EXIT_VACUOUS
    err = capsys.readouterr().err
    assert "404" in err
    assert "UNKNOWN is not green" in err


def test_main_null_is_vacuous_and_quotes_the_reason(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    payload = _manifest(("prompt_documents", "agent_write_tier", "sql"), main=None)
    fixture = _write(
        tmp_path, "r.py", _drop_column_revision("prompt_documents", "agent_writable")
    )
    code = guard.main(["--files", str(fixture)], fetch=_fetch_of(payload))
    assert code == guard.EXIT_VACUOUS
    err = capsys.readouterr().err
    assert "`main` half of the manifest is null" in err
    assert "no snapshot ingested since boot" in err


def test_empty_deployed_surfaces_is_vacuous_naming_the_deployed_half(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    payload = _manifest(
        ("prompt_documents", "agent_write_tier", "sql"), deployed_surfaces=[]
    )
    fixture = _write(
        tmp_path, "r.py", _drop_column_revision("prompt_documents", "agent_writable")
    )
    code = guard.main(["--files", str(fixture)], fetch=_fetch_of(payload))
    assert code == guard.EXIT_VACUOUS
    err = capsys.readouterr().err
    assert "`deployed` half" in err
    assert "no surfaces at all" in err


@pytest.mark.parametrize(
    "raw",
    [
        b"<html>Bad Gateway</html>",
        b'{"deployed": "nope"}',
        b'{"deployed": {"build_sha": "short", "surfaces": [["a","b","c"]]}, "main": null}',
        b'{"deployed": {"build_sha": "'
        + DEPLOYED_SHA.encode()
        + b'", "surfaces": [["a","b"]]}, "main": null}',
    ],
)
def test_unparseable_or_malformed_manifest_is_vacuous(
    tmp_path: Path, raw: bytes
) -> None:
    fixture = _write(
        tmp_path, "r.py", _drop_column_revision("prompt_documents", "agent_writable")
    )
    assert (
        guard.main(["--files", str(fixture)], fetch=lambda _url: raw)
        == guard.EXIT_VACUOUS
    )


def test_manifest_json_file_bypasses_the_network(tmp_path: Path) -> None:
    fixture = _write(
        tmp_path, "r.py", _drop_column_revision("prompt_documents", "agent_writable")
    )
    manifest = _write_manifest(tmp_path, READS_AGENT_WRITABLE)
    code = guard.main(
        ["--files", str(fixture), "--manifest-json", str(manifest)], fetch=_forbid_fetch
    )
    assert code == guard.EXIT_VIOLATION


def test_missing_manifest_json_file_is_vacuous(tmp_path: Path) -> None:
    fixture = _write(
        tmp_path, "r.py", _drop_column_revision("prompt_documents", "agent_writable")
    )
    code = guard.main(
        ["--files", str(fixture), "--manifest-json", str(tmp_path / "absent.json")],
        fetch=_forbid_fetch,
    )
    assert code == guard.EXIT_VACUOUS


# ---------------------------------------------------------------------------
# 7. the wildcard waiver
# ---------------------------------------------------------------------------


def test_wildcard_row_on_the_dropped_table_is_vacuous_naming_the_waiver(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    payload = _manifest(
        ("prompt_documents", "agent_write_tier", "sql"),
        ("prompt_documents", "*", "unresolved_wildcard"),
    )
    fixture = _write(
        tmp_path, "r.py", _drop_column_revision("prompt_documents", "scratch")
    )
    code = guard.main(["--files", str(fixture)], fetch=_fetch_of(payload))
    assert code == guard.EXIT_VACUOUS
    err = capsys.readouterr().err
    assert "INTENTIONALLY_UNRESOLVED" in err
    assert "unresolved_wildcard" in err


def test_a_concrete_read_wins_over_the_wildcard(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """Both apply: the definite answer (violation) is reported, not UNKNOWN."""
    payload = _manifest(
        ("prompt_documents", "agent_writable", "sql"),
        ("prompt_documents", "*", "unresolved_wildcard"),
    )
    fixture = _write(
        tmp_path, "r.py", _drop_column_revision("prompt_documents", "agent_writable")
    )
    code = guard.main(["--files", str(fixture)], fetch=_fetch_of(payload))
    assert code == guard.EXIT_VIOLATION


def test_wildcard_on_another_table_does_not_matter(tmp_path: Path) -> None:
    payload = _manifest(
        ("prompt_documents", "agent_write_tier", "sql"),
        ("tasks", "*", "unresolved_wildcard"),
    )
    fixture = _write(
        tmp_path, "r.py", _drop_column_revision("prompt_documents", "scratch")
    )
    assert guard.main(["--files", str(fixture)], fetch=_fetch_of(payload)) == 0


# ---------------------------------------------------------------------------
# 8. the queued customer: pdtier_03 (web#1180) must pass
# ---------------------------------------------------------------------------


def test_pdtier_03_passes_against_a_manifest_without_agent_writable(
    tmp_path: Path,
) -> None:
    """Negative control. pdtier_03 composes its DROP through
    ``_RECONCILE_AND_DROP.format(table=table, legacy=...)``, so the fixture
    carries the ``COORD_SCHEMA_DROPS`` declaration the gate demands."""
    fixture = _write(
        tmp_path, "pdtier_03.py", PDTIER_03.read_text(encoding="utf-8") + DECLARATION
    )
    manifest = _write_manifest(tmp_path, READS_TIER_ONLY)
    result = _run("--files", str(fixture), "--manifest-json", str(manifest))
    assert result.returncode == 0, result.stdout + result.stderr
    assert "OK: none of the 2 dropped surface(s)" in result.stdout


def test_pdtier_03_without_the_declaration_is_told_to_add_it(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    fixture = _write(tmp_path, "pdtier_03.py", PDTIER_03.read_text(encoding="utf-8"))
    code = guard.main(["--files", str(fixture)], fetch=_forbid_fetch)
    assert code == guard.EXIT_VIOLATION
    assert "COORD_SCHEMA_DROPS" in capsys.readouterr().err


def test_pdtier_03_would_have_failed_while_coord_still_read_the_bool(
    tmp_path: Path,
) -> None:
    fixture = _write(
        tmp_path, "pdtier_03.py", PDTIER_03.read_text(encoding="utf-8") + DECLARATION
    )
    manifest = _write_manifest(tmp_path, READS_AGENT_WRITABLE)
    result = _run("--files", str(fixture), "--manifest-json", str(manifest))
    assert result.returncode == 1


# ---------------------------------------------------------------------------
# parser edges the design rests on
# ---------------------------------------------------------------------------


def _scan(source: str) -> guard.FileScan:
    return guard.scan_source(source, Path("r.py"))


def _pairs(scan: guard.FileScan) -> set[tuple[str, str]]:
    return {(d.table, d.column) for d in scan.drops}


def test_unreferenced_module_level_template_still_counts() -> None:
    scan = _scan(
        HEADER
        + '_UNUSED = "ALTER TABLE coord.prompt_documents DROP COLUMN agent_writable"\n'
        + "def upgrade() -> None:\n    pass\n"
        + "def downgrade() -> None:\n    pass\n"
    )
    assert _pairs(scan) == {("prompt_documents", "agent_writable")}


def test_helper_functions_are_on_the_upgrade_path() -> None:
    scan = _scan(
        HEADER
        + "def _tidy() -> None:\n"
        + '    op.drop_column("prompt_documents", "x", schema="coord")\n'
        + "def upgrade() -> None:\n    _tidy()\n"
        + "def downgrade() -> None:\n    pass\n"
    )
    assert _pairs(scan) == {("prompt_documents", "x")}


def test_docstrings_are_prose_not_sql() -> None:
    scan = _scan(
        '"""ALTER TABLE coord.prompt_documents DROP COLUMN agent_writable — history."""\n'
        + "from alembic import op\n"
        + "def upgrade() -> None:\n"
        + '    """DROP TABLE coord.tasks would be bad."""\n'
        + "def downgrade() -> None:\n    pass\n"
    )
    assert not scan.drops and not scan.unresolved


def test_pdtier_01_fstring_template_renders_with_single_brace_placeholders() -> None:
    scan = _scan(PDTIER_01.read_text(encoding="utf-8"))
    assert not scan.drops
    assert (
        len(scan.unresolved) == 2
    )  # _MIGRATE_AND_DROP_LEGACY, _UNMIGRATE_AND_DROP_TIER
    assert all(u.detail == "table token '{table}'" for u in scan.unresolved)
    assert scan.violations and "COORD_SCHEMA_DROPS" in scan.violations[-1]


@pytest.mark.parametrize(
    ("sql", "expected"),
    [
        ("ALTER TABLE coord.t DROP COLUMN a", {("t", "a")}),
        ("ALTER TABLE coord.t DROP a", {("t", "a")}),
        ("ALTER TABLE IF EXISTS ONLY coord.t DROP COLUMN IF EXISTS a", {("t", "a")}),
        ("ALTER TABLE coord.t DROP COLUMN a, DROP COLUMN b", {("t", "a"), ("t", "b")}),
        ('ALTER TABLE "coord"."t" DROP COLUMN "a"', {("t", "a")}),
        ("ALTER TABLE coord.t RENAME COLUMN a TO b", {("t", "a")}),
        ("ALTER TABLE coord.t RENAME a TO b", {("t", "a")}),
        ("ALTER TABLE coord.t RENAME TO u", {("t", "*")}),
        ("ALTER TABLE coord.t SET SCHEMA project", {("t", "*")}),
        ("DROP TABLE coord.t", {("t", "*")}),
        ("DROP TABLE IF EXISTS coord.t, coord.u", {("t", "*"), ("u", "*")}),
        # Not drops of a column/table:
        ("ALTER TABLE coord.t DROP CONSTRAINT ck", set()),
        ("ALTER TABLE coord.t ALTER COLUMN a DROP DEFAULT", set()),
        ("ALTER TABLE coord.t ALTER COLUMN a DROP NOT NULL", set()),
        ("ALTER TABLE coord.t RENAME CONSTRAINT a TO b", set()),
        ("DROP INDEX IF EXISTS coord.idx_t", set()),
        ("ALTER TABLE coord.t ADD COLUMN a TEXT", set()),
        # Not coord's:
        ("ALTER TABLE project.t DROP COLUMN a", set()),
        ("DROP TABLE project.t", set()),
        ("ALTER TABLE t DROP COLUMN a", set()),
        # Comments do not count:
        ("-- ALTER TABLE coord.t DROP COLUMN a\nSELECT 1", set()),
    ],
)
def test_raw_sql_shapes(sql: str, expected: set[tuple[str, str]]) -> None:
    scan = guard.FileScan(path=Path("r.py"))
    guard.scan_sql(sql, "r.py:1", scan)
    assert _pairs(scan) == expected
    assert not scan.unresolved


@pytest.mark.parametrize(
    "sql",
    [
        "ALTER TABLE {table} DROP COLUMN a",
        "ALTER TABLE coord.t DROP COLUMN {col}",
        "ALTER TABLE coord.t DROP COLUMN %s",
        "ALTER TABLE coord.t DROP COLUMN :col",
        "ALTER TABLE %(t)s DROP COLUMN a",
        "DROP TABLE {table}",
        "DROP COLUMN a",  # no ALTER TABLE in the same string names its table
    ],
)
def test_placeholders_are_unresolved(sql: str) -> None:
    scan = guard.FileScan(path=Path("r.py"))
    guard.scan_sql(sql, "r.py:1", scan)
    assert scan.unresolved, sql
    assert not scan.drops


def test_fstring_and_concatenation_operands_are_placeholders() -> None:
    scan = _scan(
        HEADER
        + "_T = 'coord.t'\n"
        + "def upgrade() -> None:\n"
        + '    op.execute(f"ALTER TABLE {_T} DROP COLUMN a")\n'
        + '    op.execute("ALTER TABLE " + _T + " DROP COLUMN b")\n'
        + '    op.execute("ALTER TABLE coord.t DROP COLUMN {}".format("c"))\n'
        + "def downgrade() -> None:\n    pass\n"
    )
    assert not scan.drops
    assert len(scan.unresolved) == 3


def test_op_alter_column_rename_and_rename_table_count() -> None:
    scan = _scan(
        HEADER
        + "def upgrade() -> None:\n"
        + '    op.alter_column("t", "a", new_column_name="b", schema="coord")\n'
        + '    op.alter_column("t", "c", nullable=False, schema="coord")\n'
        + '    op.rename_table("u", "v", schema="coord")\n'
        + '    op.drop_table("w", schema="coord")\n'
        + "def downgrade() -> None:\n    pass\n"
    )
    assert _pairs(scan) == {("t", "a"), ("u", "*"), ("w", "*")}


def test_op_call_with_dynamic_column_or_schema_is_unresolved() -> None:
    scan = _scan(
        HEADER
        + "_C = 'a'\n_S = 'coord'\n"
        + "def upgrade() -> None:\n"
        + '    op.drop_column("t", _C, schema="coord")\n'
        + '    op.drop_column("t", "b", schema=_S)\n'
        + "def downgrade() -> None:\n    pass\n"
    )
    assert not scan.drops
    assert len(scan.unresolved) == 2


def test_whole_table_drop_names_every_column_coord_reads(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source = (
        HEADER
        + "def upgrade() -> None:\n"
        + '    op.drop_table("prompt_documents", schema="coord")\n'
        + "def downgrade() -> None:\n    pass\n"
    )
    fixture = _write(tmp_path, "r.py", source)
    code = guard.main(["--files", str(fixture)], fetch=_fetch_of(READS_AGENT_WRITABLE))
    assert code == guard.EXIT_VIOLATION
    err = capsys.readouterr().err
    assert "removes table coord.prompt_documents" in err
    assert "agent_writable" in err and "agent_write_tier" in err


def test_declared_whole_table_star_is_accepted() -> None:
    scan = _scan(
        HEADER
        + "_T = 'coord.prompt_documents'\n"
        + "def upgrade() -> None:\n"
        + '    op.execute(f"DROP TABLE {_T}")\n'
        + "def downgrade() -> None:\n    pass\n"
        + 'COORD_SCHEMA_DROPS = [("coord.prompt_documents", "*")]\n'
    )
    assert not scan.violations
    assert _pairs(scan) == {("prompt_documents", "*")}


# ---------------------------------------------------------------------------
# the lanes' contract
# ---------------------------------------------------------------------------


def test_unparseable_revision_is_vacuous(tmp_path: Path) -> None:
    fixture = _write(tmp_path, "r.py", "def upgrade(:\n")
    result = _run("--files", str(fixture))
    assert result.returncode == 2
    assert "cannot parse" in result.stderr


def test_missing_file_is_vacuous(tmp_path: Path) -> None:
    result = _run("--files", str(tmp_path / "absent.py"))
    assert result.returncode == 2


def test_unknown_base_ref_is_vacuous() -> None:
    result = _run("--base-ref", "refs/no/such/ref")
    assert result.returncode == 2
    assert "UNKNOWN, not a pass" in result.stderr


@pytest.mark.parametrize(
    "flag", ["--base-ref", "--files", "--manifest-json", "--coord-url", "--report-only"]
)
def test_the_flags_every_lane_relies_on_exist(flag: str) -> None:
    result = _run("--help")
    assert result.returncode == 0
    assert flag in result.stdout


def test_the_fixtures_are_the_recorded_revisions() -> None:
    """Sanity: the incident file and the queued customer are both present and
    are the composed-SQL shape the design was decided on."""
    pdtier_01 = PDTIER_01.read_text(encoding="utf-8")
    assert 'revision: str = "pdtier_01"' in pdtier_01
    assert "_MIGRATE_AND_DROP_LEGACY = f" in pdtier_01
    pdtier_03 = PDTIER_03.read_text(encoding="utf-8")
    assert 'revision: str = "pdtier_03"' in pdtier_03
    assert "_RECONCILE_AND_DROP.format(" in pdtier_03


# ---------------------------------------------------------------------------
# THE LANE ROSTER — who actually invokes this gate.
#
# Everything above tests what the gate COMPUTES. These two test how many places
# run it. That property is the one `a208240e2` falsified invisibly on a sibling
# gate: a fourth invocation of the ruff-parity gate was added while three
# separate places in the tree went on saying there were three, and nothing
# failed for 90 commits.
#
# Three lanes invoke this script, and the gate's own docstring says so:
#
#   * .github/workflows/coord-column-drop-guard.yml, step "Check coord.* drops
#     against coord's read contract (PR)" — the PR gate.
#   * .qontinui/ci.toml, step `coord-column-drop-guard` — the
#     runner-as-CI-node lane, invoking this same script rather than mirroring a
#     command string, so the two cannot drift. It relies on a runner checkout
#     already having `origin/main`, so the argv stays bare.
#   * .pre-commit-config.yaml — the shift-left lane, handed the changed
#     revision files as `--files`.
#
# Asserted BY POSITION (a YAML `run:`/`entry:` value, a TOML `command = [...]`
# element) rather than by "a tracked non-comment line naming the script", which
# does not generalise across this class — four such lines name
# `count_alembic_heads.py` and invoke none of it. The position rule needs no
# exclusion list, including for this file, which names the script throughout.
# ---------------------------------------------------------------------------

_SCRIPT_REF = "scripts/ci/check_coord_column_drops.py"

_DECLARED_LANES = frozenset(
    {
        ".github/workflows/coord-column-drop-guard.yml",
        ".pre-commit-config.yaml",
        ".qontinui/ci.toml",
    }
)


# ---------------------------------------------------------------------------
# The downgrade-only helper: an ADDITIVE revision is not a drop
#
# Plan 2026-09-06-devops-coord-column-drop-guard-has-no-served-manifest.
# web#1273 (fleet_res_tel_05) adds three columns and removes exactly those three
# in downgrade(), generating both from one column list. The DROP fragment lives
# in a helper `downgrade()` alone calls, so the scan saw an unresolved site,
# demanded a COORD_SCHEMA_DROPS declaration, and the declaration ACTIVATED the
# manifest phase against columns no deployed coord could be reading. Two arms
# below: the shape now passes, and a genuine drop still fails.
# ---------------------------------------------------------------------------

# `_drop_columns` is reached ONLY from downgrade(); `_add_columns` only from
# upgrade(). Neither ALTER TABLE nor DROP COLUMN shares a string literal, which
# is what makes the site unresolvable and drove the original declaration.
_ADDITIVE = (
    HEADER
    + '_TABLE = "coord.device_resource_samples"\n'
    + '_COLUMNS = (("disk_inodes_total", "BIGINT"), ("swap_shmem_bytes", "BIGINT"))\n'
    + "def _add_columns(table: str) -> str:\n"
    + '    adds = ", ".join(f"ADD COLUMN IF NOT EXISTS {n} {t}" for n, t in _COLUMNS)\n'
    + '    return f"ALTER TABLE {table} {adds}"\n'
    + "def _drop_columns(table: str) -> str:\n"
    + '    drops = ", ".join(f"DROP COLUMN IF EXISTS {n}" for n, _ in _COLUMNS)\n'
    + '    return f"ALTER TABLE {table} {drops}"\n'
    + "def upgrade() -> None:\n    op.execute(_add_columns(_TABLE))\n"
    + "def downgrade() -> None:\n    op.execute(_drop_columns(_TABLE))\n"
)


def test_a_helper_reached_only_from_downgrade_is_not_the_upgrade_path(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """ARM 1 — web#1273's shape passes, offline, with no declaration.

    `_forbid_fetch` is the assertion that matters as much as the exit code: an
    additive revision must never reach the manifest at all.
    """
    fixture = _write(tmp_path, "r.py", _ADDITIVE)
    assert guard.main(["--files", str(fixture)], fetch=_forbid_fetch) == 0
    out = capsys.readouterr().out
    assert "0 resolved coord.* DROP/RENAME site(s) and 0 unresolved" in out
    assert "nothing to check against coord" in out


def test_the_zero_drop_pass_says_what_it_does_not_prove(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """A green here is 'this revision drops nothing', never 'a drop was checked'."""
    fixture = _write(tmp_path, "r.py", _ADDITIVE)
    assert guard.main(["--files", str(fixture)], fetch=_forbid_fetch) == 0
    assert "NOT evidence that a drop was checked" in capsys.readouterr().out


def test_a_genuine_upgrade_path_drop_still_fails(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """ARM 2 — the teeth. A real drop of a column coord reads is still exit 1.

    Paired with ARM 1 deliberately: a guard that stopped refusing everything by
    refusing nothing would be worse than the defect it replaced.
    """
    source = (
        HEADER
        + "def upgrade() -> None:\n"
        + '    op.drop_column("prompt_documents", "agent_writable", schema="coord")\n'
        + "def downgrade() -> None:\n    pass\n"
    )
    fixture = _write(tmp_path, "r.py", source)
    code = guard.main(["--files", str(fixture)], fetch=_fetch_of(READS_AGENT_WRITABLE))
    assert code == guard.EXIT_VIOLATION
    assert "which coord still reads" in capsys.readouterr().err


def test_a_helper_reached_from_BOTH_paths_stays_on_the_upgrade_path(
    tmp_path: Path,
) -> None:
    """The exclusion is reachability, not name-matching.

    One extra call from upgrade() and the same helper must be scanned again —
    otherwise the fix would be a hole rather than a correction.
    """
    source = (
        HEADER
        + "def _tidy() -> None:\n"
        + '    op.drop_column("prompt_documents", "agent_writable", schema="coord")\n'
        + "def upgrade() -> None:\n    _tidy()\n"
        + "def downgrade() -> None:\n    _tidy()\n"
    )
    scan = _scan(source)
    assert _pairs(scan) == {("prompt_documents", "agent_writable")}


def test_a_transitive_downgrade_only_chain_is_excluded() -> None:
    """downgrade() -> _outer() -> _inner(): the whole chain is downgrade code."""
    source = (
        HEADER
        + "def _inner(table: str) -> str:\n"
        + '    return f"DROP COLUMN IF EXISTS {table}"\n'
        + "def _outer(table: str) -> str:\n    return _inner(table)\n"
        + "def upgrade() -> None:\n    pass\n"
        + 'def downgrade() -> None:\n    op.execute(_outer("x"))\n'
    )
    scan = _scan(source)
    assert not scan.drops and not scan.unresolved


def test_a_chain_whose_TAIL_is_shared_with_upgrade_stays_scanned() -> None:
    """If upgrade() reaches the inner helper too, the inner helper counts."""
    source = (
        HEADER
        + "def _inner() -> None:\n"
        + '    op.drop_column("prompt_documents", "agent_writable", schema="coord")\n'
        + "def _outer() -> None:\n    _inner()\n"
        + "def upgrade() -> None:\n    _inner()\n"
        + "def downgrade() -> None:\n    _outer()\n"
    )
    assert _pairs(_scan(source)) == {("prompt_documents", "agent_writable")}


def test_a_downgrade_only_helper_named_anywhere_else_stays_scanned() -> None:
    """Conservatism: a mention in a module-level constant is enough to keep it.

    A helper reached by getattr / globals() / a dispatch table is never in the
    closure at all, so it is scanned; this pins the nearest observable case.
    """
    source = (
        HEADER
        + "def _tidy() -> None:\n"
        + '    op.drop_column("prompt_documents", "agent_writable", schema="coord")\n'
        + "_DISPATCH = (_tidy,)\n"
        + "def upgrade() -> None:\n    pass\n"
        + "def downgrade() -> None:\n    _tidy()\n"
    )
    assert _pairs(_scan(source)) == {("prompt_documents", "agent_writable")}


def test_a_revision_with_no_downgrade_is_unaffected() -> None:
    source = (
        HEADER
        + "def _tidy() -> None:\n"
        + '    op.drop_column("prompt_documents", "agent_writable", schema="coord")\n'
        + "def upgrade() -> None:\n    pass\n"
    )
    assert _pairs(_scan(source)) == {("prompt_documents", "agent_writable")}


# ---------------------------------------------------------------------------
# An unserved manifest route is a gate defect, not a revision defect
# ---------------------------------------------------------------------------


def _http_error(status: int):
    """A fetch that fails the way `fetch_manifest` fails on an HTTP error.

    `fetch_manifest` is what converts the `HTTPError` into a
    `ManifestUnavailableError` carrying the status; injecting a fetch that
    raised the raw `HTTPError` would test a seam `main()` never sees. The
    conversion itself is pinned by
    `test_fetch_manifest_records_the_http_status` below.
    """

    def fetch(url: str) -> bytes:
        raise guard.ManifestUnavailableError(
            f"{url}: HTTP Error {status}: nope", http_status=status
        )

    return fetch


def test_fetch_manifest_records_the_http_status(monkeypatch) -> None:
    """The status must survive the fetch, or `main()` cannot tell 401 from 503."""

    def boom(url, timeout):  # noqa: ANN001, ARG001
        raise urllib.error.HTTPError(url, 404, "nope", None, None)

    monkeypatch.setattr(guard.urllib.request, "urlopen", boom)
    with pytest.raises(guard.ManifestUnavailableError) as excinfo:
        guard.fetch_manifest("https://coord.example/schema/read-surfaces")
    assert excinfo.value.http_status == 404


def test_fetch_manifest_records_no_status_for_a_transport_failure(
    monkeypatch,
) -> None:
    """A timeout is not an HTTP status, and must not be reported as one."""

    def boom(url, timeout):  # noqa: ANN001, ARG001
        raise TimeoutError("timed out")

    monkeypatch.setattr(guard.urllib.request, "urlopen", boom)
    monkeypatch.setattr(guard.time, "sleep", lambda _: None)
    with pytest.raises(guard.ManifestUnavailableError) as excinfo:
        guard.fetch_manifest("https://coord.example/schema/read-surfaces")
    assert excinfo.value.http_status is None


@pytest.mark.parametrize("status", [401, 404])
def test_an_unserved_manifest_route_names_the_gate_not_the_revision(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], status: int
) -> None:
    """coord answers an UNROUTED path 401 and an existing one 403.

    Measured against controls on 2026-09-06. So a 401 here means the coord half
    never shipped — and the guard must say so instead of advising a declaration,
    which is what ACTIVATES the phase that cannot pass.
    """
    source = (
        HEADER
        + "def upgrade() -> None:\n"
        + '    op.drop_column("prompt_documents", "agent_writable", schema="coord")\n'
        + "def downgrade() -> None:\n    pass\n"
    )
    fixture = _write(tmp_path, "r.py", source)
    code = guard.main(["--files", str(fixture)], fetch=_http_error(status))
    assert code == guard.EXIT_VACUOUS
    errs = capsys.readouterr().err
    assert "does not SERVE" in errs
    assert "NO EDIT INSIDE THIS PR CAN FIX IT" in errs
    assert guard.DECLARATION_NAME in errs  # named, to be refused
    assert "2026-09-06-devops-coord-column-drop-guard" in errs


def test_a_transient_manifest_failure_keeps_the_original_advice(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """A 503 is coord being down, NOT the route being absent — different advice."""
    source = (
        HEADER
        + "def upgrade() -> None:\n"
        + '    op.drop_column("prompt_documents", "agent_writable", schema="coord")\n'
        + "def downgrade() -> None:\n    pass\n"
    )
    fixture = _write(tmp_path, "r.py", source)
    code = guard.main(["--files", str(fixture)], fetch=_http_error(503))
    assert code == guard.EXIT_VACUOUS
    errs = capsys.readouterr().err
    assert "does not SERVE" not in errs
    assert "UNKNOWN is not green" in errs


def test_the_unresolved_advice_warns_that_declaring_activates_the_manifest(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """The remedy must stop being a trap.

    An unresolved site reached from upgrade() still demands a declaration — but
    the advice now says what a declaration COSTS while the route is unserved.
    """
    source = (
        HEADER
        + "def upgrade() -> None:\n"
        + '    op.execute(f"ALTER TABLE coord.{TBL} DROP COLUMN agent_writable")\n'
        + "def downgrade() -> None:\n    pass\n"
    ).replace("from alembic import op\n", 'TBL = "x"\nfrom alembic import op\n')
    fixture = _write(tmp_path, "r.py", source)
    assert guard.main(["--files", str(fixture)], fetch=_forbid_fetch) == (
        guard.EXIT_VIOLATION
    )
    errs = capsys.readouterr().err
    assert "ACTIVATES the manifest check" in errs
    assert "reached only from downgrade()" in errs


def _gate_docstring() -> str | None:
    """The gate's module docstring, read WITHOUT importing the gate.

    These gates are argv-only programs; `ast` never executes a line of one, and
    the sibling roster modules all read the same way.
    """
    source = (REPO_ROOT / _SCRIPT_REF).read_text(encoding="utf-8")
    return ast.get_docstring(ast.parse(source))


def test_the_lane_roster_is_exactly_the_declared_lanes() -> None:
    assert_lane_roster(_SCRIPT_REF, _DECLARED_LANES)


def test_the_scripts_docstring_names_every_lane() -> None:
    """The roster in prose must be the roster in the tree.

    The gate opens by naming its three lanes and what each is for. That prose is
    what a reader trusts instead of grepping, so a lane added without touching
    it leaves the script describing a shape the repo no longer has.
    """
    assert_docstring_names_every_lane(_gate_docstring(), _SCRIPT_REF, _DECLARED_LANES)
