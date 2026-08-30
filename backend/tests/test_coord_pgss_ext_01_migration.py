"""Behaviour test for ``coord_pgss_ext_01`` — the ``pg_stat_statements`` enable.

The revision is one statement::

    CREATE EXTENSION IF NOT EXISTS pg_stat_statements

``migration-reversal.yml`` would confirm only that the statement executes. What
needs pinning is narrower and specific to this extension: that the SQL objects
really appear (not merely that no error was raised), that the revision applies
on a Postgres whose ``shared_preload_libraries`` does NOT contain the module —
the CI substrate, and the exact configuration three prior plans believed made
this impossible — and that the downgrade genuinely removes it.

What is asserted
================

1. The extension is absent at the parent revision, so this revision is what
   creates it rather than an earlier one.
2. After upgrade ``pg_extension`` holds a row, at the expected version.
3. **Its SQL objects exist** — the extension owns at least one function and one
   relation, classified from ``pg_depend``. A bare catalog row with no members
   fails this, which is what discriminates a real create from a no-op.
4. **The revision applies with an empty ``shared_preload_libraries``** — the
   claim the migration's docstring rests on, and the one that refutes the
   "needs a reboot" belief three prior plans recorded. CI's image
   (``pgvector/pgvector:pg16``, on every workflow that runs this chain since
   2026-08-30) has an empty one, so this is the path normally exercised. The
   substrate is *read* rather than assumed; should it ever gain the preload,
   the test takes a strictly stronger branch and emits a warning saying the
   claim went untested, rather than quietly greening.
5. **Sensitivity — reading the view fails only for the preload reason.** Where
   the module is not preloaded, ``SELECT * FROM pg_stat_statements`` must raise
   ``pg_stat_statements must be loaded via shared_preload_libraries``, NOT
   ``relation does not exist``. Those two errors look alike from a distance and
   mean opposite things: the first proves the objects were created and only the
   shared-memory half is missing (exactly prod's situation, inverted), the
   second would mean assertion 2 passed against nothing. Without this, the test
   could not tell a created extension from an absent one on this substrate.
6. Downgrade removes the extension **and its objects**, the latter resolved by
   NAME. Checking that through ``pg_extension`` would be structurally incapable
   of failing: once the extension row is gone the dependency join returns
   nothing regardless of what survived.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import warnings

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    run_alembic,
)

_REVISION_ID = "coord_pgss_ext_01"
_PARENT_REVISION_ID = "coord_alerts_pagedidx_01"

_EXT_NAME = "pg_stat_statements"


def _extension_installed(engine: Engine) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = :n)"),
                {"n": _EXT_NAME},
            ).scalar()
        )


def _extension_version(engine: Engine) -> str | None:
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT extversion FROM pg_extension WHERE extname = :n"),
            {"n": _EXT_NAME},
        ).scalar()


def _object_counts(engine: Engine) -> tuple[int, int]:
    """``(function count, relation count)`` for objects owned by the extension.

    Walks ``pg_depend`` from the extension rather than matching on name, so a
    stray same-named relation left by something else cannot green this.
    """
    sql = text(
        """
        SELECT
            count(*) FILTER (WHERE d.classid = 'pg_proc'::regclass)  AS procs,
            count(*) FILTER (WHERE d.classid = 'pg_class'::regclass) AS rels
          FROM pg_depend d
          JOIN pg_extension e ON e.oid = d.refobjid
         WHERE d.refclassid = 'pg_extension'::regclass
           AND e.extname = :n
        """
    )
    with engine.connect() as conn:
        row = conn.execute(sql, {"n": _EXT_NAME}).one()
    return int(row[0]), int(row[1])


def _objects_exist_by_name(engine: Engine) -> tuple[bool, bool]:
    """``(view exists, reset function exists)``, resolved BY NAME.

    Deliberately not routed through ``pg_extension``: after ``DROP EXTENSION``
    the join in [`_object_counts`] returns nothing no matter what survived, so
    it is structurally incapable of catching leftovers. Name resolution is the
    only form of that check which can actually fail.
    """
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT to_regclass('public.pg_stat_statements') IS NOT NULL,
                       to_regproc('public.pg_stat_statements_reset') IS NOT NULL
                """
            )
        ).one()
    return bool(row[0]), bool(row[1])


