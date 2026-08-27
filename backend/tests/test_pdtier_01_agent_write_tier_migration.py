"""Schema + round-trip test for the ``pdtier_01`` revision.

Phase 1 of plan
``D:/qontinui-root/plans/2026-08-27-tenant-level-agent-authorable-stores.md``
turns the two-state ``coord.prompt_documents.agent_writable`` boolean into a
three-state ``agent_write_tier`` text column (``deny`` / ``allow`` /
``allow_with_notification``) and adds ``coord.prompt_document_kind_tiers``, the
per-``(tenant, kind)`` setting.

Modelled on ``test_pdaw_01_agent_writable_migration.py``, for the reason that
test states: ``migration-reversal.yml`` walks the chain against an EMPTY
database, so it proves the SQL parses and nothing more — no row exists there to
survive a round-trip, and it asserts nothing about which tables gained which
columns. Every assertion below covers something a green ``upgrade`` cannot see.

What is asserted, and why each one can fail silently otherwise:

1. **Both tables get the tier, and neither keeps the boolean.** The versions
   table's own ``COMMENT ON TABLE`` makes the widen-both rule standing law —
   *"a partial snapshot is an audit trail that lies while still reporting as
   versioned"* — and a parent-only replacement produces no error and no warning.
   Delete-over-deprecate means the boolean must be **gone**, not merely
   superseded: two columns spelling the same authority is the two-column
   disagreement the plan's design section forbids by name.
2. **The type is exactly ``text``, nullable, no default.** ``ADD COLUMN IF NOT
   EXISTS`` is type-blind (it matches on name alone), and ``NULL`` remains the
   third state that routes the decision down the resolution order. A ``DEFAULT
   'deny'`` would freeze the whole corpus; a ``DEFAULT 'allow'`` would open the
   three meta-policies.
3. **The boolean→tier data migration maps all three input states.** ``TRUE →
   'allow'``, ``FALSE → 'deny'``, ``NULL → NULL``. The NULL arm is the one that
   silently breaks things: a migration that wrote ``'deny'`` for unset rows
   would freeze coord's compile-time default into data, exactly the backfill
   ``pdaw_01`` refused to do.
4. **The CHECK actually rejects a bogus tier** — on the parent, on the snapshot,
   and on the new table. A vocabulary column with no constraint is a text column
   with a docstring.
5. **``prompt_document_kind_tiers.kind`` really is unconstrained.** Asserted the
   only way that pins it: by storing a kind the document CHECK does **not**
   admit. Storing the thirteen it does admit would pass just as happily against
   a sibling ``CHECK (kind IN …)``, so that assertion alone would prove nothing
   — it is kept as the complementary half (every real kind is settable) and the
   negative case is what makes "one vocabulary, one owner" a tested property.
6. **The comments land.** ``pdtier_01`` promotes ``COMMENT ON`` from side-effect
   to deliverable — its downgrade exists partly to restore ``pdaw_01``'s two
   comment bodies — and a comment statement is also the only place the
   revision's own ``:word`` bind-parameter hazard can manifest. A mangled or
   missing comment raises nothing, so it is read back explicitly.
7. **The downgrade restores the boolean with the inverse mapping, and is lossy
   in exactly the documented direction.** ``'allow' → TRUE``, ``'deny' →
   FALSE``, and ``'allow_with_notification' → FALSE`` — the collapse a boolean
   cannot avoid. Asserted rather than merely commented, because the alternative
   collapse (``→ TRUE``) would make a downgrade silently WIDEN authority, and
   nothing else in the chain would catch it.
8. **Up → down → up leaves no residue, keeps its constraints, and destroys no
   rows.** Both pre-existing tables survive, the document and version rows
   survive, the new table is gone after the downgrade and back after the
   re-upgrade — with its CHECK still enforcing, which is the whole reason the
   revision uses drop-then-add pairs instead of inline constraints.
9. **``upgrade()`` is genuinely re-runnable.** Alembic will not re-run it for
   you (the version table makes a second ``upgrade pdtier_01`` a no-op), so the
   revision's three-paragraph idempotency doctrine is otherwise an unverified
   claim. It is invoked a second time here against an already-upgraded database,
   through alembic's own ``Operations`` proxy.

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
# revision's own `down_revision` — the first test enforces it, because a stale
# pin rewinds too far and replays unrelated non-idempotent revisions, surfacing
# as someone else's `DuplicateTable`.
_REVISION_ID = "pdtier_01"
_PARENT_REVISION_ID = "ffland_headsync_01"
_REVISION_FILENAME = "pdtier_01_prompt_document_agent_write_tier.py"

_PARENT_TABLE = "prompt_documents"
_VERSIONS_TABLE = "prompt_document_versions"
_KIND_TIER_TABLE = "prompt_document_kind_tiers"
_KIND_TIER_CHECK = "ck_prompt_document_kind_tiers_tier"

_TIER_COLUMN = "agent_write_tier"
_LEGACY_COLUMN = "agent_writable"
_EXPECTED_TYPE = "text"

_TIERS = ("deny", "allow", "allow_with_notification")

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
    """Import the revision file directly, so ``upgrade()`` can be re-invoked.

    Alembic's own runner will not do this: once ``alembic_version`` names the
    revision, a second ``upgrade pdtier_01`` is a no-op. Loading the module by
    path is the only way to exercise the idempotency the docstring promises.
    """
    spec = importlib.util.spec_from_file_location(
        "pdtier_01_revision", _revision_path()
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


def _insert_document(
    engine: Engine, tenant: uuid.UUID, name: str, *, legacy: bool | None
) -> uuid.UUID:
    """Insert a document + its version-1 snapshot carrying ``agent_writable``."""
    doc_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.prompt_documents
                    (id, tenant_id, kind, name, body, format, current_version,
                     agent_writable)
                VALUES (:id, :tenant, 'policy', :name, 'body', 'markdown', 1,
                        :legacy)
                """
            ),
            {"id": doc_id, "tenant": tenant, "name": name, "legacy": legacy},
        )
        conn.execute(
            text(
                """
                INSERT INTO coord.prompt_document_versions
                    (document_id, version_number, body, agent_writable)
                VALUES (:doc, 1, 'body', :legacy)
                """
            ),
            {"doc": doc_id, "legacy": legacy},
        )
    return doc_id


