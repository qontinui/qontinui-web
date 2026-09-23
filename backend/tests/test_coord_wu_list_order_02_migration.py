"""Behaviour test for the ``coord_wu_list_order_02`` revision.

``_02`` is a REPAIR revision. It creates no object of its own: it heals the two
indexes ``coord_wu_list_order_01`` owns when a killed ``CREATE INDEX
CONCURRENTLY`` has left one ``indisvalid = false``, then asserts both are valid
and raises if not.

This file is the mirror image of
``tests/test_coord_wu_list_order_01_migration.py`` assertion 8. That test pins
the TRAP — mark an index invalid, re-run ``_01``, and it is *still* invalid,
because ``CREATE INDEX ... IF NOT EXISTS`` sees the name and skips the corpse.
This test pins the CURE on exactly the same setup. The two assertions must not
be collapsed: the first is a statement about what ``_01`` does not do and is
what makes this revision necessary; the second is what ``_02`` adds.

What is asserted
================

1. The pinned parent is the revision's real ``down_revision`` (no DB needed).
2. **The no-op path.** On a healthy database ``_02`` leaves both indexes valid
   AND does not rebuild them — asserted on ``pg_index.indexrelid``, which a
   DROP+CREATE changes and a skipped ``IF NOT EXISTS`` does not. This is the
   production case, and "healed it by rebuilding everything" would pass a
   validity-only assertion while costing two full heap scans per deploy.
3. **The heal, per index.** With the index marked ``indisvalid = false``,
   upgrading from ``_01`` to ``_02`` leaves it VALID — and its ``indexrelid``
   HAS changed, proving the rebuild actually happened rather than the assertion
   passing on an index that was never broken.

   No ``alembic stamp`` is involved, and the difference from ``_01``'s test is
   worth stating because it is easy to copy the wrong half. ``_01``'s hazard
   test has to re-stamp at the PARENT, because the revision it wants to re-run
   is already applied and alembic would otherwise skip it. ``_02`` has not run
   yet at that point, so the database is simply upgraded FORWARD onto it —
   which is also exactly what production does.
4. **The rebuilt definition is ``_01``'s definition**, compared byte-for-byte
   against the ``pg_get_indexdef`` this same database produced BEFORE the
   break — not against a literal, which would pin Postgres' rendering
   cosmetics rather than the DDL. Plus an explicit fragment check on the whole
   key list, because that is what a rebuild loses: a dropped ``NULLS LAST`` /
   ``NULLS FIRST``, or a dropped ``tenant_id`` / ``slug``, all leave an index
   that is valid and useless.
5. **A MISSING index is re-created**, not just an invalid one — ``_02`` runs
   ``IF NOT EXISTS`` unconditionally, so a hand-dropped index comes back.
6. **Downgrade is a no-op that keeps ``_01``'s objects.** After ``downgrade
   -1`` from ``_02`` both indexes are still present and valid, because they
   belong to ``_01``. A downgrade that dropped them would leave ``_01`` stamped
   over a table missing the indexes it promises.
7. **A valid index with the WRONG key list is REFUSED.** The migration exits
   non-zero and names the index, rather than accepting one that exists, is
   valid, and serves the wrong order. Driven through ``run_alembic``'s
   ``expect_success=False``, because the helper asserts exit 0 by default and
   would otherwise report this REFUSAL as a failed migration.

Where the coverage actually is, stated so a green run is not over-read
=====================================================================

The conditional DROP — the reason this revision exists — is decided by
``_is_invalid``, and only assertion 3 drives it down the true branch. That test
is SUPERUSER-GATED, so on an unprivileged Postgres the heal itself is not
exercised. Of the rest: assertions 2 and 6 assert NON-behaviour and would still
pass against a ``_02`` whose ``upgrade()`` were ``pass``; assertion 5 is
satisfied by the unconditional ``CREATE ... IF NOT EXISTS`` alone. Assertion 7
is the one unprivileged test that drives a real decision (the definition
check). CI's ``pgvector/pgvector:pg16`` ``POSTGRES_USER`` is a superuser, so the
heal does run there — but a green LOCAL run on a non-superuser is not evidence
that it works.

What is deliberately NOT asserted
=================================

* **No plan shape and no query behaviour.** ``_01``'s test owns the ORDER
  contract (which statement rides which index, with ``enable_seqscan = off``).
  Re-asserting it here would duplicate that file without adding a property:
  assertion 4 already pins that the rebuilt definition is identical, and an
  identical definition serves an identical plan.
* **Two of the three RAISE branches.** ``_require_healthy`` can raise on
  MISSING, on still-INVALID, and on a wrong definition. Assertion 7 drives the
  third. The first two are reachable only if Postgres reports success for a
  ``CREATE INDEX`` that produced nothing, or is interrupted again during the
  rebuild — neither is provokable from a test without patching the revision, so
  they stay fail-closed backstops rather than asserted behaviour.

What this file requires, and what it does when a requirement is missing
=======================================================================

* **The pinned-parent test requires nothing** beyond the revision file on disk;
  it always runs.
* **Every other test requires a reachable Postgres** at the URL ``conftest.py``
  resolves (``QONTINUI_TEST_PG=host:port`` points them elsewhere). Unreachable
  => those tests SKIP, and the skip reason says the heal was therefore NOT
  verified.
* **Assertions 3 and 4 additionally require that the connected role be a
  SUPERUSER**, because marking an index invalid is an ``UPDATE`` on
  ``pg_index``. Not a superuser => those skip with that reason while 2, 5, 6
  and 7 still run. Same gate, same rationale and same degradation path as
  ``_01``'s test, which that file's docstring states in full.
"""

