"use client";

/**
 * /connect-runner-github — login-gated GitHub-App connect entry for the
 * desktop runner's setup-wizard "Clone from GitHub" flow.
 *
 * Why this page exists (root cause it fixes): the runner's clone picker used to
 * open the raw `installations/new` App-install URL in a *session-less* system
 * browser. GitHub's post-install redirect lands on the App's fixed Setup URL
 * (`/admin/coord/onboarding-status`), which needs an authenticated qontinui.io
 * session to complete the claim — so with no session, no bind ever happened and
 * the picker stayed on "Connect GitHub" forever.
 *
 * This page sits in the `(app)` group, so the shared `AppAuthGate` redirects an
 * unauthenticated visitor to sign in FIRST. Once signed in, the same-tab
 * `<a href>` install nav means the post-install redirect returns into that
 * authenticated session and the claim completes, bound to the caller's tenant.
 *
 * It is deliberately NOT under `/admin/coord/*` (which is admin-gated and frames
 * the full merge-orchestrator onboarding wizard): any tenant member using the
 * runner must be able to reach it, and the framing here is clone-only.
 *
 * The `runner-clone` flow marker in `state` makes onboarding-status claim
 * **bind-only** (no repo enrollment / bootstrap PRs) — see D2 in
 * plans/2026-07-08-runner-clone-picker-selfserve-connect-claim.md. It used to be
 * a bare `state=runner-clone` constant hardcoded here; it now rides in the
 * `<flow>~<login>~<nonce>~<connect_state>` wire format alongside a coord-minted,
 * tenant-bound token (plan
 * 2026-07-26-coord-onboarding-claim-caller-tenant-binding).
 */

import { Github } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConnectInstalledOrg } from "@/components/operations/ConnectInstalledOrg";
import { InstallGitHubAppButton } from "@/components/operations/InstallGitHubAppButton";

export default function ConnectRunnerGithubPage() {
  return (
    <div
      className="mx-auto max-w-2xl p-3 sm:p-6"
      data-testid="connect-runner-github-page"
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Github className="h-4 w-4" />
            Connect GitHub for your Qontinui runner
          </CardTitle>
          <CardDescription>
            Install the Qontinui Merge Orchestrator GitHub App on the
            organization whose repositories you want to clone. GitHub verifies
            you administer the org and connects it to your Qontinui workspace, so
            your runner can list and clone your repositories. This is
            clone-only — connecting here does <strong>not</strong> open any pull
            requests or enroll your repositories in the merge orchestrator.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/*
            Same-tab install nav so the post-install redirect returns into this
            authenticated session. The `runner-clone` flow marker rides through
            GitHub's install flow back to the Setup URL, where onboarding-status
            reads it to claim bind-only (clone path — no bootstrap PRs).
          */}
          <InstallGitHubAppButton
            flow="runner-clone"
            testId="connect-runner-github-install"
          />
          <p className="text-xs text-muted-foreground">
            After installing, GitHub returns you to Qontinui to finish
            connecting. Then return to your runner and click{" "}
            <span className="font-medium">Refresh</span> to see your
            repositories.
          </p>
        </CardContent>
      </Card>

      {/*
        The install link above dead-ends when the App is ALREADY installed on the
        org (GitHub shows "Configure" and issues no Setup-URL code, so the claim
        can never fire) — the exact state the clone picker lands users in. This
        offers the authorize path, which yields a code either way. `runner-clone`
        keeps it bind-only: connecting from the runner must not enroll repos or
        open bootstrap PRs.
      */}
      <div className="mt-3">
        <ConnectInstalledOrg flow="runner-clone" />
      </div>
    </div>
  );
}
