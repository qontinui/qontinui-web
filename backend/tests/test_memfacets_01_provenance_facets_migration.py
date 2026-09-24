"""Behaviour tests for the ``memfacets_01`` / ``findfacets_02`` revisions.

The pair adds three foreign-keyed provenance columns —
``coord.memory_records.user_id`` / ``.device_id`` and
``coord.findings.author_user`` — plus the ``applies_at`` altitude facet.
``migration-reversal.yml`` already walks up -> down -> up on any PR touching
``backend/alembic/versions/**``, so *applying* them is covered. What is not,
and what this file exists for, is that **an FK is a rule about OTHER
services' deletes and about this service's inserts**, and both directions
fail as behaviour rather than as an error at migration time:

* **Delete side.** coord's device garbage collector (``gc_hard_delete``,
  ``qontinui-coord/crates/coord/src/state_reconciler_watcher.rs``) issues
  ONE ``DELETE FROM coord.devices WHERE state = 'abandoned' AND
  last_heartbeat < …`` for the whole sweep. Under a bare ``REFERENCES``
  (``NO ACTION``) the first abandoned device that ever wrote a memory makes
  that statement abort, so the sweep collects **nothing at all**, every
  tick, for good. ``ON DELETE SET NULL`` is what keeps a memory row from
  pinning its device row forever — memories are tombstoned rather than
  deleted, so the child outlives the parent by construction.
* **Insert side.** A token that asserts a ``device_id`` whose row has gone
  raises ``ForeignKeyViolation`` and 500s a memory write, which the plan
  forbids ("a memory that fails to save is worse than one that is coarsely
  scoped", §4.1 item 3). The application's answer is
  ``_write_degrading_dangling_provenance`` — a savepoint around the insert
  that retries unattributed — and it recognises the violation **by
  constraint name**, so this file pins the names Postgres actually mints.

Everything here runs against the REAL chain on a throwaway database, which
is why it lives beside the migration rather than in
``test_memory_api_db.py``: that suite's ``coord.memory_records`` is
hand-written DDL against a shared database whose ``auth.users`` is built by
``Base.metadata.create_all``. A stub of that table written there would be
adopted by every other module (``create_all`` is ``checkfirst=True``), and
an FK into it would break ``test_engine``'s teardown ``drop_all``. Here the
schema under test is the one the migration produces.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. ⚠️ A skip proves nothing —
point it at a live instance with ``QONTINUI_TEST_PG=host:port`` if 5432 is
not the one accepting the test credentials. That variable and no other:
``conftest.py`` rebuilds ``DATABASE_URL`` from it unconditionally at import,
so exporting ``DATABASE_URL`` yourself is overwritten and the suite skips
silently — the exact outcome the sentence above says proves nothing.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from typing import Any
from uuid import UUID, uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    load_revision_module,
    run_alembic,
)

_MEM_REVISION = "memfacets_01"
_FIND_REVISION = "findfacets_02"
_PARENT_REVISION = "coord_wu_authored_at_02"

#: ``confdeltype`` codes in ``pg_constraint``: 'a' NO ACTION, 'n' SET NULL,
#: 'c' CASCADE. 'a' is the default a bare ``REFERENCES`` produces, and it is
#: the value this file exists to keep out.
_SET_NULL = "n"
_NO_ACTION = "a"

_MEM_REVISION_FILENAME = "memfacets_01_memory_records_user_device_altitude.py"
_FIND_REVISION_FILENAME = "findfacets_02_findings_author_user_altitude.py"

#: The two revisions AS FIRST WRITTEN — bare ``REFERENCES``, i.e. the
#: ``ON DELETE NO ACTION`` default. Reconstructed here rather than read out of
#: git (``git show <sha>~1:…``) so the test needs no repository history and no
#: subprocess: what it has to reproduce is a STATE, and this is that state.
#: The three partial indexes are deliberately left out — they are byte-identical
#: between the two forms, the fixed revision creates them ``IF NOT EXISTS``
#: anyway, and a second copy of DDL that never varies is only a thing to drift.
#: The precondition assertion below is what keeps this reconstruction honest:
#: if it stops producing three ``'a'`` FKs it fails as a precondition rather
#: than quietly testing nothing.
_PREFIX_DDL = (
    """
    ALTER TABLE coord.memory_records
        ADD COLUMN IF NOT EXISTS user_id UUID
            REFERENCES auth.users(id),
        ADD COLUMN IF NOT EXISTS device_id UUID
            REFERENCES coord.devices(device_id),
        ADD COLUMN IF NOT EXISTS applies_at TEXT NOT NULL DEFAULT 'tenant'
            CONSTRAINT ck_memory_records_applies_at
            CHECK (applies_at IN (
                'fleet', 'tenant', 'user', 'device', 'session'
            ))
    """,
    """
    ALTER TABLE coord.findings
        ADD COLUMN IF NOT EXISTS author_user UUID
            REFERENCES auth.users(id),
        ADD COLUMN IF NOT EXISTS applies_at TEXT NOT NULL DEFAULT 'tenant'
            CONSTRAINT ck_findings_applies_at
            CHECK (applies_at IN (
                'fleet', 'tenant', 'user', 'device', 'session'
            ))
    """,
)

_EXPECTED_FK_RULES = {
    ("memory_records", "user_id"): "memory_records_user_id_fkey",
    ("memory_records", "device_id"): "memory_records_device_id_fkey",
    ("findings", "author_user"): "findings_author_user_fkey",
}

_SKIP_REASON = (
    "Postgres not reachable at the conftest URL. CI provisions a postgres "
    "service; locally, bring up a backend Postgres (or set QONTINUI_TEST_PG) "
    "before running this test."
)

pytestmark = pytest.mark.skipif(
    not can_connect(admin_database_url()), reason=_SKIP_REASON
)


# ---------------------------------------------------------------------------
# Seed helpers — the real tables, so every NOT NULL without a server default
# has to be named. Kept explicit rather than introspected: a seed that
# discovers its own column list would keep working while the schema it is
# meant to exercise changed underneath it.
# ---------------------------------------------------------------------------


def _seed_tenant(engine: Engine, tenant_id: UUID) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.tenants (tenant_id, slug, display_name)
                VALUES (:t, :slug, 'memfacets_01 test tenant')
                ON CONFLICT DO NOTHING
                """
            ),
            {"t": tenant_id, "slug": f"memfacets-{tenant_id.hex[:12]}"},
        )


