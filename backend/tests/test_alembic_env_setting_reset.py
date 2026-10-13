"""`alembic/env.py` must not let one revision's ``lock_timeout`` or
``search_path`` reach the next.

``run_migrations_online`` runs a whole batch in ONE transaction on ONE
connection, so a ``SET LOCAL lock_timeout`` (or a session-level ``SET``) that a
revision does not restore caps the lock wait of every later revision in the same
``upgrade``/``downgrade``. env.py's ``on_version_apply`` hook issues
``RESET lock_timeout`` (and ``RESET search_path``, below) after every applied step instead of relying on each
revision to restore its own bound (coord finding
``b4782f88-49f2-464e-92f9-4f44194dee34``; web#1457 tried the per-revision edit
and coord's migration classifier rejects edits to landed revisions). It issues
``RESET search_path`` too: 26 landed revisions open with a session-level
``SET search_path TO project, public`` and never restore it, which made a
fresh-database build resolve every later revision's unqualified names
``project``-first (``pg_stat_statements`` landed in ``project``, not ``public``).

These tests drive the REAL env.py over a SYNTHETIC revision chain: a temporary
``alembic.ini`` keeps ``script_location`` at ``backend/alembic`` (so env.py is
the one under test) and points ``version_locations`` at a temp directory, so no
real revision runs. Every synthetic revision records the ``lock_timeout`` and
``search_path`` it STARTS with into ``lt_probe.observations`` (a schema of its own: the repo's
public-schema guard forbids domain tables in ``public``); ``lt_setter``
(``SET LOCAL``), ``lt_session`` (a session-level ``SET`` inside an ``autocommit_block`` — the
``coord_tenant_fk_01`` shape) and ``lt_reader``'s downgrade (``SET LOCAL``) each
set a bound and leave it set; ``lt_path`` (and ``lt_reader``'s downgrade) set a
session-level ``search_path`` — the ``consolidation_phase2_v_*`` shape — and leave
it set. Without the hook the next revision's entry value is that setting; with it,
the server default.

``lt_reader`` reads its upgrade entry value from inside its OWN
``autocommit_block``, i.e. after the batch transaction has committed. That is
what separates ``RESET`` from ``SET LOCAL lock_timeout = DEFAULT``: the latter
would only mask ``lt_session``'s session value until that commit, and
``lt_reader`` would see ``2345ms`` again.

The offline (``--sql``) case needs no database; the online cases skip unless the
test Postgres is reachable (see ``_alembic_harness``).
"""

from __future__ import annotations

import textwrap
from pathlib import Path

import pytest
from sqlalchemy import text

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    run_alembic,
)

_OFFLINE_URL = "postgresql://nobody:nothing@127.0.0.1:1/setting_reset_probe"

_RECORD = (
    "INSERT INTO lt_probe.observations (rev, point, lock_timeout, search_path) "
    "VALUES ('{rev}', '{point}', current_setting('lock_timeout'), "
    "current_setting('search_path'))"
)


def _record(rev: str, point: str) -> str:
    return f'op.execute("{_RECORD.format(rev=rev, point=point)}")'


def _set(stmt: str) -> str:
    return f'op.execute("{stmt}")'


def _autocommit(*stmts: str) -> str:
    body = textwrap.indent("\n".join(stmts), "    ")
    return f"with op.get_context().autocommit_block():\n{body}"


# rev: (down_revision, upgrade statements, downgrade statements). Every revision
# records the settings it STARTS with — the values a leak would show — and a
# revision that sets one records again afterwards, proving the SET took effect.
# The search_path set always keeps ``public``: alembic writes the unqualified
# ``alembic_version`` before the hook runs.
_PATH = "lt_probe, public"

_REVISIONS: dict[str, tuple[str | None, list[str], list[str]]] = {
    "lt_base": (
        None,
        [
            _set("CREATE SCHEMA lt_probe"),
            _set(
                "CREATE TABLE lt_probe.observations "
                "(id serial PRIMARY KEY, rev text, point text, "
                "lock_timeout text, search_path text)"
            ),
        ],
        ["pass"],
    ),
    "lt_setter": (
        "lt_base",
        [
            _record("lt_setter", "up:entry"),
            _set("SET LOCAL lock_timeout = '1234ms'"),
            _record("lt_setter", "up:after-set"),
        ],
        [_record("lt_setter", "down:entry")],
    ),
    "lt_session": (
        "lt_setter",
        [
            _record("lt_session", "up:entry"),
            # Session-level: there is no transaction inside the block, so
            # `SET LOCAL` would be inert there.
            _autocommit(
                _set("SET lock_timeout = '2345ms'"),
                _record("lt_session", "up:after-set"),
            ),
        ],
        [_record("lt_session", "down:entry")],
    ),
    "lt_path": (
        "lt_session",
        [
            _record("lt_path", "up:entry"),
            # Session-level, inside the batch transaction: the
            # ``SET search_path TO project, public`` shape of the landed chain.
            _set(f"SET search_path TO {_PATH}"),
            _record("lt_path", "up:after-set"),
        ],
        [_record("lt_path", "down:entry")],
    ),
    "lt_reader": (
        "lt_path",
        # Read after the batch transaction commits (see the module docstring).
        [_autocommit(_record("lt_reader", "up:entry"))],
        [
            _record("lt_reader", "down:entry"),
            _set("SET LOCAL lock_timeout = '3456ms'"),
            _set(f"SET search_path TO {_PATH}"),
            _record("lt_reader", "down:after-set"),
        ],
    ),
}


