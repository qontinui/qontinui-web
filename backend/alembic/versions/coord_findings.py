"""coord.findings (Session Bus Phase 2 — ephemeral cross-session knowledge feed)

Revision ID: coord_findings
Revises: dropautoresp01_drop_auto_response_rules
Create Date: 2026-06-15

Phase 2 of plan
``D:/qontinui-root/plans/2026-06-15-inter-session-session-bus.md``.

Stands up ``coord.findings``: the ephemeral knowledge tier between a session's
private transcript and the permanent, distilled ``MEMORY.md``. A finding is the
*raw recent investigation* one session produces — longer than a memory,
shorter-lived (TTL ~14 days), resource/topic-scoped, and auto-expiring so it
never accumulates the way memories would. A session pulls recent findings for
the resources/topics it is about to work on; it posts one when it finishes an
investigation. (Plan problem 2: "a session doesn't learn from a recent
investigation a concurrent session just did.")

Schema:

* ``finding_id UUID PRIMARY KEY``     — synthetic id.
* ``tenant_id UUID NOT NULL``         — owning tenant. Project findings are
  tenant-scoped (read like ``coord.agent_questions``).
* ``scope TEXT NOT NULL``             — ``'tenant'`` (default) or
  ``'fleet-infra'`` (review item 11): operational truths about SHARED
  coord/runner behavior valuable to every tenant, stored under the system
  tenant and surfaced fleet-wide. The ephemeral analog of a shared
  ``MEMORY.md`` entry.
* ``author_session UUID``             — best-effort link to the authoring
  ``coord.agent_sessions`` row; NULL outside a session.
* ``author_device UUID``              — best-effort device link.
* ``kind TEXT NOT NULL``              — ``investigation`` (default) |
  ``caveat`` | ``gotcha`` | ``status`` (review item 3): much of the
  highest-value cross-session knowledge is tool-reliability caveats and
  operational gotchas, not just investigations.
* ``topic TEXT``                      — subsystem/topic tag (review item 7),
  e.g. ``coord-deploy`` / ``merge-engine``. Lets a firefighting session query
  findings by subsystem before it knows which files are involved.
* ``resource_keys TEXT[]``            — file globs / PR / plan-slug refs this
  finding pertains to; the boot-pull match key (array-overlap via GIN).
* ``title TEXT NOT NULL``             — one-line headline.
* ``body TEXT NOT NULL``              — the finding (longer than a memory).
* ``artifact_refs JSONB NOT NULL``    — structured PR/commit/deploy-run refs
  (review item 3). JSONB so refs can grow without a migration. Default ``{}``.
* ``supersedes UUID``                 — corrects/supersedes edge (review item
  9): a later finding can mark an earlier ``finding_id`` superseded, since live
  diagnoses evolve and flip. Reads return only the live head of a chain.
* ``created_at TIMESTAMPTZ``          — when posted.
* ``expires_at TIMESTAMPTZ NOT NULL`` — TTL horizon (~14d). The recent-findings
  read filters ``expires_at > now()`` so stale findings drop out automatically.

Indices:

* ``idx_findings_resource_keys``      — GIN over ``resource_keys`` for the
  array-overlap (``&&``) boot-pull: "findings touching any of my paths."
* ``idx_findings_tenant_recent``      — ``(tenant_id, expires_at)`` for the
  tenant-scoped, not-expired scan ordered by recency.
* ``idx_findings_topic``              — partial on ``topic`` for the
  by-subsystem on-demand query (review item 7).

Idempotency: ``CREATE TABLE IF NOT EXISTS`` + ``CREATE INDEX IF NOT EXISTS``,
matching the ``coord_agent_questions`` posture. The coord Rust side reads/writes
this table BEST-EFFORT (graceful degradation, like ``coord.agent_sessions``) and
does NOT add it to the boot ``require_table`` canonical-schema gate, so coord and
this migration can land in either order without the boot-gate crash-loop that
caused the 2026-06 deploy outage (plan §"Autonomous drivers", review item 16).

NOTE: ``down_revision`` was assigned by ``coord_migration_reserve`` on 2026-06-18
(reservation ``543124fb-acc8-4b5b-b91f-d7e88cd0812a``, position 2 → chained off the
queue tail ``dropautoresp01_drop_auto_response_rules``, NOT the bare main head — the
queue's fork prevention). The reservation is bound to PR #602 via
``coord_migration_bind_pr``; coord releases it on merge. Do NOT hand-edit the
``down_revision`` (memory ``feedback_migration_reservation_withdraw_cascade_repoint_hazard``).

Chains off ``dropautoresp01_drop_auto_response_rules``.
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_findings"
down_revision: str | Sequence[str] | None = "dropautoresp01_drop_auto_response_rules"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.findings`` + indices. Idempotent."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.findings (
            finding_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id      UUID NOT NULL,
            scope          TEXT NOT NULL DEFAULT 'tenant',
            author_session UUID,
            author_device  UUID,
            kind           TEXT NOT NULL DEFAULT 'investigation',
            topic          TEXT,
            resource_keys  TEXT[] NOT NULL DEFAULT '{}',
            title          TEXT NOT NULL,
            body           TEXT NOT NULL,
            artifact_refs  JSONB NOT NULL DEFAULT '{}'::jsonb,
            supersedes     UUID,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            expires_at     TIMESTAMPTZ NOT NULL
        )
        """
    )
    # Boot-pull: findings whose resource_keys overlap the caller's paths.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_findings_resource_keys
            ON coord.findings USING GIN (resource_keys)
        """
    )
    # Tenant-scoped, not-expired recency scan.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_findings_tenant_recent
            ON coord.findings (tenant_id, expires_at)
        """
    )
    # By-subsystem on-demand query.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_findings_topic
            ON coord.findings (topic)
            WHERE topic IS NOT NULL
        """
    )


def downgrade() -> None:
    """Drop ``coord.findings`` + indices."""
    op.execute("DROP INDEX IF EXISTS coord.idx_findings_topic")
    op.execute("DROP INDEX IF EXISTS coord.idx_findings_tenant_recent")
    op.execute("DROP INDEX IF EXISTS coord.idx_findings_resource_keys")
    op.execute("DROP TABLE IF EXISTS coord.findings")