def _kind_vocabulary(engine: Engine) -> list[str]:
    """Every kind ``ck_prompt_documents_kind`` currently admits, read live.

    Read out of ``pg_get_constraintdef`` rather than copied into this file: the
    whole point of the kind assertions is that ONE list owns the vocabulary, and
    a test carrying its own copy would be the second list it exists to forbid.

    De-duplicated, because the caller inserts one row per kind into a table with
    a ``(tenant_id, kind)`` primary key: a duplicate from a future constraint
    spelling would surface as a PK ``IntegrityError`` that reads like a schema
    bug rather than like a parse bug.
    """
    definition = _scalar(
        engine,
        """
        SELECT pg_get_constraintdef(con.oid)
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
         WHERE nsp.nspname = 'coord'
           AND rel.relname = 'prompt_documents'
           AND con.contype = 'c'
           AND EXISTS (
               SELECT 1
                 FROM unnest(con.conkey) AS k(attnum)
                 JOIN pg_attribute att
                   ON att.attrelid = con.conrelid
                  AND att.attnum = k.attnum
                WHERE att.attname = 'kind'
           )
        """,
    )
    assert isinstance(definition, str), "no CHECK found on coord.prompt_documents.kind"
    kinds = sorted(set(re.findall(r"'([a-z_]+)'", definition)))
    assert len(kinds) >= 13, (
        f"expected at least the thirteen kinds coord_prompt_docs_05 admits, "
        f"parsed {kinds!r} out of {definition!r}"
    )
    return kinds


def test_pin_matches_the_revisions_own_down_revision() -> None:
    """A stale `_PARENT_REVISION_ID` rewinds too far and replays foreign DDL."""
    source = _revision_source()
    assert (
        f'down_revision: str | Sequence[str] | None = "{_PARENT_REVISION_ID}"' in source
    ), (
        f"{_REVISION_FILENAME}'s down_revision no longer matches this test's pin "
        f"({_PARENT_REVISION_ID}); update the pin deliberately, not by guessing"
    )
    assert f'revision: str = "{_REVISION_ID}"' in source


