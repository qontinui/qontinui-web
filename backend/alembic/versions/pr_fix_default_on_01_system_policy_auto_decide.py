"""coord policy_rules — the SYSTEM pr_fix default becomes auto_decide

Revision ID: pr_fix_default_on_01
Revises: remote_create_01
Create Date: 2026-09-13

Plan ``2026-09-12-pr-fixer-spawns-default-on-bounded-and-coordinated-with-the-author``
Phase 4c (autonomy default). A DATA revision: it authors no schema object that
coord reads, and the one table it creates is private to this revision's own
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

What it writes
--------------
The SYSTEM tenant is resolved in SQL. coord resolves it by the durable
``coord.tenants.is_system`` marker (``tenant_scope::resolve_system_tenant``,
web ``coord_system_tenant_marker``); the slug ``personal-jspinak``
(``tenant_scope.rs`` ``SYSTEM_TENANT_SLUG``) is the fallback when no row
carries the marker. When neither resolves — a fresh database with no tenants —
the revision is a no-op; there is no system band to seed.

The target is the row coord's v2 resolver would itself select for the system
band (``policies/resolver.rs`` ``fetch_policies_by_domain``): ``tenant_id =
<system>``, ``COALESCE(decision_domain, kind) = 'pr_fix'``, ``repo IS NULL``,
``enabled``, not expired, ordered ``priority, created_at``. Rows with a
``deleted_at`` tombstone (``policy_rules_tombstone_01``) are never candidates.

* **A target exists → UPDATE it** to ``autonomy_level='auto_decide'``. Its
  ``mode`` becomes ``guidance`` unless it is ``data_driven``, which already
  resolves through the same guidance path with evidence attached.
* **No target → INSERT** one marked system row: ``mode='guidance'``,
  ``autonomy_level='auto_decide'``, ``kind`` NULL, ``condition``/``action``
  ``{}`` — the exact shape coord's own next-step settings façade authors for
  this domain (``next_step_settings.rs`` ``put_settings``).

Turned-off (``enabled = false``) and tombstoned rows are left exactly as they
are. They are not what the resolver reads, so changing them would change
nothing a consult sees while overwriting an operator's recorded intent.

Why ``guidance``, not ``deterministic`` (a deviation from the plan text)
-----------------------------------------------------------------------
The plan named ``mode='deterministic'`` "to avoid the 0.3 confidence
escalation". Two facts on ``main`` overturn that:

1. **A deterministic row cannot be seeded without polluting v1.** The CHECK
   ``policy_rules_mode_kind_check`` (``decision_engine_phase1_kind_nullable``)
   requires every deterministic row to carry one of the five reserved v1
   ``kind`` values. coord's v1 loader (``resolver.rs`` ``fetch_policies``)
   selects by ``kind`` alone, so the seeded row would join the system tenant's
   v1 rule set for that kind. There it is either skipped with a WARN on every
   load (``condition {}`` does not parse) or, with a condition that parses,
   fires as an unrelated v1 rule.
2. **The escalation it was meant to avoid does not happen at cold start.** A
   guidance resolution's confidence is the provenance-tiered prior until
   outcomes calibrate it, and a SYSTEM-band row's prior is 0.6
   (``ProvenanceTier::SystemDefault.cold_start_prior``). That is above
   ``DEFAULT_CONFIDENCE_THRESHOLD`` = 0.3, so the row serves a Guidance frame.
   ``route_resolution`` sends a Guidance frame to the dispatch gate under
   ``auto_decide``. If calibrated outcomes later drag confidence below 0.3,
   coord escalates, which is the engine's intended honesty rather than a defect
   to route around.

Reversibility
-------------
``downgrade()`` must restore the prior state exactly, and a data revision
cannot recompute the prior state from the schema. So ``upgrade()`` records what
it did in ``coord.policy_rule_seed_undo``: one row per touched policy, naming
the revision, whether it ``inserted`` or ``updated``, and — for an update — the
prior ``autonomy_level``, ``mode``, ``updated_at`` and ``updated_by``. No other
column is written, so no other column needs recording.

``downgrade()`` replays that ledger and then drops it:

* ``updated`` → the recorded columns are written back verbatim.
* ``inserted`` → the row is removed. A row this revision created did not exist
  before it. Removal is a hard ``DELETE``, not a tombstone, because a tombstone
  would leave a row behind that did not exist before the upgrade. That delete
  cascades to any tenant override pointing at the row through
  ``overrides_system_rule_id`` (``ON DELETE CASCADE``). Such an override can
  only have been authored against this seeded row, so it cannot outlive it.

A downgrade restores the values that were in place BEFORE the upgrade. A later
operator edit to the same row is overwritten, which is what reversing this
revision means.

Idempotency
-----------
``upgrade()`` returns immediately when the ledger already holds rows for this
revision, so a re-run neither double-inserts nor overwrites the recorded prior
values with the seeded ones.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "pr_fix_default_on_01"
down_revision: str | Sequence[str] | None = "remote_create_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Module constants, interpolated into SQL below. None is ever caller input.
_REVISION = "pr_fix_default_on_01"
_SYSTEM_TENANT_SLUG = "personal-jspinak"
_ACTOR = "alembic:pr_fix_default_on_01"


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
        f"""
        DO $$
        DECLARE
            sys_tenant UUID;
            target     RECORD;
            new_id     UUID;
        BEGIN
            IF EXISTS (
                SELECT 1 FROM coord.policy_rule_seed_undo
                 WHERE revision = '{_REVISION}'
            ) THEN
                RETURN;
            END IF;

            SELECT tenant_id INTO sys_tenant
              FROM coord.tenants WHERE is_system LIMIT 1;
            IF sys_tenant IS NULL THEN
                SELECT tenant_id INTO sys_tenant
                  FROM coord.tenants WHERE slug = '{_SYSTEM_TENANT_SLUG}';
            END IF;
            IF sys_tenant IS NULL THEN
                RAISE NOTICE '{_REVISION}: no system tenant — nothing to seed';
                RETURN;
            END IF;

            SELECT policy_id, autonomy_level, mode, updated_at, updated_by
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
                INSERT INTO coord.policy_rule_seed_undo
                    (revision, policy_id, disposition, prior)
                VALUES (
                    '{_REVISION}',
                    target.policy_id,
                    'updated',
                    jsonb_build_object(
                        'autonomy_level', target.autonomy_level,
                        'mode',           target.mode,
                        'updated_at',     target.updated_at,
                        'updated_by',     target.updated_by
                    )
                );
                UPDATE coord.policy_rules
                   SET autonomy_level = 'auto_decide',
                       mode           = CASE WHEN mode = 'data_driven'
                                             THEN mode ELSE 'guidance' END,
                       updated_at     = now(),
                       updated_by     = '{_ACTOR}'
                 WHERE policy_id = target.policy_id;
            ELSE
                INSERT INTO coord.policy_rules
                    (tenant_id, repo, name, kind, decision_domain, mode,
                     autonomy_level, condition, action, payload, priority,
                     created_by, updated_by, rationale)
                VALUES (
                    sys_tenant, NULL,
                    'system default: pr_fix fixer dispatch',
                    NULL, 'pr_fix', 'guidance', 'auto_decide',
                    '{{}}'::jsonb, '{{}}'::jsonb, NULL, 100,
                    '{_ACTOR}', '{_ACTOR}',
                    'PR fixer sessions are ON by default (production-and-cost '
                    'agent-spawn-authorization v11). Tenants lower this through '
                    'the next-step settings; repos opt out with '
                    'merge.auto_fix_pr: false.'
                )
                RETURNING policy_id INTO new_id;
                INSERT INTO coord.policy_rule_seed_undo
                    (revision, policy_id, disposition, prior)
                VALUES ('{_REVISION}', new_id, 'inserted', NULL);
            END IF;
        END $$
        """
    )


def downgrade() -> None:
    """Replay the undo ledger, restoring the prior rows exactly, then drop it."""
    op.execute(
        f"""
        DO $$
        BEGIN
            IF to_regclass('coord.policy_rule_seed_undo') IS NULL THEN
                RETURN;
            END IF;

            UPDATE coord.policy_rules pr
               SET autonomy_level = u.prior->>'autonomy_level',
                   mode           = u.prior->>'mode',
                   updated_at     = (u.prior->>'updated_at')::timestamptz,
                   updated_by     = u.prior->>'updated_by'
              FROM coord.policy_rule_seed_undo u
             WHERE u.revision = '{_REVISION}'
               AND u.disposition = 'updated'
               AND pr.policy_id = u.policy_id;

            DELETE FROM coord.policy_rules pr
             USING coord.policy_rule_seed_undo u
             WHERE u.revision = '{_REVISION}'
               AND u.disposition = 'inserted'
               AND pr.policy_id = u.policy_id;
        END $$
        """
    )
    op.execute("DROP TABLE IF EXISTS coord.policy_rule_seed_undo")
