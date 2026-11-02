"""coord: production converges to the alembic chain, in ten guarded steps

Revision ID: coordconv_01
Revises: coordrls_01
Create Date: 2026-10-15

Plan ``2026-10-15-coord-schema-is-authored-in-a-different-repo-than-coord``,
Phase 6, "Before 6.1": converge production to the chain. Phase 0 of that plan
compared production with a fresh database built from this chain at the same
alembic revision (coord finding ``35ca1c85``, re-measured read-only
2026-10-15). Nine objects differ in definition, and the plan's D9.0 requires
them equal before the alembic freeze. Step 10 also fixes a latent defect the
comparison found. Every step leaves production and a fresh database holding
the same definition, by one of the three moves of the plan's D3: production
gains the chain's object, the chain gains production's object (it is in use),
or production drops an object nothing uses.

The steps, in order
===================
====  ======================================  ================================
Step  Object                                  Move
====  ======================================  ================================
1     ``coord.devices.metadata``              the chain gains production's column
2     ``devices_tenant_id_fkey``              production gains the chain's key
3     ``coord.memories.memory_id`` default    production gains ``gen_random_uuid()``
4     ``idx_memories_name_version``           production drops it
5     ``idx_memories_type``                   production drops it
6     ``idx_memories_written_at``             production drops it
7     ``idx_agent_questions_agent``           the chain gains production's index
8     ``idx_agent_questions_session``         the chain gains production's wider one
9     ``primary_trees_tenant_id_fkey``        production's orphans are backed up and
                                              removed; the key is validated
10    ``primary_trees_tenant_id_fkey``        ``ON DELETE SET NULL`` becomes
                                              ``CASCADE``, everywhere
====  ======================================  ================================

Each step's function carries its evidence and its decision.

How every step works
====================
* It decides from the catalog, never from an assumed state, and does nothing
  when its object already has the target definition.
* It refuses a shape Phase 0 did not measure, naming the step, rather than
  rewriting an object nobody measured.
* It runs in an ``autocommit_block`` of its own. ``env.py`` runs one
  transaction per upgrade, so in-batch every lock would be held to the end of
  the whole deploy batch. Lock-taking DDL runs as its own transaction,
  ``BEGIN; SET LOCAL lock_timeout = '3s'; ...; COMMIT``. ``CREATE``/``DROP INDEX
  CONCURRENTLY`` cannot run in a transaction block; they run under a session
  ``lock_timeout`` that a ``finally`` resets. A lock timeout is the correct
  outcome when something holds the table: re-run once it clears.
* It reads the catalog with ``search_path`` pinned to ``pg_catalog``, so the
  deparsers (``pg_get_constraintdef``, ``pg_get_indexdef``, ``pg_get_expr``)
  render names exactly as Phase 0 measured them.

Retry
=====
alembic records ``coordconv_01`` only after every step has returned. A run
that fails at step k has committed steps 1 to k-1 and left
``alembic_version`` at ``coordrls_01``, so the next run starts again at
step 1. A finished step finds its target in the catalog and does nothing, and
the run continues from step k. Entering the first block also commits the
batch so far, which is accepted: everything here is idempotent.

Downgrade
=========
The steps are undone in reverse order, each returning its object to the
chain shape of ``coordrls_01``, because after the upgrade production and a
fresh database are indistinguishable by design. Steps 2 to 6 therefore undo
nothing: the parent chain already has their objects and lacks their drops.
Step 9 is the exception: when its backup exists, every backed-up row whose
device still exists comes back, unless its ``(device_id, repo)`` has been
re-created since (that row is newer and is kept), and the key goes back to
``NOT VALID``; when no row comes back the key is re-added validated, the
parent chain's definition. A backed-up row of a device deleted since stays
gone, as the device's delete would have cascaded it. A downgrade that would
lose a ``metadata`` value (step 1's undo) refuses before any undo runs. Like
the upgrade, a downgrade that fails part-way is finished by running it again:
every undo reads its state from the catalog, one that already ran does
nothing, and one interrupted part-way finishes.

Locks on ``coord.tenants``
==========================
Steps 2 and 10 (and the undo of 9 and 10) add or drop a key that references
``coord.tenants``, the table behind every session registration and every
tenant key's check. Adding one takes ``SHARE ROW EXCLUSIVE`` on it; DROPPING
one takes ``ACCESS EXCLUSIVE`` on it for the catalog change, which every
foreign-key check against ``coord.tenants`` then queues behind. So the
statement that drops a tenant key runs with ``SET LOCAL lock_timeout = '1s'``:
it gives up quickly rather than hold a queue of tenant-key checks, and a
re-run finishes it.

If another revision lands on ``coordrls_01`` first, re-point
``down_revision`` (and the ``Revises:`` line above) at the new head; the tests
read the parent from ``tests/test_coordconv_00_production_shape.py``.
"""

import contextlib
import logging
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass
from typing import NoReturn

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coordconv_01"
down_revision: str | None = "coordrls_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

log = logging.getLogger("alembic.runtime.migration")

# ---------------------------------------------------------------------------
# Target definitions, as the catalog renders them under search_path =
# pg_catalog (the Phase 0 format).
# ---------------------------------------------------------------------------

#: Step 1: ``format_type``, ``attnotnull``, ``pg_get_expr`` of the column.
METADATA_COLUMN = ("jsonb", True, "'{}'::jsonb")

#: Step 2.
DEVICES_TENANT_KEY = "devices_tenant_id_fkey"
DEVICES_TENANT_KEY_DEFINITION = (
    "FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id) ON DELETE RESTRICT"
)

#: Step 3.
MEMORY_ID_DEFAULT = "gen_random_uuid()"

