"""The test-database override contract in ``tests/conftest.py``.

``_test_pg_dsn_tail`` decides which Postgres every DB-backed test (and, through
``DATABASE_URL``, every alembic-harness test) talks to. Its two overrides —
``QONTINUI_TEST_PG_DSN`` (a full DSN, which wins) and ``QONTINUI_TEST_PG``
(host:port with the CI credentials) — and its two refusals were verified only
by hand when they landed (qontinui-web#1690). These pin them, against literal
expected values rather than anything the function itself computes.
"""

from __future__ import annotations

import pytest

from tests.conftest import _test_pg_dsn_tail


@pytest.fixture
def no_overrides(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    monkeypatch.delenv("QONTINUI_TEST_PG_DSN", raising=False)
    monkeypatch.delenv("QONTINUI_TEST_PG", raising=False)
    return monkeypatch


def test_ci_topology_when_neither_override_is_set(
    no_overrides: pytest.MonkeyPatch,
) -> None:
    assert (
        _test_pg_dsn_tail()
        == "qontinui_user:qontinui_dev_password@localhost:5432/qontinui_test"
    )


def test_host_port_override_keeps_ci_credentials(
    no_overrides: pytest.MonkeyPatch,
) -> None:
    no_overrides.setenv("QONTINUI_TEST_PG", "localhost:5433")
    assert (
        _test_pg_dsn_tail()
        == "qontinui_user:qontinui_dev_password@localhost:5433/qontinui_test"
    )


@pytest.mark.parametrize("hostport", ["", "   "])
def test_blank_host_port_falls_back_to_ci_default(
    no_overrides: pytest.MonkeyPatch, hostport: str
) -> None:
    no_overrides.setenv("QONTINUI_TEST_PG", hostport)
    assert (
        _test_pg_dsn_tail()
        == "qontinui_user:qontinui_dev_password@localhost:5432/qontinui_test"
    )


def test_full_dsn_wins_over_host_port(no_overrides: pytest.MonkeyPatch) -> None:
    no_overrides.setenv("QONTINUI_TEST_PG", "localhost:5433")
    no_overrides.setenv(
        "QONTINUI_TEST_PG_DSN", "postgresql://eph:pw@127.0.0.1:41234/ephdb"
    )
    assert _test_pg_dsn_tail() == "eph:pw@127.0.0.1:41234/ephdb"


@pytest.mark.parametrize(
    "dsn",
    [
        "postgres://eph:pw@127.0.0.1:41234/ephdb",
        "postgresql+asyncpg://eph:pw@127.0.0.1:41234/ephdb",
        "postgresql+psycopg2://eph:pw@127.0.0.1:41234/ephdb",
        "  postgresql://eph:pw@127.0.0.1:41234/ephdb\n",
    ],
)
def test_accepted_dsn_shapes_reduce_to_the_same_tail(
    no_overrides: pytest.MonkeyPatch, dsn: str
) -> None:
    no_overrides.setenv("QONTINUI_TEST_PG_DSN", dsn)
    assert _test_pg_dsn_tail() == "eph:pw@127.0.0.1:41234/ephdb"


def test_blank_dsn_falls_through_to_host_port(no_overrides: pytest.MonkeyPatch) -> None:
    no_overrides.setenv("QONTINUI_TEST_PG_DSN", "   ")
    no_overrides.setenv("QONTINUI_TEST_PG", "db.local:6543")
    assert (
        _test_pg_dsn_tail()
        == "qontinui_user:qontinui_dev_password@db.local:6543/qontinui_test"
    )


@pytest.mark.parametrize(
    ("dsn", "scheme_in_message"),
    [
        ("mysql://eph:s3cret@127.0.0.1:3306/ephdb", "'mysql'"),
        ("sqlite:///tmp/x.db", "'sqlite'"),
        ("eph:s3cret@127.0.0.1:41234/ephdb", "'<none>'"),
        ("postgresql://", "'postgresql'"),
    ],
)
def test_non_postgres_or_empty_dsn_is_refused_without_echoing_it(
    no_overrides: pytest.MonkeyPatch, dsn: str, scheme_in_message: str
) -> None:
    no_overrides.setenv("QONTINUI_TEST_PG_DSN", dsn)
    with pytest.raises(RuntimeError, match="must be a postgresql:// DSN") as excinfo:
        _test_pg_dsn_tail()
    assert scheme_in_message in str(excinfo.value)
    assert "s3cret" not in str(excinfo.value)


def test_query_string_is_refused_without_echoing_it(
    no_overrides: pytest.MonkeyPatch,
) -> None:
    no_overrides.setenv(
        "QONTINUI_TEST_PG_DSN",
        "postgresql://eph:s3cret@127.0.0.1:41234/ephdb?sslmode=disable",
    )
    with pytest.raises(RuntimeError, match="must not carry a query string") as excinfo:
        _test_pg_dsn_tail()
    assert "s3cret" not in str(excinfo.value)