from __future__ import annotations

import contextlib
import re
from collections.abc import Iterator
from pathlib import Path

import pytest
from psycopg2 import errors as pg_errors
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import DBAPIError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    run_alembic,
)

_REVISION_ID = "coord_wu_list_order_02"
_PARENT_REVISION_ID = "coord_wu_list_order_01"
_REVISION_FILENAME = "coord_wu_list_order_02_heal_invalid_list_order_indexes.py"

_IX_AUTHORED = "ix_coord_work_units_tenant_authored_slug"
_IX_DERIVE = "ix_coord_work_units_derive_checked_at"
_BOTH = (_IX_AUTHORED, _IX_DERIVE)

# The whole parenthesised key list of each index, as `pg_get_indexdef` renders
# it. Mirrors `_REQUIRED_KEY_FRAGMENT` in the revision under test, which is the
# behaviour these assertions are checking.
#
# A fragment and not the whole definition: the full rendering carries details
# this test has no business pinning (`USING btree`, the index's own name), and a
# whole-string expectation would go red on a Postgres upgrade that changed
# cosmetics while the DDL was still exactly right. But it covers every key, not
# just the NULL placement — `tenant_id` leading and `slug` trailing are what make
# the authored index a tenant-filtered range scan with a total keyset cursor.
#
# `pg_get_indexdef` prints only non-defaults, which is what makes these exact:
# `DESC` defaults to NULLS FIRST so `NULLS LAST` is printed; a plain ASC key
# defaults to NULLS LAST so `NULLS FIRST` is printed and the redundant `ASC` is
# dropped.
#
# The byte-for-byte check is made against the definition this same database
# produced before the break (see `before` in each test), which is a stronger
# statement than any literal here and cannot drift at all.
_REQUIRED_KEYS = {
    _IX_AUTHORED: "(tenant_id, authored_at DESC NULLS LAST, slug)",
    _IX_DERIVE: "(derive_checked_at NULLS FIRST)",
}

_NO_POSTGRES_REASON = (
    "no reachable Postgres at the conftest URL, so the "
    "coord_wu_list_order_02 heal was NOT verified here "
    "(set QONTINUI_TEST_PG=host:port to point at one)"
)

_PG_REACHABLE = can_connect(admin_database_url())