def _write_chain(tmp_path: Path) -> Path:
    """Write the synthetic revisions and an ini that runs them through env.py."""
    versions = tmp_path / "versions"
    versions.mkdir()
    for rev, (down, up_stmts, down_stmts) in _REVISIONS.items():
        (versions / f"{rev}.py").write_text(
            textwrap.dedent(
                """\
                from alembic import op

                revision = {rev!r}
                down_revision = {down!r}
                branch_labels = None
                depends_on = None


                def upgrade() -> None:
                {up}


                def downgrade() -> None:
                {down_body}
                """
            ).format(
                rev=rev,
                down=down,
                up=textwrap.indent("\n".join(up_stmts), "    "),
                down_body=textwrap.indent("\n".join(down_stmts), "    "),
            )
        )
    ini = tmp_path / "alembic.ini"
    ini.write_text(
        textwrap.dedent(
            f"""\
            [alembic]
            script_location = {backend_root() / "alembic"}
            version_locations = {versions}
            prepend_sys_path = .
            path_separator = os
            sqlalchemy.url = {_OFFLINE_URL}
            """
        )
    )
    return ini


_RESETS = ("RESET lock_timeout", "RESET search_path")


def test_offline_sql_resets_settings_after_every_revision(
    tmp_path: Path,
) -> None:
    ini = _write_chain(tmp_path)
    proc = run_alembic(
        backend_root(), _OFFLINE_URL, "-c", str(ini), "upgrade", "head", "--sql"
    )
    sql = proc.stdout
    # One set of RESETs per applied revision, each AFTER that revision's own
    # statements (i.e. after its version-table write) and before the next runs.
    for reset in _RESETS:
        assert sql.count(f"{reset};") == len(_REVISIONS), sql
    blocks = sql.split("-- Running upgrade")[1:]
    assert len(blocks) == len(_REVISIONS), sql
    for block in blocks:
        statements = [s.strip() for s in block.split(";") if s.strip()]
        # The block's last statements before COMMIT / the next "-- Running".
        tail = [s for s in statements if s != "COMMIT"][-len(_RESETS) :]
        assert tuple(tail) == _RESETS, block
        assert block.index(f"{_RESETS[0]};") > block.index("alembic_version"), block


def test_offline_stamp_emits_no_reset(tmp_path: Path) -> None:
    ini = _write_chain(tmp_path)
    proc = run_alembic(
        backend_root(), _OFFLINE_URL, "-c", str(ini), "stamp", "head", "--sql"
    )
    assert "RESET" not in proc.stdout, proc.stdout


@pytest.fixture
def pg_url() -> str:
    admin_url = admin_database_url()
    if not can_connect(admin_url):
        pytest.skip("test Postgres not reachable")
    return admin_url


def test_settings_do_not_leak_between_revisions(tmp_path: Path, pg_url: str) -> None:
    ini = _write_chain(tmp_path)
    with ephemeral_database(pg_url, "lt_reset") as (engine, db_url):
        with engine.connect() as conn:
            default = conn.execute(
                text("SELECT reset_val FROM pg_settings WHERE name = 'lock_timeout'")
            ).scalar_one()
            # Human-readable form, as current_setting() renders it.
            default_shown = conn.execute(text("SHOW lock_timeout")).scalar_one()
            path = conn.execute(text("SHOW search_path")).scalar_one()
        if default != "0":
            pytest.skip(f"test Postgres has a non-default lock_timeout {default!r}")

        run_alembic(backend_root(), db_url, "-c", str(ini), "upgrade", "head")
        run_alembic(backend_root(), db_url, "-c", str(ini), "downgrade", "lt_base")

        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT rev, point, lock_timeout, search_path "
                    "FROM lt_probe.observations ORDER BY id"
                )
            ).all()

    d, p = default_shown, path
    assert [tuple(r) for r in rows] == [
        # Upgrade, one batch transaction.
        ("lt_setter", "up:entry", d, p),
        ("lt_setter", "up:after-set", "1234ms", p),
        ("lt_session", "up:entry", d, p),  # NOT 1234ms: SET LOCAL reset
        ("lt_session", "up:after-set", "2345ms", p),
        ("lt_path", "up:entry", d, p),  # NOT 2345ms
        ("lt_path", "up:after-set", d, _PATH),
        ("lt_reader", "up:entry", d, p),  # NOT lt_probe, even after a COMMIT
        # Downgrade, a second batch transaction.
        ("lt_reader", "down:entry", d, p),
        ("lt_reader", "down:after-set", "3456ms", _PATH),
        ("lt_path", "down:entry", d, p),  # NOT 3456ms / lt_probe
        ("lt_session", "down:entry", d, p),
        ("lt_setter", "down:entry", d, p),
    ]