def test_ddl_names_the_vocabulary_and_the_tables_exactly_once() -> None:
    """One tier list and one table list is what makes drift unrepresentable."""
    source = _revision_source()

    assert (
        '_TIERS: tuple[str, ...] = ("deny", "allow", "allow_with_notification")'
        in source
    ), (
        "the tier vocabulary must be spelled once, as _TIERS — every CHECK in "
        "the revision is built from it, and a second literal list is how the "
        "parent, the snapshot and the kind table come to disagree"
    )
    assert '_TIER_COLUMN = "agent_write_tier"' in source
    assert '_TIER_SQL_TYPE = "TEXT"' in source
    assert '"coord.prompt_documents",' in source
    assert '"coord.prompt_document_versions",' in source

    # NULL is a third state; a DEFAULT would collapse it. Match on the f-string
    # placeholder form (`… IF NOT EXISTS {`), not the bare phrase: the module
    # docstring discusses `ADD COLUMN IF NOT EXISTS` in prose (it explains why
    # the form is type-blind), and counting those makes this assertion wrong for
    # a reason that has nothing to do with the DDL.
    add_lines = [
        line
        for line in source.splitlines()
        if "ADD COLUMN IF NOT EXISTS {" in line and not line.lstrip().startswith("#")
    ]
    assert len(add_lines) == 2, (
        "expected exactly TWO ADD COLUMN templates — one for the tier (upgrade) "
        "and one for the restored boolean (downgrade), each applied to both "
        f"tables from a single list; found {len(add_lines)}: {add_lines!r}"
    )
    for line in add_lines:
        assert "DEFAULT" not in line.upper(), (
            f"the ADD COLUMN template must not attach a DEFAULT: {line!r}. NULL "
            "means 'no operator opinion' and routes down the resolution order; "
            "DEFAULT 'deny' freezes the whole corpus and DEFAULT 'allow' opens "
            "the three meta-policies."
        )
        assert "NOT NULL" not in line.upper(), (
            f"the ADD COLUMN template must stay nullable: {line!r}"
        )

    # Delete-over-deprecate, and the guard/drop pairing that makes it safe. The
    # DROP must live INSIDE the same guarded block that migrated the data: a
    # guard that evaluates false while the column exists, next to an
    # unconditional DROP, discards every operator opinion with no error and no
    # log line. Read off the module's own constants rather than off the source
    # text, so a reformatting cannot break the assertion and a rename cannot
    # slip past it.
    module = _load_revision_module()
    for name, template in (
        ("_MIGRATE_AND_DROP_LEGACY", module._MIGRATE_AND_DROP_LEGACY),
        ("_UNMIGRATE_AND_DROP_TIER", module._UNMIGRATE_AND_DROP_TIER),
    ):
        assert "UPDATE" in template and "DROP COLUMN" in template, (
            f"{name} must carry BOTH the data migration and the drop, under one "
            "predicate — splitting them lets guard and drop disagree"
        )
        assert "pg_attribute" in template and "to_regclass" in template, (
            f"{name}'s existence predicate must read pg_catalog: "
            f"information_schema is privilege-filtered, which makes it a "
            f"false-negative source in front of a destructive branch"
        )
        assert "information_schema" not in template, (
            f"{name} must not gate a DROP on privilege-filtered metadata"
        )

    # ...and there is no THIRD, unguarded DROP COLUMN anywhere in the file. Two
    # is the whole budget: one per table, both inside the templates above. (The
    # filter skips `#` comment lines; the module docstring's prose mention of
    # dropping a column carries no `ALTER TABLE`, so it never matches.)
    drop_lines = [
        line
        for line in source.splitlines()
        if "DROP COLUMN" in line
        and "ALTER TABLE" in line
        and not line.lstrip().startswith("#")
    ]
    assert len(drop_lines) == 2, (
        "expected exactly two DROP COLUMN statements, both inside the guarded "
        f"templates above; found {len(drop_lines)}: {drop_lines!r}"
    )

    # The kind column must NOT carry a second copy of the kind vocabulary. This
    # is the cheap half of the check; `test_kind_column_is_unconstrained_text`
    # is the half that actually pins the behaviour.
    assert "CHECK (kind IN" not in source, (
        "coord.prompt_document_kind_tiers.kind must stay unconstrained TEXT: a "
        "sibling CHECK is invisible to the discover-and-drop loop that widens "
        "ck_prompt_documents_kind, so the next kind added would be accepted by "
        "the document store and rejected by its own tier table"
    )


@_needs_pg
def test_tier_replaces_the_boolean_on_both_tables() -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdtier01_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        for table in (_PARENT_TABLE, _VERSIONS_TABLE):
            assert table_exists(engine, "coord", table), f"coord.{table} missing"

            found = _column(engine, table, _TIER_COLUMN)
            assert found is not None, (
                f"coord.{table}.{_TIER_COLUMN} was not added. A parent-only "
                "replacement produces no error and no warning — this assertion "
                "is the only thing that catches it."
            )
            data_type, is_nullable, default = found
            assert data_type == _EXPECTED_TYPE, (
                f"coord.{table}.{_TIER_COLUMN} is {data_type!r}, expected "
                f"{_EXPECTED_TYPE!r}. ADD COLUMN IF NOT EXISTS is type-blind, so "
                "a pre-existing column of the wrong type makes the ADD a silent "
                "no-op."
            )
            assert is_nullable == "YES", (
                f"coord.{table}.{_TIER_COLUMN} must be NULLABLE: NULL is the "
                "third state ('no operator opinion') that routes the decision "
                "to the per-kind setting and then to coord's compile-time "
                "default."
            )
            assert default is None, (
                f"coord.{table}.{_TIER_COLUMN} must have NO default: a DEFAULT "
                "'deny' silently freezes the whole corpus, a DEFAULT 'allow' "
                "silently opens the three meta-policies."
            )

            assert _column(engine, table, _LEGACY_COLUMN) is None, (
                f"coord.{table}.{_LEGACY_COLUMN} survived the upgrade. "
                "Delete-over-deprecate: two columns spelling the same authority "
                "is the two-column disagreement this revision exists to remove."
            )


