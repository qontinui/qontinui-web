"""Schema + round-trip test for the ``pdtier_02`` revision.

``pdtier_02`` is the shim that repaired ``pdtier_01``'s deploy-order defect: it
restores ``agent_writable`` on both prompt-document tables and backfills it from
``agent_write_tier``, without undoing anything else ``pdtier_01`` did. It landed
under incident pressure and shipped with **no test at all**, while the revision
it repairs carries ten — so the two riskiest things in the file, the backfill
mapping and the guarded ``DO $$`` block, were unverified.

``migration-reversal.yml`` does not cover them. That gate walks the chain
against an EMPTY database, so it proves the SQL parses and that the revision
reverses; it cannot see a mapping, a comment body, or a value. Every assertion
below covers something a green ``upgrade`` cannot.

What this pins, and why each one can break quietly
==================================================

1. **The pin matches the revision's own ``down_revision``.** The chain under
   this revision has already been re-pointed once; a stale pin here rewinds too
   far and replays unrelated non-idempotent DDL, surfacing as someone else's
   ``DuplicateTable``.
2. **The boolean comes back on BOTH tables**, with ``pdaw_01``'s shape —
   nullable, no default. ``pdaw_01`` put it on the parent *and* the version
   snapshot; a parent-only restoration raises no error, and the enforcement read
   that caused the incident would start working again, so nothing would point at
   the half that is still missing.
3. **``pdtier_01`` is NOT undone.** The revision says so in its first paragraph:
   ``agent_write_tier`` and ``coord.prompt_document_kind_tiers`` stay exactly as
   that revision left them, CHECKs included. A shim that quietly reverted the
   tier would look identical from the enforcement path — which reads the boolean
   — and would silently destroy the per-kind table.
4. **The backfill maps all four states, on both tables.** ``'allow'`` → TRUE,
   ``'deny'`` → FALSE, ``NULL`` → NULL, and **``'allow_with_notification'`` →
   FALSE**. That last is the security-relevant one: a collapse to TRUE would
   restore an *unconditional* grant where the operator asked for one conditioned
   on disclosure — a repair that silently widens authority.
5. **The comment bodies really are ``pdaw_01``'s.** Read back out of
   ``col_description`` and compared against ``pdaw_01``'s own source rather than
   a third copy typed into this file. This revision first shipped holding two
   paraphrases, which is how the "NULL is NOT false" warning went missing on the
   forward path while ``pdtier_01``'s downgrade kept it — the two directions
   disagreeing about what the catalog says, with production on the forward one.
6. **``upgrade()`` is re-runnable in SCHEMA and destructive in DATA**, and those
   are different claims. Alembic will not re-run it for you, so the guards are
   otherwise unverified; the module is invoked directly through alembic's own
   ``Operations`` proxy. The data half is pinned deliberately rather than
   asserted away: a re-run **re-derives the boolean from the tier**, so a
   boolean an operator changed during the deploy window is overwritten. That is
   the same hazard the revision's own WARNING block hands to ``pdtier_03``, and
   a test is a better place to find it than production.
7. **The downgrade drops only the boolean.** The tier, its CHECKs and the
   per-kind table survive, and a re-upgrade restores and re-backfills. The
   revision's own docstring calls the downgrade "lossless with respect to THIS
   revision", which is only true if the tier is genuinely untouched.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable. ⚠️ A skip proves nothing — point it at
a live instance with ``QONTINUI_TEST_PG=localhost:5433`` if 5432 is not the one
accepting the test credentials. (CI provisions one at 5432 and runs the whole
tree, so the skip is a local-run hazard only.)

Use that variable, **not** ``DATABASE_URL``: ``conftest.py`` overwrites
``os.environ["DATABASE_URL"]`` unconditionally at import time from
``QONTINUI_TEST_PG``, so setting ``DATABASE_URL`` on the command line is
silently discarded and every database-backed test below skips — which looks
exactly like a green run in the summary line.

Each ephemeral database replays the whole revision chain from base, which costs
~25-45s, so the three tests that only READ the catalog share one
(``upgraded_engine``). The three that write, downgrade or re-invoke the revision
each take their own, because their substrate is the thing under test.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
import sqlalchemy
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    column_info,
    comment_body_from_source,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    scalar,
    table_exists,
)

# Pinned explicitly rather than "head" so a later revision landing on top cannot
# silently change what this test walks. `_PARENT_REVISION_ID` MUST equal the
# revision's own `down_revision` — the first test enforces it.
_REVISION_ID = "pdtier_02"
_PARENT_REVISION_ID = "fleet_res_tel_04"
_REVISION_FILENAME = "pdtier_02_restore_agent_writable_deploy_window.py"

# The revision whose comment bodies `pdtier_02` promises to restore. Read as
# SOURCE, never re-typed: a third copy of a body is exactly the divergence this
# file exists to catch.
_PDAW_FILENAME = "pdaw_01_prompt_document_agent_writable.py"

_PARENT_TABLE = "prompt_documents"
_VERSIONS_TABLE = "prompt_document_versions"
_KIND_TIER_TABLE = "prompt_document_kind_tiers"

_TIER_COLUMN = "agent_write_tier"
_LEGACY_COLUMN = "agent_writable"

# `tier -> restored boolean`, from the revision's own mapping table. `None` is
# the row the backfill's `WHERE ... IS NOT NULL` must never touch.
_MAPPING: dict[str | None, bool | None] = {
    "allow": True,
    "deny": False,
    "allow_with_notification": False,
    None: None,
}

# Scoped to the DB-backed tests ONLY. A module-level `pytestmark` would also
# skip the source-scanning tests below, which need no database — and a run that
# skips everything is indistinguishable from a run that proves everything.
_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="test Postgres unreachable (set QONTINUI_TEST_PG=host:port)",
)


def _versions_dir() -> Path:
    return backend_root() / "alembic" / "versions"


def _revision_path() -> Path:
    return _versions_dir() / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _revision_module():
    return load_revision_module(_revision_path(), "pdtier_02_revision")


def _pdaw_body(table: str) -> str:
    """``pdaw_01``'s comment body for ``coord.<table>.agent_writable``."""
    return comment_body_from_source(
        (_versions_dir() / _PDAW_FILENAME).read_text(encoding="utf-8"),
        f"coord.{table}.{_LEGACY_COLUMN}",
    )


