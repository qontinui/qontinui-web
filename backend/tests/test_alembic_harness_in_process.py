"""Pins what running alembic IN-PROCESS must not leak or lose.

``tests/_alembic_harness.py::run_alembic`` used to spawn ``python -m alembic``
per call; it now dispatches through alembic's own ``CommandLine`` in the test
process (plan ``2026-09-12-backend-ci-pays-a-model-import-on-every-alembic-
invocation``, Phase 2). A subprocess gave every call a clean process for free,
so the properties below are exactly the ones the move could silently break:

* the process-global state ``alembic/env.py`` touches — ``os.environ``
  (``DATABASE_URL``, ``load_dotenv``), ``sys.path``, cwd — and logging, which
  ``fileConfig`` would have reconfigured for the rest of the session;
* the streams the migration tests read (revision log lines on stderr, offline
  SQL and ``FAILED:`` on stdout);
* the exit status and traceback of a failing command, and ``expect_success``.

Every case runs offline (``--sql``) or against an unreachable port, so none of
them needs Postgres — unlike the ``*_migration.py`` tests that exercise the same
harness against a real database in CI.
"""

from __future__ import annotations

import logging
import os
import sys

import pytest

from tests._alembic_harness import backend_root, run_alembic

# Offline mode never connects; the URL only has to parse.
_OFFLINE_URL = "postgresql://nobody:nothing@127.0.0.1:1/harness_probe"


def test_offline_stamp_succeeds_and_captures_both_streams() -> None:
    proc = run_alembic(backend_root(), _OFFLINE_URL, "stamp", "head", "--sql")

    assert proc.returncode == 0
    assert "alembic_version" in proc.stdout, proc.stdout
    # Revision log lines reach stderr in alembic.ini's `generic` format, which
    # is what the migration tests' `applied.stdout + applied.stderr` reads.
    assert "INFO  [alembic.runtime.migration]" in proc.stderr, proc.stderr


def test_process_state_and_logging_are_restored(
    monkeypatch: pytest.MonkeyPatch, tmp_path: os.PathLike[str]
) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://sentinel/unchanged")
    monkeypatch.chdir(tmp_path)

    root = logging.getLogger()
    app_logger = logging.getLogger("app.harness_in_process_probe")
    alembic_logger = logging.getLogger("alembic")
    env_before = dict(os.environ)
    path_before = list(sys.path)
    root_handlers_before = list(root.handlers)
    root_level_before = root.level
    alembic_level_before = alembic_logger.level

    run_alembic(backend_root(), _OFFLINE_URL, "stamp", "head", "--sql")

    assert dict(os.environ) == env_before
    assert os.getcwd() == os.fspath(tmp_path)
    assert sys.path == path_before
    assert root.handlers == root_handlers_before
    assert root.level == root_level_before
    assert alembic_logger.level == alembic_level_before
    # `fileConfig(disable_existing_loggers=True)` would have flipped this.
    assert app_logger.disabled is False


def test_a_command_error_is_a_nonzero_exit_with_the_message() -> None:
    proc = run_alembic(
        backend_root(),
        _OFFLINE_URL,
        "upgrade",
        "no_such_revision_harness_probe",
        "--sql",
        expect_success=False,
    )

    # alembic's CLI reports a CommandError as `FAILED: ...` and exits -1 (255).
    assert proc.returncode == 255
    assert "no_such_revision_harness_probe" in proc.stdout + proc.stderr


def test_an_exception_is_exit_1_with_its_traceback_on_stderr() -> None:
    # Online mode against a port nothing listens on: the connect raises.
    proc = run_alembic(
        backend_root(), _OFFLINE_URL, "upgrade", "head", expect_success=False
    )

    assert proc.returncode == 1
    assert "Traceback (most recent call last)" in proc.stderr, proc.stderr


def test_expect_success_asserts_with_both_streams() -> None:
    with pytest.raises(AssertionError, match="--- stderr ---"):
        run_alembic(backend_root(), _OFFLINE_URL, "upgrade", "head")


def test_expect_failure_asserts_when_the_command_succeeds() -> None:
    with pytest.raises(AssertionError, match="unexpectedly SUCCEEDED"):
        run_alembic(
            backend_root(),
            _OFFLINE_URL,
            "stamp",
            "head",
            "--sql",
            expect_success=False,
        )
