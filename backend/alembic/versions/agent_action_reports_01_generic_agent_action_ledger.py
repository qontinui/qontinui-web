"""coord.agent_action_reports — generic multi-class agent action ledger

Revision ID: agent_action_reports_01
Revises: operators_disabled_01
Create Date: 2026-07-30

Phase P0 of ``plans/2026-07-28-agent-autonomy-with-reporting.md`` (§5, §6 P0).

Stands up ``coord.agent_action_reports``: an append-only ledger of consequential
actions an agent took **autonomously**, so "autonomy + reporting" has a durable
record to report from. coord OWNS reads/writes of this table; web only authors
the DDL. Per fleet policy coord authors ZERO ``coord.*`` DDL
(``tests/coord_schema_authorship.rs``), so THIS web migration is the sole DDL
author and coord's consumer does pure DML.

CRITICAL SCOPING — read before adding a writer
==============================================

This table is for the **generic, multi-class** action ledger ONLY: plan §7
classes **B** (gate approve / attest), **C** (merge-class: pr-merge settings,
repo profiles, reevaluate, spawn-fix, proposal cancel, suggestions, kill-switch,
rollout) and **D** (device / tenant / operator admin). Those classes have no
reporting surface of their own today; this is it.

Policy-**document** writes (plan §7 class **A**) are deliberately **NOT**
recorded here. They already have a complete, shipped reporting substrate:

* ``coord.prompt_document_proposals`` — the **pending** side (a re-routed
  loosening/unclassifiable edit awaiting operator review), created by revision
  ``prompt_doc_proposals_01``.
* ``coord.prompt_document_versions`` — the **landed** side (the version history
  of an edit that went straight in).
* The shipped ``/admin/coord/prompt-document-proposals`` page reads **both** and
  renders them as one feed, with its own Revert affordance.

Emitting an ``agent_action_reports`` row for a document write would therefore
make every policy edit appear **twice**, on two different pages, behind two
Revert buttons that do different things. That is plan §9's *"Duplicate reporting
surfaces"* risk, and it is the exact reason the vet (2026-07-30) rescoped P0 to
the non-document classes.

**So, explicitly: "unifying" this table with the prompt-document proposal /
version tables is a duplicate-reporting BUG, not a cleanup.** Do not migrate
document writes into this table, do not backfill them here, and do not teach the
document write path to emit here. If you want one page showing both, join at the
read layer — never at the write layer. A test asserting that a document write
produces **zero** ``agent_action_reports`` rows is part of this plan's §8
verification; if you find yourself deleting that test, you are the contributor
this docstring was written for.

Schema
======

* ``id UUID PRIMARY KEY``              — synthetic id.
* ``tenant_id UUID NOT NULL``          — owning tenant (see design notes: no FK).
* ``action_class TEXT NOT NULL``       — what kind of action, e.g.
  ``'gate_attest'``, ``'merge_settings_patch'``, ``'device_admin'``.
* ``severity TEXT NOT NULL``           — ``info`` | ``notable`` | ``sensitive``.
  ``sensitive`` rows additionally raise a ``coord.alerts`` row so they surface on
  the existing alerts page + nav badge (plan §5); that emission is coord-side
  consumer behaviour, not DDL.
* ``actor TEXT NOT NULL``              — the **authenticated** identity that took
  the action (``session:<uuid>`` / ``agent:<uuid>`` / ``device:<uuid>`` per
  ``authorship_actor``), never a client-supplied string.
* ``session_id TEXT``                  — the agent session, when known.
* ``summary TEXT NOT NULL``            — one line, human-first. This is what the
  operator reads; it must stand alone without opening ``detail``.
* ``detail JSONB NOT NULL``            — structured specifics (target ids, before
  /after values, change notes, version numbers). ``'{}'::jsonb`` when there is
  nothing to say — NOT NULL so consumers never branch on null.
* ``revert_ref JSONB``                 — machine-readable instructions for the
  Revert affordance, e.g. ``{"kind": ..., "name": ..., "restore_to_version": N}``.
  NULL means *this action is not revertible*, which is a first-class state: the
  page must render such a row without a Revert button rather than offering a
  revert that cannot work (plan §9, *"Revert that doesn't revert"*).
* ``reverted_at TIMESTAMPTZ``          — stamped on the ORIGINAL row when a
  revert of it lands. NULL = not reverted.
* ``reverted_by TEXT``                 — authenticated identity that reverted.
* ``created_at TIMESTAMPTZ NOT NULL``  — when the action happened.

Index
=====

* ``ix_agent_action_reports_tenant_created`` — ``(tenant_id, created_at DESC)``,
  the report page's **only** query shape (tenant-scoped, newest first). Severity
  filtering is done in the page over that ordered window, so it is deliberately
  not part of the index — adding columns speculatively is how index sprawl
  starts.

Design notes
============

* **Append-only by convention.** A revert writes a **NEW** row (describing the
  revert as its own action) and *stamps* the original's ``reverted_at`` /
  ``reverted_by``. Nothing else ever mutates a row, and rows are never deleted.
  The two revert columns are the sole exception to immutability and exist so the
  page can strike through an action without rewriting history. This is a
  convention enforced by the consumer, not by a DB trigger — a trigger would
  make the exception impossible to express.
* ``tenant_id`` carries **NO foreign key** to ``coord.tenants``, matching the
  ancestor pattern (``coord.prompt_documents``, ``coord.agent_registry``,
  ``coord.prompt_document_proposals``): coord-side seeding is warn-and-continue,
  and an FK would silently re-introduce the inert-feature failure class — the
  report insert would fail for a tenant that was never seeded, and the feature
  would look "shipped but empty" rather than broken.
* ``action_class`` and ``severity`` are **Rust-enforced vocabularies,
  deliberately NOT DB CHECK constraints** — per the precedent set by
  ``coord.agent_registry`` (``agent_registry_01``) and
  ``coord.prompt_document_proposals`` (``prompt_doc_proposals_01``): vocab
  columns stay CHECK-free so that adding an action class or a severity level
  never requires a migration. ``action_class`` in particular grows every time a
  new class B/C/D route is brought under the dial.
* ``actor`` / ``reverted_by`` are free-text authenticated identities (agent id,
  device id, or operator user), with no FK to a users table because the two
  identity spaces differ (``auth.users`` vs ``coord.operators``).
* No FK from ``revert_ref`` to anything either — it is an opaque, per-class
  payload interpreted by the class's own revert handler.
* Idempotency: every DDL uses ``IF NOT EXISTS`` / ``IF EXISTS``; ``downgrade()``
  is symmetric and drops index-then-table. coord reads/writes BEST-EFFORT (a
  missing table logs WARN and is treated as "no reports" — it is NOT in the boot
  ``require_table`` gate) so coord and this migration may land in either order
  without a boot-gate crash-loop.

Chains off ``operators_disabled_01``, the single live head of the alembic chain
on ``main`` at authoring time (computed from the repo, not from the plan). If a
concurrent head-race moves ``main``'s head before this lands, re-point
``down_revision`` onto the new head.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "agent_action_reports_01"
down_revision: str | Sequence[str] | None = "operators_disabled_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the generic agent action ledger + its one index. Idempotent."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.agent_action_reports (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id     UUID NOT NULL,
            action_class  TEXT NOT NULL,
            severity      TEXT NOT NULL,
            actor         TEXT NOT NULL,
            session_id    TEXT,
            summary       TEXT NOT NULL,
            detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
            revert_ref    JSONB,
            reverted_at   TIMESTAMPTZ,
            reverted_by   TEXT,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    # Serves the report page's only list read: tenant-scoped, newest first.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_agent_action_reports_tenant_created
            ON coord.agent_action_reports (tenant_id, created_at DESC)
        """
    )


def downgrade() -> None:
    """Drop the ledger (no data migrated in, plain drop)."""
    op.execute("DROP INDEX IF EXISTS coord.ix_agent_action_reports_tenant_created")
    op.execute("DROP TABLE IF EXISTS coord.agent_action_reports")
