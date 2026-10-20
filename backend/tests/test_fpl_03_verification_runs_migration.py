"""Behaviour test for the ``fpl_03`` ``coord.verification_runs`` table.

The contracts pinned here are the ones coord's Rust write door and the
``verification_ran_share_7d`` named count rely on:

1. **Shape** - the table, its exact column contract, and its three indexes
   exist after upgrade, and are gone after downgrade.
2. **The outcome vocabulary is enforced** - the five words of plan D2 are
   accepted and any other word is refused by the schema, not merely by coord.
3. **``skip_reason`` iff ``skipped``** - a skip without a reason and a
   non-skip carrying one are both refused.
4. **The idempotency key holds** - a second row with the same
   ``(tenant_id, client_run_id)`` is refused, while another tenant may reuse
   the client id.
5. **A receiver only on an offload row**, and no negative counts.
6. **Text bounds and shapes** - ``repo``, ``subcommand`` and ``skip_reason``
   lengths at both edges, a non-blank ``skip_reason``, and ``tree_sha`` as
   7..64 lowercase hex.
7. **Re-running the upgrade is a no-op** over an applied table (second test).

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    index_exists,
    run_alembic,
    scalar,
    table_exists,
)

_REVISION_ID = "fpl_03"
_REVISION_FILENAME = "fpl_03_verification_runs.py"


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime (never pinned)."""
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    return declared_parent_revision_id(source, _REVISION_FILENAME)


_PARENT_REVISION_ID = _parent_revision_id()

_TABLE = "verification_runs"

_INDEXES = (
    "uq_verification_runs_tenant_client_run",
    "idx_verification_runs_observed_at",
    "idx_verification_runs_tenant_observed_at",
)

# The column contract shared with coord's Rust code: name -> (data_type, nullable).
_EXPECTED_COLUMNS: dict[str, tuple[str, str]] = {
    "id": ("uuid", "NO"),
    "tenant_id": ("uuid", "NO"),
    "client_run_id": ("uuid", "NO"),
    "device_id": ("uuid", "YES"),
    "agent_id": ("uuid", "YES"),
    "session_id": ("uuid", "YES"),
    "repo": ("text", "NO"),
    "wrapper": ("text", "NO"),
    "subcommand": ("text", "NO"),
    "outcome": ("text", "NO"),
    "skip_reason": ("text", "YES"),
    "wait_secs": ("integer", "YES"),
    "duration_secs": ("integer", "YES"),
    "memory_shortfall_mb": ("integer", "YES"),
    "receiver_device_id": ("uuid", "YES"),
    "tree_sha": ("text", "YES"),
    "exit_code": ("integer", "YES"),
    "tests_run": ("integer", "YES"),
    "observed_at": ("timestamp with time zone", "NO"),
    "recorded_at": ("timestamp with time zone", "NO"),
}

_OUTCOMES = (
    "local",
    "local_after_queue",
    "offloaded",
    "offload_failed_then_local",
    "skipped",
)

_TENANT = uuid.UUID("5b1e7c42-9d3a-4f86-a0c1-7e2d9b4f3a61")
_OTHER_TENANT = uuid.UUID("c8f2a915-4e7b-4d03-9b6e-1a5c3d8e2f74")

_INSERT = text(
    """
    INSERT INTO coord.verification_runs
        (tenant_id, client_run_id, repo, wrapper, subcommand, outcome,
         skip_reason, receiver_device_id, wait_secs, duration_secs,
         memory_shortfall_mb, tree_sha, tests_run, observed_at)
    VALUES (:tid, :crid, :repo, :wrapper, :sub, :outcome,
            :reason, :receiver, :wait, :duration,
            :shortfall, :tree_sha, :tests, now())
    """
)