#: Steps 4 to 6: the production-only indexes, as Phase 0 measured them.
PRODUCTION_ONLY_MEMORIES_INDEXES = {
    "idx_memories_name_version": (
        "CREATE INDEX idx_memories_name_version ON coord.memories "
        "USING btree (name, version DESC)"
    ),
    "idx_memories_type": (
        "CREATE INDEX idx_memories_type ON coord.memories "
        "USING btree (type) WHERE (NOT is_tombstone)"
    ),
    "idx_memories_written_at": (
        "CREATE INDEX idx_memories_written_at ON coord.memories "
        "USING btree (written_at DESC)"
    ),
}

#: Step 7.
AGENT_QUESTIONS_AGENT_DEFINITION = (
    "CREATE INDEX idx_agent_questions_agent ON coord.agent_questions "
    "USING btree (agent_id, created_at DESC)"
)

#: Step 8.
SESSION_INDEX = "idx_agent_questions_session"
SESSION_STAGING = "idx_agent_questions_session_cc01"
SESSION_WIDE_DEFINITION = (
    "CREATE INDEX idx_agent_questions_session ON coord.agent_questions "
    "USING btree (agent_session_id, created_at DESC) "
    "WHERE (agent_session_id IS NOT NULL)"
)
SESSION_NARROW_DEFINITION = (
    "CREATE INDEX idx_agent_questions_session ON coord.agent_questions "
    "USING btree (agent_session_id) "
    "WHERE (agent_session_id IS NOT NULL)"
)

#: Steps 9 and 10.
TREE_KEY = "primary_trees_tenant_id_fkey"
_TREE_KEY_PREFIX = "FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id)"
TREE_KEY_SET_NULL = f"{_TREE_KEY_PREFIX} ON DELETE SET NULL"
TREE_KEY_CASCADE = f"{_TREE_KEY_PREFIX} ON DELETE CASCADE"
#: served policy production-and-cost prod-mutation: "fewer than 50 rows".
ORPHAN_BOUND = 50
ORPHAN_BACKUP = "web.coordconv_01_primary_trees_orphans"

# ---------------------------------------------------------------------------
# Shared mechanics.
# ---------------------------------------------------------------------------


def _read(query: sa.TextClause) -> list[sa.RowMapping]:
    """Read with ``search_path`` pinned to ``pg_catalog``, in a transaction of its own.

    The deparsers qualify a name only when the search path hides it. Pinning
    the path makes their output the shape Phase 0 measured, whatever the
    migrating role's own search path is. The counts read whole tables, so the
    read's lock wait and run time are bounded too.
    """
    bind = op.get_bind()
    op.execute("BEGIN")
    try:
        op.execute("SET LOCAL search_path TO pg_catalog")
        op.execute("SET LOCAL lock_timeout = '3s'")
        op.execute("SET LOCAL statement_timeout = '30s'")
        rows = list(bind.execute(query).mappings().all())
    except BaseException:
        with contextlib.suppress(Exception):
            op.execute("ROLLBACK")
        raise
    op.execute("COMMIT")
    return rows


@contextlib.contextmanager
def _own_transaction() -> Iterator[None]:
    """One explicit transaction inside the autocommit block, its lock wait bounded.

    ``SET LOCAL`` ends with the transaction, so nothing leaks into later steps
    or revisions. On failure the transaction is rolled back before the error
    propagates, so the connection is never left inside an aborted block.
    """
    op.execute("BEGIN")
    try:
        op.execute("SET LOCAL lock_timeout = '3s'")
        yield
    except BaseException:
        with contextlib.suppress(Exception):
            op.execute("ROLLBACK")
        raise
    op.execute("COMMIT")


@contextlib.contextmanager
def _bounded_lock_wait() -> Iterator[None]:
    """A session ``lock_timeout`` for a statement no transaction block may hold.

    ``RESET`` in the ``finally`` is required: outside the autocommit block the
    batch transaction would otherwise inherit the timeout.
    """
    op.execute("SET lock_timeout = '3s'")
    try:
        yield
    finally:
        op.execute("RESET lock_timeout")


def _refuse(step: int, message: str) -> NoReturn:
    raise RuntimeError(f"coordconv_01 step {step}: {message}")


_INDEX = sa.text(
    """
    SELECT c.relname                     AS name,
           pg_get_indexdef(i.indexrelid) AS definition,
           i.indisvalid                  AS valid
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'coord'
       AND c.relname = ANY(:names)
    """
)


def _indexes(*names: str) -> dict[str, sa.RowMapping]:
    """``name -> (name, definition, valid)`` of the named coord indexes that exist."""
    return {
        row["name"]: row
        for row in _read(_INDEX.bindparams(sa.bindparam("names", list(names))))
    }


# ---------------------------------------------------------------------------
# Step 1: coord.devices.metadata
# ---------------------------------------------------------------------------

_METADATA_COLUMN = sa.text(
    """
    SELECT format_type(a.atttypid, a.atttypmod) AS type,
           a.attnotnull                         AS not_null,
           pg_get_expr(d.adbin, d.adrelid)      AS default_expr
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = 'coord.devices'::regclass
       AND a.attname = 'metadata'
       AND a.attnum > 0
       AND NOT a.attisdropped
    """
)


