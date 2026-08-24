"use client";

/**
 * /admin/coord/onboarding — PR Merge Orchestrator Phase 8 onboarding wizard.
 *
 * Mounts the (previously orphaned) MergeOrchestrationOnboarding component:
 * three-step wizard that (1) pairs a device, (2) verifies Claude Code
 * sign-in via precondition-status polling, (3) audits the first repo
 * (POST /pr-merge/onboarding/audit + STARTER_PROFILE accept/edit/reject +
 * final POST /pr-merge/onboarding/accept).
 *
 * Counterpart to /admin/coord/merge-settings: this page WRITES
 * coord.tenant_repos (the enrollment row the onboarding audit/accept flow
 * requires); merge-settings reads/mutates `merge_enabled` on already-enrolled
 * repos. Without this page the SLO panel renders "No repos onboarded yet"
 * with no actionable next step.
 *
 * CoordNav comes from the /admin/coord layout. That layout does NOT admin-gate
 * — any authenticated tenant member may reach this page, including the
 * `connect` install CTA below. Mutations gate on `isCoordAdmin` per page.
 *
 * ## Console style (Phase 3 ride-along) — checked, already satisfied
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` classes this
 * route as a form/dialog surface taking "R9 + R3 only". Audited 2026-08-24:
 * this page file already satisfies R9 — no `<h1>`, no page-level `<Card>`,
 * body is `p-3 sm:p-6`. `space-y-6` is kept rather than narrowed to the
 * console's `space-y-4`: the three children are sequential steps in an
 * enrolment flow, and the extra gap is what keeps them from reading as one
 * form. No code change was needed; recorded so the next session reads a
 * verdict rather than re-auditing.
 */

import { ConnectGitHubOrg } from "@/components/operations/ConnectGitHubOrg";
import { ConnectInstalledOrg } from "@/components/operations/ConnectInstalledOrg";
import { MergeOrchestrationOnboarding } from "@/components/operations/MergeOrchestrationOnboarding";

export default function OnboardingPage() {
  return (
    <div className="p-3 sm:p-6 space-y-6" data-testid="coord-onboarding-page">
      <ConnectGitHubOrg />
      {/*
        Secondary path for an org that ALREADY has the App installed: GitHub
        issues no Setup-URL code on a re-visit, so the install CTA above can
        never complete a claim for it. Renders only when coord has OAuth creds.
      */}
      <ConnectInstalledOrg flow="connect" />
      <MergeOrchestrationOnboarding />
    </div>
  );
}