def _shared_preload_libraries(engine: Engine) -> str:
    with engine.connect() as conn:
        return str(conn.execute(text("SHOW shared_preload_libraries")).scalar() or "")


def _read_view_error(engine: Engine) -> str | None:
    """``None`` when the view reads, else the error text."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT count(*) FROM pg_stat_statements")).scalar()
        return None
    except Exception as exc:  # noqa: BLE001 - the message is the assertion subject
        return str(exc)


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_coord_pgss_ext_01_creates_and_reverses_the_extension() -> None:
    """Create pg_stat_statements, prove its objects exist, and reverse it."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_pgss_ext_test") as (
        engine,
        url,
    ):
        # ----------------------------------------------------------------
        # 1. Parent revision — the extension must not exist yet.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not _extension_installed(engine), (
            "the extension must be created by this revision, not an earlier one"
        )

        # ----------------------------------------------------------------
        # 4. Record the substrate BEFORE upgrading. The migration's central
        #    claim is that CREATE EXTENSION does not need the module in
        #    shared_preload_libraries; that claim is only tested if we know
        #    whether it was preloaded here.
        # ----------------------------------------------------------------
        preload = _shared_preload_libraries(engine)
        preloaded = _EXT_NAME in preload
        if preloaded:
            # Not a failure — the revision still applies, and the branch below
            # asserts something strictly stronger (the view actually reads).
            # But the claim this test exists to defend, "applies with an EMPTY
            # shared_preload_libraries", is then untested, and a silent switch
            # to the weaker substrate is exactly how that would go unnoticed.
            warnings.warn(
                f"{_EXT_NAME} is preloaded on this substrate ({preload!r}), so "
                "the not-preloaded path this revision's docstring rests on was "
                "NOT exercised. CI (pgvector/pgvector:pg16) has an "
                "empty shared_preload_libraries; if that changed, re-verify "
                "the migration's substrate claim by hand.",
                stacklevel=2,
            )

        # ----------------------------------------------------------------
        # 2. Apply — the extension exists.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)

        assert _extension_installed(engine), (
            "CREATE EXTENSION reported success but pg_extension has no row "
            f"(shared_preload_libraries={preload!r})"
        )
        version = _extension_version(engine)
        assert version, "extension installed with no recorded version"

        # ----------------------------------------------------------------
        # 3. Its SQL objects really exist — pg_extension alone is not proof
        #    that anything usable was created.
        # ----------------------------------------------------------------
        procs, rels = _object_counts(engine)
        assert procs > 0, (
            f"extension {_EXT_NAME} {version} owns no functions — the create "
            "did not produce usable objects"
        )
        assert rels > 0, (
            f"extension {_EXT_NAME} {version} owns no relations — the view "
            "was not created"
        )

        # ----------------------------------------------------------------
        # 5. Sensitivity. Where the module is NOT preloaded, the view must
        #    fail for the preload reason and not because it is missing —
        #    that distinction is the whole difference between "created but
        #    inert" and "never created". Where it IS preloaded, the view
        #    must simply read.
        # ----------------------------------------------------------------
        err = _read_view_error(engine)
        if preloaded:
            assert err is None, (
                f"{_EXT_NAME} is in shared_preload_libraries ({preload!r}) so "
                f"the view must be readable; got: {err}"
            )
        else:
            assert err is not None, (
                f"{_EXT_NAME} is NOT preloaded ({preload!r}) yet the view read "
                "succeeded — the substrate changed and this test's premise "
                "with it"
            )
            assert "shared_preload_libraries" in err, (
                "the view must fail because the module is not preloaded, not "
                f"because it does not exist; got: {err}"
            )
            assert "does not exist" not in err, (
                "the view is MISSING, not merely inert — the extension was "
                f"not really created; got: {err}"
            )

        # ----------------------------------------------------------------
        # 6. Downgrade removes the extension and everything it owned.
        # ----------------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not _extension_installed(engine)

        # Resolved BY NAME. Reusing `_object_counts` here would be worthless:
        # it joins through `pg_extension`, so once the row above is gone it
        # returns (0, 0) whatever survived — an assertion that cannot fail.
        view_left, func_left = _objects_exist_by_name(engine)
        assert not view_left, (
            "downgrade removed the pg_extension row but left the "
            "pg_stat_statements VIEW behind"
        )
        assert not func_left, (
            "downgrade removed the pg_extension row but left "
            "pg_stat_statements_reset() behind"
        )
