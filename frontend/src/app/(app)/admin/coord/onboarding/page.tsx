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
 * This is ENTIRELY a write surface (device pairing, audit, accept). The
 * /admin/coord layout is now viewable by all authenticated users, so this
 * page gates itself: non-superusers get a read-only "operator action"
 * notice instead of the onboarding wizard. CoordNav comes from the layout.
 */

import { ShieldAlert } from "lucide-react";
import { MergeOrchestrationOnboarding } from "@/components/operations/MergeOrchestrationOnboarding";
import { useCoordOperator } from "@/components/admin/coord/use-coord-operator";

export default function OnboardingPage() {
  const { isOperator } = useCoordOperator();

  if (!isOperator) {
    return (
      <div className="p-3 sm:p-6" data-testid="coord-onboarding-page">
        <div
          className="flex items-start gap-3 rounded-md border border-border bg-muted/40 p-4 text-sm"
          data-testid="coord-onboarding-readonly"
        >
          <ShieldAlert className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-medium">Operator actions require admin privileges</p>
            <p className="text-muted-foreground">
              Repo onboarding (device pairing, audit, and accept) writes
              coordination state and is operator-only. Ask an administrator to
              onboard a repo.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6" data-testid="coord-onboarding-page">
      <MergeOrchestrationOnboarding />
    </div>
  );
}