def _step_01_devices_metadata() -> None:
    """The chain gains production's ``coord.devices.metadata``.

    Production carries ``metadata jsonb NOT NULL DEFAULT '{}'``, which a
    since-deleted Rust self-heal created and no revision does. D3 has
    production drop an object only when nothing uses it, and has the chain gain
    one "in use per coord's and web's read surfaces". coord's served
    read-surface manifest (``GET /coord/schema/read-surfaces``, read
    2026-10-15) carries ``devices *`` rows, among them ``routes_phase3.rs:
    star-select — the consumer intentionally takes the full row shape``: ``GET
    /coord/devices/by-user`` serves ``to_jsonb(d.*)``. No reader names the
    column (coord, web, runner and supervisor at ``origin/main``), but under
    that wildcard ``scripts/ci/check_coord_column_drops.py`` answers UNKNOWN
    for any column drop on the table, so the required
    ``coord-column-drop-guard`` check would refuse one. A later coord contract
    migration may remove the column from both sides once coord names its
    columns.

    Absent (a fresh database): added, a catalog-only change for a constant
    default. Present with exactly that definition (production): nothing. Any
    other definition: refused. Column ORDER still differs afterwards
    (production's sits mid-table); the plan's D4 takes order out of the
    equality.
    """
    rows = _read(_METADATA_COLUMN)
    if rows:
        found = (rows[0]["type"], rows[0]["not_null"], rows[0]["default_expr"])
        if found != METADATA_COLUMN:
            _refuse(
                1,
                f"coord.devices.metadata exists as (type, not_null, default) = "
                f"{found!r}, not {METADATA_COLUMN!r}. That shape was never "
                "measured, so it is not rewritten; converge it by hand.",
            )
        return
    with _own_transaction():
        op.execute(
            "ALTER TABLE coord.devices "
            "ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb"
        )


_VALUED_METADATA = sa.text(
    "SELECT count(*) AS valued FROM coord.devices "
    "WHERE metadata IS DISTINCT FROM '{}'::jsonb"
)


def _refuse_valued_metadata(valued: int) -> None:
    if valued:
        _refuse(
            1,
            f"undo: {valued} coord.devices row(s) hold a metadata value other "
            "than '{}'; removing the column would lose them. Copy them out "
            "first, then re-run the downgrade.",
        )


def _check_device_metadata_before_downgrading() -> None:
    """Refuse the whole downgrade, before any undo commits, if step 1's would refuse.

    Step 1's undo is the last to run, so refusing only there would leave steps
    10 to 7 undone under a database still stamped with this revision.
    """
    if _read(_METADATA_COLUMN):
        _refuse_valued_metadata(int(_read(_VALUED_METADATA)[0]["valued"]))


def _undo_01_devices_metadata() -> None:
    """The parent chain has no such column, so it goes, unless a row holds a value.

    On production this also removes the self-heal's column, which Phase 0 found
    holding only its default (finding ``35ca1c85``). A row whose ``metadata`` is
    anything but ``'{}'`` refuses the undo instead: removing the column would
    lose data no other copy holds. The table is locked before the rows are
    counted, in the transaction that drops the column, so no value can be
    written between the count and the drop.
    """
    if not _read(_METADATA_COLUMN):
        return
    with _own_transaction():
        op.execute("LOCK TABLE coord.devices IN ACCESS EXCLUSIVE MODE")
        _refuse_valued_metadata(int(op.get_bind().scalar(_VALUED_METADATA)))
        op.execute("ALTER TABLE coord.devices DROP COLUMN metadata")


# ---------------------------------------------------------------------------
# Step 2: devices_tenant_id_fkey
# ---------------------------------------------------------------------------

_DEVICES_TENANT_KEYS = sa.text(
    """
    SELECT c.conname                   AS name,
           pg_get_constraintdef(c.oid) AS definition,
           c.convalidated              AS validated
      FROM pg_constraint c
     WHERE c.conrelid = 'coord.devices'::regclass
       AND c.contype = 'f'
       AND pg_get_constraintdef(c.oid)
           LIKE 'FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id)%'
     ORDER BY c.conname
    """
)

_DEVICES_REFERENCES = sa.text(
    """
    SELECT count(*) FILTER (WHERE d.tenant_id IS NULL) AS nulls,
           count(*) FILTER (
               WHERE d.tenant_id IS NOT NULL
                 AND NOT EXISTS (
                     SELECT 1 FROM coord.tenants t WHERE t.tenant_id = d.tenant_id
                 )
           ) AS orphans
      FROM coord.devices d
    """
)


def _devices_refuse_orphans() -> None:
    counts = _read(_DEVICES_REFERENCES)[0]
    log.info(
        "coordconv_01 step 2: coord.devices tenant_id: %d orphaned, %d NULL",
        counts["orphans"],
        counts["nulls"],
    )
    if counts["orphans"]:
        _refuse(
            2,
            f"{counts['orphans']} coord.devices row(s) name a tenant_id missing "
            "from coord.tenants, so the chain's key cannot be validated. Nothing "
            "was written by this step, which repairs no data: resolve those rows, "
            "then re-run.",
        )


def _step_02_devices_tenant_key() -> None:
    """Production gains the chain's ``devices_tenant_id_fkey`` (``ON DELETE RESTRICT``).

    Production has no such key: the ``ADD COLUMN IF NOT EXISTS ... REFERENCES``
    revision skipped where a since-deleted self-heal had made the column, the
    mechanism ``coord_tenant_fk_01`` documents (its repair list missed this
    table). Phase 0 measured no orphaned and no NULL ``tenant_id``.

    Found by definition, and it must carry the canonical name. Absent: the rows
    the key would reject are counted, read-only, first; any orphan refuses the
    step. Then ``ADD ... NOT VALID`` and ``VALIDATE``, each its own transaction
    (``VALIDATE`` takes only ``SHARE UPDATE EXCLUSIVE`` while it scans). Left
    ``NOT VALID`` by an interrupted run: counted, then validated, where
    ``coord_tenant_fk_01``'s guard would have skipped it for good. Any other
    tenant key on the column: refused.
    """
    keys = _read(_DEVICES_TENANT_KEYS)
    if not keys:
        _devices_refuse_orphans()
        with _own_transaction():
            op.execute(
                "ALTER TABLE coord.devices ADD CONSTRAINT devices_tenant_id_fkey "
                "FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id) "
                "ON DELETE RESTRICT NOT VALID"
            )
    else:
        accepted = {
            DEVICES_TENANT_KEY_DEFINITION,
            f"{DEVICES_TENANT_KEY_DEFINITION} NOT VALID",
        }
        if len(keys) != 1 or (
            keys[0]["name"] != DEVICES_TENANT_KEY
            or keys[0]["definition"] not in accepted
        ):
            found = [(k["name"], k["definition"]) for k in keys]
            _refuse(
                2,
                f"coord.devices carries tenant key(s) {found!r}, not the chain's "
                f"{DEVICES_TENANT_KEY} ({DEVICES_TENANT_KEY_DEFINITION}). That shape "
                "was never measured; converge it by hand.",
            )
        if keys[0]["validated"]:
            return
        _devices_refuse_orphans()
    with _own_transaction():
        op.execute(
            "ALTER TABLE coord.devices VALIDATE CONSTRAINT devices_tenant_id_fkey"
        )


