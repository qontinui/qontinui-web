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
   FALSE**. The last is the security-relevant one and it is asserted twice: once
   for the value, once for ``is not True``. A collapse to TRUE would restore an
   *unconditional* grant where the operator asked for one conditioned on
   disclosure — a repair that silently widens authority.
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
"""

from __future__ import annotations

import importlib.util
import re
import uuid
from pathlib import Path
from types import ModuleType

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
    ephemeral_database,
    run_alembic,
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

# A SQL string literal, with `''` as the escaped apostrophe. Used to reassemble
# `pdaw_01`'s adjacent-literal comment bodies.
_SQL_LITERAL = re.compile(r"'((?:[^']|'')*)'")


def _versions_dir() -> Path:
    return backend_root() / "alembic" / "versions"


def _revision_path() -> Path:
    return _versions_dir() / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _load_revision_module() -> ModuleType:
    """Import the revision file directly, so ``upgrade()`` can be re-invoked.

    Alembic's own runner will not do this: once ``alembic_version`` names the
    revision, a second ``upgrade pdtier_02`` is a no-op. Loading the module by
    path is the only way to exercise the guards the revision relies on.
    """
    spec = importlib.util.spec_from_file_location(
        "pdtier_02_revision", _revision_path()
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _pdaw_comment_body(qualified_column: str) -> str:
    """``pdaw_01``'s ``COMMENT ON COLUMN`` body for ``qualified_column``.

    Reassembled from that revision's SOURCE — PostgreSQL concatenates adjacent
    string literals separated by a newline, and `pdaw_01` writes each body as
    one such run. The doubled apostrophes are collapsed the way the SQL parser
    collapses them, so the result is what ``col_description`` will return.

    Deliberately not a constant in this file: the whole assertion is that ONE
    author owns these bodies, and a copy here would be the second one.
    """
    source = (_versions_dir() / _PDAW_FILENAME).read_text(encoding="utf-8")
    marker = f"COMMENT ON COLUMN {qualified_column} IS"
    start = source.find(marker)
    assert start >= 0, (
        f"{_PDAW_FILENAME} no longer contains {marker!r}; this test can no "
        "longer derive the body it compares against"
    )
    start += len(marker)
    end = source.find('"""', start)
    assert end > start, f"unterminated COMMENT block for {qualified_column}"

    parts = _SQL_LITERAL.findall(source[start:end])
    assert parts, f"no SQL string literals found after {marker!r}"
    return "".join(part.replace("''", "'") for part in parts)


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


def _scalar(engine: Engine, sql: str, **params: object) -> object:
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar_one()


