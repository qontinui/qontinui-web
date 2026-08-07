"use client";

/**
 * ConnectGitHubOrg — the primary, zero-touch onboarding CTA.
 *
 * Leads the /admin/coord/onboarding page: the operator installs the Qontinui
 * Merge Orchestrator GitHub App on their organization. GitHub's
 * OAuth-during-install verifies they can REACH the org's installation (their
 * own `/user/installations` lists it — MEMBERSHIP, not org-admin AUTHORITY; see
 * plan `2026-08-01-onboarding-bind-requires-org-admin`, F8); coord then binds
 * the org to their tenant and auto-enrolls its repositories with starter
 * (dry-run) merge profiles (coord PR #901 / web #703). No device pairing or manual repo
 * audit is required — the device-pairing wizard below is now optional, for the
 * separate autonomous-dev runner setup.
 *
 * Post-install, GitHub redirects back to /admin/coord/onboarding-status which
 * completes the claim. Navigation is same-tab so the redirect returns into the
 * authenticated session.
 *
 * This CTA used to point at a hardcoded `installations/new` URL with **no
 * `state` at all** — the live entry point for the CSRF described in plan
 * `2026-07-26-coord-onboarding-claim-caller-tenant-binding` §1. It now goes
 * through {@link InstallGitHubAppButton}, which mints a tenant-bound
 * connect-state token before navigating.
 */

import Link from "next/link";
import { Github } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InstallGitHubAppButton } from "@/components/operations/InstallGitHubAppButton";

export function ConnectGitHubOrg() {
  return (
    <Card data-testid="connect-github-org">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Github className="h-4 w-4" />
          Connect your GitHub organization
        </CardTitle>
        <CardDescription>
          Onboarding is zero-touch. Install the Qontinui Merge Orchestrator
          GitHub App on your organization — it verifies you&apos;re an org
          admin, connects the org to your tenant, and automatically enrolls your
          repositories with starter (dry-run) merge profiles. No device pairing
          or manual setup required.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <InstallGitHubAppButton
          flow="connect"
          testId="connect-github-org-install"
        />
        <p className="text-xs text-muted-foreground">
          After installing, GitHub returns you to Qontinui to finish connecting
          — automatically.
        </p>
        <p className="text-xs text-muted-foreground">
          <Link
            href="/admin/coord/onboarding-status"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Already installed? Check a repository&apos;s onboarding status →
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