def _seed_user(engine: Engine, user_id: UUID) -> None:
    """One ``auth.users`` row. Every NOT NULL column with no server default."""
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO auth.users
                    (id, email, username, full_name, is_beta,
                     created_at, updated_at, subscription_tier, login_count,
                     remember_me_usage_count, automation_streaming_enabled,
                     automation_sessions_used,
                     is_active, is_superuser, is_verified)
                VALUES
                    (:id, :email, :username, 'memfacets test user', false,
                     now(), now(), 'free', 0,
                     0, false,
                     0,
                     true, false, true)
                """
            ),
            {
                "id": user_id,
                "email": f"memfacets-{user_id.hex[:12]}@example.invalid",
                "username": f"memfacets-{user_id.hex[:12]}",
            },
        )


def _seed_device(engine: Engine, device_id: UUID, tenant_id: UUID) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.devices (device_id, tenant_id, name, hostname)
                VALUES (:d, :t, :name, 'memfacets-test-host')
                """
            ),
            {"d": device_id, "t": tenant_id, "name": f"memfacets-{device_id.hex[:8]}"},
        )


def _insert_memory(
    engine: Engine,
    *,
    tenant_id: UUID,
    user_id: UUID | None,
    device_id: UUID | None,
    title: str,
) -> UUID:
    memory_id = uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.memory_records
                    (memory_id, tenant_id, scope, kind, title, content,
                     content_hash, user_id, device_id)
                VALUES (:m, :t, 'tenant', 'fact', :title, :title, :title,
                        :u, :d)
                """
            ),
            {
                "m": memory_id,
                "t": tenant_id,
                "title": title,
                "u": user_id,
                "d": device_id,
            },
        )
    return memory_id


def _insert_finding(engine: Engine, *, tenant_id: UUID, author_user: UUID) -> UUID:
    finding_id = uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.findings
                    (finding_id, tenant_id, title, body, author_user, expires_at)
                VALUES (:f, :t, 'memfacets finding', 'body',
                        :u, now() + interval '14 days')
                """
            ),
            {"f": finding_id, "t": tenant_id, "u": author_user},
        )
    return finding_id