@pytest.fixture(scope="module")
def upgraded_engine() -> Iterator[Engine]:
    """One database at ``pdtier_02``, shared by the read-only tests.

    Module-scoped on purpose: replaying ~500 revisions from base is the cost
    here, and the three tests that use this only read ``pg_catalog`` /
    ``information_schema``. The one that writes does so inside a
    ``pytest.raises`` block whose transaction rolls back, so it leaves nothing
    behind for its neighbours to trip over. Any test that mutates state, walks
    the chain, or re-invokes the revision takes its own database instead.
    """
    with ephemeral_database(admin_database_url(), "pdtier02_ro") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        yield engine


def _legacy_of(engine: Engine, doc_id: uuid.UUID, table: str) -> object:
    if table == _PARENT_TABLE:
        return scalar(
            engine,
            f"SELECT {_LEGACY_COLUMN} FROM coord.{_PARENT_TABLE} WHERE id = :id",
            id=doc_id,
        )
    return scalar(
        engine,
        f"""
        SELECT {_LEGACY_COLUMN} FROM coord.{_VERSIONS_TABLE}
         WHERE document_id = :doc AND version_number = 1
        """,
        doc=doc_id,
    )


def _seed_tiered_documents(
    engine: Engine, tenant: uuid.UUID
) -> dict[str | None, uuid.UUID]:
    """One document per tier state, each with its version-1 snapshot.

    Called while the database is at `_PARENT_REVISION_ID` — the tier exists,
    the boolean does not. That is the real-world ordering, and the only one in
    which the backfill is observable at all.
    """
    ids: dict[str | None, uuid.UUID] = {}
    with engine.begin() as conn:
        for tier in _MAPPING:
            doc_id = uuid.uuid4()
            ids[tier] = doc_id
            name = f"doc-{(tier or 'unset').replace('_', '-')}"
            conn.execute(
                text(
                    f"""
                    INSERT INTO coord.prompt_documents
                        (id, tenant_id, kind, name, body, format,
                         current_version, {_TIER_COLUMN})
                    VALUES (:id, :tenant, 'policy', :name, 'b', 'markdown', 1,
                            :tier)
                    """
                ),
                {"id": doc_id, "tenant": tenant, "name": name, "tier": tier},
            )
            conn.execute(
                text(
                    f"""
                    INSERT INTO coord.prompt_document_versions
                        (document_id, version_number, body, {_TIER_COLUMN})
                    VALUES (:doc, 1, 'b', :tier)
                    """
                ),
                {"doc": doc_id, "tier": tier},
            )
        conn.execute(
            text(
                f"INSERT INTO coord.{_KIND_TIER_TABLE} (tenant_id, kind, tier) "
                "VALUES (:tenant, 'initiative', 'allow_with_notification')"
            ),
            {"tenant": tenant},
        )
    return ids


