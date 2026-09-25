"""coord.overlap_detections (durable PG sink for events.coord.overlap.detected)

Revision ID: coord_overlap_detections
Revises: pdtier_03
Create Date: 2026-09-17

Phase 1 of ``2026-09-17-coord-overlap-detections-durable-sink.md``.

Stands up ``coord.overlap_detections``: an append-only sink mirroring the
``events.coord.overlap.detected`` channel, one row per published event. coord's
``after_intent_write`` (``agent_worktrees.rs``) publishes that event once per
``OverlapHit`` whenever an agent writes intent — on allocate and on
``declare_intent`` — and today the event is observable NOWHERE past 7 days: the
JetStream ``coord-events`` stream's ``max_age`` is 7 days, and no PG row is
written at all.

Why the table exists at all: coord gate ``l3-gated-on-l2-overlap-rate``
(``855a818d-6d1f-4b75-bf88-56f65b484426``, on the parent plan
``2026-05-14-active-agent-coordination-design``) asks whether the overlap-event
rate is "sustained >5/day over 28d". Nothing on the fleet can answer that, so
the gate can only ever be attested on a guess. This table is the measurement
surface; a later ``NamedQuery`` in coord does the counting.

The sink stores every publish RAW (it mirrors the channel, re-declarations
included). Deduplication belongs to the READ, not to the write: one long-lived
pair of agents that re-declares intent five times publishes five identical
events, so a naive ``count(*)`` would clear the parent gate on a single pair of
agents talking to itself. The counting query therefore counts DAYS whose
distinct unordered agent pairs exceed the bar — which is why ``agent_a`` /
``agent_b`` are both stored plainly and why the session columns are kept
alongside them.

coord OWNS reads/writes of this table; web only authors the DDL. Per fleet
policy coord authors ZERO ``coord.*`` DDL, so THIS web migration is the sole
DDL author.

Schema:

* ``event_id UUID PRIMARY KEY``         — synthetic id.
* ``tenant_id UUID``                    — the declarer's tenant
  (``DeclarerIdentity.tenant_id``); ``detect_overlap`` already scopes peers to
  it. Nullable: the identity resolution is best-effort.
* ``agent_a UUID NOT NULL``             — the DECLARING agent.
* ``agent_b UUID NOT NULL``             — the overlapping peer
  (``OverlapHit.agent_b``).
* ``session_a UUID``                    — declarer's harness session, when
  resolvable.
* ``session_b UUID``                    — peer's harness session
  (``OverlapHit.session_b``, explicitly optional). Both are nullable, which is
  exactly why the counting unit is the AGENT pair and not the session pair —
  a session-keyed count is undefined on the rows where either is null.
* ``overlapping_paths TEXT[] NOT NULL`` — the published payload's field,
  verbatim.
* ``trigger TEXT NOT NULL``             — ``allocate`` or ``declare_intent``,
  the two ``after_intent_write`` callers. ``trigger`` is a non-reserved word in
  PostgreSQL and needs no quoting, so the counting SQL reads plainly.
* ``created_at TIMESTAMPTZ NOT NULL``   — when the overlap was published.

Indices:

* ``idx_overlap_det_created``         — ``(created_at)`` — the 28-day windowed
  count the gate predicate runs.
* ``idx_overlap_det_tenant_created``  — ``(tenant_id, created_at)`` — for a
  future tenant-scoped reader. Today's ``NamedQuery`` whitelist is
  parameter-free and fleet-wide, so nothing scoped reads this yet.

No retention sweep is added. Volume is bounded by intent writes x live peers in
one tenant and the query only ever reads 28 days; a prune (precedent
``edit_effects::prune_old_fs_rows``) is a measured follow-up, not a speculative
one.

Idempotency: ``CREATE TABLE/INDEX IF NOT EXISTS``. coord reads/writes
BEST-EFFORT — a pool error or a missing table logs WARN and continues, exactly
like ``edit_effects::detect_and_record_drift``, and the publish, the
SessionAdvice ladder and the HTTP response are never affected. The table is
DELIBERATELY **not** added to coord's ``schema_manifest::ALEMBIC_OWNED_TABLES``
/ the boot ``require_table`` gate (``coord.footprint_drift_events`` is not
there either), so coord and this migration may deploy in EITHER ORDER without a
boot-gate crash-loop. The corresponding read is fail-open too:
``GatePredicate::SqlCount`` is ``Open`` on a query error, so a not-yet-migrated
table leaves the gate open rather than failed — the safe direction, and the
reason the migration still lands first (an open gate on a query that has never
once succeeded is indistinguishable from one that is genuinely measuring).

Chains off ``coord_agent_worktrees_credentialed_at_01``, the single live head of
``origin/main``'s alembic chain. This revision was first written against
``coord_system_tenant_rename_qontinui`` (2026-09-17), which was the head at
authoring time; ``coord_agent_worktrees_credentialed_at_01`` landed on top of it
hours later and forked the chain. A parent that has landed but is no longer the
head forks exactly as a never-landed one does. If a concurrent head-race moves
``main``'s head again before this lands, re-point ``down_revision`` onto the new
head.
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_overlap_detections"
down_revision: str | Sequence[str] | None = "pdtier_03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.overlap_detections`` + indices. Idempotent."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.overlap_detections (
            event_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id          UUID,
            agent_a            UUID NOT NULL,
            agent_b            UUID NOT NULL,
            session_a          UUID,
            session_b          UUID,
            overlapping_paths  TEXT[] NOT NULL,
            trigger            TEXT NOT NULL,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    # The 28-day windowed count behind the l3-overlap-rate gate predicate.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_overlap_det_created
            ON coord.overlap_detections (created_at)
        """
    )
    # Any future tenant-scoped reader.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_overlap_det_tenant_created
            ON coord.overlap_detections (tenant_id, created_at)
        """
    )


def downgrade() -> None:
    """Drop ``coord.overlap_detections`` + indices."""
    op.execute("DROP INDEX IF EXISTS coord.idx_overlap_det_tenant_created")
    op.execute("DROP INDEX IF EXISTS coord.idx_overlap_det_created")
    op.execute("DROP TABLE IF EXISTS coord.overlap_detections")
