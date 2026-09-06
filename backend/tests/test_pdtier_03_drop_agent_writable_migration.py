"""Pin ``pdtier_03``, which drops ``coord.*.agent_writable`` for real.

Modelled on ``test_pdtier_01_agent_write_tier_migration.py``, for the reason
that file gives: this family has now shipped three revisions, one of which
(``pdtier_01``) broke production, and every one of those breakages was invisible
to a green ``upgrade``.

Every assertion below covers something a green ``upgrade`` cannot see:

1. **Both tables lose the boolean**, and both keep ``agent_write_tier`` intact.
   A parent-only drop raises nothing at all.
2. **Class B is backfilled, not dropped on the floor.** A row whose only
   authority opinion is the boolean must arrive as the equivalent tier.
3. **Class B cannot clobber.** This is the assertion that pins the one
   substantive divergence from ``pdtier_02``'s prescribed blanket ``UPDATE``.
   Without it, a future "simplification" back to the blanket form passes every
   other test here while silently reverting operator decisions — and collapsing
   ``allow_with_notification`` to ``deny``.
4. **Class C raises, and leaves the column PRESENT.** A refusal that
   half-dropped would be worse than either outcome.
5. **Round trip.** up → down → up restores the column, its comments, and
   destroys no rows.
6. **``upgrade()`` is genuinely re-runnable.** Alembic will not re-run it for
   you (``alembic_version`` makes a second ``upgrade pdtier_03`` a no-op), so
   the module is loaded by path and invoked a second time against an
   already-upgraded database.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable. ⚠️ A skip proves nothing — point it at
a live instance with ``QONTINUI_TEST_PG=localhost:5433`` if 5432 is not the one
accepting the test credentials. (Measured on the operator box 2026-08-31: 5432
rejects them and 5433 accepts.)

Use that variable, **not** ``DATABASE_URL``: ``conftest.py`` overwrites
``os.environ["DATABASE_URL"]`` unconditionally at import time from
``QONTINUI_TEST_PG``, so setting ``DATABASE_URL`` on the command line is
silently discarded and every database-backed test below skips — which looks
exactly like a green run in the summary line.
"""

from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import uuid
from types import ModuleType

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

# Pinned explicitly rather than "head" so a later revision landing on top cannot
# silently change what this test walks. `_PARENT_REVISION_ID` MUST equal the
# revision's own `down_revision` — the first test enforces it, because a stale
# pin rewinds too far and replays unrelated non-idempotent revisions, surfacing
# as someone else's `DuplicateTable`.
#
# It is `fleet_res_tel_05_socket_census` — qontinui-web #1216, an UNLANDED
# sibling rather than a chain head. A 2026-09-05 land forked six open PRs off
# one parent and they were CHAINED to resolve it rather than all re-pointed at
# the head; the block above `down_revision` in the revision itself carries the
# order and the reasoning. It was `coordtouch_01` until then.
_REVISION_ID = "pdtier_03"
_PARENT_REVISION_ID = "fleet_res_tel_05_socket_census"
_REVISION_FILENAME = "pdtier_03_drop_agent_writable.py"

_PARENT_TABLE = "prompt_documents"
_VERSIONS_TABLE = "prompt_document_versions"

_TIER_COLUMN = "agent_write_tier"
_LEGACY_COLUMN = "agent_writable"

# `pdaw_01`'s comment bodies. Asserted as literals, NOT imported from the
# revision module: a test that reads the value it is checking out of the code
# under test pins nothing at all.
_EXPECTED_COMMENTS = {
    _PARENT_TABLE: (
        "Operator-controlled per-document agent write access. NULL = no operator "
        "opinion (the compile-time default decides)."
    ),
    _VERSIONS_TABLE: (
        "Snapshot of the parent agent_writable at the time this version was written."
    ),
}

# Distinguishes "caller said None" from "caller said nothing", which matters
# because None is a MEANINGFUL value for both snapshot columns.
_SAME_AS_PARENT: object = object()

# Scoped to the DB-backed tests ONLY. A module-level `pytestmark` would also
# skip the source-scanning tests below, which need no database — and a run that
# skips everything is indistinguishable from a run that proves everything.
_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="test Postgres unreachable (set QONTINUI_TEST_PG=host:port)",
)