def test_pin_matches_the_revisions_own_down_revision() -> None:
    """A stale `_PARENT_REVISION_ID` rewinds too far and replays foreign DDL."""
    source = _revision_source()
    assert (
        f'down_revision: str | Sequence[str] | None = "{_PARENT_REVISION_ID}"' in source
    ), (
        f"{_REVISION_FILENAME}'s down_revision no longer matches this test's "
        f"pin ({_PARENT_REVISION_ID!r}). This chain has been re-pointed before; "
        "update the pin deliberately rather than letting the walk drift."
    )
    assert f'revision: str = "{_REVISION_ID}"' in source


def test_upgrade_touches_only_the_boolean() -> None:
    """The shim ADDs; it must never DROP, and never on the upgrade path.

    ``pdtier_01``'s whole defect was doing an ADD and a DROP in one revision.
    A shim written to repair that must not repeat it — and the one place a
    ``DROP COLUMN`` legitimately appears is ``downgrade()``.
    """
    source = _revision_source()
    upgrade_body = source[source.index("def upgrade()") : source.index("def downgrade")]
    downgrade_body = source[source.index("def downgrade") :]

    assert "DROP COLUMN" not in upgrade_body, (
        "the deploy-window shim's upgrade must drop nothing: it exists because "
        "a DROP landed before its last reader was gone"
    )
    assert (
        "_BACKFILL.format(" in upgrade_body and "tier=_TIER_COLUMN" in upgrade_body
    ), (
        "the upgrade must apply the guarded backfill with the tier as its "
        "source — an ADD COLUMN alone restores the column the enforcement read "
        "wants and leaves every value NULL, which resolves to coord's default "
        "rather than to the operator's actual setting"
    )

    # Scoped to the two function bodies rather than scanned over the whole file:
    # the module docstring discusses dropping this column at length, and a
    # future sentence there quoting `ALTER TABLE ... DROP COLUMN` would red this
    # test while pointing at a documentation edit.
    drop_lines = [
        line
        for line in downgrade_body.splitlines()
        if "DROP COLUMN" in line
        and "ALTER TABLE" in line
        and not line.lstrip().startswith("#")
    ]
    assert len(drop_lines) == 1, (
        "expected exactly one DROP COLUMN statement in downgrade(), applied to "
        f"both tables from one list; found {len(drop_lines)}: {drop_lines!r}"
    )


