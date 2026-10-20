"use client";

/**
 * /admin/coord/tenant-policy — per-tenant policy switches coord enforces.
 *
 * Phase 3 of plan
 * `2026-09-22-transcript-sync-default-on-with-tenant-and-user-controls` (§3.6).
 * It carries five switches and one designation:
 *
 * * transcript sync — the per-tenant consent gate coord applies to
 *   session-output ingest (qontinui-coord#2480);
 * * command-safety rewrite — the `command_safety_rewrite` fleet-policy dial
 *   that decides whether runners hand new sessions the hook that rewrites a
 *   risky shell command instead of stopping on Claude Code's prompt (plan
 *   `2026-10-03-runner-sessions-stop-on-builtin-command-safety-prompts`
 *   Phase 4);
 * * permission-prompt capture — the `permission_prompt_capture` fleet-policy
 *   dial that decides whether runners hand new sessions the hook that records
 *   each permission prompt (tool, first command word, counts, redacted command
 *   excerpts) in this tenant's coord findings (plan
 *   `2026-10-14-permission-prompts-are-never-recorded-so-guard-rules-grow-on-anecdote`
 *   Phase 5);
 * * account selection — the `account_selection_mode` fleet-policy dial that
 *   runners force-apply as their Claude account-selection mode unless the
 *   machine is pinned (plan
 *   `2026-10-01-fleet-account-selection-effective-mode-visibility-and-pin-safe-saves`
 *   Phase 3);
 * * image generation — the `image_generation` fleet-policy dial Studio is to
 *   read before each image request (no Studio build reads it yet) (`on` | `local_only` | `off`), with per-repo
 *   overrides (plan `2026-10-13-image-generation-and-visual-judgment` Phase 12);
 * * secrets broker device — the device coord accepts secrets-broker reports
 *   from (`coord.fleet_runtime_policy.secrets_broker_device_id` on the
 *   `secrets_broker` domain's tenant row), written through its own
 *   `PUT /operations/secrets-broker/device` door, which proves the device is
 *   bound to the tenant first (plan
 *   `2026-10-20-secrets-broker-agents-act-on-secrets-never-see-them` Phase 3).
 *
 * Authz: like every `/admin/coord` page, any tenant member may VIEW it; the
 * write is gated by coord-tenant admin on the backend
 * (`require_coord_tenant_admin_target` for transcript sync and the secrets
 * broker device, `require_coord_tenant_admin` on the shared `PUT /operations/fleet-policy`
 * door for the four fleet-policy dials) and again by coord (`rbac::is_tenant_admin`), and
 * only reflected here via `can_edit`.
 *
 * Deliberately absent: `session_coordination_enabled`, which shares the coord
 * row but is the Phase 10 cutover flag and has no HTTP write door.
 */

import { AccountSelectionPanel } from "./_components/AccountSelectionPanel";
import { CommandSafetyRewritePanel } from "./_components/CommandSafetyRewritePanel";
import { ImageGenerationPanel } from "./_components/ImageGenerationPanel";
import { PermissionPromptCapturePanel } from "./_components/PermissionPromptCapturePanel";
import { SecretsBrokerDevicePanel } from "./_components/SecretsBrokerDevicePanel";
import { TranscriptSyncPanel } from "./_components/TranscriptSyncPanel";

export default function TenantPolicyPage() {
  return (
    <div className="space-y-4 p-4 sm:p-6" data-testid="tenant-policy-page">
      <TranscriptSyncPanel />
      <CommandSafetyRewritePanel />
      <PermissionPromptCapturePanel />
      <AccountSelectionPanel />
      <ImageGenerationPanel />
      <SecretsBrokerDevicePanel />
    </div>
  );
}
