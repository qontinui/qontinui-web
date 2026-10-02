"""coord.spawn_admission_ledger — per-machine spawn admission grants, refusals and reports

Revision ID: spawnadm_01_spawn_admission_ledger
Revises: cmtland_01
Create Date: 2026-10-01

Prerequisite of plan
``2026-10-01-runner-spawn-bursts-are-unregulated-coord-must-admit-spawns-per-machine``
(vet decision D1 — lease persistence is a PG ledger, not Redis, and not a held
``AdmissionLease`` connection).

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the
table lands here, in qontinui-web, and must be DEPLOYED before coord's
``POST /coord/devices/me/spawn-admission`` routes read and write it. coord is
expected to read it readiness-gated; whatever coord answers while the table is
absent, the runner client is expected (plan
``2026-10-01-runner-spawn-bursts-are-unregulated-coord-must-admit-spawns-per-machine``,
§3 "Offline / coord-unreachable") to treat any non-grant answer, a 404 from a
coord that does not serve the routes included, as admission UNKNOWN and fall
back to its local token bucket.

The re-point rule
=================

``down_revision`` is this repo's LOCAL single alembic head at authoring time and
is deliberately NOT pinned to it: ``alembic-graph-pr.yml`` serialises alembic
PRs, so a revision that lands ahead of this one re-forks the chain and this line
is re-pointed at the new head. Re-point it; do NOT author an ``alembic merge``
revision and do NOT order it with coord dependency labels.

The gap
=======

Runner spawn bursts are unregulated: continuations, autofix dispatches and
local spawns each decide on their own whether to start a process, and nothing
counts them per machine. coord's admission route answers "may this device start
N more agent sessions now?" from a per-device token bucket plus a live count, and
the bucket and the in-flight permits both need durable state that outlives one
HTTP request. This ledger is that state:

* a ``grant`` row is a runner-held permit (``count`` permits, leased until
  ``lease_expires_at``, closed by ``released_at`` on release / convert / the
  expiry sweep). The bucket's refill is computed from grant rows in the trailing
  window; outstanding permits are unreleased, unexpired grants.
* a ``refusal`` row records an admission coord refused (``verdict``, ``reason``).
* a ``report`` row is the runner's cumulative per-origin spawn counter since boot
  (``boot_id``) — what makes bare shell PTYs, invisible to the placement live
  predicate, count at all.
* a ``shadow`` row is the verdict coord WOULD have returned while enforcement is
  off (Phase 0/1), so the bucket can be calibrated before it refuses anything.

Column contract — shared with coord's Rust code and the runner client
=====================================================================

``id UUID PRIMARY KEY DEFAULT gen_random_uuid()``
    A grant's id is the ``lease_id`` handed to the runner.

``tenant_id UUID NOT NULL`` / ``device_id UUID NOT NULL``
    From the caller's verified device JWT, never the request body. No FKs: an
    admission log must never fail an insert for referential bookkeeping.

``class TEXT NOT NULL`` — CHECK ``autofix`` | ``continuation`` | ``local`` | ``attended``
    The spawn class. The bucket covers ``local`` + ``continuation`` combined;
    ``attended`` is reported, never refused.

``origin TEXT NOT NULL``
    The runner's ``SpawnOrigin::as_wire()`` value, or a coord-side origin
    (``continuation_pull``, ``continuation_push``, ``autofix``). Deliberately
    unconstrained: it grows with the runner's spawn sites, and the runner and
    coord deploy independently of this schema.

``kind TEXT NOT NULL`` — CHECK ``grant`` | ``refusal`` | ``report`` | ``shadow``

``count INTEGER NOT NULL DEFAULT 1`` — CHECK ``count >= 0``
    Permits granted / refused, or the cumulative counter on a report row (which
    may legitimately be 0).

``verdict TEXT NULL`` / ``reason TEXT NULL``
    e.g. ``admit`` / ``refuse``, and a ``held_by``-style reason key. Free text:
    the reason vocabulary is grown from data.

``lease_expires_at TIMESTAMPTZ NULL`` / ``released_at TIMESTAMPTZ NULL``
    Grants only. NULL ``released_at`` on a grant means the permit is still out.

``boot_id TEXT NULL``
    Reports only — counters are cumulative per runner boot, so the latest report
    per ``boot_id`` is the reading.

``work_keys JSONB NOT NULL DEFAULT '[]'``
    The work items the spawn was for, when the caller named them.

``created_at TIMESTAMPTZ NOT NULL DEFAULT now()``

Indexes
=======

* ``(device_id, created_at DESC)`` — the bucket window and latest-report reads.
* ``(tenant_id, created_at DESC)`` — the tenant feed.
* partial ``(device_id, lease_expires_at) WHERE kind = 'grant' AND released_at
  IS NULL`` — outstanding permits, and the expiry sweep.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "spawnadm_01_spawn_admission_ledger"
down_revision: str | Sequence[str] | None = "cmtland_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the ledger + its indexes. No rows."""
    # Raw ``op.execute`` with IF NOT EXISTS throughout — the convention the
    # sibling coord ledger tables use, and what keeps a re-run harmless.
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.spawn_admission_ledger (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id         UUID NOT NULL,
            device_id         UUID NOT NULL,
            class             TEXT NOT NULL,
            origin            TEXT NOT NULL,
            kind              TEXT NOT NULL,
            count             INTEGER NOT NULL DEFAULT 1,
            verdict           TEXT NULL,
            reason            TEXT NULL,
            lease_expires_at  TIMESTAMPTZ NULL,
            released_at       TIMESTAMPTZ NULL,
            boot_id           TEXT NULL,
            work_keys         JSONB NOT NULL DEFAULT '[]'::jsonb,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_spawn_admission_ledger_class
                CHECK (class IN ('autofix', 'continuation', 'local', 'attended')),
            CONSTRAINT ck_spawn_admission_ledger_kind
                CHECK (kind IN ('grant', 'refusal', 'report', 'shadow')),
            CONSTRAINT ck_spawn_admission_ledger_count
                CHECK (count >= 0)
        )
        """
    )
    # Bucket window + latest report per boot, per device.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_spawn_admission_ledger_device_created_at
            ON coord.spawn_admission_ledger (device_id, created_at DESC)
        """
    )
    # Tenant feed, newest first.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_spawn_admission_ledger_tenant_created_at
            ON coord.spawn_admission_ledger (tenant_id, created_at DESC)
        """
    )
    # Outstanding permits per device, and the lease-expiry sweep.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_spawn_admission_ledger_open_grants
            ON coord.spawn_admission_ledger (device_id, lease_expires_at)
            WHERE kind IN ('grant', 'shadow')
              AND verdict = 'admit'
              AND released_at IS NULL
        """
    )


def downgrade() -> None:
    """Drop the ledger + its indexes. Any recorded rows go with it."""
    op.execute("DROP INDEX IF EXISTS coord.ix_spawn_admission_ledger_open_grants")
    op.execute("DROP INDEX IF EXISTS coord.ix_spawn_admission_ledger_tenant_created_at")
    op.execute("DROP INDEX IF EXISTS coord.ix_spawn_admission_ledger_device_created_at")
    # DROP TABLE takes every CHECK constraint with it.
    op.execute("DROP TABLE IF EXISTS coord.spawn_admission_ledger")
