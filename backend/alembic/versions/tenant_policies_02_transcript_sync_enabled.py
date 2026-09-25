"""coord.tenant_policies — add ``transcript_sync_enabled``

Revision ID: tenant_policies_02_transcript_sync_enabled
Revises: worker_hb_body_started_01
Create Date: 2026-09-22

Phase 1a of plan
``qontinui-dev-notes/plans/2026-09-22-transcript-sync-default-on-with-tenant-and-user-controls.md``,
schema half only. This is a **new** per-tenant consent gate for transcript
sync, deliberately decoupled from the existing ``session_coordination_enabled``
column on this same table — that column is the dormant-by-design Phase 10
coord-native session-coordination dual-write cutover flag (plan
``2026-05-23-coord-native-sessions-phase-7-10.md``) and is not touched by this
migration or by this plan at all. ``claim_steal_visibility`` and
``output_{warm,cold}_quota_bytes`` are likewise untouched.

* ``transcript_sync_enabled`` — per-tenant consent for coord to accept
  transcript-sync content on ingest. The read/write route
  (``GET``/``PATCH /tenant-policy``) and the actual ``post_output``
  enforcement land in a **separate** ``qontinui-coord`` PR (Phase 1b of the
  same plan) — see "Deploy ordering" below, which is the load-bearing
  section. This migration only adds the column and its default.

Why the default is ``true``
============================
Per ``engineering-priorities`` ``capability-ships-enabled``: this is a
user-preference axis with no safety gap (redaction is defense in depth and is
unaffected either way), so it ships on with a reachable off-switch rather than
off-by-default as a safety measure. ``DEFAULT true`` is also the single point
of truth for "what a brand-new tenant gets" — reversing that default later
(the operator's own "easy to change back" requirement) is one future
migration line, ``ALTER COLUMN transcript_sync_enabled SET DEFAULT false``,
which affects only tenants created after it runs, not any existing tenant.

On the no-row fallback (a tenant with no ``coord.tenant_policies`` row at all,
which reads ``TenantPolicy::defaults()`` instead): that Rust-side default must
also be ``true`` for this field, matching this column's default, or a no-row
tenant would silently read as opted OUT while a with-row tenant reads opted
IN — the same trap ``session_coordination_enabled``'s own ``defaults()``
comment warns about for the opposite polarity (there the safe default is
``false``; here, per ``capability-ships-enabled``, it is ``true``). That is
Phase 1b's concern (the ``TenantPolicy`` struct lives in ``qontinui-coord``),
not this migration's — noted here only so a Phase 1b reader does not miss it.

Idempotent ``ADD COLUMN IF NOT EXISTS`` / ``DROP COLUMN IF EXISTS`` — same
precedent as ``a1cc120c0fba_add_renderer_memory_telemetry_to_devices`` — so
this decouples deploy order between ``qontinui-web`` and ``qontinui-coord``.

Deploy ordering (load-bearing)
===============================
Per ``production-and-cost`` ``alembic-sole-authorship``: a coord PR that
READS a new ``coord.<table>.<column>`` can go live BEFORE the migration
creating it, so land this migration FIRST and confirm it live (applied to the
serving database) before merging Phase 1b's coord PR — the coord PR is
labelled ``downstream-of`` this one via ``coord-pr-label`` so the merge train
sequences them correctly rather than relying on manual timing. Phase 1b also
carries its own belt-and-braces targeted missing-column degrade
(``pg_error::is_missing_column_error``) for the case where a coord deploy
races ahead anyway — that is a coord-side concern and does not change
anything here.

No backfill statement
======================
No explicit ``UPDATE coord.tenant_policies SET transcript_sync_enabled =
true`` follows the ``ADD COLUMN`` below. This is deliberate, not an
oversight: Postgres applies a column's ``DEFAULT`` to every existing row at
``ADD COLUMN`` time (confirmed for this fleet's Postgres 16), so a follow-up
``UPDATE ... SET transcript_sync_enabled = true`` would be a no-op over every
row this ``ADD COLUMN`` already touched. Per ``production-and-cost``
``pipeline-deploys-are-not-adhoc-mutation``, the DDL alone already reaches
every existing tenant through the normal migration pipeline, so no separate
ask-first ad-hoc mutation step is needed either.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "tenant_policies_02_transcript_sync_enabled"
down_revision: str | Sequence[str] | None = "worker_hb_body_started_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add ``coord.tenant_policies.transcript_sync_enabled``. Idempotent."""
    op.execute(
        """
        ALTER TABLE coord.tenant_policies
            ADD COLUMN IF NOT EXISTS transcript_sync_enabled
                BOOLEAN NOT NULL DEFAULT true
        """
    )


def downgrade() -> None:
    """Remove ``coord.tenant_policies.transcript_sync_enabled``."""
    op.execute(
        """
        ALTER TABLE coord.tenant_policies
            DROP COLUMN IF EXISTS transcript_sync_enabled
        """
    )