# ---------------------------------------------------------------------------
# Step 3: coord.memories.memory_id default
# ---------------------------------------------------------------------------

_MEMORY_ID_DEFAULT = sa.text(
    """
    SELECT pg_get_expr(d.adbin, d.adrelid) AS default_expr
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = 'coord.memories'::regclass
       AND a.attname = 'memory_id'
       AND a.attnum > 0
       AND NOT a.attisdropped
    """
)


def _step_03_memory_id_default() -> None:
    """Production gains the chain's ``memory_id DEFAULT gen_random_uuid()``.

    ``coord_memories`` creates the table with ``CREATE TABLE IF NOT EXISTS`` and
    this default; production's column has none (Phase 0, finding ``35ca1c85``),
    the shape that statement leaves when the table already existed. Adding one
    changes no stored row; an ``INSERT``
    that omits ``memory_id`` then succeeds, as it does on a fresh database. The
    function is named with its schema so no other ``gen_random_uuid`` a search
    path puts first can bind; ``pg_get_expr`` renders it as the chain's. No
    default: set. The chain's default: nothing. Any other default: refused.
    """
    rows = _read(_MEMORY_ID_DEFAULT)
    if not rows:
        _refuse(3, "coord.memories has no memory_id column; that was never measured.")
    found = rows[0]["default_expr"]
    if found == MEMORY_ID_DEFAULT:
        return
    if found is not None:
        _refuse(
            3,
            f"coord.memories.memory_id defaults to {found!r}, not "
            f"{MEMORY_ID_DEFAULT!r} and not to nothing. That shape was never "
            "measured; converge it by hand.",
        )
    with _own_transaction():
        op.execute(
            "ALTER TABLE coord.memories "
            "ALTER COLUMN memory_id SET DEFAULT pg_catalog.gen_random_uuid()"
        )


# ---------------------------------------------------------------------------
# Steps 4 to 6: production-only indexes on coord.memories
# ---------------------------------------------------------------------------


def _production_only_index_present(step: int, name: str) -> bool:
    """True when ``name`` exists with production's measured definition.

    Valid or ``INVALID``: an interrupted ``DROP INDEX CONCURRENTLY`` leaves it
    ``INVALID`` with the same definition, and a re-run drops it. Any other
    definition under the name was never measured and refuses the step.
    """
    found = _indexes(name).get(name)
    if found is None:
        return False
    expected = PRODUCTION_ONLY_MEMORIES_INDEXES[name]
    if found["definition"] != expected:
        _refuse(
            step,
            f"coord.{name} is {found['definition']!r}, not {expected!r}. That index "
            "was never measured, so it is left alone; resolve it by hand.",
        )
    return True


def _step_04_drop_idx_memories_name_version() -> None:
    """Production drops ``idx_memories_name_version``, a self-heal index the chain lacks.

    Its key, ``(name, version DESC)``, duplicates the chain's own
    ``idx_memories_name_latest``, which both sides keep. No code names it, and
    Phase 0 read its scans as negligible (finding ``35ca1c85``). ``DROP INDEX
    CONCURRENTLY`` blocks neither reads nor writes. An index holds no data.
    """
    if _production_only_index_present(4, "idx_memories_name_version"):
        with _bounded_lock_wait():
            op.execute("DROP INDEX CONCURRENTLY coord.idx_memories_name_version")


def _step_05_drop_idx_memories_type() -> None:
    """Production drops ``idx_memories_type``, a self-heal index the chain lacks.

    Phase 0 found it never scanned (finding ``35ca1c85``), and no code names it.
    """
    if _production_only_index_present(5, "idx_memories_type"):
        with _bounded_lock_wait():
            op.execute("DROP INDEX CONCURRENTLY coord.idx_memories_type")


def _step_06_drop_idx_memories_written_at() -> None:
    """Production drops ``idx_memories_written_at``, a self-heal index the chain lacks.

    Its key, ``(written_at DESC)``, duplicates the chain's own
    ``idx_memories_recent``, which both sides keep. Phase 0 found it never
    scanned (finding ``35ca1c85``), and no code names it.
    """
    if _production_only_index_present(6, "idx_memories_written_at"):
        with _bounded_lock_wait():
            op.execute("DROP INDEX CONCURRENTLY coord.idx_memories_written_at")


# ---------------------------------------------------------------------------
# Step 7: idx_agent_questions_agent
# ---------------------------------------------------------------------------


def _step_07_idx_agent_questions_agent() -> None:
    """The chain gains production's ``idx_agent_questions_agent``.

    A self-heal index production has and is using (Phase 0 read non-zero scans,
    finding ``35ca1c85``); building it on a fresh database costs nothing. With
    production's definition and valid: nothing. Absent: built ``CONCURRENTLY``.
    ``INVALID`` (an interrupted build): dropped and rebuilt, which ``IF NOT
    EXISTS`` would not have done. Another definition: refused.
    """
    found = _indexes("idx_agent_questions_agent").get("idx_agent_questions_agent")
    if found is not None:
        if found["definition"] != AGENT_QUESTIONS_AGENT_DEFINITION:
            _refuse(
                7,
                f"coord.idx_agent_questions_agent is {found['definition']!r}, not "
                f"{AGENT_QUESTIONS_AGENT_DEFINITION!r}. That index was never "
                "measured; resolve it by hand.",
            )
        if found["valid"]:
            return
        with _bounded_lock_wait():
            op.execute("DROP INDEX CONCURRENTLY coord.idx_agent_questions_agent")
    with _bounded_lock_wait():
        op.execute(
            "CREATE INDEX CONCURRENTLY idx_agent_questions_agent "
            "ON coord.agent_questions USING btree (agent_id, created_at DESC)"
        )