def test_backfill_guard_reads_pg_catalog_and_names_the_column_it_reads() -> None:
    """The guard must gate on the column the statement READS.

    ``pdtier_01`` shipped a probe naming one table while the statement read
    another, and the revision's own comment says the fix was to gate on what is
    read. Here the UPDATE reads ``agent_write_tier``, so that is what the
    ``IF EXISTS`` must name — gating on ``agent_writable`` instead would be true
    the instant the ADD above it ran and would therefore never guard anything.

    ``information_schema`` is privilege-filtered and so a false-negative source
    in front of a conditional write; ``pg_attribute``/``to_regclass`` are not.
    """
    template = _revision_module()._BACKFILL

    assert "pg_attribute" in template and "to_regclass" in template, (
        "the backfill's existence predicate must read pg_catalog, not "
        "privilege-filtered metadata"
    )
    assert "information_schema" not in template, (
        "information_schema is a false-negative source; a suppressed guard "
        "here silently skips the backfill and leaves the restored boolean NULL"
    )
    assert "att.attname = '{tier}'" in template, (
        "the guard must name the TIER column — the one the UPDATE reads. "
        "Gating on the legacy boolean would pass unconditionally, because the "
        "ADD COLUMN immediately above it has already run."
    )
    assert "{tier} IS NOT NULL" in template, (
        "the UPDATE must skip rows with no tier: 'no operator opinion' is a "
        "state, and writing FALSE for it would freeze a refusal into data"
    )


def test_comment_sql_quotes_the_bodies_and_binds_nothing() -> None:
    """The one function this revision adds, exercised without a database.

    Everything else that reaches `_comment_sql` is `@_needs_pg`, and a local run
    with no Postgres skips all of it while still reporting green — so a deleted
    ``.replace("'", "''")`` would be invisible until CI.

    Both hazards are checked against real machinery rather than a hand-rolled
    regex: SQLAlchemy's own compiler decides what a bind parameter is, and its
    rule admits digits and ``$`` that a naive ``:[a-zA-Z_]`` scan would miss.
    """
    module = _revision_module()

    for table in module._TABLES:
        sql = module._comment_sql(table)

        assert "''" in sql, (
            f"{table}'s body carries apostrophes and none were doubled — the "
            "statement would terminate its own literal early"
        )
        assert sql.count("'") % 2 == 0, (
            f"unbalanced quotes in the COMMENT statement for {table}: {sql!r}"
        )
        assert module._COMMENTS[table].replace("'", "''") in sql, (
            f"the body reaching the catalog for {table} is not the one "
            "`_COMMENTS` holds"
        )
        assert not text(sql).compile().params, (
            f"{table}'s comment body contains a token SQLAlchemy's text() reads "
            "as a bind parameter. pdaw_01 spells the route {kind}/{name} rather "
            "than :kind/:name for exactly this reason, and the failure mode is "
            "'A value is required for bind parameter' at migration time."
        )


def test_comment_bodies_are_pdaw_01s_verbatim_in_source() -> None:
    """The cheap half of the comment check; the DB test is the half that binds.

    Checked at source level too because this is the failure that already
    happened once: two plausible paraphrases, no error, no diff in behaviour,
    and the catalog quietly stops saying "NULL is NOT false" on a column whose
    NULL is not false.
    """
    comments = _revision_module()._COMMENTS

    for table in (_PARENT_TABLE, _VERSIONS_TABLE):
        want = _pdaw_body(table)
        got = comments[f"coord.{table}"]
        assert got == want, (
            f"coord.{table}.{_LEGACY_COLUMN}'s restored comment is not "
            f"{_PDAW_FILENAME}'s body.\n  want: {want!r}\n  got:  {got!r}"
        )
        assert "''" not in got, (
            "apostrophes are doubled by _comment_sql at format time; storing "
            "the doubled form here would put `''` in the catalog verbatim"
        )


