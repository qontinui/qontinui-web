"""coord policy_rules — the SYSTEM pr_fix default becomes auto_decide

Revision ID: pr_fix_default_on_01
Revises: remote_create_01
Create Date: 2026-09-13

Plan ``2026-09-12-pr-fixer-spawns-default-on-bounded-and-coordinated-with-the-author``
Phase 4c (autonomy default). A DATA revision: it authors no schema object that
coord reads, and the one table it creates exists only for this revision's own
reversal (see "Reversibility").

Why
---
Served policy ``production-and-cost`` ``agent-spawn-authorization`` (v11,
operator-approved 2026-09-12): a spawn that outlives the request — PR fixer
sessions included — runs under a standing authorization that is ON by default,
with tenant and repo off-switches. For ``decision_domain='pr_fix'`` the
autonomy half of that default lives in ``coord.policy_rules``: coord's
dispatch gate only fires for a matched policy whose ``autonomy_level`` is
``auto_decide`` (``next_step.rs`` ``cheap_gates_verdict`` gate 4).

Measured before authoring (read-only, prod, 2026-09-13):
``GET /coord/agent-next-step-settings`` served ``pr_fix`` as
``autonomy_level=guidance_only, mode=guidance, resolved_from=system``, and
``coord_fixer_arm_readiness`` counted 1737 of 9441 holds in 7 days as
``autonomy_not_auto_decide``. ``resolved_from=system`` is ALSO what coord
prints when NO row matches (``next_step_settings.rs`` fallback arm), so that
door cannot tell whether a system ``pr_fix`` row exists. This revision
therefore handles both cases.

The system tenant
-----------------
The system tenant is the ``coord.tenants`` row with ``is_system``. That is the
ONLY thing coord's ``tenant_scope::resolve_system_tenant`` reads. When no row
is marked, coord has no system band at all, and this revision is a no-op.

There is deliberately no fallback to the slug ``personal-jspinak``. A row keyed
to that slug while nothing is marked would not act as a fleet default in coord.
It would act as that one tenant's own tenant-level setting.

How coord reads the system band
-------------------------------
For a tenant's consult, ``policies/resolver.rs`` ``fetch_policies_by_domain``
unions the tenant's rows with EVERY enabled, unexpired system-tenant row for
the domain, whatever its ``repo``. It ranks them by scope band, then
``priority``, then ``created_at``.

For every tenant other than the system tenant, the system band's winner is
therefore the lowest ``(priority, created_at)`` across ALL such system rows,
repo-scoped ones included. coord does not read ``deleted_at`` (the tombstone of
``policy_rules_tombstone_01``) yet, so an enabled row carrying a tombstone is
still served.

What it writes
--------------
* **Target.** The live tenant-wide system row: ``tenant_id = <system>``,
  ``COALESCE(decision_domain, kind) = 'pr_fix'``, ``repo IS NULL``,
  ``enabled``, not expired, ``deleted_at IS NULL``, ordered
  ``priority, created_at``. A tombstoned row is never adopted as the default.
* **Exists → UPDATE.** ``autonomy_level`` becomes ``auto_decide``; ``mode``,
  ``kind``, ``condition`` and ``action`` are left alone. A deterministic row
  still decides through ``build_decision``, and ``route_resolution``'s
  Decision arm dispatches under ``auto_decide`` exactly as the Guidance arm
  does.
* **Absent → INSERT** one marked row: ``mode='guidance'``,
  ``autonomy_level='auto_decide'``, ``kind`` NULL, ``condition`` and
  ``action`` ``{}``. That is the shape coord's own next-step settings façade
  authors for this domain (``next_step_settings.rs`` ``put_settings``).
* **Rank.** The seeded row's ``priority`` is set strictly below every OTHER
  enabled, unexpired system ``pr_fix`` row, repo-scoped or tombstoned. It is
  never raised above its current value, and an INSERT starts from 100. So the
  seed is the system band's winner for every tenant's consult, not only for the
  system tenant's own tenant-wide one.

Turned-off, expired and other rows are never written. A repo-scoped system row
keeps its values; it merely stops outranking the fleet default for other
tenants' consults.

coord caches domain resolutions per replica (``resolver.rs``
``resolve_policies_by_domain``). A replica can therefore serve the previous
``pr_fix`` resolution until that cache entry expires, since this revision
publishes no invalidation.

Why ``guidance`` for an inserted row, not ``deterministic``
-----------------------------------------------------------
The plan named ``mode='deterministic'`` "to avoid the 0.3 confidence
escalation". Two facts on ``main`` overturn that for a NEW row:

1. **A deterministic row needs a reserved v1 ``kind``.** The CHECK
   ``policy_rules_mode_kind_check`` (``decision_engine_phase1_kind_nullable``)
   requires one. That enrols the row in coord's v1 loader (``resolver.rs``
   ``fetch_policies``, which selects by ``kind``) on the system tenant. There it
   is either skipped with a WARN on every load (``condition {}`` does not
   parse) or, with a condition that does parse, fires as an unrelated v1 rule.
2. **The escalation does not happen at cold start.** A guidance resolution's
   confidence is the provenance-tiered prior until outcomes calibrate it. A
   SYSTEM-band row's prior is 0.6
   (``ProvenanceTier::SystemDefault.cold_start_prior``), which is above
   ``DEFAULT_CONFIDENCE_THRESHOLD`` = 0.3.

Once labelled outcomes accrue, a run of failed fixes can drag the posterior
under 0.3. The arm then escalates with ``held_by=escalated_by_policy``, without
anyone flipping a switch. That is intended, self-limiting behaviour.

Reversibility
-------------
``downgrade()`` must restore the prior state exactly, and a data revision
cannot recompute that state from the schema. So ``upgrade()`` records what it
did in ``coord.policy_rule_seed_undo``: one row per touched policy, with this
revision's id, ``inserted`` or ``updated``, and — for an update — the prior
``autonomy_level``, ``priority``, ``updated_at`` and ``updated_by``. No other
column is written, so no other column needs recording.

``downgrade()`` replays this revision's ledger rows, deletes them, and drops the
table only if no other revision's rows remain:

* ``updated`` → the recorded columns are written back verbatim.
* ``inserted`` → the row is hard-deleted. It did not exist before, and a
  tombstone would leave a row behind that was not there before the upgrade.

  The delete cascades, through ``ON DELETE CASCADE``, to any tenant override
  (``overrides_system_rule_id``) and any graduation proposal
  (``coord.policy_rule_proposals``) that points at the row. It leaves
  ``coord.policy_rule_resolutions.policy_id`` and ``coord.gates``
  ``cleared_under_rule`` naming a row that no longer exists; neither column has
  a foreign key.

A downgrade restores the values that were in place BEFORE the upgrade. A later
operator edit to the same row is overwritten, which is what reversing this
revision means.

Idempotency
-----------
``upgrade()`` returns immediately when the ledger already holds rows for this
revision, so a re-run neither double-inserts nor overwrites the recorded prior
values with the seeded ones.

The SQL is plain string literals, not f-strings, so
``check_alembic_schema_args.py`` can read every statement.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "pr_fix_default_on_01"
down_revision: str | Sequence[str] | None = "remote_create_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Seed or update the system-tenant ``pr_fix`` policy to auto_decide."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.policy_rule_seed_undo (
            revision     TEXT        NOT NULL,
            policy_id    UUID        NOT NULL,
            disposition  TEXT        NOT NULL
                CHECK (disposition IN ('inserted', 'updated')),
            prior        JSONB,
            recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (revision, policy_id)
        )
        """
    )

    op.execute(
        """
        DO $$
        DECLARE
            sys_tenant    UUID;
            target        RECORD;
            target_id     UUID;
            new_id        UUID;
            rival_min     INTEGER;
            seed_priority INTEGER;
        BEGIN
            IF EXISTS (
                SELECT 1 FROM coord.policy_rule_seed_undo
                 WHERE revision = 'pr_fix_default_on_01'
            ) THEN
                RETURN;
            END IF;

            SELECT tenant_id INTO sys_tenant
              FROM coord.tenants WHERE is_system LIMIT 1;
            IF sys_tenant IS NULL THEN
                RAISE NOTICE 'pr_fix_default_on_01: no is_system tenant, nothing to seed';
                RETURN;
            END IF;

            SELECT policy_id, autonomy_level, priority, updated_at, updated_by
              INTO target
              FROM coord.policy_rules
             WHERE tenant_id = sys_tenant
               AND COALESCE(decision_domain, kind) = 'pr_fix'
               AND repo IS NULL
               AND enabled = true
               AND deleted_at IS NULL
               AND (expires_at IS NULL OR expires_at > now())
             ORDER BY priority ASC, created_at ASC
             LIMIT 1
               FOR UPDATE;
            IF FOUND THEN
                target_id := target.policy_id;
            END IF;

            -- Every OTHER row coord would serve in the system band.
            SELECT min(priority) INTO rival_min
              FROM coord.policy_rules
             WHERE tenant_id = sys_tenant
               AND COALESCE(decision_domain, kind) = 'pr_fix'
               AND enabled = true
               AND (expires_at IS NULL OR expires_at > now())
               AND (target_id IS NULL OR policy_id <> target_id);

            IF target_id IS NOT NULL THEN
                seed_priority := CASE
                    WHEN rival_min IS NULL THEN target.priority
                    ELSE LEAST(target.priority, rival_min - 1)
                END;
                INSERT INTO coord.policy_rule_seed_undo
                    (revision, policy_id, disposition, prior)
                VALUES (
                    'pr_fix_default_on_01',
                    target_id,
                    'updated',
                    jsonb_build_object(
                        'autonomy_level', target.autonomy_level,
                        'priority',       target.priority,
                        'updated_at',     target.updated_at,
                        'updated_by',     target.updated_by
                    )
                );
                UPDATE coord.policy_rules
                   SET autonomy_level = 'auto_decide',
                       priority       = seed_priority,
                       updated_at     = now(),
                       updated_by     = 'alembic:pr_fix_default_on_01'
                 WHERE policy_id = target_id;
            ELSE
                seed_priority := CASE
                    WHEN rival_min IS NULL THEN 100
                    ELSE LEAST(100, rival_min - 1)
                END;
                INSERT INTO coord.policy_rules
                    (tenant_id, repo, name, kind, decision_domain, mode,
                     autonomy_level, condition, action, payload, priority,
                     created_by, updated_by, rationale)
                VALUES (
                    sys_tenant, NULL,
                    'system default: pr_fix fixer dispatch',
                    NULL, 'pr_fix', 'guidance', 'auto_decide',
                    '{}'::jsonb, '{}'::jsonb, NULL, seed_priority,
                    'alembic:pr_fix_default_on_01',
                    'alembic:pr_fix_default_on_01',
                    'PR fixer sessions are ON by default (production-and-cost '
                    'agent-spawn-authorization v11). Tenants lower this through '
                    'the next-step settings; repos opt out with '
                    'merge.auto_fix_pr: false.'
                )
                RETURNING policy_id INTO new_id;
                INSERT INTO coord.policy_rule_seed_undo
                    (revision, policy_id, disposition, prior)
                VALUES ('pr_fix_default_on_01', new_id, 'inserted', NULL);
            END IF;
        END $$
        """
    )


