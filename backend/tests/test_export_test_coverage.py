"""The per-test coverage exporter, and the sharded-producer contract it serves.

``scripts/export_test_coverage.py`` reads ONE combined coverage db and any
number of JUnit files -- one per shard of
``.github/workflows/backend-coverage-producer.yml`` -- and POSTs one results
batch. These tests pin the two halves of that contract that the workflow
relies on: several JUnit files merge into one document carrying every test,
and a set with a hole in it is never POSTed as if it were whole.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "export_test_coverage.py"


def _load():
    spec = importlib.util.spec_from_file_location("export_test_coverage", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


exporter = _load()

SUITE_A = (
    '<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests">'
    '<testsuite name="pytest" tests="2" failures="1" errors="0" skipped="0">'
    '<testcase classname="tests.test_a" name="test_x"/>'
    '<testcase classname="tests.test_a" name="test_y"><failure message="m"/></testcase>'
    "</testsuite></testsuites>"
)
SUITE_B = (
    '<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests">'
    '<testsuite name="pytest" tests="1" failures="0" errors="1" skipped="0">'
    '<testcase classname="tests.test_b" name="test_z"><error message="e"/></testcase>'
    "</testsuite></testsuites>"
)


def _write(tmp_path: Path, name: str, body: str) -> str:
    path = tmp_path / name
    path.write_text(body, encoding="utf-8")
    return str(path)


def test_the_self_test_passes():
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), "--self-test"], capture_output=True, text=True
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "SELF-TEST PASSED" in proc.stdout


def test_one_junit_file_is_posted_verbatim(tmp_path):
    path = _write(tmp_path, "a.xml", SUITE_A)
    assert exporter.merge_junit_xml([path]) == SUITE_A


def test_shard_junit_files_merge_into_one_document_with_every_test(tmp_path):
    merged = exporter.merge_junit_xml(
        [_write(tmp_path, "a.xml", SUITE_A), _write(tmp_path, "b.xml", SUITE_B)]
    )
    assert merged is not None
    root = ET.fromstring(merged)
    assert root.tag == "testsuites"
    assert [tc.get("name") for tc in root.iter("testcase")] == [
        "test_x",
        "test_y",
        "test_z",
    ]
    assert root.get("tests") == "3"
    assert root.get("failures") == "1"
    assert root.get("errors") == "1"


@pytest.mark.parametrize("bad", ["missing", "unparseable", "wrong-root"])
def test_a_hole_in_a_shard_set_posts_no_results(tmp_path, bad):
    good = _write(tmp_path, "a.xml", SUITE_A)
    if bad == "missing":
        other = str(tmp_path / "absent.xml")
    elif bad == "unparseable":
        other = _write(tmp_path, "b.xml", "<testsuite><testcase")
    else:
        other = _write(tmp_path, "b.xml", "<html/>")
    assert exporter.merge_junit_xml([good, other]) is None


def test_junit_xml_is_repeatable_and_defaults_to_the_unsharded_name(
    tmp_path, monkeypatch
):
    seen: list[list[str]] = []
    monkeypatch.setattr(
        exporter, "post_junit", lambda _url, paths, _sha: seen.append(paths)
    )
    monkeypatch.setattr(exporter, "post_observations", lambda *_a: None)
    monkeypatch.setenv("GITHUB_SHA", "deadbeef")
    db = str(tmp_path / ".coverage")
    exporter.build_synthetic_db(db)

    assert exporter.main(["--coverage-db", db]) == 0
    assert (
        exporter.main(
            ["--coverage-db", db, "--junit-xml", "a.xml", "--junit-xml", "b.xml"]
        )
        == 0
    )
    assert seen == [[exporter.DEFAULT_JUNIT_XML], ["a.xml", "b.xml"]]