def _revision_path():
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _load_revision_module() -> ModuleType:
    """Import the revision file directly, so ``upgrade()`` can be re-invoked."""
    spec = importlib.util.spec_from_file_location(
        "pdtier_03_revision", _revision_path()
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _column(
    engine: Engine, table: str, column: str
) -> tuple[str, str, str | None] | None:
    """``(data_type, is_nullable, column_default)`` for the column, or None."""
    sql = text(
        """
        SELECT data_type, is_nullable, column_default
          FROM information_schema.columns
         WHERE table_schema = 'coord'
           AND table_name = :table
           AND column_name = :column
        """
    )
    with engine.connect() as conn:
        row = conn.execute(sql, {"table": table, "column": column}).fetchone()
    return (row[0], row[1], row[2]) if row else None


def _column_comment(engine: Engine, table: str, column: str) -> str | None:
    with engine.connect() as conn:
        return conn.execute(
            text(
                """
                SELECT col_description(att.attrelid, att.attnum)
                  FROM pg_attribute att
                 WHERE att.attrelid = to_regclass('coord.' || :table)
                   AND att.attname = :column
                   AND att.attnum > 0
                   AND NOT att.attisdropped
                """
            ),
            {"table": table, "column": column},
        ).scalar()


def _insert_document(
    engine: Engine,
    tenant: uuid.UUID,
    name: str,
    *,
    legacy: bool | None,
    tier: str | None,
    snapshot_legacy: bool | None = _SAME_AS_PARENT,
    snapshot_tier: str | None = _SAME_AS_PARENT,
) -> uuid.UUID:
    """Insert a document + its version-1 snapshot, both carrying BOTH columns.

    By default the snapshot mirrors its parent, so each class is exercised on
    both tables — a parent-only assertion is exactly the blind spot that let
    ``pdtier_01`` ship a probe naming one table while the statement read another.

    ``snapshot_legacy`` / ``snapshot_tier`` let the snapshot DIFFER, which is not
    a convenience: with mirroring only, a conflict always exists on
    ``coord.prompt_documents``, and ``upgrade()`` walks that table FIRST — so it
    always raises before the versions block is emitted, and any assertion about
    the versions table on the refusal path is trivially true. The dangerous
    ordering is the reverse one, and it is unreachable without this.
    """
    if snapshot_legacy is _SAME_AS_PARENT:
        snapshot_legacy = legacy
    if snapshot_tier is _SAME_AS_PARENT:
        snapshot_tier = tier
    doc_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                f"""
                INSERT INTO coord.{_PARENT_TABLE}
                    (id, tenant_id, kind, name, body, format, current_version,
                     {_LEGACY_COLUMN}, {_TIER_COLUMN})
                VALUES (:id, :tenant, 'policy', :name, 'body', 'markdown', 1,
                        :legacy, :tier)
                """
            ),
            {
                "id": doc_id,
                "tenant": tenant,
                "name": name,
                "legacy": legacy,
                "tier": tier,
            },
        )
        conn.execute(
            text(
                f"""
                INSERT INTO coord.{_VERSIONS_TABLE}
                    (document_id, version_number, body,
                     {_LEGACY_COLUMN}, {_TIER_COLUMN})
                VALUES (:doc, 1, 'body', :legacy, :tier)
                """
            ),
            {"doc": doc_id, "legacy": snapshot_legacy, "tier": snapshot_tier},
        )
    return doc_id


def _tier_of(engine: Engine, doc_id: uuid.UUID) -> tuple[str | None, str | None]:
    """The parent's and the snapshot's tier, as one tuple."""
    with engine.connect() as conn:
        parent = conn.execute(
            text(f"SELECT {_TIER_COLUMN} FROM coord.{_PARENT_TABLE} WHERE id = :id"),
            {"id": doc_id},
        ).scalar()
        snap = conn.execute(
            text(
                f"SELECT {_TIER_COLUMN} FROM coord.{_VERSIONS_TABLE} "
                "WHERE document_id = :id"
            ),
            {"id": doc_id},
        ).scalar()
    return parent, snap


def _upgrade_to(db_url: str, revision: str):
    return run_alembic(backend_root(), db_url, "upgrade", revision)