def _column_comment(engine: Engine, table: str, column: str) -> str | None:
    return _scalar(  # type: ignore[return-value]
        engine,
        """
        SELECT col_description(att.attrelid, att.attnum)
          FROM pg_attribute att
         WHERE att.attrelid = to_regclass('coord.' || :table)
           AND att.attname = :column
           AND att.attnum > 0
           AND NOT att.attisdropped
        """,
        table=table,
        column=column,
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


def _legacy_of(engine: Engine, doc_id: uuid.UUID, table: str) -> object:
    if table == _PARENT_TABLE:
        return _scalar(
            engine,
            f"SELECT {_LEGACY_COLUMN} FROM coord.{_PARENT_TABLE} WHERE id = :id",
            id=doc_id,
        )
    return _scalar(
        engine,
        f"""
        SELECT {_LEGACY_COLUMN} FROM coord.{_VERSIONS_TABLE}
         WHERE document_id = :doc AND version_number = 1
        """,
        doc=doc_id,
    )


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

    drop_lines = [
        line
        for line in source.splitlines()
        if "DROP COLUMN" in line
        and "ALTER TABLE" in line
        and not line.lstrip().startswith("#")
    ]
    assert len(drop_lines) == 1, (
        "expected exactly one DROP COLUMN statement — the downgrade's, applied "
        f"to both tables from one list; found {len(drop_lines)}: {drop_lines!r}"
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
    module = _load_revision_module()
    template = module._BACKFILL

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


def test_comment_bodies_are_pdaw_01s_verbatim_in_source() -> None:
    """The cheap half of the comment check; the DB test is the half that binds.

    Checked at source level too because this is the failure that already
    happened once: two plausible paraphrases, no error, no diff in behaviour,
    and the catalog quietly stops saying "NULL is NOT false" on a column whose
    NULL is not false.
    """
    module = _load_revision_module()

    for table, column in (
        (_PARENT_TABLE, f"coord.{_PARENT_TABLE}.{_LEGACY_COLUMN}"),
        (_VERSIONS_TABLE, f"coord.{_VERSIONS_TABLE}.{_LEGACY_COLUMN}"),
    ):
        want = _pdaw_comment_body(column)
        got = module._COMMENTS[f"coord.{table}"]
        assert got == want, (
            f"coord.{table}.{_LEGACY_COLUMN}'s restored comment is not "
            f"{_PDAW_FILENAME}'s body.\n  want: {want!r}\n  got:  {got!r}"
        )
        assert "''" not in got, (
            "apostrophes are doubled by _comment_sql at format time; storing "
            "the doubled form here would put `''` in the catalog verbatim"
        )
        assert not re.search(r":[a-zA-Z_]", got), (
            "op.execute routes a plain string through SQLAlchemy's text(), "
            "which reads `:word` as a bind parameter — pdaw_01 spells the "
            "route {kind}/{name} for exactly this reason"
        )


@_needs_pg
def test_boolean_is_restored_on_both_tables_with_pdaw_01s_shape() -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdtier02_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        for table in (_PARENT_TABLE, _VERSIONS_TABLE):
            restored = _column(engine, table, _LEGACY_COLUMN)
            assert restored is not None, (
                f"coord.{table}.{_LEGACY_COLUMN} was not restored. A "
                "parent-only shim makes the enforcement read work again, so "
                "nothing would point at the snapshot half still being absent."
            )
            data_type, is_nullable, default = restored
            assert data_type == "boolean", (
                f"coord.{table}.{_LEGACY_COLUMN} is {data_type!r}. ADD COLUMN "
                "IF NOT EXISTS is type-blind, so a pre-existing column of "
                "another type makes the ADD a silent no-op."
            )
            assert is_nullable == "YES", (
                f"coord.{table}.{_LEGACY_COLUMN} must stay NULLABLE: NULL is "
                "'no operator opinion', the state coord's compile-time default "
                "resolves"
            )
            assert default is None, (
                f"coord.{table}.{_LEGACY_COLUMN} must have NO default — a "
                "DEFAULT would give every unset row an operator opinion it "
                "never had, on the column the enforcement read consults"
            )


@_needs_pg
def test_pdtier_01s_work_survives_the_shim() -> None:
    """The revision's first paragraph, asserted: this does NOT undo `pdtier_01`."""
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdtier02_survive") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        for table in (_PARENT_TABLE, _VERSIONS_TABLE):
            tier = _column(engine, table, _TIER_COLUMN)
            assert tier is not None and tier[0] == "text", (
                f"coord.{table}.{_TIER_COLUMN} did not survive the shim; the "
                "boolean is back, so the enforcement path looks healthy while "
                f"the tier {table} is silently gone"
            )
            assert tier[1] == "YES"

        assert table_exists(engine, "coord", _KIND_TIER_TABLE), (
            f"coord.{_KIND_TIER_TABLE} did not survive the shim — nothing in "
            "the enforcement path reads it, so its loss would surface only "
            "when the coord consumer finally deploys"
        )

        # The tier CHECKs are not merely present, they are still ENFORCING.
        tenant = uuid.uuid4()
        with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        f"""
                        INSERT INTO coord.prompt_documents
                            (id, tenant_id, kind, name, body, format,
                             current_version, {_TIER_COLUMN})
                        VALUES (:id, :tenant, 'policy', 'bogus', 'b',
                                'markdown', 1, 'maybe')
                        """
                    ),
                    {"id": uuid.uuid4(), "tenant": tenant},
                )
        assert "ck_prompt_documents_agent_write_tier" in str(excinfo.value)

        with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        f"INSERT INTO coord.{_KIND_TIER_TABLE} "
                        "(tenant_id, kind, tier) "
                        "VALUES (:tenant, 'policy', 'maybe')"
                    ),
                    {"tenant": tenant},
                )
        assert "ck_prompt_document_kind_tiers_tier" in str(excinfo.value)


