"use client";

/**
 * /admin/coord/onboarding-status — zero-touch onboarding status page (P4).
 *
 * Mounts {@link OnboardingDoctor}: the per-repo onboarding checklist read
 * from coord's onboarding-doctor endpoint (via the web-backend proxy at
 * `GET /api/v1/operations/pr-merge/onboarding/doctor?repo=owner/name`).
 *
 * This route is the GitHub App's post-install Setup URL target, so it
 * accepts `?repo=owner/name` (auto-runs the check) and tolerates GitHub's
 * `?installation_id=…&setup_action=…` params by ignoring them. An
 * installer without a session hits the normal `(app)` auth wall first.
 *
 * Counterpart to /admin/coord/onboarding (the enrollment wizard, which
 * WRITES coord.tenant_repos): this page only reads state and surfaces
 * remediation hints. Admin-gating + CoordNav come from the /admin/coord
 * layout.
 */

import { OnboardingDoctor } from "@/components/operations/OnboardingDoctor";

export default function OnboardingStatusPage() {
  return (
    <div className="p-3 sm:p-6" data-testid="coord-onboarding-status-page">
      <OnboardingDoctor />
    </div>
  );
}