@_needs_pg
def test_kind_tier_table_shape() -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdtier01_kindtbl") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert table_exists(engine, "coord", _KIND_TIER_TABLE), (
            f"coord.{_KIND_TIER_TABLE} was not created"
        )

        tenant = _column(engine, _KIND_TIER_TABLE, "tenant_id")
        assert tenant is not None and tenant[0] == "uuid" and tenant[1] == "NO"

        kind = _column(engine, _KIND_TIER_TABLE, "kind")
        assert kind is not None and kind[0] == "text" and kind[1] == "NO"

        tier = _column(engine, _KIND_TIER_TABLE, "tier")
        assert tier is not None and tier[0] == "text", (
            f"coord.{_KIND_TIER_TABLE}.tier must be text, got {tier!r}"
        )
        assert tier[1] == "NO", (
            "tier must be NOT NULL: absence of a row already spells 'no "
            "opinion', so a nullable tier would be a second, redundant spelling "
            "of the same fact"
        )

        updated_at = _column(engine, _KIND_TIER_TABLE, "updated_at")
        assert updated_at is not None
        assert updated_at[0] == "timestamp with time zone"
        assert updated_at[1] == "NO"
        assert updated_at[2] is not None and "now()" in updated_at[2]

        updated_by = _column(engine, _KIND_TIER_TABLE, "updated_by")
        assert updated_by is not None and updated_by[0] == "text"
        assert updated_by[1] == "YES", "updated_by is a record, not a requirement"

        # Composite PK on (tenant_id, kind) — the only thing that makes two
        # conflicting tiers for one (tenant, kind) unrepresentable.
        with engine.connect() as conn:
            pk_cols = [
                r[0]
                for r in conn.execute(
                    text(
                        """
                        SELECT att.attname
                          FROM pg_constraint con
                          JOIN pg_class rel ON rel.oid = con.conrelid
                          JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                          JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
                            ON TRUE
                          JOIN pg_attribute att
                            ON att.attrelid = con.conrelid
                           AND att.attnum = k.attnum
                         WHERE nsp.nspname = 'coord'
                           AND rel.relname = :table
                           AND con.contype = 'p'
                         ORDER BY k.ord
                        """
                    ),
                    {"table": _KIND_TIER_TABLE},
                ).fetchall()
            ]
        assert pk_cols == ["tenant_id", "kind"], (
            f"expected PRIMARY KEY (tenant_id, kind), got {pk_cols!r}"
        )


@_needs_pg
def test_comments_land_on_every_column_the_revision_documents() -> None:
    """`pdtier_01` treats COMMENT ON as a deliverable, so it gets asserted.

    Two failure modes neither the upgrade nor `migration-reversal.yml` would
    surface: a comment statement silently not applying, and the `:word`
    bind-parameter hazard the revision's own warning describes — which can only
    manifest inside a comment body, and which would abort the migration with a
    message about a missing bind parameter rather than about SQL.
    """
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdtier01_comments") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        parent_comment = _column_comment(engine, _PARENT_TABLE, _TIER_COLUMN)
        assert parent_comment, f"coord.{_PARENT_TABLE}.{_TIER_COLUMN} has no comment"
        for tier in _TIERS:
            assert tier in parent_comment, (
                f"coord.{_PARENT_TABLE}.{_TIER_COLUMN}'s comment does not name "
                f"the tier {tier!r}: {parent_comment!r}"
            )

        versions_comment = _column_comment(engine, _VERSIONS_TABLE, _TIER_COLUMN)
        assert versions_comment, (
            f"coord.{_VERSIONS_TABLE}.{_TIER_COLUMN} has no comment — the "
            "snapshot column is documented separately because it means a "
            "different thing (a record, not a restore source)"
        )
        assert "edited_by" in versions_comment
        # The literal braces the revision uses instead of `:kind`/`:name`. If a
        # future edit spells the route with colons, the migration dies before
        # this point — but if it spells it some third way, this catches the
        # documentation regression.
        assert "{kind}/{name}" in parent_comment, (
            "the PATCH route must stay written with braces; colons would be "
            f"read as bind parameters: {parent_comment!r}"
        )
        assert "NULL is NOT deny" in parent_comment

        for column in ("kind", "tier", "updated_at"):
            assert _column_comment(engine, _KIND_TIER_TABLE, column), (
                f"coord.{_KIND_TIER_TABLE}.{column} has no comment"
            )
        updated_at_comment = _column_comment(engine, _KIND_TIER_TABLE, "updated_at")
        assert updated_at_comment is not None and "UPSERT" in updated_at_comment, (
            "updated_at's comment must state that the writer maintains it — "
            "DEFAULT now() fires on INSERT only and there is no trigger"
        )

        table_comment = _scalar(
            engine,
            "SELECT obj_description(to_regclass('coord.' || :table), 'pg_class')",
            table=_KIND_TIER_TABLE,
        )
        assert isinstance(table_comment, str) and table_comment, (
            f"coord.{_KIND_TIER_TABLE} has no table comment"
        )


