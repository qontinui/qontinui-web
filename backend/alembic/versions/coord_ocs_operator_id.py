"""coord.onboarding_connect_states.operator_id — bind the connect state to the MINTING operator

Revision ID: coord_ocs_operator_id
Revises: fleet_res_tel_03
Create Date: 2026-08-07

The web half of P6 of plan
``2026-08-01-connect-state-residual-hardenings.md``. DDL ONLY — no proxy
change, no frontend change, no coord change. Those are the coord PR, and it
must deploy AFTER this revision is at head.

Why this column exists
======================

``coord.onboarding_connect_states`` binds a connect flow to the TENANT that
initiated it (``tenant_id``, ``coord_onboarding_connect_states``), and the claim
verifies that binding. It does not bind the flow to a *person*: the claim checks
tenant match, not user match, so a state minted by an ``admin`` for the
``connect`` flow — the privileged one, which enrolls repos and opens bootstrap
PRs — can be completed by any other member of that tenant.

That is defensible in isolation (an admin did authorize the flow), but it is the
wrong default once P6 makes the ``connect`` mint an authorization rather than a
recorded intent: the whole point of role-gating the mint is that a non-admin
cannot initiate an enrolling flow, and a state that any tenant member may finish
hands the tail of that flow straight back to them. Recording who minted the row
and comparing at claim closes it, and it is one column plus one comparison while
this row's shape is being revisited anyway. Retrofitting it once states are in
flight is materially more awkward — every unclaimed row would carry a NULL whose
meaning is ambiguous rather than dated.

``operator_id UUID NULL``
=========================

* **UUID**, matching ``tenant_id``'s type on this same table and coord's own
  operator identity (``OperatorContext``), so the comparison at claim is an
  equality on a native type rather than a text compare.
* **NULLABLE, and it must stay that way for now.** Deploy order here is
  producer-before-consumer: this revision lands first, coord's mint starts
  populating the column only when the coord half deploys. Every row minted
  before that — and every row minted in the window between the two — carries no
  operator, and those rows stay claimable for the remaining part of their
  15-minute TTL. A ``NOT NULL`` would make the ordering un-orderable and would
  strand in-flight legitimate connects at the moment of deploy.

  So NULL means exactly *"minted before the operator was recorded"*, and coord's
  claim must treat it as "no operator assertion available" — skip the
  comparison, the same conditional-assertion shape ``target_login`` /
  ``target_installation_id`` already use on this table. It must NOT be read as
  "minted by nobody" and refused: that would fail every in-flight connect across
  the deploy.

  Tightening to ``NOT NULL`` is safe only after the coord consumer is live AND
  the 15-minute TTL has fully turned over the pre-consumer rows (the lazy
  delete-on-mint reap does that on its own), and only in a separate revision.

No index, deliberately
======================

Every read of this table still arrives by ``token_hash`` (the primary key);
``operator_id`` is only ever *asserted against* on the row that lookup already
returned, exactly like ``flow`` and the two target columns. An index would add
write amplification to the mint, which sits on the connect critical path, and
buy nothing. The one existing secondary index — ``idx_ocs_expires`` — is there
because the in-transaction reap scans on ``expires_at``; nothing scans on
``operator_id``.

Schema authorship
=================

``coord.onboarding_connect_states`` is authored SOLELY by qontinui-web alembic;
coord does pure DML against it (``[policy: alembic-sole-authorship]``, and
``qontinui-coord/tests/coord_schema_authorship.rs`` bans all Rust ``coord.*``
DDL with no allowlist). A coord binary that names a column its migration has not
shipped fails every mint with PostgreSQL's 42703 "column does not exist" — the
2026-07-13 missing-column incident. Hence: this revision must be at head before
the coord PR deploys.

Idempotency: ``ADD COLUMN IF NOT EXISTS`` up, ``DROP COLUMN IF EXISTS`` down —
the house convention for ``coord.*`` tables, and reversible for the
``migration-reversal`` gate. The column is nullable with no default, so the ADD
is a catalogue update with no table rewrite.

``down_revision`` is ``fleet_res_tel_03``, the single live head at the time this
was written. Do NOT copy that value out of this docstring later — the head is
whichever revision is no other migration's ``down_revision``, and there must be
exactly one. Recompute it and re-point this if a concurrent revision lands
first; ``alembic-graph-pr.yml`` fails a forked chain.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
# Keep ``down_revision`` on ONE physical line — the ``alembic-heads-pr`` CI gate
# parses it with a line-based regex.
revision: str = "coord_ocs_operator_id"
down_revision: str | Sequence[str] | None = "fleet_res_tel_03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable ``operator_id`` column. Idempotent, no table rewrite."""
    op.execute(
        """
        ALTER TABLE coord.onboarding_connect_states
            ADD COLUMN IF NOT EXISTS operator_id UUID
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.onboarding_connect_states.operator_id IS
            'The operator who MINTED this connect state. Compared at claim so a '
            'state minted for the privileged `connect` flow cannot be completed '
            'by a different member of the same tenant (tenant_id binds the '
            'workspace; this binds the person). NULL means the row was minted '
            'before coord started recording it -- deploy order is '
            'producer-before-consumer -- so the claim SKIPS the comparison for a '
            'NULL, the same conditional-assertion rule flow/target_login/'
            'target_installation_id already follow. NULL is NOT "minted by '
            'nobody": refusing it would fail every connect in flight across the '
            'deploy. Tighten to NOT NULL only after the coord consumer is live '
            'and the 15-minute TTL has turned over the pre-consumer rows.'
        """
    )


def downgrade() -> None:
    """Drop ``operator_id``. Exact inverse of upgrade()."""
    op.execute(
        """
        ALTER TABLE coord.onboarding_connect_states
            DROP COLUMN IF EXISTS operator_id
        """
    )