def _memory_provenance(engine: Engine, memory_id: UUID) -> tuple[Any, Any, Any]:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT user_id, device_id, applies_at "
                "FROM coord.memory_records WHERE memory_id = :m"
            ),
            {"m": memory_id},
        ).one()
    return (row[0], row[1], row[2])


def _fk_delete_rules(engine: Engine) -> dict[tuple[str, str], tuple[str, str]]:
    """``{(table, column): (constraint_name, confdeltype)}`` for FK columns.

    Read from ``pg_constraint`` rather than from the migration's source
    text: the question is what Postgres ended up enforcing, and an
    ``ADD COLUMN IF NOT EXISTS`` that silently no-ops on a pre-existing
    column would leave the source saying one thing and the catalogue
    another.
    """
    sql = text(
        """
        SELECT c.relname       AS table_name,
               a.attname       AS column_name,
               con.conname     AS constraint_name,
               con.confdeltype AS delete_rule
          FROM pg_constraint con
          JOIN pg_class c ON c.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN unnest(con.conkey) AS k(attnum) ON true
          JOIN pg_attribute a
            ON a.attrelid = con.conrelid AND a.attnum = k.attnum
         WHERE con.contype = 'f'
           AND n.nspname = 'coord'
           AND c.relname IN ('memory_records', 'findings')
        """
    )
    with engine.connect() as conn:
        rows = conn.execute(sql).all()
    return {
        (str(r.table_name), str(r.column_name)): (
            str(r.constraint_name),
            str(r.delete_rule),
        )
        for r in rows
    }


def _column_exists(engine: Engine, table: str, column: str) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    """
                    SELECT EXISTS(
                        SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'coord'
                          AND table_name = :t
                          AND column_name = :c
                    )
                    """
                ),
                {"t": table, "c": column},
            ).scalar()
        )


@pytest.fixture(scope="module")
def migrated() -> Iterator[tuple[Engine, str]]:
    """One ephemeral database, upgraded to ``findfacets_02``.

    Module-scoped because a full chain run is the expensive part and every
    test below only needs "the schema these two revisions produce". The
    up -> down -> up walk gets its own database so no test can depend on
    another's residue.
    """
    with ephemeral_database(admin_database_url(), "memfacets_01_test") as (
        engine,
        url,
    ):
        run_alembic(backend_root(), url, "upgrade", _FIND_REVISION)
        yield engine, url


# ---------------------------------------------------------------------------
# Delete side — the coord device-GC wedge
# ---------------------------------------------------------------------------


def test_all_three_provenance_fks_are_on_delete_set_null(
    migrated: tuple[Engine, str],
) -> None:
    """Catalogue-level: the rule, and the constraint name the app matches on.

    Both halves matter. The RULE is what keeps coord's device GC working.
    The NAME is what ``_is_provenance_fk_violation`` greps the driver error
    for, so a rename here silently turns the insert-side fallback into a
    500 — the failure it exists to prevent, reintroduced by a cosmetic
    edit.
    """
    engine, _url = migrated
    rules = _fk_delete_rules(engine)

    for (table, column), expected_name in _EXPECTED_FK_RULES.items():
        assert (table, column) in rules, (
            f"coord.{table}.{column} carries no FOREIGN KEY at all. The plan "
            f"requires one (provenance must be resolvable-or-NULL, never "
            f"dangling); if it was deliberately dropped, this test is the "
            f"place that decision gets recorded."
        )
        name, delete_rule = rules[(table, column)]
        assert name == expected_name, (
            f"coord.{table}.{column}'s constraint is named {name!r}, not "
            f"{expected_name!r}. app/api/v1/endpoints/memory.py's "
            f"_PROVENANCE_FK_CONSTRAINTS matches the driver error by NAME — "
            f"update both together or the insert-side fallback stops firing."
        )
        assert delete_rule == _SET_NULL, (
            f"coord.{table}.{column} has ON DELETE rule {delete_rule!r}, not "
            f"{_SET_NULL!r} (SET NULL). 'a' means NO ACTION — the bare "
            f"REFERENCES default — which wedges coord's gc_hard_delete "
            f"sweep the first time an abandoned device has written a memory."
        )