def _undo_07_idx_agent_questions_agent() -> None:
    """The parent chain has no such index; on production that also removes the
    self-heal's."""
    with _bounded_lock_wait():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS coord.idx_agent_questions_agent")


# ---------------------------------------------------------------------------
# Step 8: idx_agent_questions_session
# ---------------------------------------------------------------------------


def _drop_session_staging() -> None:
    with _bounded_lock_wait():
        op.execute("DROP INDEX CONCURRENTLY coord.idx_agent_questions_session_cc01")


def _swap_session_index(target: str, build_staging: Callable[[], None]) -> None:
    """Swap ``idx_agent_questions_session`` to ``target`` through the staging name.

    Build the target under the staging name, drop the old index, rename: a
    lookup by session always has an index, and every step is read from the
    catalog, so an interrupted run resumes where it stopped. A staging index
    that is ``INVALID`` or not the target is dropped and rebuilt first.
    """
    found = _indexes(SESSION_INDEX, SESSION_STAGING)
    current, staging = found.get(SESSION_INDEX), found.get(SESSION_STAGING)
    if current is None and staging is None:
        _refuse(
            8,
            f"coord.{SESSION_INDEX} does not exist, and no staging copy does either. "
            "The chain always creates it, so a database without it was never "
            "measured; resolve it by hand.",
        )
    if current is not None and current["definition"] not in (
        SESSION_WIDE_DEFINITION,
        SESSION_NARROW_DEFINITION,
    ):
        _refuse(
            8,
            f"coord.{SESSION_INDEX} is {current['definition']!r}, neither the "
            "chain's narrow definition nor production's wide one. That index was "
            "never measured; resolve it by hand.",
        )
    if current is not None and current["valid"] and current["definition"] == target:
        if staging is not None:
            _drop_session_staging()
        return
    if staging is not None and (
        not staging["valid"]
        or staging["definition"].replace(SESSION_STAGING, SESSION_INDEX, 1) != target
    ):
        _drop_session_staging()
        staging = None
    if staging is None:
        with _bounded_lock_wait():
            build_staging()
    if current is not None:
        with _bounded_lock_wait():
            op.execute("DROP INDEX CONCURRENTLY coord.idx_agent_questions_session")
    with _own_transaction():
        op.execute(
            "ALTER INDEX coord.idx_agent_questions_session_cc01 "
            "RENAME TO idx_agent_questions_session"
        )


def _build_wide_session_staging() -> None:
    op.execute(
        "CREATE INDEX CONCURRENTLY idx_agent_questions_session_cc01 "
        "ON coord.agent_questions USING btree (agent_session_id, created_at DESC) "
        "WHERE (agent_session_id IS NOT NULL)"
    )


def _build_narrow_session_staging() -> None:
    op.execute(
        "CREATE INDEX CONCURRENTLY idx_agent_questions_session_cc01 "
        "ON coord.agent_questions USING btree (agent_session_id) "
        "WHERE (agent_session_id IS NOT NULL)"
    )


def _step_08_idx_agent_questions_session() -> None:
    """The chain gains production's wider ``idx_agent_questions_session``.

    ``coord_agent_questions`` creates it on ``(agent_session_id)`` with ``IF
    NOT EXISTS``; production already had a self-heal index of that name on
    ``(agent_session_id, created_at DESC)``, same predicate, so the ``IF NOT
    EXISTS`` skipped. Phase 0 read the wide index's scans as non-zero (finding
    ``35ca1c85``). It serves every lookup the narrow one does, and the
    newest-first reads besides. Wide and valid (production): nothing; anything
    else measured: swapped to wide. Neither definition: refused.
    """
    _swap_session_index(SESSION_WIDE_DEFINITION, _build_wide_session_staging)


def _undo_08_idx_agent_questions_session() -> None:
    """The same swap, back to the parent chain's narrow definition."""
    _swap_session_index(SESSION_NARROW_DEFINITION, _build_narrow_session_staging)


# ---------------------------------------------------------------------------
# Steps 9 and 10: primary_trees_tenant_id_fkey
# ---------------------------------------------------------------------------

_TREE_KEYS = sa.text(
    """
    SELECT c.conname                   AS name,
           pg_get_constraintdef(c.oid) AS definition,
           c.convalidated              AS validated
      FROM pg_constraint c
     WHERE c.conrelid = 'coord.primary_trees'::regclass
       AND c.contype = 'f'
       AND pg_get_constraintdef(c.oid)
           LIKE 'FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id)%'
     ORDER BY c.conname
    """
)

_TREE_REFERENCES = sa.text(
    """
    SELECT count(*) FILTER (WHERE p.tenant_id IS NULL) AS nulls,
           count(*) FILTER (
               WHERE p.tenant_id IS NOT NULL
                 AND NOT EXISTS (
                     SELECT 1 FROM coord.tenants t WHERE t.tenant_id = p.tenant_id
                 )
           ) AS orphans
      FROM coord.primary_trees p
    """
)

_ORPHAN_BACKUP_EXISTS = sa.text(
    "SELECT to_regclass('web.coordconv_01_primary_trees_orphans') IS NOT NULL "
    "AS present"
)

# One statement, so a row is never deleted without its copy.
_MOVE_ORPHANS = sa.text(
    """
    WITH moved AS (
        DELETE FROM coord.primary_trees AS p
         WHERE p.tenant_id IS NOT NULL
           AND NOT EXISTS (
               SELECT 1 FROM coord.tenants AS t WHERE t.tenant_id = p.tenant_id
           )
        RETURNING p.*
    )
    INSERT INTO web.coordconv_01_primary_trees_orphans
           (device_id, repo, tenant_id, row_data)
    SELECT m.device_id, m.repo, m.tenant_id, to_jsonb(m)
      FROM moved AS m
    """
)

