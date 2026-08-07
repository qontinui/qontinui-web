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
 * `<flow>~<login>~<nonce>~<connect_state>[~<runnerState>]` wire format alongside
 * a coord-minted, tenant-bound token (plan
 * 2026-07-26-coord-onboarding-claim-caller-tenant-binding).
 *
 * ## P2 runner-native hand-off
 * A deep-link-capable runner opens this page as `?state=<runner-nonce>` (see
 * `setup_wizard::github_connect_url`). That nonce is threaded into slot 5 of the
 * wire format so `/admin/coord/onboarding-status` can deep-link the claim back
 * to the runner window that started the flow, which then claims with its OWN
 * Cognito bearer. It is read here and passed down — never used to build a URL
 * directly — so the single mint+`beginConnectState` path in the two entry-point
 * components stays the only place a `state` value is constructed. A connect
 * started without a nonce (a plain browser visit) is unaffected and keeps the
 * exact 4-field shape.
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
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
import { isValidRunnerState } from "@/lib/onboarding-connect-state";

/**
 * `useSearchParams` needs a Suspense boundary in the App Router, or the whole
 * route opts into client-side rendering at build time. The fallback renders the
 * page with no runner nonce — the browser-only flow, which is the correct
 * degradation.
 */
export default function ConnectRunnerGithubPage() {
  return (
    <Suspense fallback={<ConnectRunnerGithubView runnerState={null} />}>
      <ConnectRunnerGithubContent />
    </Suspense>
  );
}

function ConnectRunnerGithubContent() {
  const searchParams = useSearchParams();
  const raw = searchParams?.get("state") ?? null;
  // Validate at ingress: an unparseable value is dropped to null rather than
  // threaded onward, so nothing but runner-minted hex can reach the wire format
  // (and later the `qontinui://` deep link built from it).
  return (
    <ConnectRunnerGithubView runnerState={isValidRunnerState(raw) ? raw : null} />
  );
}

function ConnectRunnerGithubView({ runnerState }: { runnerState: string | null }) {
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
            runnerState={runnerState}
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
        <ConnectInstalledOrg flow="runner-clone" runnerState={runnerState} />
      </div>
    </div>
  );
}
