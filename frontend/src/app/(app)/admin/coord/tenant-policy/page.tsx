"use client";

/**
 * /admin/coord/tenant-policy — per-tenant policy switches coord enforces.
 *
 * It carries:
 *
 * * the egress switches — one `egress_*` fleet-policy domain per outbound data
 *   flow a runner can send off its machine, transcript sync among them (plan
 *   `2026-10-10-spec-front-end-phase-9-generic-boundary` Phase 8);
 * * command-safety rewrite — the `command_safety_rewrite` fleet-policy dial
 *   that decides whether runners hand new sessions the hook that rewrites a
 *   risky shell command instead of stopping on Claude Code's prompt (plan
 *   `2026-10-03-runner-sessions-stop-on-builtin-command-safety-prompts`
 *   Phase 4);
 * * account selection — the `account_selection_mode` fleet-policy dial that
 *   runners force-apply as their Claude account-selection mode unless the
 *   machine is pinned (plan
 *   `2026-10-01-fleet-account-selection-effective-mode-visibility-and-pin-safe-saves`
 *   Phase 3).
 *
 * Authz: like every `/admin/coord` page, any tenant member may VIEW it; the
 * write is gated by coord-tenant admin on the backend
 * (`require_coord_tenant_admin` on the shared `PUT /operations/fleet-policy`
 * door every switch here uses) and again by coord (`rbac::is_tenant_admin`),
 * and only reflected here via `can_edit`.
 *
 * Deliberately absent: `session_coordination_enabled`, which shares the coord
 * row but is the Phase 10 cutover flag and has no HTTP write door.
 */

import { AccountSelectionPanel } from "./_components/AccountSelectionPanel";
import { CommandSafetyRewritePanel } from "./_components/CommandSafetyRewritePanel";
import { EgressPanel } from "./_components/EgressPanel";

export default function TenantPolicyPage() {
  return (
    <div className="space-y-4 p-4 sm:p-6" data-testid="tenant-policy-page">
      <EgressPanel />
      <CommandSafetyRewritePanel />
      <AccountSelectionPanel />
    </div>
  );
}