# Newest copy per (device_id, repo). A row whose key is taken again is newer
# and is kept. A row whose device is gone stays gone: had it never been moved,
# the device's delete would have cascaded it (primary_trees_device_id_fkey).
_RESTORE_ORPHANS = sa.text(
    """
    INSERT INTO coord.primary_trees
    SELECT r.*
      FROM (
          SELECT DISTINCT ON (b.device_id, b.repo) b.row_data
            FROM web.coordconv_01_primary_trees_orphans AS b
           ORDER BY b.device_id, b.repo, b.backed_up_at DESC
      ) AS latest
     CROSS JOIN LATERAL
           jsonb_populate_record(NULL::coord.primary_trees, latest.row_data) AS r
     WHERE NOT EXISTS (
           SELECT 1 FROM coord.primary_trees AS p
            WHERE p.device_id = r.device_id AND p.repo = r.repo
     )
       AND EXISTS (SELECT 1 FROM coord.devices AS d WHERE d.device_id = r.device_id)
    """
)

# What the restore leaves out, and why, counted before it runs.
_RESTORE_SKIPS = sa.text(
    """
    SELECT count(*) FILTER (WHERE d.device_id IS NULL) AS device_gone,
           count(*) FILTER (
               WHERE d.device_id IS NOT NULL AND p.device_id IS NOT NULL
           ) AS recreated
      FROM (
          SELECT DISTINCT b.device_id, b.repo
            FROM web.coordconv_01_primary_trees_orphans AS b
      ) AS k
      LEFT JOIN coord.devices AS d ON d.device_id = k.device_id
      LEFT JOIN coord.primary_trees AS p
             ON p.device_id = k.device_id AND p.repo = k.repo
    """
)


def _tree_key(step: int, accepted: set[str]) -> sa.RowMapping:
    """The table's one tenant key, refusing any shape outside ``accepted``."""
    keys = _read(_TREE_KEYS)
    if len(keys) != 1 or (
        keys[0]["name"] != TREE_KEY or keys[0]["definition"] not in accepted
    ):
        found = [(k["name"], k["definition"]) for k in keys]
        _refuse(
            step,
            f"coord.primary_trees carries tenant key(s) {found!r}, not {TREE_KEY} "
            f"as one of {sorted(accepted)!r}. That shape was never measured; "
            "converge it by hand.",
        )
    return keys[0]


def _with_not_valid(*definitions: str) -> set[str]:
    return {d + suffix for d in definitions for suffix in ("", " NOT VALID")}


def _step_09_primary_trees_orphans_and_validation() -> None:
    """Production's ``NOT VALID`` tenant key on ``primary_trees`` is repaired and validated.

    ``coord_tenant_fk_01`` added the key ``NOT VALID`` and then validated it in
    a second step. In production the validation did not complete, and that
    revision's re-run guard matches a ``NOT VALID`` key, so every later run
    skipped it. Production's table holds rows naming no row of
    ``coord.tenants`` (Phase 0, finding ``35ca1c85``, re-measured 2026-10-15),
    which is what a ``VALIDATE`` refuses. coord's tree upsert never rewrites
    ``tenant_id`` on conflict, so such a row keeps its dead tenant while its
    device reports, invisible to every tenant-scoped read; once removed, the
    device's next report re-creates it under the tenant coord resolves now,
    which the key checks on insert.

    The removal is data repair. It reaches production through the pipeline
    [policy: production-and-cost pipeline-deploys-are-not-adhoc-mutation], and
    is bound by [policy: production-and-cost prod-mutation] anyway:

    * SIZED FIRST: orphans and NULLs are counted, read-only, before any write.
      ``prod-mutation`` permits fewer than 50 rows, so 50 or more refuses the
      step and nothing is written; the count is checked again inside the
      deleting transaction, which rolls back above it.
    * REVERSIBLE-SAFE: each orphan is copied whole, as ``to_jsonb`` of the row,
      into ``web.coordconv_01_primary_trees_orphans`` by the statement that
      deletes it. The copy lives in web's own schema, outside the ``coord``
      schema the plan fingerprints (D4), so production and a fresh database
      still compare equal. The downgrade puts back every backed-up row whose
      device still exists.
    * A FRESH DATABASE writes nothing: its key is validated, which admits no
      orphan.

    The key must carry the canonical name. ``ON DELETE SET NULL`` and
    validated: nothing to do. ``ON DELETE CASCADE``, valid or not: step 10 has
    already swapped it, which it does only once no orphan is left, so this step
    is done; a retry of a run that failed inside step 10 passes through here.
    ``SET NULL`` and ``NOT VALID``: the repair below. Anything else refuses the
    step.
    """
    key = _tree_key(9, _with_not_valid(TREE_KEY_SET_NULL, TREE_KEY_CASCADE))
    if key["validated"] or key["definition"].startswith(TREE_KEY_CASCADE):
        return
    counts = _read(_TREE_REFERENCES)[0]
    orphans = int(counts["orphans"])
    log.info(
        "coordconv_01 step 9: coord.primary_trees tenant_id: %d orphaned, %d NULL",
        orphans,
        counts["nulls"],
    )
    if orphans >= ORPHAN_BOUND:
        _refuse(
            9,
            f"refusing: {orphans} coord.primary_trees row(s) name a tenant missing "
            f"from coord.tenants, and production-and-cost prod-mutation permits "
            f"fewer than {ORPHAN_BOUND}. Nothing was written by this step. Look at "
            "who is creating them before repairing them.",
        )
    if orphans:
        with _own_transaction():
            op.execute("SET LOCAL statement_timeout = '30s'")
            op.execute(
                """
                CREATE TABLE IF NOT EXISTS web.coordconv_01_primary_trees_orphans (
                    device_id    uuid        NOT NULL,
                    repo         text        NOT NULL,
                    tenant_id    uuid        NOT NULL,
                    row_data     jsonb       NOT NULL,
                    backed_up_at timestamptz NOT NULL DEFAULT now(),
                    PRIMARY KEY (device_id, repo, backed_up_at)
                )
                """
            )
            op.execute(
                "COMMENT ON TABLE web.coordconv_01_primary_trees_orphans IS "
                "'coord.primary_trees rows whose tenant_id named no coord.tenants "
                "row, moved here whole (row_data = to_jsonb of the row) by step 9 of "
                "alembic revision coordconv_01 so the table tenant key could be "
                "validated. Its downgrade puts back the rows whose device still "
                "exists. Plan "
                "2026-10-15-coord-schema-is-authored-in-a-different-repo-than-coord, "
                "Phase 6.'"
            )
            moved = op.get_bind().execute(_MOVE_ORPHANS).rowcount
            if moved >= ORPHAN_BOUND:
                _refuse(
                    9,
                    f"refusing: {moved} rows matched at delete time, not fewer "
                    f"than {ORPHAN_BOUND}; rolled back, nothing written.",
                )
        log.info("coordconv_01 step 9: moved %d row(s) into %s", moved, ORPHAN_BACKUP)
    with _own_transaction():
        op.execute(
            "ALTER TABLE coord.primary_trees "
            "VALIDATE CONSTRAINT primary_trees_tenant_id_fkey"
        )