_CHECK_OUTCOME = "verification_runs_outcome_check"
_CHECK_WRAPPER = "verification_runs_wrapper_check"
_CHECK_REASON_IFF = "verification_runs_skip_reason_iff_skipped_check"
_CHECK_REASON_LEN = "verification_runs_skip_reason_length_check"
_CHECK_RECEIVER = "verification_runs_receiver_only_when_offloaded_check"
_CHECK_REPO_LEN = "verification_runs_repo_length_check"
_CHECK_SUB_LEN = "verification_runs_subcommand_length_check"
_CHECK_TREE_SHA = "verification_runs_tree_sha_shape_check"
_CHECK_NONNEG = "verification_runs_nonnegative_check"
_UNIQUE_RUN = "uq_verification_runs_tenant_client_run"


def _row(**overrides: object) -> dict[str, object]:
    """A valid ``local`` row's parameters, with ``overrides`` applied."""
    params: dict[str, object] = {
        "tid": _TENANT,
        "crid": uuid.uuid4(),
        "repo": "qontinui/qontinui-coord",
        "wrapper": "cargo-verify",
        "sub": "test",
        "outcome": "local",
        "reason": None,
        "receiver": None,
        "wait": 0,
        "duration": 30,
        "shortfall": None,
        "tree_sha": "c02d49f66aa0",
        "tests": 12,
    }
    params.update(overrides)
    return params


