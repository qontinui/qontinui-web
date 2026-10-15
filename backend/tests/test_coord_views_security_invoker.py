"""At-head guard: every view in schema ``coord`` is ``security_invoker``.

Revision ``coordrls_01`` switches ``coord.memories_latest`` and
``coord.pr_check_runs_latest`` to ``security_invoker = true`` so that, once
row-level security is enforced, a view read through the ``coord_tenant`` role
is filtered by the READER's policies rather than run with its owner's rights
(plan ``2026-10-15-coord-tenant-isolation-has-no-database-enforcement``, D3).

That setting does not survive a re-definition: ``CREATE OR REPLACE VIEW``
replaces the view's options with whatever its own ``WITH`` clause says, so a
later revision that re-creates either view without the option silently turns
it back into an owner-rights view — an RLS bypass for every tenant reading it.
The same is true of a NEW coord view created without it. This guard walks the
whole chain to the head and fails on any such view, which is the only place
that regression is visible before production.

Substrate comes from ``_alembic_harness`` (an ephemeral database inside the
test Postgres, skipped when none is reachable). A skip proves nothing — set
``QONTINUI_TEST_PG_DSN`` (or ``QONTINUI_TEST_PG``) to run it.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    run_alembic,
)

# The views coordrls_01 switched. The guard covers every coord view; this list
# only pins that the walk is not vacuous.
_KNOWN_VIEWS = ("coord.memories_latest", "coord.pr_check_runs_latest")


def views_without_security_invoker(conn: Connection) -> list[str]:
    """Every coord view whose options do not evaluate ``security_invoker`` true.

    The value is cast through ``boolean`` rather than string-matched, so
    ``security_invoker=on`` / ``=1`` count as set and an absent option as unset.
    """
    rows = conn.execute(
        text(
            """
            SELECT format('%I.%I', n.nspname, c.relname)
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'coord' AND c.relkind = 'v'
               AND NOT coalesce(
                     (SELECT o.option_value::boolean
                        FROM pg_options_to_table(c.reloptions) o
                       WHERE o.option_name = 'security_invoker'),
                     false)
             ORDER BY 1
            """
        )
    ).fetchall()
    return [row[0] for row in rows]


def _coord_views(conn: Connection) -> list[str]:
    rows = conn.execute(
        text(
            """
            SELECT format('%I.%I', n.nspname, c.relname)
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'coord' AND c.relkind = 'v'
             ORDER BY 1
            """
        )
    ).fetchall()
    return [row[0] for row in rows]


@pytest.fixture(scope="module")
def at_head() -> Iterator[Engine]:
    admin_url = admin_database_url()
    if not can_connect(admin_url):
        pytest.skip(f"no test Postgres reachable at {admin_url}")
    with ephemeral_database(admin_url, "coord_views_head") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", "head")
        yield engine


def test_every_coord_view_at_head_is_security_invoker(at_head: Engine) -> None:
    with at_head.connect() as conn:
        views = _coord_views(conn)
        offenders = views_without_security_invoker(conn)
    # Non-vacuous: the walk must actually have seen the views it guards.
    for view in _KNOWN_VIEWS:
        assert view in views, f"{view} is missing at head (seen: {views})"
    assert not offenders, (
        f"coord view(s) without security_invoker=true at the alembic head: {offenders}. "
        "A view that is not security_invoker runs with its OWNER's rights, so row-level "
        "security on the tables beneath it does not filter a coord_tenant reader. "
        "Re-create the view WITH (security_invoker = true), or ALTER VIEW … SET "
        "(security_invoker = true) after CREATE OR REPLACE VIEW (which resets options)."
    )


def test_the_guard_reds_on_a_view_re_created_without_the_option(
    at_head: Engine,
) -> None:
    """The mutation: what a later ``CREATE OR REPLACE VIEW`` revision would do.

    Run inside a transaction that is rolled back, so the shared head database
    is left exactly as the walk produced it.
    """
    with at_head.connect() as conn:
        transaction = conn.begin()
        try:
            definition = conn.execute(
                text("SELECT pg_get_viewdef('coord.pr_check_runs_latest'::regclass)")
            ).scalar_one()
            conn.execute(
                text(
                    f"CREATE OR REPLACE VIEW coord.pr_check_runs_latest AS {definition}"
                )
            )
            assert views_without_security_invoker(conn) == [
                "coord.pr_check_runs_latest"
            ]
        finally:
            transaction.rollback()
        assert views_without_security_invoker(conn) == []