@_needs_pg
def test_backfill_maps_every_tier_state_on_both_tables() -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdtier02_data") as (engine, db_url):
        # Stop at the parent so the rows exist while the tier is the only
        # setting — the ordering production was actually in.
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        assert _column(engine, _PARENT_TABLE, _LEGACY_COLUMN) is None, (
            "the parent revision must not already carry the boolean, or this "
            "test proves nothing about the backfill"
        )

        tenant = uuid.uuid4()
        docs = _seed_tiered_documents(engine, tenant)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        for tier, want in _MAPPING.items():
            for table in (_PARENT_TABLE, _VERSIONS_TABLE):
                got = _legacy_of(engine, docs[tier], table)
                assert got is want, (
                    f"coord.{table}: tier {tier!r} restored as {got!r}, "
                    f"expected {want!r} — the two tables are migrated from one "
                    "list, and one passing is not evidence about the other"
                )

        # Restated on its own, because it is the assertion with teeth: the
        # notification tier must collapse to a REFUSAL. Mapping it to TRUE
        # would restore an unconditional grant where the operator asked for one
        # conditioned on disclosure — a repair that widens authority.
        for table in (_PARENT_TABLE, _VERSIONS_TABLE):
            collapsed = _legacy_of(engine, docs["allow_with_notification"], table)
            assert collapsed is not True, (
                f"coord.{table}: 'allow_with_notification' must never restore "
                f"as TRUE, got {collapsed!r}"
            )
            assert collapsed is False

        # And no row without a tier gained an opinion. Tenant-scoped so an
        # unrelated seeding revision cannot break it for another reason.
        opinionated = _scalar(
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
def test_restored_comments_are_pdaw_01s_bodies_in_the_catalog() -> None:
    """Read back off the database, not off this test's own expectation."""
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdtier02_comments") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        parent = _column_comment(engine, _PARENT_TABLE, _LEGACY_COLUMN)
        assert parent == _pdaw_comment_body(
            f"coord.{_PARENT_TABLE}.{_LEGACY_COLUMN}"
        ), (
            "the restored parent comment must be pdaw_01's body verbatim; got "
            f"{parent!r}"
        )
        assert parent is not None and "NULL is NOT false" in parent, (
            "the one sentence pdaw_01 exists to carry. During this shim window "
            "a three-state setting is stored in a two-state column, which is "
            "precisely when a reader is most likely to take NULL for false."
        )

        versions = _column_comment(engine, _VERSIONS_TABLE, _LEGACY_COLUMN)
        assert versions == _pdaw_comment_body(
            f"coord.{_VERSIONS_TABLE}.{_LEGACY_COLUMN}"
        ), (
            "the restored snapshot comment must be pdaw_01's body verbatim; "
            f"got {versions!r}"
        )
        assert versions is not None and "edited_by" in versions, (
            "the snapshot comment's job is to say why the version row is the "
            "ATTRIBUTABLE record; a paraphrase that drops edited_by drops the "
            "only reason the column is on this table at all"
        )

        # The apostrophes round-tripped as apostrophes. A body carrying `''`
        # parses and stores without error, so nothing but a read-back catches it.
        assert parent is not None and "''" not in parent
        assert "coord's compile-time" in parent
        assert "''" not in versions and "parent's mutable" in versions

        # And the braces survived: `{kind}/{name}` is pdaw_01's deliberate
        # spelling of a route whose `:kind/:name` form would be eaten as bind
        # parameters by SQLAlchemy's text().
        assert "/coord/prompt-documents/{kind}/{name}" in parent


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
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdtier02_rerun") as (engine, db_url):
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

        module = _load_revision_module()
        with engine.begin() as conn:
            with Operations.context(MigrationContext.configure(conn)):
                module.upgrade()

        # Schema: still exactly one boolean per table, still commented.
        for table in (_PARENT_TABLE, _VERSIONS_TABLE):
            assert _column(engine, table, _LEGACY_COLUMN) is not None
            assert _column_comment(engine, table, _LEGACY_COLUMN) == (
                _pdaw_comment_body(f"coord.{table}.{_LEGACY_COLUMN}")
            ), "a re-run must leave the comment as pdaw_01's body, not mangle it"

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
            _scalar(
                engine,
                f"SELECT {_TIER_COLUMN} FROM coord.{_PARENT_TABLE} WHERE id = :id",
                id=doc_id,
            )
            == "deny"
        )


@_needs_pg
def test_downgrade_drops_only_the_boolean_and_re_upgrade_restores_it() -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdtier02_reverse") as (engine, db_url):
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
            assert _column(engine, table, _LEGACY_COLUMN) is None, (
                f"downgrade left coord.{table}.{_LEGACY_COLUMN} behind"
            )
            assert _column(engine, table, _TIER_COLUMN) is not None, (
                f"downgrade took coord.{table}.{_TIER_COLUMN} with it. The "
                "revision calls its downgrade lossless with respect to itself, "
                "which holds only while the tier is genuinely untouched."
            )

        assert table_exists(engine, "coord", _KIND_TIER_TABLE), (
            f"downgrade dropped coord.{_KIND_TIER_TABLE}, which belongs to "
            "pdtier_01 and is outside this revision's reach"
        )
        assert (
            _scalar(
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