def _superuser_skip_reason() -> str | None:
    """``None`` when the catalog-write step may run here; else why it may not."""
    if not _PG_REACHABLE:
        return _NO_POSTGRES_REASON
    engine = create_engine(admin_database_url(), isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as conn:
            is_superuser = bool(
                conn.execute(
                    text("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")
                ).scalar()
            )
    except Exception as exc:  # pragma: no cover - a probe that cannot answer
        return f"could not read rolsuper for current_user: {exc!r}"
    finally:
        engine.dispose()
    if not is_superuser:
        return (
            "the connected role is NOT a superuser, so the INVALID-index heal "
            "(which marks an index invalid via UPDATE pg_index) was not "
            "verified here. CI's POSTGRES_USER is a superuser and so is "
            "pgvector/pgvector:pg16's; connect as one to run this assertion."
        )
    return None


_SUPERUSER_SKIP_REASON = _superuser_skip_reason()


@contextlib.contextmanager
def _database_at_revision(revision: str) -> Iterator[tuple[Engine, str, Path]]:
    """An ephemeral database upgraded to ``revision``; yields (engine, url, root)."""
    root = backend_root()
    with ephemeral_database(admin_database_url(), "coord_wu_list_order_02_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", revision)
        yield engine, url, root


def _index_state(engine: Engine, name: str) -> tuple[str, bool, int] | None:
    """``(definition, indisvalid, indexrelid)`` for ``coord.<name>``, or ``None``.

    ``indexrelid`` is the identity half: a DROP+CREATE mints a new oid, so
    comparing it across a run distinguishes "rebuilt" from "left alone" —
    which a validity-only assertion cannot.
    """
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT pg_get_indexdef(i.indexrelid), i.indisvalid, i.indexrelid
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'coord' AND c.relname = :idx
                """
            ),
            {"idx": name},
        ).one_or_none()
    if row is None:
        return None
    return str(row[0]), bool(row[1]), int(row[2])


def _require(engine: Engine, name: str) -> tuple[str, bool, int]:
    state = _index_state(engine, name)
    assert state is not None, f"coord.{name} is absent"
    return state


def _mark_index_invalid(engine: Engine, index_name: str) -> None:
    """``indisvalid = false`` on one index — the stand-in for a killed build."""
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE pg_index SET indisvalid = false "
                    f"WHERE indexrelid = 'coord.{index_name}'::regclass"
                )
            )
    except DBAPIError as exc:  # pragma: no cover - superuser-gated already
        if isinstance(exc.orig, pg_errors.InsufficientPrivilege):
            pytest.skip(
                "UPDATE pg_index was refused despite rolsuper, so the "
                f"heal of {index_name} was NOT verified here: {exc.orig}"
            )
        raise


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    """`_PARENT_REVISION_ID` is the revision's real parent — no database needed."""
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    match = re.search(
        r'^down_revision[^=]*=\s*["\'](?P<parent>[^"\']+)["\']',
        source,
        re.MULTILINE,
    )
    assert match is not None, f"no down_revision found in {_REVISION_FILENAME}"
    assert match.group("parent") == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision={match.group('parent')!r} "
        f"but this test pins _PARENT_REVISION_ID={_PARENT_REVISION_ID!r}. "
        "Re-point both together."
    )


@pytest.mark.skipif(not _PG_REACHABLE, reason=_NO_POSTGRES_REASON)
def test_coord_wu_list_order_02_is_a_no_op_on_a_healthy_database() -> None:
    """2. Both indexes stay valid AND are not rebuilt when nothing is wrong."""
    with _database_at_revision(_PARENT_REVISION_ID) as (engine, url, root):
        before = {name: _require(engine, name) for name in _BOTH}
        assert all(state[1] for state in before.values()), (
            "_01 must leave both indexes valid on a clean upgrade; this test "
            "cannot say anything about _02 otherwise"
        )

        run_alembic(root, url, "upgrade", _REVISION_ID)

        for name in _BOTH:
            definition, valid, oid = _require(engine, name)
            assert valid, f"coord.{name} must still be valid after _02"
            assert oid == before[name][2], (
                f"coord.{name} was REBUILT by _02 on a healthy database "
                "(indexrelid changed). _02 must only drop an index whose "
                "indisvalid is false — rebuilding a healthy index costs a full "
                "heap scan on a continuously-written table to prove something "
                "the catalog already answered."
            )
            assert definition == before[name][0]


@pytest.mark.skipif(
    _SUPERUSER_SKIP_REASON is not None,
    reason=str(_SUPERUSER_SKIP_REASON),
)
@pytest.mark.parametrize("broken", _BOTH)
def test_coord_wu_list_order_02_heals_an_invalid_index(broken: str) -> None:
    """3 + 4. An INVALID index is rebuilt valid, with ``_01``'s exact definition.

    The direct contrast with
    ``test_coord_wu_list_order_01_rerun_does_not_heal_an_invalid_index``: same
    poke, same corpse — and here the index comes back. That test re-stamps at
    the parent to force an already-applied revision to run again; this one just
    upgrades forward onto ``_02``, which has not run yet.
    """
    with _database_at_revision(_PARENT_REVISION_ID) as (engine, url, root):
        before = {name: _require(engine, name) for name in _BOTH}

        _mark_index_invalid(engine, broken)
        assert not _require(engine, broken)[1], "the poke must have landed"

        run_alembic(root, url, "upgrade", _REVISION_ID)

        definition, valid, oid = _require(engine, broken)
        assert valid, (
            f"coord.{broken} is still INVALID after _02. That is the whole "
            "point of the revision: CREATE INDEX ... IF NOT EXISTS skips an "
            "invalid index, so _02 must DROP it first."
        )
        assert oid != before[broken][2], (
            f"coord.{broken} reports valid but its indexrelid did not change, "
            "so it was never rebuilt — the assertion would be passing on an "
            "index the poke failed to break."
        )
        assert definition == before[broken][0], (
            f"the rebuilt coord.{broken} does not carry the definition _01 "
            "produced on this same database. Key directions and NULL placement "
            "ARE the contract: a DESC key defaults to NULLS FIRST and a plain "
            "ASC key to NULLS LAST, so a rebuild that dropped the explicit "
            f"spelling would be valid and would stop serving the order.\n"
            f"got:      {definition}\nexpected: {before[broken][0]}"
        )
        assert _REQUIRED_KEYS[broken] in definition, (
            f"coord.{broken} lost its NULL placement in the rebuild: expected "
            f"{_REQUIRED_KEYS[broken]!r} in {definition!r}"
        )

        intact = next(name for name in _BOTH if name != broken)
        assert _require(engine, intact)[2] == before[intact][2], (
            f"coord.{intact} was healthy and must not have been rebuilt"
        )


