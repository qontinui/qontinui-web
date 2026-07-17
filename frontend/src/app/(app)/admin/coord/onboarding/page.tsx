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
 * coord.tenant_repos (the row the rollout-promote endpoint requires);
 * merge-settings reads/mutates rollout_state on already-enrolled repos.
 * Without this page the SLO panel renders "No repos onboarded yet" with
 * no actionable next step.
 *
 * Admin-gating + CoordNav come from the /admin/coord layout.
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
      <ConnectInstalledOrg />
      <MergeOrchestrationOnboarding />
    </div>
  );
}
