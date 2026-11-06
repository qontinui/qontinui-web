"""web: retire coordconv_01's primary_trees orphan backup, after a read-only guard

Revision ID: coordconv_01r
Revises: capmodel_01
Create Date: 2026-11-06

Retention follow-up of ``coordconv_01`` (qontinui-web#1914), plan
``2026-10-15-coord-schema-is-authored-in-a-different-repo-than-coord``, Phase 6
"Before 6.1". Step 9 of ``coordconv_01`` moved every ``coord.primary_trees``
row whose ``tenant_id`` named no ``coord.tenants`` row into
``web.coordconv_01_primary_trees_orphans`` (``row_data`` = ``to_jsonb`` of the
row), so the table's tenant key could be validated. The backup existed only so
that ``coordconv_01``'s downgrade could put those rows back. A 21-day retention
gate was registered when the revision applied; it has elapsed.

State this revision was authored against (read-only, 2026-11-06)
================================================================
* ``web.coordconv_01_primary_trees_orphans`` present in production
  (``coord_query_schema_object``, ``live_rds_catalog``, ``qontinui_db``).
* Production's applied alembic head is ``capmodel_01``, equal to the chain head,
  single head: ``coordconv_01`` applied weeks ago and nothing is pending below
  it (``coord_query_migration_state``). No downgrade through ``coordconv_01`` is
  planned; the plan's alembic freeze (Phase 6.1) has not landed, so this chain
  is still the single author.
* coord finding ``7b9c8a79`` (2026-10-19): step 9 applied, 0 orphans left,
  32 rows in the backup, ``primary_trees_tenant_id_fkey`` validated and
  ``ON DELETE CASCADE``.

The guard (read-only, before any write)
=======================================
The table is dropped only when nothing in it could still be restored as a
live row. In one ``READ ONLY`` transaction, the revision counts:

1. ``coord.primary_trees`` rows naming a tenant missing from ``coord.tenants``.
   The validated key makes this 0; a non-zero count means the table is in a
   shape nobody measured, and the backup is the only record of step 9, so the
   revision refuses.
2. Backed-up rows (the newest copy per ``(device_id, repo)``) that are no longer
   orphans: their tenant exists again, their device still exists, and their
   ``(device_id, repo)`` is free in ``coord.primary_trees``. Such a row is valid
   data the drop would lose, so the revision refuses and names the count.
   Rows whose tenant is still missing are exactly what step 9 removed: a
   restore would only make them orphans again, invisible to every
   tenant-scoped read, so they carry no recoverable value. A row whose key was re-created since is superseded by the
   newer row, and a row whose device was deleted would have cascaded.

Both counts are taken first in a READ ONLY transaction and then again inside
the transaction that drops the table, so a tenant re-created in between is
still seen. A refusal writes nothing and names what it found; decide the rows
by hand, then re-run. An absent table (a fresh database, or one where step 9 found no orphan)
is a no-op.

Downgrade
=========
Nothing comes back: the drop is the point of the revision. After it,
``coordconv_01``'s downgrade finds no backup and its step-9 undo does nothing,
the same path as on a database step 9 never had to repair.

The drop runs in an ``autocommit_block`` as its own transaction under
``lock_timeout = '3s'``; nothing else references the table.
"""

import contextlib
import logging
from collections.abc import Sequence
from typing import NoReturn

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coordconv_01r"
down_revision: str | None = "capmodel_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

log = logging.getLogger("alembic.runtime.migration")

ORPHAN_BACKUP = "web.coordconv_01_primary_trees_orphans"

_BACKUP_EXISTS = sa.text(
    "SELECT to_regclass('web.coordconv_01_primary_trees_orphans') IS NOT NULL "
    "AS present"
)

_LIVE_ORPHANS = sa.text(
    """
    SELECT count(*) AS orphans
      FROM coord.primary_trees AS p
     WHERE p.tenant_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM coord.tenants AS t WHERE t.tenant_id = p.tenant_id
       )
    """
)

