"""Schema + round-trip test for the ``pdpub_01`` revision.

Phase 1 (first of two revisions) of plan
``2026-09-04-cross-tenant-policy-publishing`` creates
``coord.prompt_document_publications`` — design decision **D1**, the append-only,
immutable, TENANT-AGNOSTIC channel the system tenant publishes into and every
other tenant reads from.

Why this file exists
====================

``pdpub_01`` landed in qontinui-web#1252 with no test, which breaks the
prompt-document family's own convention: ``pdaw_01``, ``pdtier_01``,
``pdtier_02`` and ``pdann_01`` each ship one. The convention exists for the
reason ``test_pdaw_01`` states and ``test_pdtier_01`` repeats —
``migration-reversal.yml`` walks the chain against an **empty** database, so a
green reversal gate proves the SQL parses and nothing more. It asserts nothing
about which columns landed, which constraints enforce, whether an index is
ascending or descending, or whether a comment body survived. The revision's own
docstring makes eight substantive claims; before this file, every one of them
was prose.

What is asserted, and why each one can fail silently otherwise
==============================================================

1. **The table lands with EXACTLY the thirteen declared columns — and no
   ``tenant_id``.** The negative is the load-bearing half: D1's whole design is
   that the read key is ``(kind, name)`` and carries no tenant, and the rejected
   alternative it records ("downstream tenants read the system tenant's live
   row") is exactly what a stray ``tenant_id`` would re-enable. An extra column
   raises nothing and would be discovered by a reader, not by CI.
2. **``ix_prompt_document_publications_latest`` is DESCENDING.** ``index_exists``
   would be just as happy with an ascending index, and so would every query —
   just more slowly, and only under load. The revision argues at length for the
   DESC ordering (the ``MAX()`` first-row fetch and the fan-out's ``DISTINCT ON
   … ORDER BY … DESC`` reading in index order with no sort); ``pg_get_indexdef``
   is the only thing that can hold it to that.
3. **The unique index makes the per-document sequence a sequence.** Asserted in
   all three directions, because only the combination pins it: a duplicate
   ``(kind, name, publication_version)`` is refused, the SAME version number is
   accepted for a DIFFERENT document, and a different version of the same
   document is accepted. A globally-unique index on ``publication_version``
   alone would satisfy the first assertion and break the channel.
4. **``kind`` and ``format`` really do carry no CHECK of their own.** This is the
   revision's most deliberate omission — "one vocabulary, one owner", because
   ``coord_prompt_docs_02..05`` widen the kind vocabulary by discovering CHECKs
   on ``coord.prompt_documents.kind`` alone and would not see a sibling copy.
   Asserted the only way that pins it, the way ``pdtier_01`` pins the same
   property for ``prompt_document_kind_tiers``: by storing a ``kind`` and a
   ``format`` that ``coord.prompt_documents`` **rejects**, and by checking in
   the same test that it does reject them — otherwise the negative is vacuous
   the day someone widens the document CHECK.
5. **``source_tenant_id`` carries no foreign key.** "No FK to ``coord.tenants``,
   matching ``coord.prompt_documents.tenant_id``" is a deliberate call about
   coord's warn-and-continue seeding: an FK would convert a seeding-order
   accident into the inert-feature class ``coord_policy_documents_default_source``
   records. A later ``ALTER TABLE … ADD CONSTRAINT`` would be invisible here.
6. **The defaults land**: ``publication_id`` generates a UUID, ``format``
   defaults to ``'markdown'``, ``published_at`` defaults to now. A publish path
   that omits any of them is the caller this protects.
7. **The five comments land, compared against the revision's own source.** The
   table comment carries the D1 contract ("source_tenant_id is audit only and
   must never appear in a read predicate") and ``content_sha256``'s carries the
   degrade polarity that decides whether a downstream body is overwritten. A
   mangled or missing ``COMMENT ON`` raises nothing at all.
8. **``upgrade()`` is genuinely re-runnable.** Alembic will not re-run it for you
   — once ``alembic_version`` names the revision a second ``upgrade pdpub_01``
   is a no-op — so the revision's ``IF NOT EXISTS`` + unconditional-``COMMENT``
   idempotency doctrine is otherwise an unverified claim. It is invoked a second
   time here against an already-upgraded database, through alembic's own
   ``Operations`` proxy.
9. **Up → down → up destroys the table and brings it back still enforcing.**
   The downgrade is destructive by design; what must not happen is a re-upgrade
   whose unique index no longer refuses a duplicate. (The post-downgrade index
   assertions are a consistency check only — PostgreSQL drops an index with its
   table, so they follow from the table drop rather than pinning the revision's
   explicit ``DROP INDEX`` statements. That is stated at the assertion too,
   because a test that looks like it pins something it cannot is worse than an
   absent one.)

Also asserted without a database: the pinned parent equals the revision's own
``down_revision``, and ``scripts/ci/check_coord_column_drops.py`` reads the
upgrade path as dropping nothing. The second is not decoration — ``pdpub_01``
drops a ``coord.*`` table in ``downgrade()``, and the guard's rule is that the
upgrade path is *the whole module minus the ``downgrade()`` body*. Hoisting
those statements to a module-level constant, which is the tidier-looking
refactor, would make the guard demand a ``COORD_SCHEMA_DROPS`` declaration for
a drop the upgrade never makes.

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

import re
import sys
import uuid
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
    index_exists,
    load_revision_module,
    run_alembic,
    table_exists,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

# Pinned explicitly rather than "head" so a later revision landing on top cannot
# silently change what this test walks. `_PARENT_REVISION_ID` MUST equal the
# revision's own `down_revision` — the first test enforces it, because a stale
# pin rewinds too far and replays unrelated non-idempotent revisions, surfacing
# as someone else's `DuplicateTable`.
_REVISION_ID = "pdpub_01"
_PARENT_REVISION_ID = "effect_calc_01_ui_bridge_effect_columns"
_REVISION_FILENAME = "pdpub_01_prompt_document_publications.py"

_TABLE = "prompt_document_publications"
_QUALIFIED = f"coord.{_TABLE}"
_UNIQUE_INDEX = "uq_prompt_document_publications_kind_name_version"
_LATEST_INDEX = "ix_prompt_document_publications_latest"

# (column, data_type, is_nullable, column_default-fragment or None).
# Spelled out as LITERALS rather than derived from the revision, so changing the
# revision's DDL reddens this test instead of moving with it.
_EXPECTED_COLUMNS: tuple[tuple[str, str, str, str | None], ...] = (
    ("publication_id", "uuid", "NO", "gen_random_uuid()"),
    ("kind", "text", "NO", None),
    ("name", "text", "NO", None),
    ("publication_version", "integer", "NO", None),
    ("body", "text", "NO", None),
    ("format", "text", "NO", "'markdown'::text"),
    ("description", "text", "YES", None),
    ("release_note", "text", "YES", None),
    ("content_sha256", "text", "NO", None),
    ("source_tenant_id", "uuid", "NO", None),
    ("source_version", "integer", "NO", None),
    ("published_by", "text", "NO", None),
    ("published_at", "timestamp with time zone", "NO", "now()"),
)

# The four columns the revision writes a COMMENT ON for. Every other column
# in `_EXPECTED_COLUMNS` must therefore read back None — the complement is
# derived in the comments test rather than hand-listed beside this one, so
# the two cannot drift into both claiming the same column.
_COMMENTED_COLUMNS = (
    "kind",
    "publication_version",
    "content_sha256",
    "source_tenant_id",
)

# A kind and a format that `coord.prompt_documents` REJECTS. The point of both
# is that this table must accept them; the companion assertion that the document
# table refuses them lives in the same test, so neither can go vacuous alone.
_KIND_THE_DOCUMENT_CHECK_REFUSES = "not_a_prompt_document_kind"
_FORMAT_THE_DOCUMENT_CHECK_REFUSES = "asciidoc"

# Scoped to the DB-backed tests ONLY. A module-level `pytestmark` would also
# skip the source-scanning tests below, which need no database — and a run that
# skips everything is indistinguishable from a run that proves everything.
_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="test Postgres unreachable (set QONTINUI_TEST_PG=host:port)",
)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _insert(
    engine: Engine,
    *,
    kind: str = "policy",
    name: str = "coordination",
    publication_version: int = 1,
    body: str = "body",
    fmt: str | None = None,
    content_sha256: str = "0" * 64,
    source_version: int = 1,
    published_by: str = "operator:test",
) -> None:
    """Insert one publication with only the NOT NULL columns the caller cares about."""
    columns = [
        "kind",
        "name",
        "publication_version",
        "body",
        "content_sha256",
        "source_tenant_id",
        "source_version",
        "published_by",
    ]
    params: dict[str, object] = {
        "kind": kind,
        "name": name,
        "publication_version": publication_version,
        "body": body,
        "content_sha256": content_sha256,
        "source_tenant_id": str(uuid.uuid4()),
        "source_version": source_version,
        "published_by": published_by,
    }
    if fmt is not None:
        columns.append("format")
        params["format"] = fmt

    sql = (
        f"INSERT INTO {_QUALIFIED} ({', '.join(columns)}) "
        f"VALUES ({', '.join(':' + c for c in columns)})"
    )
    with engine.begin() as conn:
        conn.execute(text(sql), params)


# ---------------------------------------------------------------------------
# 1. source-only: the pin, and what the coord drop guard reads
# ---------------------------------------------------------------------------


def test_the_pinned_parent_matches_the_revisions_own_down_revision() -> None:
    """A stale pin rewinds past unrelated revisions and fails as someone else's bug."""
    source = _revision_source()
    assert re.search(rf'^revision: str = "{_REVISION_ID}"$', source, re.M), (
        f"{_REVISION_FILENAME} no longer declares revision {_REVISION_ID!r}"
    )
    match = re.search(
        r'^down_revision: str \| Sequence\[str\] \| None = "([^"]+)"$', source, re.M
    )
    assert match, "down_revision is no longer a plain string literal"
    assert match.group(1) == _PARENT_REVISION_ID