@pytest.mark.skipif(not _PG_REACHABLE, reason=_NO_POSTGRES_REASON)
def test_coord_wu_list_order_02_recreates_a_missing_index() -> None:
    """5. A hand-dropped index comes back, not only an invalid one."""
    with _database_at_revision(_PARENT_REVISION_ID) as (engine, url, root):
        before_def = _require(engine, _IX_DERIVE)[0]
        with engine.begin() as conn:
            conn.execute(text(f"DROP INDEX coord.{_IX_DERIVE}"))
        assert _index_state(engine, _IX_DERIVE) is None, "the drop must have landed"

        run_alembic(root, url, "upgrade", _REVISION_ID)

        definition, valid, _ = _require(engine, _IX_DERIVE)
        assert valid
        assert definition == before_def
        assert _REQUIRED_KEYS[_IX_DERIVE] in definition


@pytest.mark.skipif(not _PG_REACHABLE, reason=_NO_POSTGRES_REASON)
def test_coord_wu_list_order_02_refuses_an_index_with_the_wrong_key_list() -> None:
    """7. A VALID index whose key list is wrong is refused, not accepted.

    The break used here is a lost NULL placement, which is the cheapest one to
    construct; `_REQUIRED_KEY_FRAGMENT` pins the whole key list, so a lost
    ``tenant_id`` or ``slug`` is refused by the same comparison.

    This is the hand-rebuild ``_01``'s own recovery invites: ``DROP INDEX``,
    then re-create it from memory without ``NULLS FIRST``. The result is
    ``indisvalid`` and serves the wrong order, and ``CREATE INDEX ... IF NOT
    EXISTS`` matches on NAME alone so it cannot notice.

    Needs no superuser — it builds the wrong index for real rather than poking
    the catalog — so this is the one test that exercises a heal decision on an
    unprivileged Postgres.
    """
    with _database_at_revision(_PARENT_REVISION_ID) as (engine, url, root):
        with engine.begin() as conn:
            conn.execute(text(f"DROP INDEX coord.{_IX_DERIVE}"))
            # Plain ASC: defaults to NULLS LAST, so never-evaluated units sort
            # to the BACK and the rotation lane reaches them last instead of
            # first. Valid, wrong, and invisible to an existence check.
            conn.execute(
                text(
                    f"CREATE INDEX {_IX_DERIVE} ON coord.work_units (derive_checked_at)"
                )
            )
        definition, valid, _ = _require(engine, _IX_DERIVE)
        assert valid, "the hand-rebuilt index must itself be valid"
        assert _REQUIRED_KEYS[_IX_DERIVE] not in definition, (
            f"this test needs an index whose key list does NOT match; got {definition!r}"
        )

        # `expect_success=False`: the harness asserts exit 0 by default, so
        # without this the REFUSAL this test is asking for would be reported as
        # "alembic ... failed with exit 1" — the correct outcome rendered as a
        # broken migration, and the test could never pass while the code was
        # right.
        result = run_alembic(root, url, "upgrade", _REVISION_ID, expect_success=False)

        combined = (result.stdout or "") + (result.stderr or "")
        assert _IX_DERIVE in combined, (
            "the refusal must name the index so an operator can act on it; "
            f"got:\n{combined}"
        )


@pytest.mark.skipif(not _PG_REACHABLE, reason=_NO_POSTGRES_REASON)
def test_coord_wu_list_order_02_downgrade_keeps_the_parents_indexes() -> None:
    """6. ``downgrade -1`` is a no-op: both indexes belong to ``_01``."""
    with _database_at_revision(_REVISION_ID) as (engine, url, root):
        before = {name: _require(engine, name) for name in _BOTH}

        run_alembic(root, url, "downgrade", "-1")

        for name in _BOTH:
            definition, valid, oid = _require(engine, name)
            assert valid, (
                f"coord.{name} must survive _02's downgrade — it is _01's "
                "object, and _01 is still stamped"
            )
            assert oid == before[name][2]
            assert definition == before[name][0]

        # And the replay the reversal gate runs is clean.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        for name in _BOTH:
            assert _require(engine, name)[1]