@_needs_pg
def test_boolean_to_tier_migration_maps_all_three_states() -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdtier01_data") as (engine, db_url):
        # Walk to the PARENT first so the rows exist while the column is still a
        # boolean — that is the real-world ordering, and the only one where the
        # mapping is observable at all.
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)

        tenant = uuid.uuid4()
        open_doc = _insert_document(engine, tenant, "open-doc", legacy=True)
        shut_doc = _insert_document(engine, tenant, "shut-doc", legacy=False)
        unset_doc = _insert_document(engine, tenant, "unset-doc", legacy=None)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        expected = {open_doc: "allow", shut_doc: "deny", unset_doc: None}
        for doc_id, want in expected.items():
            got_parent = _scalar(
                engine,
                f"SELECT {_TIER_COLUMN} FROM coord.prompt_documents WHERE id = :id",
                id=doc_id,
            )
            assert got_parent == want, (
                f"parent row {doc_id} mapped to {got_parent!r}, expected {want!r}"
            )

            got_child = _scalar(
                engine,
                f"""
                SELECT {_TIER_COLUMN} FROM coord.prompt_document_versions
                 WHERE document_id = :doc AND version_number = 1
                """,
                doc=doc_id,
            )
            assert got_child == want, (
                f"snapshot row for {doc_id} mapped to {got_child!r}, expected "
                f"{want!r} — the versions table is migrated by the same list, "
                "and one passing is not evidence about the other"
            )

        # The NULL arm restated as its own assertion, because it is the one that
        # breaks quietly: writing 'deny' for unset rows would freeze coord's
        # compile-time default into data and make the constant inert. Scoped by
        # tenant so a future seeding revision cannot break it for an unrelated
        # reason.
        opinionated = _scalar(
            engine,
            "SELECT count(*) FROM coord.prompt_documents "
            f"WHERE tenant_id = :t AND {_TIER_COLUMN} IS NOT NULL",
            t=tenant,
        )
        assert opinionated == 2, (
            "no row without an operator opinion may gain one during the "
            f"migration; {opinionated} of this tenant's rows are non-NULL, "
            "expected 2"
        )

        # And the tier column accepts all three values on the way back in,
        # including the new one the boolean could never hold.
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"UPDATE coord.prompt_documents SET {_TIER_COLUMN} = "
                    "'allow_with_notification' WHERE id = :id"
                ),
                {"id": unset_doc},
            )
        assert (
            _scalar(
                engine,
                f"SELECT {_TIER_COLUMN} FROM coord.prompt_documents WHERE id = :id",
                id=unset_doc,
            )
            == "allow_with_notification"
        )


