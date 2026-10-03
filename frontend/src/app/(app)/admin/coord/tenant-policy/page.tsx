"use client";

/**
 * /admin/coord/tenant-policy — per-tenant policy switches coord enforces.
 *
 * Phase 3 of plan
 * `2026-09-22-transcript-sync-default-on-with-tenant-and-user-controls` (§3.6).
 * It carries two switches:
 *
 * * transcript sync — the per-tenant consent gate coord applies to
 *   session-output ingest (qontinui-coord#2480);
 * * command-safety rewrite — the `command_safety_rewrite` fleet-policy dial
 *   that decides whether runners hand new sessions the hook that rewrites a
 *   risky shell command instead of stopping on Claude Code's prompt (plan
 *   `2026-10-03-runner-sessions-stop-on-builtin-command-safety-prompts`
 *   Phase 4).
 *
 * Authz: like every `/admin/coord` page, any tenant member may VIEW it; the
 * write is gated by coord-tenant admin on the backend
 * (`require_coord_tenant_admin_target` for transcript sync,
 * `require_coord_tenant_admin` on the shared `PUT /operations/fleet-policy`
 * door for the rewrite dial) and again by coord (`rbac::is_tenant_admin`), and
 * only reflected here via `can_edit`.
 *
 * Deliberately absent: `session_coordination_enabled`, which shares the coord
 * row but is the Phase 10 cutover flag and has no HTTP write door.
 */

import { CommandSafetyRewritePanel } from "./_components/CommandSafetyRewritePanel";
import { TranscriptSyncPanel } from "./_components/TranscriptSyncPanel";

export default function TenantPolicyPage() {
  return (
    <div className="space-y-4 p-4 sm:p-6" data-testid="tenant-policy-page">
      <TranscriptSyncPanel />
      <CommandSafetyRewritePanel />
    </div>
  );
}