def _columns(engine: Engine) -> dict[str, tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable
                  FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :table
                """
            ),
            {"table": _TABLE},
        ).all()
    return {name: (dtype, nullable) for name, dtype, nullable in rows}


def _accepted(engine: Engine, params: dict[str, object]) -> None:
    with engine.begin() as conn:
        conn.execute(_INSERT, params)


def _refused(engine: Engine, params: dict[str, object], constraint: str) -> None:
    """Insert ``params`` and assert the NAMED constraint is what refuses it."""
    with pytest.raises(IntegrityError) as excinfo:
        with engine.begin() as conn:
            conn.execute(_INSERT, params)
    diag = getattr(excinfo.value.orig, "diag", None)
    assert diag is not None and diag.constraint_name == constraint, (
        f"expected {constraint} to refuse {params!r}, got "
        f"{getattr(diag, 'constraint_name', None)!r}: {excinfo.value.orig!r}"
    )


_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, set QONTINUI_TEST_PG=host:port (or "
        "QONTINUI_TEST_PG_DSN), because conftest.py derives DATABASE_URL "
        "from them and overwrites a hand-set one."
    ),
)


@_needs_pg
def test_fpl_03_creates_verification_runs_and_enforces_its_contract() -> None:
    """Shape, vocabulary, skip-reason pairing, idempotency key, reversal."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "fpl03_test") as (engine, url):
        # 1. Parent revision - the table does not exist yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _TABLE), (
            "the table must be created by this revision, not an earlier one"
        )

        # 2. Apply - table, exact columns, indexes.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", _TABLE)
        assert _columns(engine) == _EXPECTED_COLUMNS
        for name in _INDEXES:
            assert index_exists(engine, name), f"missing index {name}"

        # 3. Every outcome word is accepted (with a reason only on skipped,
        #    a receiver only on the two offload words); any other is refused.
        for outcome in _OUTCOMES:
            _accepted(
                engine,
                _row(
                    outcome=outcome,
                    reason="no headroom and no receiver"
                    if outcome == "skipped"
                    else None,
                    receiver=(
                        uuid.uuid4()
                        if outcome in ("offloaded", "offload_failed_then_local")
                        else None
                    ),
                ),
            )
        _refused(engine, _row(outcome="unverified"), _CHECK_OUTCOME)
        _refused(engine, _row(wrapper="cargo"), _CHECK_WRAPPER)

        # 4. skip_reason iff skipped, non-blank, at most 500 characters.
        _refused(engine, _row(outcome="skipped", reason=None), _CHECK_REASON_IFF)
        _refused(engine, _row(outcome="local", reason="not here"), _CHECK_REASON_IFF)
        _refused(engine, _row(outcome="skipped", reason=""), _CHECK_REASON_LEN)
        _refused(engine, _row(outcome="skipped", reason="   "), _CHECK_REASON_LEN)
        _refused(engine, _row(outcome="skipped", reason="x" * 501), _CHECK_REASON_LEN)
        _accepted(engine, _row(outcome="skipped", reason="x" * 500))

        # 5. A receiver only on an offload row; no negative counts or durations.
        _refused(engine, _row(outcome="local", receiver=uuid.uuid4()), _CHECK_RECEIVER)
        _refused(engine, _row(wait=-1), _CHECK_NONNEG)
        _refused(engine, _row(duration=-1), _CHECK_NONNEG)
        _refused(engine, _row(shortfall=-1), _CHECK_NONNEG)
        _refused(engine, _row(tests=-1), _CHECK_NONNEG)

        # 6. Text bounds, each at its inclusive edge and one past it.
        _refused(engine, _row(repo=""), _CHECK_REPO_LEN)
        _refused(engine, _row(repo="x" * 201), _CHECK_REPO_LEN)
        _accepted(engine, _row(repo="x" * 200))
        _refused(engine, _row(sub="x" * 65), _CHECK_SUB_LEN)
        _accepted(engine, _row(sub="x" * 64))
        _refused(engine, _row(tree_sha="HEAD"), _CHECK_TREE_SHA)
        _refused(engine, _row(tree_sha="a" * 65), _CHECK_TREE_SHA)
        _refused(engine, _row(tree_sha="abc123"), _CHECK_TREE_SHA)
        _refused(engine, _row(tree_sha="ABC1234"), _CHECK_TREE_SHA)
        _accepted(engine, _row(tree_sha="a" * 64))
        _accepted(engine, _row(tree_sha="abc1234"))

        # 6b. Idempotency key: same tenant + client id refused; another tenant
        #     may carry the same client id.
        crid = uuid.uuid4()
        _accepted(engine, _row(crid=crid))
        _refused(engine, _row(crid=crid), _UNIQUE_RUN)
        _accepted(engine, _row(crid=crid, tid=_OTHER_TENANT))

        # 7. Defaults honest: recorded_at stamped, tests_run NULL stays NULL.
        null_tests = _row(tests=None)
        _accepted(engine, null_tests)
        with engine.connect() as conn:
            stored = conn.execute(
                text(
                    """
                    SELECT tests_run, recorded_at IS NOT NULL
                      FROM coord.verification_runs
                     WHERE tenant_id = :tid AND client_run_id = :crid
                    """
                ),
                {"tid": _TENANT, "crid": null_tests["crid"]},
            ).one()
        assert tuple(stored) == (None, True)

        # 8. Downgrade - the table and every index gone.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _TABLE)
        for name in _INDEXES:
            assert not index_exists(engine, name), f"index {name} survived downgrade"


@_needs_pg
def test_fpl_03_re_executing_upgrade_over_an_applied_schema_is_a_no_op() -> None:
    """Stamp back to the parent WITHOUT downgrade, upgrade again: every
    ``IF NOT EXISTS`` must make the re-run a no-op that keeps existing rows."""
    root = backend_root()
    with ephemeral_database(admin_database_url(), "fpl03_rerun") as (engine, url):
        run_alembic(root, url, "upgrade", _REVISION_ID)
        kept = _row()
        _accepted(engine, kept)
        columns_before = _columns(engine)

        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        assert (
            scalar(engine, "SELECT version_num FROM alembic_version")
            == _PARENT_REVISION_ID
        )
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert scalar(engine, "SELECT version_num FROM alembic_version") == _REVISION_ID

        assert _columns(engine) == columns_before == _EXPECTED_COLUMNS
        for name in _INDEXES:
            assert index_exists(engine, name), f"index {name} lost on re-run"
        assert (
            scalar(
                engine,
                "SELECT count(*) FROM coord.verification_runs WHERE client_run_id = :crid",
                crid=kept["crid"],
            )
            == 1
        )