def downgrade() -> None:
    """Replay this revision's undo rows, restoring prior rows exactly."""
    op.execute(
        """
        DO $$
        BEGIN
            IF to_regclass('coord.policy_rule_seed_undo') IS NULL THEN
                RETURN;
            END IF;

            UPDATE coord.policy_rules pr
               SET autonomy_level = u.prior->>'autonomy_level',
                   priority       = (u.prior->>'priority')::integer,
                   updated_at     = (u.prior->>'updated_at')::timestamptz,
                   updated_by     = u.prior->>'updated_by'
              FROM coord.policy_rule_seed_undo u
             WHERE u.revision = 'pr_fix_default_on_01'
               AND u.disposition = 'updated'
               AND pr.policy_id = u.policy_id;

            DELETE FROM coord.policy_rules pr
             USING coord.policy_rule_seed_undo u
             WHERE u.revision = 'pr_fix_default_on_01'
               AND u.disposition = 'inserted'
               AND pr.policy_id = u.policy_id;

            DELETE FROM coord.policy_rule_seed_undo
             WHERE revision = 'pr_fix_default_on_01';

            IF NOT EXISTS (SELECT 1 FROM coord.policy_rule_seed_undo) THEN
                DROP TABLE coord.policy_rule_seed_undo;
            END IF;
        END $$
        """
    )