def test_the_upgrade_path_drops_no_coord_surface() -> None:
    """The table drop lives in ``downgrade()``, which the guard excludes.

    ``check_coord_column_drops.py`` scans the whole module MINUS the
    ``downgrade()`` body, so a module-level ``_DROP_TABLE`` constant — the
    tidier-looking refactor, and the one every other statement in this revision
    uses — would be read as an upgrade-path drop of ``coord.*`` and would demand
    a ``COORD_SCHEMA_DROPS`` declaration for a drop the upgrade never makes.
    That structural choice is currently defended only by a paragraph of prose.
    """
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, (
        "the guard now reads an upgrade-path coord drop in this revision: "
        f"{[(d.table, d.column) for d in scan.drops]}"
    )
    assert not scan.unresolved, (
        "the guard now reads an UNRESOLVED drop site here, which is a violation "
        f"on its own before any manifest is consulted: {scan.unresolved}"
    )


# ---------------------------------------------------------------------------
# 2. the shape the empty-database reversal gate cannot see
# ---------------------------------------------------------------------------


@_needs_pg
def test_the_table_lands_with_exactly_the_declared_columns_and_no_tenant_id() -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdpub01_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert table_exists(engine, "coord", _TABLE)

        for column, data_type, nullable, default in _EXPECTED_COLUMNS:
            info = column_info(engine, _TABLE, column)
            assert info is not None, f"{_QUALIFIED}.{column} is absent"
            assert info[0] == data_type, f"{column}: {info[0]} != {data_type}"
            assert info[1] == nullable, f"{column}: nullable {info[1]} != {nullable}"
            if default is None:
                assert info[2] is None, f"{column} gained a default: {info[2]!r}"
            else:
                assert info[2] == default, (
                    f"{column}: default {info[2]!r} != {default!r}"
                )

        # The negative that carries D1. `(kind, name)` addresses the document
        # tenant-independently; a tenant column here is the cross-tenant read the
        # revision rejected, re-admitted through the schema.
        with engine.connect() as conn:
            actual = {
                row[0]
                for row in conn.execute(
                    text(
                        """
                        SELECT column_name FROM information_schema.columns
                         WHERE table_schema = 'coord' AND table_name = :t
                        """
                    ),
                    {"t": _TABLE},
                )
            }
        assert "tenant_id" not in actual, (
            "coord.prompt_document_publications gained a tenant_id. The read key "
            "is (kind, name) and carries no tenant — see D1 and the table comment."
        )
        assert actual == {c[0] for c in _EXPECTED_COLUMNS}, (
            "column set drifted from the thirteen the revision declares: "
            f"unexpected {sorted(actual - {c[0] for c in _EXPECTED_COLUMNS})}, "
            f"missing {sorted({c[0] for c in _EXPECTED_COLUMNS} - actual)}"
        )

        # `source_tenant_id` is audit only, and deliberately unconstrained: an FK
        # to coord.tenants would turn coord's warn-and-continue seeding into a
        # hard failure. The PK is the only constraint this table is meant to have.
        with engine.connect() as conn:
            constraints = {
                (row[0], row[1])
                for row in conn.execute(
                    text(
                        """
                        SELECT conname, contype FROM pg_constraint
                         WHERE conrelid = to_regclass(:t)
                        """
                    ),
                    {"t": _QUALIFIED},
                )
            }
        assert constraints == {(f"{_TABLE}_pkey", "p")}, (
            f"unexpected constraints on {_QUALIFIED}: {sorted(constraints)}"
        )