def test_deleting_a_device_succeeds_and_nulls_the_memory_row(
    migrated: tuple[Engine, str],
) -> None:
    """The reproduction of the coord GC wedge, run forwards.

    Under ``NO ACTION`` the DELETE below raises::

        ERROR: update or delete on table "devices" violates foreign key
               constraint "memory_records_device_id_fkey" on table
               "memory_records"

    and, because ``gc_hard_delete`` deletes the whole abandoned cohort in
    one statement, the sweep then collects nothing at all rather than
    skipping one row.
    """
    engine, _url = migrated
    tenant_id, user_id, device_id = uuid4(), uuid4(), uuid4()
    _seed_tenant(engine, tenant_id)
    _seed_user(engine, user_id)
    _seed_device(engine, device_id, tenant_id)
    memory_id = _insert_memory(
        engine,
        tenant_id=tenant_id,
        user_id=user_id,
        device_id=device_id,
        title=f"device-gc {device_id.hex[:8]}",
    )

    # The GC's own predicate shape, narrowed to this test's device.
    with engine.begin() as conn:
        deleted = conn.execute(
            text("DELETE FROM coord.devices WHERE device_id = :d"),
            {"d": device_id},
        ).rowcount
    assert deleted == 1

    stored_user, stored_device, applies_at = _memory_provenance(engine, memory_id)
    assert stored_device is None, (
        "the device FK must SET NULL, leaving the memory row in place with "
        "coarser provenance"
    )
    assert stored_user == user_id, "only the device facet was affected"
    assert applies_at == "tenant", "Phase 1's column default, untouched"


def test_deleting_a_user_nulls_both_the_memory_and_the_finding(
    migrated: tuple[Engine, str],
) -> None:
    """``auth.users`` is deletable too, and a finding outlives its author.

    ``coord.findings.author_device`` was deliberately left FK-free as a
    "best-effort device link" because findings outlive devices. The same
    reasoning applies to the human, which is why ``author_user`` is
    ``SET NULL`` rather than ``CASCADE``: deleting a person must not delete
    what they found.
    """
    engine, _url = migrated
    tenant_id, user_id, device_id = uuid4(), uuid4(), uuid4()
    _seed_tenant(engine, tenant_id)
    _seed_user(engine, user_id)
    _seed_device(engine, device_id, tenant_id)
    memory_id = _insert_memory(
        engine,
        tenant_id=tenant_id,
        user_id=user_id,
        device_id=device_id,
        title=f"user-delete {user_id.hex[:8]}",
    )
    finding_id = _insert_finding(engine, tenant_id=tenant_id, author_user=user_id)

    with engine.begin() as conn:
        deleted = conn.execute(
            text("DELETE FROM auth.users WHERE id = :u"), {"u": user_id}
        ).rowcount
    assert deleted == 1

    stored_user, stored_device, _applies_at = _memory_provenance(engine, memory_id)
    assert stored_user is None
    assert stored_device == device_id, "only the user facet was affected"

    with engine.connect() as conn:
        author_user = conn.execute(
            text("SELECT author_user FROM coord.findings WHERE finding_id = :f"),
            {"f": finding_id},
        ).scalar()
    assert author_user is None
    with engine.connect() as conn:
        survived = conn.execute(
            text("SELECT count(*) FROM coord.findings WHERE finding_id = :f"),
            {"f": finding_id},
        ).scalar()
    assert survived == 1, "SET NULL, not CASCADE — the finding must survive"


# ---------------------------------------------------------------------------
# Insert side — the violation the application catches
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("column", ["user_id", "device_id"])
def test_a_dangling_provenance_id_raises_a_violation_naming_its_constraint(
    migrated: tuple[Engine, str], column: str
) -> None:
    """The INSERT-side failure, and the string the fallback recognises.

    ``ON DELETE SET NULL`` governs deletes and does nothing for a write
    arriving with an id whose parent is already gone. That write raises,
    and ``_is_provenance_fk_violation`` decides whether to degrade it by
    looking for the constraint name in the rendered driver error — so this
    asserts the name is actually IN that error, not merely in the
    catalogue.
    """
    from app.api.v1.endpoints.memory import _PROVENANCE_FK_CONSTRAINTS

    engine, _url = migrated
    tenant_id = uuid4()
    _seed_tenant(engine, tenant_id)
    dangling = uuid4()

    with pytest.raises(IntegrityError) as exc:
        _insert_memory(
            engine,
            tenant_id=tenant_id,
            user_id=dangling if column == "user_id" else None,
            device_id=dangling if column == "device_id" else None,
            title=f"dangling {column} {dangling.hex[:8]}",
        )

    rendered = str(exc.value.orig) if exc.value.orig is not None else str(exc.value)
    expected = f"memory_records_{column}_fkey"
    assert expected in rendered, (
        f"the driver error did not name {expected!r}; "
        f"_is_provenance_fk_violation would not recognise it. Got: {rendered}"
    )
    assert expected in _PROVENANCE_FK_CONSTRAINTS, (
        f"{expected!r} is not in the endpoint's _PROVENANCE_FK_CONSTRAINTS, "
        f"so the fallback would re-raise it as a 500"
    )