@_needs_pg
def test_boolean_is_restored_on_both_tables_with_pdaw_01s_shape(
    upgraded_engine: Engine,
) -> None:
    for table in (_PARENT_TABLE, _VERSIONS_TABLE):
        restored = column_info(upgraded_engine, table, _LEGACY_COLUMN)
        assert restored is not None, (
            f"coord.{table}.{_LEGACY_COLUMN} was not restored. A parent-only "
            "shim makes the enforcement read work again, so nothing would "
            "point at the snapshot half still being absent."
        )
        data_type, is_nullable, default = restored
        assert data_type == "boolean", (
            f"coord.{table}.{_LEGACY_COLUMN} is {data_type!r}. ADD COLUMN IF "
            "NOT EXISTS is type-blind, so a pre-existing column of another "
            "type makes the ADD a silent no-op."
        )
        assert is_nullable == "YES", (
            f"coord.{table}.{_LEGACY_COLUMN} must stay NULLABLE: NULL is 'no "
            "operator opinion', the state coord's compile-time default resolves"
        )
        assert default is None, (
            f"coord.{table}.{_LEGACY_COLUMN} must have NO default — a DEFAULT "
            "would give every unset row an operator opinion it never had, on "
            "the column the enforcement read consults"
        )


@_needs_pg
def test_pdtier_01s_work_survives_the_shim(upgraded_engine: Engine) -> None:
    """The revision's first paragraph, asserted: this does NOT undo `pdtier_01`."""
    for table in (_PARENT_TABLE, _VERSIONS_TABLE):
        tier = column_info(upgraded_engine, table, _TIER_COLUMN)
        assert tier is not None and tier[0] == "text", (
            f"coord.{table}.{_TIER_COLUMN} did not survive the shim; the "
            "boolean is back, so the enforcement path looks healthy while the "
            f"tier on {table} is silently gone"
        )
        assert tier[1] == "YES"

    assert table_exists(upgraded_engine, "coord", _KIND_TIER_TABLE), (
        f"coord.{_KIND_TIER_TABLE} did not survive the shim — nothing in the "
        "enforcement path reads it, so its loss would surface only when the "
        "coord consumer finally deploys"
    )

    # The tier CHECKs are not merely present, they are still ENFORCING. Both
    # inserts fail, so both transactions roll back and this test leaves the
    # shared database exactly as it found it.
    tenant = uuid.uuid4()
    with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
        with upgraded_engine.begin() as conn:
            conn.execute(
                text(
                    f"""
                    INSERT INTO coord.prompt_documents
                        (id, tenant_id, kind, name, body, format,
                         current_version, {_TIER_COLUMN})
                    VALUES (:id, :tenant, 'policy', 'bogus', 'b', 'markdown',
                            1, 'maybe')
                    """
                ),
                {"id": uuid.uuid4(), "tenant": tenant},
            )
    assert "ck_prompt_documents_agent_write_tier" in str(excinfo.value)

    with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
        with upgraded_engine.begin() as conn:
            conn.execute(
                text(
                    f"INSERT INTO coord.{_KIND_TIER_TABLE} "
                    "(tenant_id, kind, tier) VALUES (:tenant, 'policy', 'maybe')"
                ),
                {"tenant": tenant},
            )
    assert "ck_prompt_document_kind_tiers_tier" in str(excinfo.value)


@_needs_pg
def test_restored_comments_are_pdaw_01s_bodies_in_the_catalog(
    upgraded_engine: Engine,
) -> None:
    """Read back off the database, not off this test's own expectation."""
    parent = column_comment(upgraded_engine, _PARENT_TABLE, _LEGACY_COLUMN)
    assert parent == _pdaw_body(_PARENT_TABLE), (
        f"the restored parent comment must be pdaw_01's body verbatim; got {parent!r}"
    )
    assert parent is not None and "NULL is NOT false" in parent, (
        "the one sentence pdaw_01 exists to carry. During this shim window a "
        "three-state setting is stored in a two-state column, which is "
        "precisely when a reader is most likely to take NULL for false."
    )

    versions = column_comment(upgraded_engine, _VERSIONS_TABLE, _LEGACY_COLUMN)
    assert versions == _pdaw_body(_VERSIONS_TABLE), (
        f"the restored snapshot comment must be pdaw_01's body verbatim; got "
        f"{versions!r}"
    )
    assert versions is not None and "edited_by" in versions, (
        "the snapshot comment's job is to say why the version row is the "
        "ATTRIBUTABLE record; a paraphrase that drops edited_by drops the only "
        "reason the column is on this table at all"
    )

    # These four look subsumed by the equality above — they are not. `want` is
    # derived from pdaw_01's SOURCE, so an edit to pdaw_01 moves BOTH sides of
    # that comparison and it stays green. These name the content directly.
    assert "''" not in parent and "coord's compile-time" in parent, (
        "the apostrophes round-tripped as apostrophes. A body carrying `''` "
        "parses and stores without error, so only a read-back catches it."
    )
    assert "''" not in versions and "parent's mutable" in versions

    # And the braces survived: `{kind}/{name}` is pdaw_01's deliberate spelling
    # of a route whose `:kind/:name` form SQLAlchemy's text() would eat.
    assert "/coord/prompt-documents/{kind}/{name}" in parent