@_needs_pg
def test_the_latest_index_is_descending_and_the_unique_index_is_unique() -> None:
    """DESC is the whole reason the second index exists; ``index_exists`` cannot see it."""
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdpub01_index") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert index_exists(engine, _UNIQUE_INDEX)
        assert index_exists(engine, _LATEST_INDEX)

        with engine.connect() as conn:
            defs = {
                row[0]: row[1]
                for row in conn.execute(
                    text(
                        """
                        SELECT indexname, indexdef FROM pg_indexes
                         WHERE schemaname = 'coord' AND tablename = :t
                        """
                    ),
                    {"t": _TABLE},
                )
            }

        assert "(kind, name, publication_version DESC)" in defs[_LATEST_INDEX], (
            "ix_prompt_document_publications_latest is no longer DESC on the "
            f"version — the MAX() read and the fan-out's DISTINCT ON both sort "
            f"without it: {defs[_LATEST_INDEX]}"
        )
        assert "UNIQUE" in defs[_UNIQUE_INDEX]
        assert "(kind, name, publication_version)" in defs[_UNIQUE_INDEX]


@_needs_pg
def test_the_unique_index_makes_the_version_a_per_document_sequence() -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdpub01_unique") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        _insert(engine, kind="policy", name="coordination", publication_version=1)

        # Two publishers cannot both claim version 1 of the same document.
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _insert(engine, kind="policy", name="coordination", publication_version=1)

        # Monotonic PER (kind, name), not global: version 1 of another document,
        # and of another kind of the same name, are both legal. A globally unique
        # index on publication_version would pass the assertion above and fail here.
        _insert(engine, kind="policy", name="testing", publication_version=1)
        _insert(
            engine, kind="agent_playbook", name="coordination", publication_version=1
        )
        _insert(engine, kind="policy", name="coordination", publication_version=2)

        with engine.connect() as conn:
            assert (
                conn.execute(text(f"SELECT count(*) FROM {_QUALIFIED}")).scalar() == 4
            )