def _undo_09_primary_trees_orphans_and_validation() -> None:
    """Where the backup exists, the backed-up rows and the ``NOT VALID`` key come back.

    In one transaction: the key is dropped, every backed-up row is re-inserted
    whose device still exists and whose ``(device_id, repo)`` is free, the key
    is re-added ``NOT VALID`` as before, and the backup is dropped. Left out:
    a row a device has re-created since (it is newer, and is kept) and a row of
    a device deleted since (the device's delete would have cascaded it). Both
    are counted in the log. When no row comes back, nothing is left for the key
    to refuse, so it is re-added validated: the parent chain's definition, the
    same end state as on a database step 9 never had to repair. Without a
    backup (a fresh database, or this undo already done) nothing changes.
    Dropping the key takes ``ACCESS EXCLUSIVE`` on ``coord.tenants`` (module
    docs), so the transaction waits at most 1 s.
    """
    if not _read(_ORPHAN_BACKUP_EXISTS)[0]["present"]:
        return
    _tree_key(9, _with_not_valid(TREE_KEY_SET_NULL))
    with _own_transaction():
        op.execute("SET LOCAL lock_timeout = '1s'")
        op.execute(
            "ALTER TABLE coord.primary_trees "
            "DROP CONSTRAINT primary_trees_tenant_id_fkey"
        )
        skips = op.get_bind().execute(_RESTORE_SKIPS).mappings().one()
        restored = op.get_bind().execute(_RESTORE_ORPHANS).rowcount
        if restored:
            op.execute(
                "ALTER TABLE coord.primary_trees ADD CONSTRAINT "
                "primary_trees_tenant_id_fkey FOREIGN KEY (tenant_id) "
                "REFERENCES coord.tenants(tenant_id) ON DELETE SET NULL NOT VALID"
            )
        else:
            op.execute(
                "ALTER TABLE coord.primary_trees ADD CONSTRAINT "
                "primary_trees_tenant_id_fkey FOREIGN KEY (tenant_id) "
                "REFERENCES coord.tenants(tenant_id) ON DELETE SET NULL"
            )
        op.execute("DROP TABLE web.coordconv_01_primary_trees_orphans")
    log.info(
        "coordconv_01 step 9 undo: restored %d row(s); kept %d re-created since; "
        "left out %d whose device was deleted since",
        restored,
        skips["recreated"],
        skips["device_gone"],
    )


def _tree_refuse_orphans(step: int) -> None:
    orphans = int(_read(_TREE_REFERENCES)[0]["orphans"])
    if orphans:
        _refuse(
            step,
            f"{orphans} coord.primary_trees row(s) name a tenant missing from "
            "coord.tenants, so no tenant key can be validated. Nothing was written "
            "by this step; step 9 is the one that repairs them.",
        )