@_needs_pg
def test_backfill_maps_every_tier_state_on_both_tables() -> None:
    with ephemeral_database(admin_database_url(), "pdtier02_data") as (engine, db_url):
        # Stop at the parent so the rows exist while the tier is the only
        # setting — the ordering production was actually in.
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        assert column_info(engine, _PARENT_TABLE, _LEGACY_COLUMN) is None, (
            "the parent revision must not already carry the boolean, or this "
            "test proves nothing about the backfill"
        )

        tenant = uuid.uuid4()
        docs = _seed_tiered_documents(engine, tenant)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        for tier, want in _MAPPING.items():
            for table in (_PARENT_TABLE, _VERSIONS_TABLE):
                got = _legacy_of(engine, docs[tier], table)
                # `is`, not `==`: psycopg2 maps PG boolean to the True/False
                # singletons, and `1 == True` would pass where `1 is True`
                # will not. A driver that stopped doing so should fail here
                # loudly rather than pass on a coincidence.
                assert got is want, (
                    f"coord.{table}: tier {tier!r} restored as {got!r}, "
                    f"expected {want!r} — the two tables are migrated from one "
                    "list, and one passing is not evidence about the other"
                )

        # Restated on its own, because it is the assertion with teeth: the
        # notification tier must collapse to a REFUSAL. Mapping it to TRUE
        # would restore an unconditional grant where the operator asked for one
        # conditioned on disclosure. `is False` rather than `is not True`, which
        # NULL would also satisfy.
        for table in (_PARENT_TABLE, _VERSIONS_TABLE):
            collapsed = _legacy_of(engine, docs["allow_with_notification"], table)
            assert collapsed is False, (
                f"coord.{table}: 'allow_with_notification' must restore as "
                f"FALSE and never as TRUE, got {collapsed!r}"
            )

        # And no row without a tier gained an opinion. Tenant-scoped so an
        # unrelated seeding revision cannot break it for another reason.
        opinionated = scalar(
            engine,
            f"SELECT count(*) FROM coord.{_PARENT_TABLE} "
            f"WHERE tenant_id = :t AND {_LEGACY_COLUMN} IS NOT NULL",
            t=tenant,
        )
        assert opinionated == 3, (
            "exactly the three tiered rows may carry a restored boolean; "
            f"{opinionated} of this tenant's rows do"
        )