@_needs_pg
def test_kind_and_format_carry_no_check_of_their_own() -> None:
    """One vocabulary, one owner — and the negative is kept honest.

    ``coord_prompt_docs_02..05`` widen the kind vocabulary by discovering and
    re-adding CHECKs on ``coord.prompt_documents.kind``; a sibling copy on this
    table would be invisible to that loop and would raise a 23514 at publish
    time on a document the store itself considers legal. The complementary
    assertion — that the document table really does refuse these two values — is
    in the same test, so widening the document CHECK cannot quietly turn the
    negative into a tautology.
    """
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdpub01_nocheck") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        # The channel accepts both.
        _insert(
            engine,
            kind=_KIND_THE_DOCUMENT_CHECK_REFUSES,
            name="whatever",
            fmt=_FORMAT_THE_DOCUMENT_CHECK_REFUSES,
        )

        # The document store does not — which is what makes the above meaningful.
        document = (
            "INSERT INTO coord.prompt_documents "
            "(tenant_id, name, kind, body, format) "
            "VALUES (:tenant, :name, :kind, 'b', :format)"
        )
        for kind, fmt in (
            (_KIND_THE_DOCUMENT_CHECK_REFUSES, "markdown"),
            ("policy", _FORMAT_THE_DOCUMENT_CHECK_REFUSES),
        ):
            with pytest.raises(sqlalchemy.exc.IntegrityError):
                with engine.begin() as conn:
                    conn.execute(
                        text(document),
                        {
                            "tenant": str(uuid.uuid4()),
                            "name": f"probe-{kind}-{fmt}",
                            "kind": kind,
                            "format": fmt,
                        },
                    )


@_needs_pg
def test_the_defaults_land() -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdpub01_defaults") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        _insert(engine, kind="policy", name="testing", publication_version=1)

        with engine.connect() as conn:
            row = conn.execute(
                text(
                    f"""
                    SELECT publication_id, format,
                           published_at IS NOT NULL,
                           published_at BETWEEN now() - interval '1 hour'
                                            AND now() + interval '1 hour'
                      FROM {_QUALIFIED}
                    """
                )
            ).one()

        assert isinstance(row[0], uuid.UUID)
        assert row[1] == "markdown"
        assert row[2] is True
        assert row[3] is True, "published_at did not default to wall-clock now()"


