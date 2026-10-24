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
 * * permission-prompt capture — the `permission_prompt_capture` fleet-policy
 *   dial that decides whether runners hand new sessions the hook that records
 *   each permission prompt (tool, first command word, counts, redacted command
 *   excerpts) in this tenant's coord findings (plan
 *   `2026-10-14-permission-prompts-are-never-recorded-so-guard-rules-grow-on-anecdote`
 *   Phase 5);
 * * permission auto-accept — the `permission_auto_accept` fleet-policy dial
 *   that decides whether runners accept the tool permission prompts Claude
 *   Code asks in runner sessions, read live per prompt (plan
 *   `2026-10-23-runner-sessions-stop-at-permission-dialogs-so-accept-them-by-default-with-a-tenant-switch`
 *   Phase 3);
 * * account selection — the `account_selection_mode` fleet-policy dial that
 *   runners force-apply as their Claude account-selection mode unless the
 *   machine is pinned (plan
 *   `2026-10-01-fleet-account-selection-effective-mode-visibility-and-pin-safe-saves`
 *   Phase 3);
 * * image generation — the `image_generation` fleet-policy dial Studio is to
 *   read before each image request (no Studio build reads it yet) (`on` | `local_only` | `off`), with per-repo
 *   overrides (plan `2026-10-13-image-generation-and-visual-judgment` Phase 12).
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
import { ImageGenerationPanel } from "./_components/ImageGenerationPanel";
import { PermissionAutoAcceptPanel } from "./_components/PermissionAutoAcceptPanel";
import { PermissionPromptCapturePanel } from "./_components/PermissionPromptCapturePanel";

export default function TenantPolicyPage() {
  return (
    <div className="space-y-4 p-4 sm:p-6" data-testid="tenant-policy-page">
      <EgressPanel />
      <CommandSafetyRewritePanel />
      <PermissionPromptCapturePanel />
      <PermissionAutoAcceptPanel />
      <AccountSelectionPanel />
      <ImageGenerationPanel />
    </div>
  );
}