@_needs_pg
def test_upgrade_is_schema_idempotent_and_re_derives_the_boolean() -> None:
    """Two claims, and only the first one is "idempotent".

    Alembic re-runs no revision, so the guards are unexercised without this.
    Invoked through alembic's own ``Operations`` proxy against an
    already-upgraded database.

    The second half pins a hazard rather than a promise. A re-run recomputes
    ``agent_writable`` from ``agent_write_tier``, so any boolean the deployed
    build wrote during the window — and it writes ONLY the boolean — is
    overwritten by the tier's stale image. That is the same trap the revision's
    WARNING block hands to ``pdtier_03``, which must re-backfill in the OTHER
    direction before dropping. Asserted here so the direction of loss is a
    tested fact rather than a docstring.
    """
    with ephemeral_database(admin_database_url(), "pdtier02_rerun") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        tenant = uuid.uuid4()
        doc_id = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"""
                    INSERT INTO coord.prompt_documents
                        (id, tenant_id, kind, name, body, format,
                         current_version, {_TIER_COLUMN}, {_LEGACY_COLUMN})
                    VALUES (:id, :tenant, 'policy', 'operating-rules', 'b',
                            'markdown', 1, 'deny', TRUE)
                    """
                ),
                {"id": doc_id, "tenant": tenant},
            )

        module = _revision_module()
        with engine.begin() as conn:
            with Operations.context(MigrationContext.configure(conn)):
                module.upgrade()

        # Schema: the boolean is still there on both tables, still commented.
        for table in (_PARENT_TABLE, _VERSIONS_TABLE):
            assert column_info(engine, table, _LEGACY_COLUMN) is not None
            assert column_comment(engine, table, _LEGACY_COLUMN) == _pdaw_body(table), (
                "a re-run must leave the comment as pdaw_01's body, not mangle it"
            )

        # Data: the operator's TRUE is gone, re-derived from the 'deny' tier.
        assert _legacy_of(engine, doc_id, _PARENT_TABLE) is False, (
            "a re-run re-derives the boolean from the tier. This is the "
            "documented deploy-window hazard: the deployed build writes only "
            "the boolean, so re-running this shim — or dropping the boolean in "
            "pdtier_03 without re-backfilling the tier first — silently "
            "reverts every operator decision made during the window."
        )

        # The tier itself is never rewritten by this revision, in either
        # direction. It is the only surviving record of the pre-window state.
        assert (
            scalar(
                engine,
                f"SELECT {_TIER_COLUMN} FROM coord.{_PARENT_TABLE} WHERE id = :id",
                id=doc_id,
            )
            == "deny"
        )


@_needs_pg
def test_downgrade_drops_only_the_boolean_and_re_upgrade_restores_it() -> None:
    with ephemeral_database(admin_database_url(), "pdtier02_reverse") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        tenant = uuid.uuid4()
        docs = _seed_tiered_documents(engine, tenant)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)

        for table in (_PARENT_TABLE, _VERSIONS_TABLE):
            assert table_exists(engine, "coord", table), (
                f"downgrade dropped coord.{table} itself; it belongs to an "
                "earlier revision and must survive"
            )
            assert column_info(engine, table, _LEGACY_COLUMN) is None, (
                f"downgrade left coord.{table}.{_LEGACY_COLUMN} behind"
            )
            assert column_comment(engine, table, _LEGACY_COLUMN) is None, (
                f"coord.{table}.{_LEGACY_COLUMN}'s comment outlived its column"
            )
            assert column_info(engine, table, _TIER_COLUMN) is not None, (
                f"downgrade took coord.{table}.{_TIER_COLUMN} with it. The "
                "revision calls its downgrade lossless with respect to itself, "
                "which holds only while the tier is genuinely untouched."
            )

        assert table_exists(engine, "coord", _KIND_TIER_TABLE), (
            f"downgrade dropped coord.{_KIND_TIER_TABLE}, which belongs to "
            "pdtier_01 and is outside this revision's reach"
        )
        assert (
            scalar(
                engine,
                f"SELECT tier FROM coord.{_KIND_TIER_TABLE} "
                "WHERE tenant_id = :t AND kind = 'initiative'",
                t=tenant,
            )
            == "allow_with_notification"
        )

        # Forward again: the boolean comes back and is re-backfilled from the
        # tiers, which survived. This is the arm `migration-reversal.yml` runs
        # against an empty database, where every mapping is vacuously correct.
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for tier, want in _MAPPING.items():
            for table in (_PARENT_TABLE, _VERSIONS_TABLE):
                got = _legacy_of(engine, docs[tier], table)
                assert got is want, (
                    f"after downgrade + re-upgrade, coord.{table} tier "
                    f"{tier!r} restored as {got!r}, expected {want!r}"
                )