@_needs_pg
def test_the_comments_land_verbatim_from_the_revision_source() -> None:
    """A mangled or missing ``COMMENT ON`` raises nothing, so it is read back.

    Compared against the revision's own source rather than a copy here: the
    bodies carry the D1 audit-only contract and the degrade polarity that
    decides whether a downstream body is overwritten, and a second copy of a
    contract is the divergence this comparison exists to catch.
    """
    admin_url = admin_database_url()
    source = _revision_source()
    with ephemeral_database(admin_url, "pdpub01_comments") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        with engine.connect() as conn:
            table_comment = conn.execute(
                text("SELECT obj_description(to_regclass(:t), 'pg_class')"),
                {"t": _QUALIFIED},
            ).scalar()
        assert table_comment == comment_body_from_source(
            source, _QUALIFIED, object_kind="TABLE"
        )

        for column in _COMMENTED_COLUMNS:
            assert column_comment(engine, _TABLE, column) == comment_body_from_source(
                source, f"{_QUALIFIED}.{column}"
            ), f"{column}'s comment does not match the revision that writes it"

        # EVERY other column stays uncommented — the complement, derived from
        # `_EXPECTED_COLUMNS` rather than hand-listed, so a comment attached to
        # the wrong column is caught wherever it lands rather than only in the
        # handful someone remembered to name here.
        for column, *_ in _EXPECTED_COLUMNS:
            if column in _COMMENTED_COLUMNS:
                continue
            assert column_comment(engine, _TABLE, column) is None, (
                f"{column} gained a comment the revision does not write"
            )


# ---------------------------------------------------------------------------
# 3. the two walks: re-run, and up → down → up
# ---------------------------------------------------------------------------


@_needs_pg
def test_upgrade_is_re_runnable_over_an_already_upgraded_database() -> None:
    """Alembic will not re-run it, so the idempotency doctrine is otherwise unverified.

    The revision leans on ``CREATE TABLE IF NOT EXISTS`` + ``CREATE INDEX IF NOT
    EXISTS`` and re-applies every ``COMMENT ON`` unconditionally — the second
    half being how the comments survive a re-run that found the table already
    present. Both are exercised here by invoking ``upgrade()`` directly through
    alembic's ``Operations`` proxy against a database already at ``pdpub_01``.
    """
    admin_url = admin_database_url()
    source = _revision_source()
    with ephemeral_database(admin_url, "pdpub01_rerun") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        _insert(engine, kind="policy", name="coordination", publication_version=1)

        # Strip a comment first, so the re-run has something to repair and the
        # "re-applied unconditionally" claim is tested rather than assumed.
        with engine.begin() as conn:
            conn.execute(text(f"COMMENT ON COLUMN {_QUALIFIED}.kind IS NULL"))
        assert column_comment(engine, _TABLE, "kind") is None

        module = load_revision_module(_revision_path(), "pdpub_01_rerun")
        with engine.begin() as conn:
            context = MigrationContext.configure(conn)
            with Operations.context(context):
                module.upgrade()

        assert table_exists(engine, "coord", _TABLE)
        assert index_exists(engine, _UNIQUE_INDEX)
        assert index_exists(engine, _LATEST_INDEX)
        assert column_comment(engine, _TABLE, "kind") == comment_body_from_source(
            source, f"{_QUALIFIED}.kind"
        )
        with engine.connect() as conn:
            assert (
                conn.execute(text(f"SELECT count(*) FROM {_QUALIFIED}")).scalar() == 1
            )


@_needs_pg
def test_up_down_up_removes_the_table_and_restores_it_still_enforcing() -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdpub01_reverse") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert(engine, kind="policy", name="coordination", publication_version=1)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)

        # Destructive by design, and it must leave nothing behind.
        #
        # Honest about what the two index assertions do and do not pin:
        # PostgreSQL drops an index WITH its table, so once the table is gone
        # they follow, and removing the revision's explicit `DROP INDEX`
        # statements does not redden them (measured). They are kept as a cheap
        # consistency check on the whole reversal, NOT as evidence for those
        # statements — those are defensive against a half-applied upgrade, a
        # state no test here can construct, and the property that IS falsifiable
        # is the table drop itself.
        assert not table_exists(engine, "coord", _TABLE)
        assert not index_exists(engine, _UNIQUE_INDEX)
        assert not index_exists(engine, _LATEST_INDEX)

        # The tables this revision did not create are untouched.
        assert table_exists(engine, "coord", "prompt_documents")
        assert table_exists(engine, "coord", "prompt_document_versions")

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert table_exists(engine, "coord", _TABLE)
        assert index_exists(engine, _UNIQUE_INDEX)
        assert index_exists(engine, _LATEST_INDEX)

        # The re-created table is empty (the bodies live nowhere else — the
        # revision says so) and the unique index still refuses a duplicate.
        with engine.connect() as conn:
            assert (
                conn.execute(text(f"SELECT count(*) FROM {_QUALIFIED}")).scalar() == 0
            )
        _insert(engine, kind="policy", name="coordination", publication_version=1)
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _insert(engine, kind="policy", name="coordination", publication_version=1)