@_needs_pg
def test_check_rejects_a_bogus_tier_everywhere_it_is_stored() -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdtier01_check") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        tenant = uuid.uuid4()
        doc_id = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.prompt_documents
                        (id, tenant_id, kind, name, body, format, current_version)
                    VALUES (:id, :tenant, 'policy', 'git-operations', 'b',
                            'markdown', 1)
                    """
                ),
                {"id": doc_id, "tenant": tenant},
            )
            conn.execute(
                text(
                    """
                    INSERT INTO coord.prompt_document_versions
                        (document_id, version_number, body)
                    VALUES (:doc, 1, 'b')
                    """
                ),
                {"doc": doc_id},
            )

        # `maybe` is the plausible-looking wrong value: a fourth state someone
        # invents rather than an obvious typo. Each `match=` names the
        # constraint that must be the one refusing, so the assertion cannot pass
        # on some unrelated integrity error.
        with pytest.raises(
            sqlalchemy.exc.IntegrityError, match="ck_prompt_documents_agent_write_tier"
        ):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        f"UPDATE coord.prompt_documents SET {_TIER_COLUMN} = 'maybe' "
                        "WHERE id = :id"
                    ),
                    {"id": doc_id},
                )

        with pytest.raises(
            sqlalchemy.exc.IntegrityError,
            match="ck_prompt_document_versions_agent_write_tier",
        ):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        f"UPDATE coord.prompt_document_versions SET {_TIER_COLUMN} = "
                        "'maybe' WHERE document_id = :doc"
                    ),
                    {"doc": doc_id},
                )

        with pytest.raises(sqlalchemy.exc.IntegrityError, match=_KIND_TIER_CHECK):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        f"INSERT INTO coord.{_KIND_TIER_TABLE} "
                        "(tenant_id, kind, tier) VALUES (:tenant, 'policy', 'maybe')"
                    ),
                    {"tenant": tenant},
                )

        # NULL is still legal on the two nullable columns — the CHECK constrains
        # the vocabulary, it does not make the setting mandatory.
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"UPDATE coord.prompt_documents SET {_TIER_COLUMN} = NULL "
                    "WHERE id = :id"
                ),
                {"id": doc_id},
            )

        # ...and all three legal values are accepted on the kind table.
        with engine.begin() as conn:
            for index, tier in enumerate(_TIERS):
                conn.execute(
                    text(
                        f"INSERT INTO coord.{_KIND_TIER_TABLE} "
                        "(tenant_id, kind, tier) VALUES (:tenant, :kind, :tier)"
                    ),
                    {"tenant": tenant, "kind": f"probe_kind_{index}", "tier": tier},
                )


@_needs_pg
def test_kind_column_is_unconstrained_text() -> None:
    """No second kind vocabulary — the whole point of leaving `kind` plain TEXT.

    The positive half (every kind the document CHECK admits is settable) and the
    NEGATIVE half (a kind it does *not* admit is settable too) are both here.
    Only the negative half distinguishes "unconstrained TEXT" from "a sibling
    CHECK that happens to list the same thirteen values" — and the sibling is
    the defect this design exists to avoid, because it would go on passing until
    the fourteenth kind was added.
    """
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdtier01_kinds") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        tenant = uuid.uuid4()
        kinds = _kind_vocabulary(engine)
        with engine.begin() as conn:
            for kind in kinds:
                conn.execute(
                    text(
                        f"INSERT INTO coord.{_KIND_TIER_TABLE} "
                        "(tenant_id, kind, tier) VALUES (:tenant, :kind, 'deny')"
                    ),
                    {"tenant": tenant, "kind": kind},
                )

        stored = _scalar(
            engine,
            f"SELECT count(*) FROM coord.{_KIND_TIER_TABLE} WHERE tenant_id = :t",
            t=tenant,
        )
        assert stored == len(kinds), (
            f"expected a tier row for every one of {kinds!r}, stored {stored}"
        )

        # The half that actually pins it. `future_kind_not_yet_in_the_check`
        # stands in for the fourteenth kind: a sibling CHECK would reject it
        # here, today, instead of on the day someone widens the vocabulary.
        #
        # The guard runs BEFORE the INSERT, not after: a probe kind that turned
        # out to be IN the vocabulary would make the INSERT prove nothing, and
        # an assertion placed after it would announce that only once the
        # meaningless work had already succeeded.
        probe_kind = "future_kind_not_yet_in_the_check"
        assert probe_kind not in kinds, (
            "the probe kind must be one the document CHECK does NOT admit, or "
            "it proves nothing about the tier table being unconstrained"
        )
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"INSERT INTO coord.{_KIND_TIER_TABLE} "
                    "(tenant_id, kind, tier) VALUES (:tenant, :kind, 'allow')"
                ),
                {"tenant": tenant, "kind": probe_kind},
            )
        assert (
            _scalar(
                engine,
                f"SELECT tier FROM coord.{_KIND_TIER_TABLE} "
                "WHERE tenant_id = :t AND kind = :k",
                t=tenant,
                k=probe_kind,
            )
            == "allow"
        ), "a kind outside the document vocabulary must store, not merely insert"


@_needs_pg
def test_upgrade_and_downgrade_are_both_rerunnable() -> None:
    """Alembic re-runs neither direction; the idempotency doctrine needs both.

    Every statement in the revision is IF-guarded, and nothing else in the suite
    exercises that: a second `alembic upgrade pdtier_01` is a version-table
    no-op. This invokes `upgrade()` directly through alembic's own `Operations`
    proxy, so the guards are the only thing standing between a re-run and a
    `DuplicateObject`/`DuplicateTable`.
    """
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdtier01_rerun") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        tenant = uuid.uuid4()
        doc_id = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"""
                    INSERT INTO coord.prompt_documents
                        (id, tenant_id, kind, name, body, format, current_version,
                         {_TIER_COLUMN})
                    VALUES (:id, :tenant, 'policy', 'operating-rules', 'b',
                            'markdown', 1, 'allow_with_notification')
                    """
                ),
                {"id": doc_id, "tenant": tenant},
            )
            conn.execute(
                text(
                    f"INSERT INTO coord.{_KIND_TIER_TABLE} "
                    "(tenant_id, kind, tier) VALUES (:tenant, 'initiative', 'allow')"
                ),
                {"tenant": tenant},
            )

        module = _load_revision_module()
        with engine.begin() as conn:
            with Operations.context(MigrationContext.configure(conn)):
                module.upgrade()

        # Nothing was disturbed: the tier survives (a re-run must not re-migrate
        # from a boolean that no longer exists), and so does the kind-tier row.
        assert (
            _scalar(
                engine,
                f"SELECT {_TIER_COLUMN} FROM coord.prompt_documents WHERE id = :id",
                id=doc_id,
            )
            == "allow_with_notification"
        )
        assert (
            _scalar(
                engine,
                f"SELECT tier FROM coord.{_KIND_TIER_TABLE} "
                "WHERE tenant_id = :t AND kind = 'initiative'",
                t=tenant,
            )
            == "allow"
        )

        # And each table still carries exactly ONE CHECK over the tier column.
        #
        # Counting by `conname` would not say this: PostgreSQL enforces
        # constraint-name uniqueness per table (unique index on
        # `pg_constraint (conrelid, contypid, conname)`), so a name-filtered
        # count can only ever be 0 or 1 — the duplicate-under-a-generated-name
        # case is structurally undetectable that way. Counting the CHECKs whose
        # `conkey` reaches the tier column is what actually catches a re-run
        # that added a second constraint beside the named one.
        for table, constraint, column in (
            (_PARENT_TABLE, "ck_prompt_documents_agent_write_tier", _TIER_COLUMN),
            (
                _VERSIONS_TABLE,
                "ck_prompt_document_versions_agent_write_tier",
                _TIER_COLUMN,
            ),
            (_KIND_TIER_TABLE, _KIND_TIER_CHECK, "tier"),
        ):
            count = _scalar(
                engine,
                """
                SELECT count(*)
                  FROM pg_constraint con
                  JOIN pg_class rel ON rel.oid = con.conrelid
                  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                  JOIN pg_attribute att
                    ON att.attrelid = con.conrelid
                   AND att.attnum = ANY (con.conkey)
                 WHERE nsp.nspname = 'coord'
                   AND rel.relname = :table
                   AND con.contype = 'c'
                   AND att.attname = :column
                """,
                table=table,
                column=column,
            )
            assert count == 1, (
                f"expected exactly one CHECK over coord.{table}.{column} after "
                f"a re-run, found {count} (the named one is {constraint})"
            )

        # `downgrade()` is IF-guarded the same way and is re-runnable too.
        # Nothing else in the suite invokes it twice: `alembic downgrade` will
        # no more repeat it than `alembic upgrade` will, so this is the only
        # place the reverse half of the doctrine is exercised.
        for pass_number in (1, 2):
            with engine.begin() as conn:
                with Operations.context(MigrationContext.configure(conn)):
                    module.downgrade()
            assert _column(engine, _PARENT_TABLE, _TIER_COLUMN) is None, (
                f"downgrade pass {pass_number} left the tier column behind"
            )
            assert not table_exists(engine, "coord", _KIND_TIER_TABLE), (
                f"downgrade pass {pass_number} left coord.{_KIND_TIER_TABLE} behind"
            )

        # The collapse was applied ONCE, by the first pass. The second pass
        # finds no tier column, takes its guard's false arm, and must therefore
        # leave the restored boolean exactly as the first pass wrote it —
        # a second pass that re-derived it from a column that no longer exists
        # is the failure this asserts against.
        assert (
            _scalar(
                engine,
                f"SELECT {_LEGACY_COLUMN} FROM coord.prompt_documents WHERE id = :id",
                id=doc_id,
            )
            is False
        ), (
            "the doc was 'allow_with_notification'; after a double downgrade it "
            "must read FALSE — the documented collapse, applied once"
        )


@_needs_pg
def test_downgrade_restores_the_boolean_lossily_and_drops_the_new_table() -> None:
    admin_url = admin_database_url()
    with ephemeral_database(admin_url, "pdtier01_reverse") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        tenant = uuid.uuid4()
        docs: dict[str, uuid.UUID] = {}
        with engine.begin() as conn:
            for tier in (*_TIERS, "unset"):
                doc_id = uuid.uuid4()
                docs[tier] = doc_id
                conn.execute(
                    text(
                        f"""
                        INSERT INTO coord.prompt_documents
                            (id, tenant_id, kind, name, body, format,
                             current_version, {_TIER_COLUMN})
                        VALUES (:id, :tenant, 'policy', :name, 'b', 'markdown',
                                1, :tier)
                        """
                    ),
                    {
                        "id": doc_id,
                        "tenant": tenant,
                        "name": f"doc-{tier.replace('_', '-')}",
                        "tier": None if tier == "unset" else tier,
                    },
                )
                conn.execute(
                    text(
                        f"""
                        INSERT INTO coord.prompt_document_versions
                            (document_id, version_number, body, {_TIER_COLUMN})
                        VALUES (:doc, 1, 'b', :tier)
                        """
                    ),
                    {"doc": doc_id, "tier": None if tier == "unset" else tier},
                )
            conn.execute(
                text(
                    f"INSERT INTO coord.{_KIND_TIER_TABLE} "
                    "(tenant_id, kind, tier) VALUES (:tenant, 'initiative', 'allow')"
                ),
                {"tenant": tenant},
            )

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)

        # The boolean is back on both tables, the tier is gone from both, and
        # both TABLES survive — they belong to earlier revisions.
        for table in (_PARENT_TABLE, _VERSIONS_TABLE):
            assert table_exists(engine, "coord", table), (
                f"downgrade dropped coord.{table} itself; it belongs to an "
                "earlier revision and must survive"
            )
            restored = _column(engine, table, _LEGACY_COLUMN)
            assert restored is not None and restored[0] == "boolean", (
                f"downgrade must restore coord.{table}.{_LEGACY_COLUMN} as a "
                f"boolean, got {restored!r}"
            )
            assert restored[1] == "YES" and restored[2] is None, (
                "the restored boolean keeps pdaw_01's shape: nullable, no "
                f"default, got {restored!r}"
            )
            assert _column(engine, table, _TIER_COLUMN) is None, (
                f"downgrade left coord.{table}.{_TIER_COLUMN} behind"
            )
            assert _column_comment(engine, table, _LEGACY_COLUMN), (
                f"downgrade must restore pdaw_01's comment on coord.{table}."
                f"{_LEGACY_COLUMN} — DROP COLUMN took it with the column, and a "
                "bare re-ADD leaves the restored column undocumented"
            )

        # The two comment bodies say different things and are checked
        # separately: only the parent's carries the "NULL is NOT false" warning
        # that pdaw_01 exists to state, and only the snapshot's explains why the
        # version row is the attributable record.
        parent_legacy_comment = _column_comment(engine, _PARENT_TABLE, _LEGACY_COLUMN)
        assert parent_legacy_comment is not None
        assert "NULL is NOT false" in parent_legacy_comment, (
            "the restored parent comment must keep pdaw_01's three-state "
            f"warning verbatim; got {parent_legacy_comment!r}"
        )
        versions_legacy_comment = _column_comment(
            engine, _VERSIONS_TABLE, _LEGACY_COLUMN
        )
        assert versions_legacy_comment is not None
        assert "edited_by" in versions_legacy_comment, (
            "the restored snapshot comment must keep pdaw_01's attribution "
            f"note; got {versions_legacy_comment!r}"
        )

        # The inverse mapping, including the documented collapse.
        want = {
            "allow": True,
            "deny": False,
            # LOSSY — a boolean has no third state. FALSE rather than TRUE so a
            # downgrade can never silently WIDEN authority.
            "allow_with_notification": False,
            "unset": None,
        }
        actual: dict[str, object] = {}
        for tier, expected in want.items():
            got = _scalar(
                engine,
                f"SELECT {_LEGACY_COLUMN} FROM coord.prompt_documents WHERE id = :id",
                id=docs[tier],
            )
            actual[tier] = got
            assert got is expected, (
                f"tier {tier!r} downgraded to {got!r}, expected {expected!r}"
            )
            got_child = _scalar(
                engine,
                f"""
                SELECT {_LEGACY_COLUMN} FROM coord.prompt_document_versions
                 WHERE document_id = :doc AND version_number = 1
                """,
                doc=docs[tier],
            )
            assert got_child is expected, (
                f"snapshot for tier {tier!r} downgraded to {got_child!r}, "
                f"expected {expected!r}"
            )

        # The loss, read back off the database rather than off `want`: after the
        # downgrade `allow_with_notification` and `deny` are indistinguishable,
        # and neither is confusable with `allow`. A test that asserted this
        # against its own expectation table would pin nothing.
        assert actual["allow_with_notification"] == actual["deny"], (
            "the documented collapse did not happen — allow_with_notification "
            f"stored {actual['allow_with_notification']!r} and deny stored "
            f"{actual['deny']!r}"
        )
        assert actual["allow_with_notification"] != actual["allow"], (
            "allow_with_notification must NOT collapse to the same value as "
            "allow: a downgrade that turned a disclosure-conditioned grant into "
            "an unconditional one would silently widen authority"
        )

        # The per-kind table has no representation in the older schema at all.
        assert not table_exists(engine, "coord", _KIND_TIER_TABLE), (
            f"downgrade must drop coord.{_KIND_TIER_TABLE}; this revision created it"
        )

        # No row was destroyed by the walk.
        assert _scalar(
            engine,
            "SELECT count(*) FROM coord.prompt_documents WHERE tenant_id = :t",
            t=tenant,
        ) == len(docs)

        # And up again, cleanly — the tier comes back on both, and the
        # round-trip's loss is now visible: `allow_with_notification` returns as
        # `deny`, never as `allow`.
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for table in (_PARENT_TABLE, _VERSIONS_TABLE):
            found = _column(engine, table, _TIER_COLUMN)
            assert found is not None and found[0] == _EXPECTED_TYPE
            assert _column(engine, table, _LEGACY_COLUMN) is None
        assert table_exists(engine, "coord", _KIND_TIER_TABLE)

        round_tripped = _scalar(
            engine,
            f"SELECT {_TIER_COLUMN} FROM coord.prompt_documents WHERE id = :id",
            id=docs["allow_with_notification"],
        )
        assert round_tripped == "deny", (
            "down-then-up must land 'allow_with_notification' on the "
            f"conservative side, got {round_tripped!r} — anything else means a "
            "reversal silently re-granted authority"
        )

        # The re-added CHECKs are enforcing, not merely present. This is the
        # only place a round trip exercises them, and it is the reason the
        # revision uses drop-then-add pairs rather than inline constraints.
        with pytest.raises(sqlalchemy.exc.IntegrityError, match=_KIND_TIER_CHECK):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        f"INSERT INTO coord.{_KIND_TIER_TABLE} "
                        "(tenant_id, kind, tier) VALUES (:tenant, 'policy', 'maybe')"
                    ),
                    {"tenant": tenant},
                )
        with pytest.raises(
            sqlalchemy.exc.IntegrityError, match="ck_prompt_documents_agent_write_tier"
        ):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        f"UPDATE coord.prompt_documents SET {_TIER_COLUMN} = 'maybe' "
                        "WHERE id = :id"
                    ),
                    {"id": docs["allow"]},
                )