# The newest copy per (device_id, repo), as coordconv_01's restore reads it.
_BACKUP_COUNTS = sa.text(
    """
    WITH latest AS (
        SELECT DISTINCT ON (b.device_id, b.repo)
               b.device_id, b.repo, b.tenant_id
          FROM web.coordconv_01_primary_trees_orphans AS b
         ORDER BY b.device_id, b.repo, b.backed_up_at DESC
    )
    SELECT (SELECT count(*) FROM web.coordconv_01_primary_trees_orphans) AS rows,
           count(*) AS keys,
           count(*) FILTER (
               WHERE EXISTS (
                         SELECT 1 FROM coord.tenants AS t
                          WHERE t.tenant_id = l.tenant_id
                     )
                 AND EXISTS (
                         SELECT 1 FROM coord.devices AS d
                          WHERE d.device_id = l.device_id
                     )
                 AND NOT EXISTS (
                         SELECT 1 FROM coord.primary_trees AS p
                          WHERE p.device_id = l.device_id AND p.repo = l.repo
                     )
           ) AS restorable
      FROM latest AS l
    """
)


def _refuse(message: str) -> NoReturn:
    raise RuntimeError(f"coordconv_01r: {message}")


def _read_only(*queries: sa.TextClause) -> list[sa.RowMapping]:
    """Each query's first row, all in one READ ONLY transaction of its own."""
    bind = op.get_bind()
    op.execute("BEGIN READ ONLY")
    try:
        op.execute("SET LOCAL lock_timeout = '3s'")
        op.execute("SET LOCAL statement_timeout = '30s'")
        rows = [bind.execute(q).mappings().one() for q in queries]
    except BaseException:
        with contextlib.suppress(Exception):
            op.execute("ROLLBACK")
        raise
    op.execute("COMMIT")
    return rows


def _refuse_unless_retirable(live: sa.RowMapping, counts: sa.RowMapping) -> None:
    if int(live["orphans"]):
        _refuse(
            f"refusing: {live['orphans']} coord.primary_trees row(s) name a "
            "tenant missing from coord.tenants, which the validated tenant key "
            f"should make impossible. {ORPHAN_BACKUP} is the only record of "
            "coordconv_01 step 9, so it is kept. Nothing was written."
        )
    if int(counts["restorable"]):
        _refuse(
            f"refusing: {counts['restorable']} backed-up row(s) in "
            f"{ORPHAN_BACKUP} are no longer orphans (tenant and device exist, "
            "(device_id, repo) free in coord.primary_trees); dropping the "
            "backup would lose them. Restore or discard them by hand, then "
            "re-run. Nothing was written."
        )


def upgrade() -> None:
    with op.get_context().autocommit_block():
        (backup,) = _read_only(_BACKUP_EXISTS)
        if not backup["present"]:
            log.info("coordconv_01r: %s absent; nothing to retire", ORPHAN_BACKUP)
            return
        live, counts = _read_only(_LIVE_ORPHANS, _BACKUP_COUNTS)
        log.info(
            "coordconv_01r: coord.primary_trees orphans %d; backup rows %d over "
            "%d (device_id, repo) keys, %d restorable",
            live["orphans"],
            counts["rows"],
            counts["keys"],
            counts["restorable"],
        )
        _refuse_unless_retirable(live, counts)
        bind = op.get_bind()
        op.execute("BEGIN")
        try:
            op.execute("SET LOCAL lock_timeout = '3s'")
            op.execute("SET LOCAL statement_timeout = '30s'")
            # Re-checked under the drop's own transaction: nothing can become
            # restorable between this read and the DROP's commit unnoticed.
            _refuse_unless_retirable(
                bind.execute(_LIVE_ORPHANS).mappings().one(),
                bind.execute(_BACKUP_COUNTS).mappings().one(),
            )
            op.execute("DROP TABLE IF EXISTS web.coordconv_01_primary_trees_orphans")
        except BaseException:
            with contextlib.suppress(Exception):
                op.execute("ROLLBACK")
            raise
        op.execute("COMMIT")
        log.info("coordconv_01r: dropped %s", ORPHAN_BACKUP)


def downgrade() -> None:
    log.info(
        "coordconv_01r downgrade: %s is not re-created; its rows are gone by design",
        ORPHAN_BACKUP,
    )
