"""coord: account_tenant_consents and the account|off autobind vocabulary

Revision ID: acctconsent_01
Revises: outbound_budget_windows_01
Create Date: 2026-11-07

Phase 1 of plan
``2026-11-07-pair-a-runner-once-to-the-account-and-reach-every-tenant``.
Web FIRST: coord authors zero DDL (``[policy: alembic-sole-authorship]``), and
the coord doors that read these objects ship in later phases of the plan.

The re-point rule
=================

``down_revision`` is this repo's single alembic head at authoring time. If
another revision lands ahead of this one, re-point it at the new head; do NOT
author an ``alembic merge`` revision.

What changes
============

* ``coord.account_tenant_consents``: one row per ``(operator_id, tenant_id)``
  consent -- the account itself accepting membership of a tenant, which is
  what lets a runner paired once to the account reach that tenant. A row is
  LIVE while ``withdrawn_at IS NULL`` AND ``accepted_at >=
  MIN(operator_roles.granted_at)`` for that pair, so a re-add after removal
  (a fresh role grant newer than the accept) requires a fresh accept. Rows
  are written only by the account itself over a user-bearing credential;
  ``accepted_via`` names the surface (``web``, ``runner``, ``tenant_create``)
  or ``backfill`` for rows this revision wrote.
* Backfill (idempotent, ``ON CONFLICT DO NOTHING``): one ``backfill`` row per
  pair where the operator holds a role row that is EITHER
  ``grant_origin = 'self_service'`` OR a legacy creator-shaped row --
  ``grant_origin IS NULL AND granted_by IS NULL`` and its ``granted_at`` is
  the earliest role grant in its tenant. ``accepted_at`` is the MIN ``granted_at``
  over that operator's roles in that tenant, so the backfilled row is live
  under the rule above.

  DESIGN NOTE. The plan originally backfilled ``self_service`` only. A prod
  read on 2026-11-07 found 13 of 19 role rows carry a NULL ``grant_origin``
  (written before ``grantorig_01`` started origin tracking), including the
  own home tenants of the account owner, which a self_service-only backfill
  would have shown as pending invitations (coord finding
  0ebf933e-97d2-46d3-8984-70c6c0ef53d4). The legacy creator shape (the first
  grant in the tenant, no granter) recovers those. Later-granted NULL-origin
  rows are legacy invitations and are NOT backfilled: they require acceptance.

  TIES. A NULL-origin granter-less row counts as creator-shaped ONLY when the
  earliest-granted granter-less NULL-origin rows of its tenant belong to
  exactly ONE operator. Several distinct operators tied at that earliest
  ``granted_at`` are one-transaction inserts (``group_auto_create``,
  ``default_role``), not a creator, so none of them gets a consent from the
  NULL-origin arm; they must accept. ``self_service`` rows are unaffected.
* ``coord.devices.membership_autobind`` vocabulary: ``created`` becomes
  ``account`` (bind every tenant the account has consented to); ``off`` is
  unchanged. Existing ``created`` rows are rewritten and the default moves.
* ``ck_tenant_device_unbinds_reason`` widens to admit ``owner_withdrew``: the
  tombstone written when the account withdraws its consent to a tenant.

Downgrade
=========

Reverses each step. It DROPS ``coord.account_tenant_consents`` and so loses
every recorded consent, backfilled or accepted. ``owner_withdrew`` tombstones
are KEPT, rewritten to ``owner_declined`` (both are owner-initiated with
``unbound_by_operator_id`` NULL, and the primary key does not involve the
reason, so nothing collides): deleting them would let an unattended pass
re-bind a tenant the owner withdrew from.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "acctconsent_01"
down_revision: str | Sequence[str] | None = "outbound_budget_windows_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic. Keep these comments free of apostrophes and of the
# op-dot-call spelling: the classifier lexer does not skip Python comments.


def upgrade() -> None:
    """Create coord.account_tenant_consents, backfill it, rename autobind, widen reasons."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.account_tenant_consents (
            operator_id  UUID        NOT NULL
                REFERENCES coord.operators(operator_id) ON DELETE CASCADE,
            tenant_id    UUID        NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            accepted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            accepted_via TEXT        NOT NULL,
            withdrawn_at TIMESTAMPTZ NULL,
            CONSTRAINT account_tenant_consents_pkey PRIMARY KEY (operator_id, tenant_id),
            CONSTRAINT ck_account_tenant_consents_accepted_via
                CHECK (accepted_via IN ('web', 'runner', 'tenant_create', 'backfill'))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_account_tenant_consents_tenant
            ON coord.account_tenant_consents (tenant_id)
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.account_tenant_consents IS
            'One row per (account, tenant) consent: the account accepted membership of the tenant. Live while withdrawn_at IS NULL AND accepted_at >= MIN(operator_roles.granted_at) for that pair, so a re-add after removal requires a fresh accept. Written only by the account itself over a user-bearing credential. Plan 2026-11-07-pair-a-runner-once-to-the-account-and-reach-every-tenant.'
        """
    )
    op.execute(
        """
        INSERT INTO coord.account_tenant_consents
            (operator_id, tenant_id, accepted_at, accepted_via)
        SELECT r.operator_id, r.tenant_id, min(r.granted_at), 'backfill'
          FROM coord.operator_roles r
         WHERE EXISTS (
                SELECT 1
                  FROM coord.operator_roles q
                 WHERE q.operator_id = r.operator_id
                   AND q.tenant_id = r.tenant_id
                   AND (
                        q.grant_origin = 'self_service'
                        OR (
                            q.grant_origin IS NULL
                            AND q.granted_by IS NULL
                            AND q.granted_at = (
                                SELECT min(f.granted_at)
                                  FROM coord.operator_roles f
                                 WHERE f.tenant_id = q.tenant_id
                            )
                            AND NOT EXISTS (
                                SELECT 1
                                  FROM coord.operator_roles s
                                 WHERE s.tenant_id = q.tenant_id
                                   AND s.granted_at = q.granted_at
                                   AND s.grant_origin IS NULL
                                   AND s.granted_by IS NULL
                                   AND s.operator_id <> q.operator_id
                            )
                        )
                   )
         )
         GROUP BY r.operator_id, r.tenant_id
        ON CONFLICT (operator_id, tenant_id) DO NOTHING
        """
    )

    op.execute(
        """
        ALTER TABLE coord.devices
            DROP CONSTRAINT IF EXISTS ck_devices_membership_autobind
        """
    )
    op.execute(
        """
        UPDATE coord.devices
           SET membership_autobind = 'account'
         WHERE membership_autobind = 'created'
        """
    )
    op.execute(
        """
        ALTER TABLE coord.devices
            ALTER COLUMN membership_autobind SET DEFAULT 'account'
        """
    )
    op.execute(
        """
        ALTER TABLE coord.devices
            ADD CONSTRAINT ck_devices_membership_autobind
            CHECK (membership_autobind IN ('account', 'off'))
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.devices.membership_autobind IS
            'Standing consent for the unattended membership bind. account = it may bind every tenant the device owner account has a live consent row for; off = it binds nothing for this device. Plan 2026-11-07-pair-a-runner-once-to-the-account-and-reach-every-tenant.'
        """
    )

    op.execute(
        """
        ALTER TABLE coord.tenant_device_unbinds
            DROP CONSTRAINT IF EXISTS ck_tenant_device_unbinds_reason
        """
    )
    op.execute(
        """
        ALTER TABLE coord.tenant_device_unbinds
            ADD CONSTRAINT ck_tenant_device_unbinds_reason
            CHECK (reason IN ('operator_unbind', 'owner_declined', 'owner_withdrew'))
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.tenant_device_unbinds.reason IS
            'operator_unbind = an operator removed the binding (unbound_by_operator_id names them); owner_declined = the device owner left the tenant unticked at sign-in; owner_withdrew = the device owner account withdrew its consent to the tenant (unbound_by_operator_id is NULL for both owner reasons).'
        """
    )


def downgrade() -> None:
    """Restore the two-value reason and created|off autobind CHECKs; drop the consents table."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        UPDATE coord.tenant_device_unbinds
           SET reason = 'owner_declined'
         WHERE reason = 'owner_withdrew'
        """
    )
    op.execute(
        """
        ALTER TABLE coord.tenant_device_unbinds
            DROP CONSTRAINT IF EXISTS ck_tenant_device_unbinds_reason
        """
    )
    op.execute(
        """
        ALTER TABLE coord.tenant_device_unbinds
            ADD CONSTRAINT ck_tenant_device_unbinds_reason
            CHECK (reason IN ('operator_unbind', 'owner_declined'))
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.tenant_device_unbinds.reason IS
            'operator_unbind = an operator removed the binding (unbound_by_operator_id names them); owner_declined = the device owner left the tenant unticked at sign-in (unbound_by_operator_id is NULL).'
        """
    )

    op.execute(
        """
        ALTER TABLE coord.devices
            DROP CONSTRAINT IF EXISTS ck_devices_membership_autobind
        """
    )
    op.execute(
        """
        UPDATE coord.devices
           SET membership_autobind = 'created'
         WHERE membership_autobind = 'account'
        """
    )
    op.execute(
        """
        ALTER TABLE coord.devices
            ALTER COLUMN membership_autobind SET DEFAULT 'created'
        """
    )
    op.execute(
        """
        ALTER TABLE coord.devices
            ADD CONSTRAINT ck_devices_membership_autobind
            CHECK (membership_autobind IN ('created', 'off'))
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.devices.membership_autobind IS
            'Standing consent for the unattended membership bind. created = it may bind tenants the device owner created; off = it binds nothing for this device. Plan 2026-10-17-runner-credential-for-every-account-tenant, D2.'
        """
    )

    op.execute("DROP INDEX IF EXISTS coord.ix_account_tenant_consents_tenant")
    op.execute("DROP TABLE IF EXISTS coord.account_tenant_consents")