# ---------------------------------------------------------------------------
# The application halves, over the real schema and the real driver
# ---------------------------------------------------------------------------


def _async_maker(url: str) -> tuple[Any, async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(
        url.replace("postgresql://", "postgresql+asyncpg://"),
        poolclass=NullPool,
    )
    return engine, async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )


def test_existing_provenance_resolves_against_real_postgres(
    migrated: tuple[Engine, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """``_existing_provenance``'s SQL, executed — hit, miss, and both-None.

    Until this existed the function's query was run by NOTHING:
    ``test_memory_auth.py`` substitutes a fake session whose ``execute``
    ignores the statement and does set membership on the params, and
    ``test_memory_api_db.py`` overrides ``get_memory_tenant`` wholesale.
    Combined with the (correct) ``except Exception: return None, None``,
    a query that was simply wrong — a renamed column, a search-path
    surprise, an asyncpg type error on the ``CAST(:user_id AS uuid)`` that
    receives a ``str`` — would degrade to unattributed provenance with a
    single ``logger.warning``. And because coord mints no ``user_id`` claim
    yet, permanently-NULL provenance is exactly what a fully broken lookup
    would look like, so nothing would have distinguished the two.

    This is the test that settles asyncpg's runtime encoding of the
    ``str(user_id)`` the function binds.
    """
    import app.db.session as db_session
    from app.api.v1.endpoints.memory import _existing_provenance

    sync_engine, url = migrated
    tenant_id, user_id, device_id = uuid4(), uuid4(), uuid4()
    _seed_tenant(sync_engine, tenant_id)
    _seed_user(sync_engine, user_id)
    _seed_device(sync_engine, device_id, tenant_id)

    engine, maker = _async_maker(url)
    monkeypatch.setattr(db_session, "AsyncSessionLocal", maker)

    async def _go() -> list[tuple[UUID | None, UUID | None]]:
        try:
            return [
                # Both resolve.
                await _existing_provenance(user_id, device_id),
                # Neither does — the degradation, not an exception.
                await _existing_provenance(uuid4(), uuid4()),
                # One of each.
                await _existing_provenance(user_id, uuid4()),
                await _existing_provenance(uuid4(), device_id),
                # Nothing claimed: the short-circuit, no query at all.
                await _existing_provenance(None, None),
            ]
        finally:
            await engine.dispose()

    both, neither, user_only, device_only, nothing = asyncio.run(_go())

    assert both == (user_id, device_id), (
        "a claimed pair that EXISTS must survive the lookup. A failure here "
        "with a correct seed means the SQL itself is wrong — which is the "
        "condition this test was written because nothing could detect."
    )
    assert neither == (None, None)
    assert user_only == (user_id, None)
    assert device_only == (None, device_id)
    assert nothing == (None, None)


def test_the_savepoint_fallback_lands_the_row_unattributed(
    migrated: tuple[Engine, str],
) -> None:
    """A dangling principal writes a COARSER row, never a failed write.

    The end-to-end shape of the plan's §4.1 item 3 over real Postgres: a
    principal whose ``device_id`` names no ``coord.devices`` row (the state
    a device JWT outliving its device produces, and the state the device
    arm cannot pre-empt because it resolves nothing) must still land the
    memory — with NULL provenance rather than a 500.
    """
    from app.api.v1.endpoints.memory import (
        MemoryPrincipal,
        _write_degrading_dangling_provenance,
    )
    from app.services import memory_store as store

    sync_engine, url = migrated
    tenant_id, user_id = uuid4(), uuid4()
    _seed_tenant(sync_engine, tenant_id)
    _seed_user(sync_engine, user_id)
    principal = MemoryPrincipal(
        tenant_id=tenant_id,
        # Resolvable...
        user_id=user_id,
        # ...and not. One dangling facet is enough to abort the INSERT.
        device_id=uuid4(),
        actor="device",
    )

    engine, maker = _async_maker(url)
    # Fixed, not minted per call: the retry must re-run the SAME write, as
    # it does in production. A hash regenerated inside the lambda would let
    # the second attempt succeed for a reason the real path does not have.
    content_hash = f"fallback-{uuid4().hex}"

    async def _go() -> UUID:
        try:
            async with maker() as session:
                memory_id, _deduped = await _write_degrading_dangling_provenance(
                    session,
                    principal,
                    lambda u, d: store.insert_record(
                        session,
                        tenant_id=tenant_id,
                        scope="tenant",
                        scope_ref=None,
                        kind="fact",
                        title="fallback",
                        content="written by a principal with a dead device",
                        content_hash=content_hash,
                        embedding=None,
                        embedding_model=None,
                        importance=0.5,
                        source={},
                        user_id=u,
                        device_id=d,
                    ),
                )
                await session.commit()
                return memory_id
        finally:
            await engine.dispose()

    memory_id = asyncio.run(_go())

    stored_user, stored_device, applies_at = _memory_provenance(sync_engine, memory_id)
    assert stored_device is None
    assert stored_user is None, (
        "the retry writes BOTH facets NULL: the savepoint rolled back the "
        "whole statement, and the handler cannot tell which of the two ids "
        "was the dangling one without another round trip it declined to take"
    )
    assert applies_at == "tenant"


# ---------------------------------------------------------------------------
# Reversal, on its own database
# ---------------------------------------------------------------------------


def test_the_pair_is_reversible_and_adds_nothing_before_it_runs() -> None:
    """up -> down -> up, with the columns absent at the parent revision.

    ``migration-reversal.yml`` walks the chain, but it cannot assert that
    these particular columns are created HERE rather than by something
    earlier — which is what makes a downgrade that drops them correct.
    """
    root = backend_root()
    with ephemeral_database(admin_database_url(), "memfacets_01_rev") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION)
        for table, column in _EXPECTED_FK_RULES:
            assert not _column_exists(engine, table, column), (
                f"coord.{table}.{column} exists at {_PARENT_REVISION} — it "
                f"must be created by this pair, not by an earlier revision"
            )

        # Stop at the FIRST of the pair: the memory columns must be there
        # and the findings ones must not. The two revisions are separately
        # deployable and a reviewer reading either one alone is entitled to
        # know which columns it owns.
        run_alembic(root, url, "upgrade", _MEM_REVISION)
        assert _column_exists(engine, "memory_records", "user_id")
        assert _column_exists(engine, "memory_records", "device_id")
        assert _column_exists(engine, "memory_records", "applies_at")
        assert not _column_exists(engine, "findings", "author_user"), (
            f"{_FIND_REVISION}'s column appeared at {_MEM_REVISION}"
        )
        assert not _column_exists(engine, "findings", "applies_at")

        run_alembic(root, url, "upgrade", _FIND_REVISION)
        for table, column in _EXPECTED_FK_RULES:
            assert _column_exists(engine, table, column)
        assert _column_exists(engine, "memory_records", "applies_at")
        assert _column_exists(engine, "findings", "applies_at")

        run_alembic(root, url, "downgrade", _PARENT_REVISION)
        for table, column in _EXPECTED_FK_RULES:
            assert not _column_exists(engine, table, column), (
                f"downgrade left coord.{table}.{column} behind"
            )
        assert not _column_exists(engine, "memory_records", "applies_at")
        assert not _column_exists(engine, "findings", "applies_at")

        run_alembic(root, url, "upgrade", _FIND_REVISION)
        rules = _fk_delete_rules(engine)
        for key, expected_name in _EXPECTED_FK_RULES.items():
            assert rules[key] == (expected_name, _SET_NULL), (
                "the re-applied revision must rebuild the FK with the SAME "
                "name and delete rule — the ADD COLUMN IF NOT EXISTS idiom "
                "makes a partially-applied state possible, and a column that "
                "survives a downgrade would come back without its constraint"
            )


def _run_revision_body(engine: Engine, filename: str, module_name: str) -> None:
    """Execute one revision file's ``upgrade()`` against ``engine``.

    Alembic's own runner will not do this once ``alembic_version`` names the
    revision — which is the whole subject of the test below.
    """
    module = load_revision_module(
        backend_root() / "alembic" / "versions" / filename, module_name
    )
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            module.upgrade()


def test_a_prefix_database_is_repaired_by_rerunning_the_fixed_revision() -> None:
    """The ``ON DELETE SET NULL`` fix reaches a database that ran the OLD form.

    The fix was made inside an ``ADD COLUMN IF NOT EXISTS`` under an
    UNCHANGED revision id. Every other test in this file builds a fresh
    database, where the ``ADD COLUMN`` really adds and the inline clause
    therefore lands — so none of them can see the case this one exists for:
    a database on which those columns ALREADY EXIST with the pre-fix
    ``NO ACTION`` rule. There the ``ADD COLUMN`` no-ops, the inline clause
    is never parsed, and without the explicit
    ``DROP CONSTRAINT IF EXISTS`` / ``ADD CONSTRAINT`` rebuild the
    ``NO ACTION`` FKs survive the fix — i.e. coord's device GC stays wedged
    on exactly the databases the fix was written for.

    Both halves are asserted, because they are different claims:

    1. ``alembic upgrade head`` does NOT repair such a database. The
       revisions are already stamped, so their bodies never run at all.
       This is a real residual and it is pinned here rather than described:
       the only complete repair for an already-stamped database is a NEW
       revision. This branch is unmerged, so no such database is known to
       exist — but "almost certainly none" across dev boxes, CI caches and
       persistent test databases is not a thing anyone can verify, which is
       why the rebuild below is cheap insurance rather than dead code.
    2. RUNNING the revision body does repair it. That covers every path on
       which the body does run: a downgrade -> upgrade cycle (which
       ``migration-reversal.yml`` walks on every PR touching
       ``backend/alembic/versions/**``), and a partially-applied state.
    """
    root = backend_root()
    with ephemeral_database(admin_database_url(), "memfacets_01_prefix") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION)

        # Rebuild the pre-fix state: the columns present, with the bare
        # REFERENCES the revisions originally carried, and alembic told the
        # pair is applied. This is what a box that ran the earlier form has.
        with engine.begin() as conn:
            for statement in _PREFIX_DDL:
                conn.execute(text(statement))
        run_alembic(root, url, "stamp", _FIND_REVISION)

        before = _fk_delete_rules(engine)
        for key, expected_name in _EXPECTED_FK_RULES.items():
            assert before.get(key) == (expected_name, _NO_ACTION), (
                f"precondition: the reconstruction must give coord.{key[0]}."
                f"{key[1]} a {expected_name!r} FK with NO ACTION, or this "
                f"test is not exercising the pre-fix state at all — got "
                f"{before.get(key)!r}"
            )

        # 1. The stamped revisions never re-run, so this changes nothing.
        run_alembic(root, url, "upgrade", "head")
        after_upgrade = _fk_delete_rules(engine)
        for key in _EXPECTED_FK_RULES:
            assert after_upgrade.get(key) == before[key], (
                "`alembic upgrade head` repaired coord."
                f"{key[0]}.{key[1]} — if a NEW revision was added to do that, "
                "this pin is the place to record it; it asserts the residual "
                "the in-place fix deliberately does not close"
            )

        # 2. Running the bodies does.
        _run_revision_body(engine, _MEM_REVISION_FILENAME, f"_prefix_{_MEM_REVISION}")
        _run_revision_body(engine, _FIND_REVISION_FILENAME, f"_prefix_{_FIND_REVISION}")

        repaired = _fk_delete_rules(engine)
        for key, expected_name in _EXPECTED_FK_RULES.items():
            assert repaired.get(key) == (expected_name, _SET_NULL), (
                f"coord.{key[0]}.{key[1]} still carries {repaired.get(key)!r} "
                f"after the fixed revision ran over a pre-fix database. The "
                f"inline ON DELETE SET NULL cannot reach it — ADD COLUMN IF "
                f"NOT EXISTS no-ops — so the explicit DROP CONSTRAINT IF "
                f"EXISTS / ADD CONSTRAINT rebuild is load-bearing here."
            )
