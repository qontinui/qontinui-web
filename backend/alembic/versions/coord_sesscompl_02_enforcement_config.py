"""coord.session_compliance_config(+_versions) — versioned enforcement config

Revision ID: coord_sesscompl_02
Revises: coord_sesscompl_01
Create Date: 2026-07-30

Phase 2 (§B2) of plan
``D:/qontinui-root/qontinui-dev-notes/plans/2026-07-30-session-compliance-report-enforcement.md``.

Per-tenant enforcement settings for the session compliance-report check:
``{enabled, enforced_clause_ref, mode, max_attempts}``.

Why its own versioned tables, and NOT ``coord.prompt_documents.attrs``
=====================================================================

Plan §B2 is explicit. An ``attrs``-only PATCH takes coord's **non-versioning**
branch — no snapshot row, no ``current_version`` bump
(``qontinui-coord/src/prompt_documents.rs:23-35``, ``:674``) — and coord's own
module docs state the trap outright: *"anything that needs versioning cannot
live in attrs"*. Enforcement config **changes agent-visible behaviour** and must
be auditable ("who turned this on, when, and what was it before"), so it gets
its own versioned rows rather than a JSONB side-channel.

Shape
=====

The versioning idiom is copied from the proven sibling pair in this same schema,
``coord.prompt_documents`` / ``coord.prompt_document_versions``
(``coord_prompt_docs_01_prompt_documents.py``): a live parent row carrying
``current_version``, plus an **append-only, immutable** child table with one
snapshot row per version and ``UNIQUE (parent_id, version)``. coord INSERTs the
snapshot and UPDATEs ``current_version`` in the same transaction, under
``FOR UPDATE`` on the parent (``prompt_documents.rs:805-884``). History is never
rewritten; a rollback is an ordinary forward edit that creates a NEW version.

Note the one deliberate naming divergence from that sibling: the version column
here is ``version`` (the prompt-document table calls it ``version_number``).
``version`` is the name in the plan's column contract and therefore in coord's
reader; the column set is a **shared contract** with the coord Rust code and
must not drift from this list.

Defaults
========

* ``enabled`` defaults to **false**, deliberately. The plan's Sequencing section
  ships §1 **report-only** — "a check that blocks before its false-positive rate
  is measured would train sessions to route around it." Enforcement is inert
  until an operator explicitly turns it on, so this migration alone enables
  nothing anywhere.
* ``enforced_clause_ref`` defaults to ``policy/planning-and-scope#finish-to-zero``.
  It **names a clause**, and enforcement auto-inerts when that clause is absent
  from the active prompt-document version — derived, never separately
  configured, so it cannot drift when someone edits the prompt
  (``[policy: design-tradeoff-ranking#3]``).

  The document half of that ref is ``planning-and-scope``, **not**
  ``session-protocol``, and the distinction is load-bearing because the ref is
  resolved literally against clause ids. ``policy/planning-and-scope`` carries
  ``## clause: finish-to-zero`` (operator-authored 2026-07-19) — that is where
  the clause id lives, and it is the operator's "work-to-0 clause" that anchors
  applicability. ``policy/session-protocol`` uses ``## Step N — …`` headings and
  registers no ``finish-to-zero`` clause id: its Step 3 is the POLICY_COMPLIANCE
  footer this check looks for, and its Step 2 is *about* finishing to zero, but
  neither is a citable clause. Pointing the default at ``session-protocol``
  would resolve to nothing and silently auto-inert enforcement for every tenant
  — an invisible no-op, the exact failure class this plan exists to remove.
* ``mode`` ∈ (``nudge``, ``reopen``), default ``nudge``. ``reopen`` spawns work
  that OUTLIVES the request, which ``[policy: agent-spawn-authorization]``
  requires be opt-in — hence it is never the default.
* ``max_attempts`` defaults to 1: the corrective prompt fires **at most once**
  per session (plan §A1/§A4); a loop would burn the user's own token budget.

Other notes
===========

* ``tenant_id`` is UNIQUE (one live config row per tenant) and carries NO
  foreign key to ``coord.tenants``, matching every ancestor coord table in this
  schema.
* ``config_id`` FKs ``coord.session_compliance_config(id) ON DELETE CASCADE`` —
  a version snapshot cannot outlive its config, mirroring
  ``prompt_document_versions.document_id``.
* ``updated_by`` is TEXT and, per the plan's Dependencies section, is
  currently **client-asserted** on the prompt-document PATCH path. Any coord
  route writing it here should take it from the authenticated
  ``OperatorContext``, not the request body.
* CHECK on ``mode`` (closed two-value set) follows the house convention used for
  ``coord.gates.verdict`` and ``coord.prompt_documents.kind``. ``max_attempts``
  gets a ``>= 1`` CHECK: zero attempts would silently disable the nudge while
  the config still reads ``enabled = true``, which is exactly the kind of
  invisible-inert state this plan exists to eliminate.

Idempotency: raw ``op.execute`` with ``CREATE TABLE / INDEX IF NOT EXISTS`` —
the house convention for coord tables.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_sesscompl_02"
down_revision: str | Sequence[str] | None = "coord_sesscompl_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the live enforcement-config table and its version snapshots."""
    # 1. Live values — one row per tenant.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.session_compliance_config (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id           UUID NOT NULL,
            enabled             BOOLEAN NOT NULL DEFAULT false,
            enforced_clause_ref TEXT NOT NULL
                DEFAULT 'policy/planning-and-scope#finish-to-zero',
            mode                TEXT NOT NULL DEFAULT 'nudge'
                CHECK (mode IN ('nudge', 'reopen')),
            max_attempts        INTEGER NOT NULL DEFAULT 1
                CHECK (max_attempts >= 1),
            current_version     INTEGER NOT NULL DEFAULT 1,
            updated_by          TEXT,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_session_compliance_config_tenant UNIQUE (tenant_id)
        )
        """
    )

    op.execute(
        """
        COMMENT ON COLUMN coord.session_compliance_config.enabled IS
            'Defaults false on purpose: the compliance check ships '
            'report-only until its false-positive rate is measured. This '
            'migration enables enforcement for nobody.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_compliance_config.enforced_clause_ref IS
            'Names a clause; defaults to '
            'policy/planning-and-scope#finish-to-zero (that document, NOT '
            'session-protocol, is where the finish-to-zero clause id lives). '
            'Enforcement auto-inerts when the named clause is absent from the '
            'active prompt-document version — derived, never separately '
            'configured.'
        """
    )

    # 2. Append-only immutable snapshots — one row per version.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.session_compliance_config_versions (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            config_id           UUID NOT NULL
                REFERENCES coord.session_compliance_config (id)
                ON DELETE CASCADE,
            version             INTEGER NOT NULL,
            enabled             BOOLEAN NOT NULL,
            enforced_clause_ref TEXT NOT NULL,
            mode                TEXT NOT NULL,
            max_attempts        INTEGER NOT NULL,
            change_note         TEXT,
            updated_by          TEXT,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_session_compliance_config_versions_config_version
                UNIQUE (config_id, version)
        )
        """
    )

    op.execute(
        """
        COMMENT ON TABLE coord.session_compliance_config_versions IS
            'Append-only immutable snapshots. Never UPDATE or DELETE a row '
            'here: a rollback is a forward edit that INSERTs a new version, '
            'mirroring coord.prompt_document_versions.'
        """
    )

    # Snapshot rows are deliberately NOT value-CHECKed on mode/max_attempts:
    # they are a historical record, and a future widening of the live table's
    # allowed set must not retroactively invalidate stored history.


def downgrade() -> None:
    """Drop the enforcement-config tables (versions first — FK child)."""
    op.execute("DROP TABLE IF EXISTS coord.session_compliance_config_versions")
    op.execute("DROP TABLE IF EXISTS coord.session_compliance_config")