def _step_10_primary_trees_key_cascades() -> None:
    """``primary_trees_tenant_id_fkey`` becomes ``ON DELETE CASCADE``, on every database.

    The latent defect Phase 0 found: the key is ``ON DELETE SET NULL`` on a
    ``NOT NULL`` column (``coord_tenant_scope_columns`` made it while the column
    was nullable; ``coord_tenant_id_not_null`` later made the column NOT NULL).
    Deleting a tenant a row names fails with a NOT NULL violation; the declared
    action can never happen.

    CASCADE, from evidence. Among keys from a NOT NULL ``tenant_id`` to
    ``coord.tenants`` at ``image_assets_01``, CASCADE is the rule (22), RESTRICT
    the exception for rows carrying identity or history (4: ``devices``,
    ``sessions``, ``memory_records``, ``memory_links``), and SET NULL appears
    only on this defect (5 tables). A ``primary_trees`` row is the last
    observation of one checkout on one device: owned by its device
    (``primary_trees_device_id_fkey ... ON DELETE CASCADE``), rewritten by the
    device's next report, read only through its tenant (coord's
    ``data/primary_trees.rs``, ``fleet_health.rs``, ``policies/decide.rs``,
    ``wip_attribution.rs``). Without its tenant it has no reader and nothing a
    report will not restore; ``device_status`` and ``tenant_devices``, the other
    per-device observation rows, are deleted with their tenant too. RESTRICT
    would keep the refused delete for rows nothing can read [policy:
    engineering-priorities design-tradeoff-ranking, ranks 1 and 3]. The same
    SET NULL on NOT NULL on ``agent_logs``, ``agent_questions``,
    ``agent_worktrees`` and ``memories`` is left for its own decision: those
    rows are history.

    CASCADE and valid: nothing. SET NULL: the orphan count must be zero (step
    9 makes it so); one ``ALTER TABLE`` drops the key and adds it ``ON DELETE
    CASCADE NOT VALID``, so the table is never without one, waiting at most 1 s
    because the drop locks ``coord.tenants`` (module docs); then ``VALIDATE``
    in a transaction of its own. CASCADE ``NOT VALID`` (an interrupted run):
    counted, then validated.
    """
    key = _tree_key(10, _with_not_valid(TREE_KEY_SET_NULL, TREE_KEY_CASCADE))
    if key["definition"] == TREE_KEY_CASCADE and key["validated"]:
        return
    _tree_refuse_orphans(10)
    if key["definition"].startswith(TREE_KEY_SET_NULL):
        with _own_transaction():
            # The drop takes ACCESS EXCLUSIVE on coord.tenants (module docs).
            op.execute("SET LOCAL lock_timeout = '1s'")
            op.execute(
                "ALTER TABLE coord.primary_trees "
                "DROP CONSTRAINT primary_trees_tenant_id_fkey, "
                "ADD CONSTRAINT primary_trees_tenant_id_fkey "
                "FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id) "
                "ON DELETE CASCADE NOT VALID"
            )
    with _own_transaction():
        op.execute(
            "ALTER TABLE coord.primary_trees "
            "VALIDATE CONSTRAINT primary_trees_tenant_id_fkey"
        )


def _undo_10_primary_trees_key_cascades() -> None:
    """The same swap, back to the parent chain's ``ON DELETE SET NULL``, validated.

    A validated ``SET NULL`` key is this undo already done (or step 9's undo
    done, having restored no row): nothing to do. A ``NOT VALID`` one is one of
    two states. With the step-9 backup gone and orphans present it is step 9's
    undo done, which re-added the key ``NOT VALID`` because it restored rows the
    key would refuse: nothing to do, so a downgrade that failed after step 9's
    undo finishes on a re-run. Otherwise (the backup still there, or no orphan
    at all) it is this undo interrupted between its swap and its ``VALIDATE``,
    and it is validated.
    """
    key = _tree_key(10, _with_not_valid(TREE_KEY_SET_NULL, TREE_KEY_CASCADE))
    if key["definition"].startswith(TREE_KEY_SET_NULL):
        if key["validated"]:
            return
        backup = _read(_ORPHAN_BACKUP_EXISTS)[0]["present"]
        if not backup and int(_read(_TREE_REFERENCES)[0]["orphans"]):
            return
    _tree_refuse_orphans(10)
    if key["definition"].startswith(TREE_KEY_CASCADE):
        with _own_transaction():
            # The drop takes ACCESS EXCLUSIVE on coord.tenants (module docs).
            op.execute("SET LOCAL lock_timeout = '1s'")
            op.execute(
                "ALTER TABLE coord.primary_trees "
                "DROP CONSTRAINT primary_trees_tenant_id_fkey, "
                "ADD CONSTRAINT primary_trees_tenant_id_fkey "
                "FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id) "
                "ON DELETE SET NULL NOT VALID"
            )
    with _own_transaction():
        op.execute(
            "ALTER TABLE coord.primary_trees "
            "VALIDATE CONSTRAINT primary_trees_tenant_id_fkey"
        )


# ---------------------------------------------------------------------------
# The revision.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Step:
    number: int
    name: str
    apply: Callable[[], None]


#: Run in this order. ``upgrade()`` reads it at call time.
STEPS: tuple[Step, ...] = (
    Step(1, "coord.devices.metadata joins the chain", _step_01_devices_metadata),
    Step(2, "production gains devices_tenant_id_fkey", _step_02_devices_tenant_key),
    Step(3, "production gains the memory_id default", _step_03_memory_id_default),
    Step(
        4,
        "production drops idx_memories_name_version",
        _step_04_drop_idx_memories_name_version,
    ),
    Step(5, "production drops idx_memories_type", _step_05_drop_idx_memories_type),
    Step(
        6,
        "production drops idx_memories_written_at",
        _step_06_drop_idx_memories_written_at,
    ),
    Step(
        7,
        "the chain gains idx_agent_questions_agent",
        _step_07_idx_agent_questions_agent,
    ),
    Step(
        8,
        "the chain gains the wide idx_agent_questions_session",
        _step_08_idx_agent_questions_session,
    ),
    Step(
        9,
        "primary_trees orphans backed up and removed; tenant key validated",
        _step_09_primary_trees_orphans_and_validation,
    ),
    Step(
        10,
        "primary_trees tenant key cascades",
        _step_10_primary_trees_key_cascades,
    ),
)


def upgrade() -> None:
    """Steps 1 to 10, each in an autocommit block of its own; see the module docs."""
    for step in STEPS:
        with op.get_context().autocommit_block():
            log.info("coordconv_01 step %d/%d: %s", step.number, len(STEPS), step.name)
            step.apply()


def downgrade() -> None:
    """Steps 10 to 1 undone, each to ``coordrls_01``'s chain shape.

    Steps 2 to 6 undo nothing: the parent chain already has their objects and
    lacks their drops. Step 1's refusal is checked first, so a downgrade that
    would lose a ``metadata`` value refuses before anything is undone.
    """
    with op.get_context().autocommit_block():
        _check_device_metadata_before_downgrading()
    for undo in (
        _undo_10_primary_trees_key_cascades,
        _undo_09_primary_trees_orphans_and_validation,
        _undo_08_idx_agent_questions_session,
        _undo_07_idx_agent_questions_agent,
        _undo_01_devices_metadata,
    ):
        with op.get_context().autocommit_block():
            undo()