def _upgrade_expecting_failure(db_url: str, revision: str):
    """Run `alembic upgrade` WITHOUT the harness's success assertion.

    ``run_alembic`` asserts ``returncode == 0`` internally, so it can only ever
    express "this migration succeeds". The Class C test needs the opposite — a
    refusal is the passing outcome — and routing it through the harness turns a
    correct refusal into a harness ``AssertionError`` that reads exactly like a
    broken migration.

    Same invocation as the harness otherwise, including ``sys.executable`` (the
    child must be the interpreter running the tests, not whatever ``python`` the
    OS finds first) and passing the URL both ways.
    """
    env = os.environ.copy()
    env["DATABASE_URL"] = db_url
    return subprocess.run(
        [
            sys.executable,
            "-m",
            "alembic",
            "-x",
            f"db_url={db_url}",
            "upgrade",
            revision,
        ],
        cwd=str(backend_root()),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def _assert_ok(proc, what: str) -> None:
    assert proc.returncode == 0, (
        f"{what} failed (exit {proc.returncode})\n"
        f"--- stdout ---\n{proc.stdout}\n--- stderr ---\n{proc.stderr}"
    )


# --------------------------------------------------------------------------
# Source-level: no database needed, so these run even on a box with no Postgres.
# --------------------------------------------------------------------------


def test_parent_revision_pin_matches_the_revisions_own_down_revision():
    """A stale `_PARENT_REVISION_ID` rewinds too far and replays foreign work."""
    source = _revision_source()
    assert f'revision: str = "{_REVISION_ID}"' in source
    assert f'down_revision: str | Sequence[str] | None = "{_PARENT_REVISION_ID}"' in (
        source
    )


def test_backfill_is_narrowed_so_it_can_never_clobber_a_tier():
    """The divergence from `pdtier_02`'s blanket UPDATE, pinned in the SQL.

    Assertion 3 proves the BEHAVIOUR against a live database; this proves the
    narrowing clause is still written down, so a reviewer watching the diff sees
    it go if it goes.

    Asserted against the FORMATTED SQL, not the source text. The revision holds
    its statements as ``str.format`` templates (``WHERE {tier} IS NULL``), so a
    grep of the raw file for the rendered clause can only ever fail — it would
    have been a test that passes by never being true.
    """
    module = _load_revision_module()
    table = f"coord.{_PARENT_TABLE}"
    sql = module._RECONCILE_AND_DROP.format(
        table=table,
        tier=_TIER_COLUMN,
        legacy=_LEGACY_COLUMN,
        row_key=module._ROW_KEY[table],
        conflict=module._CLASS_C_PREDICATE.format(
            tier=_TIER_COLUMN, legacy=_LEGACY_COLUMN
        ),
        remedy=module._REMEDY[table],
    )

    # Scope the assertion to the UPDATE statement. A whole-block search cannot
    # do this job: the Class C detection query legitimately opens
    # `WHERE agent_writable IS NOT NULL`, which is character-for-character the
    # blanket form this test exists to forbid. Asserting over the whole block
    # therefore fails on correct code — it did, first run.
    # Anchor on the EXECUTE that introduces the statement, not on the bare word
    # "UPDATE" — the explanatory comment above it in the revision also contains
    # "UPDATE", so a one-word edit there would silently move this slice onto the
    # comment.
    update_start = sql.index("$sql$\n            UPDATE ")
    update_sql = sql[update_start : sql.index("$sql$", update_start + 5)]

    assert f"WHERE {_TIER_COLUMN} IS NULL" in update_sql, update_sql
    assert f"AND {_LEGACY_COLUMN} IS NOT NULL" in update_sql, update_sql
    # The blanket form `pdtier_02` prescribed must NOT be what the UPDATE does.
    assert f"WHERE {_LEGACY_COLUMN} IS NOT NULL" not in update_sql, update_sql

    # And the Class C predicate must exclude `allow_with_notification`. The
    # behavioural proof is
    # `test_allow_with_notification_is_never_a_conflict_under_either_boolean`;
    # this is the cheap structural pin beside it, because dropping this one
    # clause is what turns the migration into a deploy-aborting false positive.
    conflict = module._CLASS_C_PREDICATE.format(
        tier=_TIER_COLUMN, legacy=_LEGACY_COLUMN
    )
    assert f"{_TIER_COLUMN} <> 'allow_with_notification'" in conflict, conflict


def test_revision_is_hand_authored_not_autogenerated():
    assert "alembic-sole-authorship" in _revision_source()


# --------------------------------------------------------------------------
# Database-backed.
# --------------------------------------------------------------------------


@_needs_pg
def test_both_tables_lose_the_boolean_and_keep_the_tier():
    """Assertion 1 — a parent-only drop raises nothing, so assert both tables."""
    with ephemeral_database(admin_database_url(), "pdtier03_drop") as (engine, url):
        _assert_ok(_upgrade_to(url, _REVISION_ID), f"upgrade {_REVISION_ID}")

        for table in (_PARENT_TABLE, _VERSIONS_TABLE):
            assert _column(engine, table, _LEGACY_COLUMN) is None, (
                f"coord.{table}.{_LEGACY_COLUMN} survived the upgrade"
            )
            tier = _column(engine, table, _TIER_COLUMN)
            assert tier is not None, f"coord.{table}.{_TIER_COLUMN} went missing"
            data_type, is_nullable, default = tier
            assert data_type == "text"
            assert is_nullable == "YES"
            assert default is None


@_needs_pg
def test_class_b_is_backfilled_not_dropped_on_the_floor():
    """Assertion 2 — the boolean was the ONLY opinion; it must survive as a tier."""
    with ephemeral_database(admin_database_url(), "pdtier03_classb") as (engine, url):
        _assert_ok(_upgrade_to(url, _PARENT_REVISION_ID), "upgrade to parent")

        tenant = uuid.uuid4()
        allowed = _insert_document(engine, tenant, "b-true", legacy=True, tier=None)
        denied = _insert_document(engine, tenant, "b-false", legacy=False, tier=None)

        _assert_ok(_upgrade_to(url, _REVISION_ID), f"upgrade {_REVISION_ID}")

        assert _tier_of(engine, allowed) == ("allow", "allow")
        assert _tier_of(engine, denied) == ("deny", "deny")


@_needs_pg
def test_class_b_backfill_cannot_clobber_an_existing_tier():
    """Assertion 3 — the whole reason this is not `pdtier_02`'s blanket UPDATE.

    ``allow_with_notification`` paired with ``FALSE`` is Class A under the
    forward mapping — the two AGREE. The blanket form would rewrite the tier to
    ``deny``, destroying a three-state value the boolean cannot express.
    """
    with ephemeral_database(admin_database_url(), "pdtier03_noclobber") as (
        engine,
        url,
    ):
        _assert_ok(_upgrade_to(url, _PARENT_REVISION_ID), "upgrade to parent")

        tenant = uuid.uuid4()
        awn = _insert_document(
            engine, tenant, "awn", legacy=False, tier="allow_with_notification"
        )
        # Class D for good measure: tier-only opinion, boolean silent.
        tier_only = _insert_document(
            engine, tenant, "tier-only", legacy=None, tier="allow"
        )

        _assert_ok(_upgrade_to(url, _REVISION_ID), f"upgrade {_REVISION_ID}")

        assert _tier_of(engine, awn) == (
            "allow_with_notification",
            "allow_with_notification",
        ), "the blanket re-backfill collapsed allow_with_notification to deny"
        assert _tier_of(engine, tier_only) == ("allow", "allow")


@_needs_pg
def test_class_c_refuses_and_leaves_the_column_present():
    """Assertion 4 — a refusal that half-dropped is worse than either outcome."""
    with ephemeral_database(admin_database_url(), "pdtier03_classc") as (engine, url):
        _assert_ok(_upgrade_to(url, _PARENT_REVISION_ID), "upgrade to parent")

        tenant = uuid.uuid4()
        # Genuinely conflicting: boolean says "yes", tier says "no".
        _insert_document(engine, tenant, "conflict", legacy=True, tier="deny")

        proc = _upgrade_expecting_failure(url, _REVISION_ID)
        assert proc.returncode != 0, (
            "upgrade SUCCEEDED against a Class C row — the refusal did not fire\n"
            f"{proc.stdout}\n{proc.stderr}"
        )
        combined = f"{proc.stdout}\n{proc.stderr}"
        assert "Class C" in combined, combined[:2000]

        # The message must NAME the row. Assert the FULL key the revision
        # promises to emit, not a fragment: `"conflict" in combined` passes on
        # the refusal's own fixed boilerplate ("...two contradictory authority
        # opinions..." contains "contradictory", and the earlier wording
        # contained "conflicting"), so it can never fail and proves nothing.
        # The full key also covers `_ROW_KEY`'s uuid::text cast, which nothing
        # else exercises.
        assert f"{tenant}/policy/conflict" in combined, combined[:2000]
        # And the count must be the population, not the LIMIT.
        assert "1 Class C row(s)" in combined, combined[:2000]

        # And the column must still be there on BOTH tables — nothing half-done.
        for table in (_PARENT_TABLE, _VERSIONS_TABLE):
            assert _column(engine, table, _LEGACY_COLUMN) is not None, (
                f"coord.{table}.{_LEGACY_COLUMN} was dropped despite the refusal"
            )


@_needs_pg
def test_allow_with_notification_is_never_a_conflict_under_either_boolean():
    """`allow_with_notification` + EITHER boolean must pass, not refuse.

    The two authorities project this tier onto the boolean differently, both on
    purpose: ``pdtier_02``'s backfill wrote ``awn -> FALSE``, while coord's live
    ``AgentWriteTier::legacy_bool() = permits_write() = !Deny`` reports ``TRUE``.
    So both pairs occur in production, and the ``TRUE`` one arises from a plain
    round trip — a legacy client reads ``agent_writable: true`` off such a
    document and PATCHes it back, which coord preserves as ``awn``.

    Flagging either as a two-opinion conflict aborts the migration on a state
    coord builds deliberately, and because alembic wraps the run in ONE
    transaction that rolls back every pending revision in the deploy — not just
    this one. This test is the regression guard for that.
    """
    with ephemeral_database(admin_database_url(), "pdtier03_awn") as (engine, url):
        _assert_ok(_upgrade_to(url, _PARENT_REVISION_ID), "upgrade to parent")

        tenant = uuid.uuid4()
        awn_false = _insert_document(
            engine, tenant, "awn-false", legacy=False, tier="allow_with_notification"
        )
        awn_true = _insert_document(
            engine, tenant, "awn-true", legacy=True, tier="allow_with_notification"
        )

        proc = _upgrade_expecting_failure(url, _REVISION_ID)
        assert proc.returncode == 0, (
            "upgrade REFUSED on allow_with_notification — that tier is "
            "compatible with either boolean and must never be Class C\n"
            f"{proc.stdout}\n{proc.stderr}"
        )

        # Both survive with the three-state value intact, on both tables.
        assert _tier_of(engine, awn_false) == (
            "allow_with_notification",
            "allow_with_notification",
        )
        assert _tier_of(engine, awn_true) == (
            "allow_with_notification",
            "allow_with_notification",
        )
        for table in (_PARENT_TABLE, _VERSIONS_TABLE):
            assert _column(engine, table, _LEGACY_COLUMN) is None


@_needs_pg
def test_a_conflict_only_in_the_versions_table_still_drops_nothing():
    """The half-drop case the parent-conflict test cannot reach.

    With the parent conflicting, ``coord.prompt_documents`` raises first
    (``_TABLES`` order) and the versions block is never emitted — so asserting
    the versions column survived is trivially true there.

    Here the parent AGREES and only the snapshot conflicts, so the parent's
    block runs to completion and genuinely drops
    ``coord.prompt_documents.agent_writable`` before the versions block refuses.
    Only alembic's single enclosing transaction puts it back. That is what makes
    this the test that would catch a future ``transaction_per_migration = True``,
    an AUTOCOMMIT isolation level, or a split across a commit boundary.
    """
    with ephemeral_database(admin_database_url(), "pdtier03_snaponly") as (
        engine,
        url,
    ):
        _assert_ok(_upgrade_to(url, _PARENT_REVISION_ID), "upgrade to parent")

        tenant = uuid.uuid4()
        _insert_document(
            engine,
            tenant,
            "snap-only",
            legacy=True,
            tier="allow",  # parent AGREES
            snapshot_legacy=True,
            snapshot_tier="deny",  # snapshot CONTRADICTS
        )

        proc = _upgrade_expecting_failure(url, _REVISION_ID)
        assert proc.returncode != 0, (
            "upgrade SUCCEEDED with a conflicting version snapshot\n"
            f"{proc.stdout}\n{proc.stderr}"
        )

        # The parent's drop must have been rolled back with the refusal.
        for table in (_PARENT_TABLE, _VERSIONS_TABLE):
            assert _column(engine, table, _LEGACY_COLUMN) is not None, (
                f"coord.{table}.{_LEGACY_COLUMN} stayed dropped after a refusal "
                "in a later table — the upgrade is not atomic across _TABLES"
            )


@_needs_pg
def test_round_trip_restores_column_comments_and_destroys_no_rows():
    """Assertion 5 — up → down → up, with the comments checked as literals."""
    with ephemeral_database(admin_database_url(), "pdtier03_roundtrip") as (
        engine,
        url,
    ):
        _assert_ok(_upgrade_to(url, _PARENT_REVISION_ID), "upgrade to parent")

        tenant = uuid.uuid4()
        _insert_document(engine, tenant, "rt-allow", legacy=None, tier="allow")
        _insert_document(
            engine, tenant, "rt-awn", legacy=None, tier="allow_with_notification"
        )

        with engine.connect() as conn:
            before = conn.execute(
                text(f"SELECT count(*) FROM coord.{_PARENT_TABLE}")
            ).scalar_one()

        _assert_ok(_upgrade_to(url, _REVISION_ID), f"upgrade {_REVISION_ID}")
        _assert_ok(
            run_alembic(backend_root(), url, "downgrade", _PARENT_REVISION_ID),
            "downgrade",
        )

        for table in (_PARENT_TABLE, _VERSIONS_TABLE):
            assert _column(engine, table, _LEGACY_COLUMN) is not None, (
                f"coord.{table}.{_LEGACY_COLUMN} was not restored by downgrade"
            )
            assert (
                _column_comment(engine, table, _LEGACY_COLUMN)
                == _EXPECTED_COMMENTS[table]
            ), f"coord.{table}.{_LEGACY_COLUMN} lost its comment on the way down"

        # The documented lossy direction, asserted rather than assumed:
        # allow_with_notification restores as FALSE, never TRUE.
        with engine.connect() as conn:
            awn_legacy = conn.execute(
                text(
                    f"SELECT {_LEGACY_COLUMN} FROM coord.{_PARENT_TABLE} "
                    "WHERE name = 'rt-awn'"
                )
            ).scalar()
            allow_legacy = conn.execute(
                text(
                    f"SELECT {_LEGACY_COLUMN} FROM coord.{_PARENT_TABLE} "
                    "WHERE name = 'rt-allow'"
                )
            ).scalar()
            after = conn.execute(
                text(f"SELECT count(*) FROM coord.{_PARENT_TABLE}")
            ).scalar_one()

        assert awn_legacy is False, "a restore widened authority"
        # ⚠️ `rt-allow` went in as Class D (tier set, boolean NULL) — "no
        # operator opinion, the compile-time default decides". It comes back
        # TRUE. That is the documented SECOND lossy direction (see the
        # `downgrade()` docstring): a widening, asserted here so the behaviour is
        # pinned and visible, NOT because turning NULL into an explicit
        # permission is desirable. It is irreducible — by downgrade time the
        # boolean is gone, so nothing distinguishes "was NULL" from "was TRUE".
        # If a future change makes it reducible, this assertion is the one to
        # revisit; do not read it as an endorsement.
        assert allow_legacy is True
        # Weak by construction — neither direction contains a DELETE or a
        # CASCADE, so this cannot currently fail. Kept as a cheap tripwire for a
        # future edit that introduces one, not as evidence of anything today.
        assert after == before, "the round trip destroyed rows"

        _assert_ok(_upgrade_to(url, _REVISION_ID), "re-upgrade")
        for table in (_PARENT_TABLE, _VERSIONS_TABLE):
            assert _column(engine, table, _LEGACY_COLUMN) is None


@_needs_pg
def test_upgrade_is_rerunnable_against_an_already_upgraded_database():
    """Assertion 6 — alembic will not re-run it, so invoke the module directly."""
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    with ephemeral_database(admin_database_url(), "pdtier03_rerun") as (engine, url):
        _assert_ok(_upgrade_to(url, _REVISION_ID), f"upgrade {_REVISION_ID}")

        module = _load_revision_module()
        with engine.begin() as conn:
            ctx = MigrationContext.configure(conn)
            with Operations.context(ctx):
                module.upgrade()  # must be a clean no-op, not an error

        for table in (_PARENT_TABLE, _VERSIONS_TABLE):
            assert _column(engine, table, _LEGACY_COLUMN) is None
            assert _column(engine, table, _TIER_COLUMN) is not None
