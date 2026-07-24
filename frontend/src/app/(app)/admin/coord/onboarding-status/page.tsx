"use client";

/**
 * /admin/coord/onboarding-status — zero-touch onboarding status page (P4).
 *
 * This route is the GitHub App's post-install **Setup URL** target. It plays
 * two roles depending on the query string GitHub redirects with:
 *
 * 1. Self-serve claim (`?code=…&installation_id=…&setup_action=install`): the
 *    OAuth redirect after a fresh install. On mount we POST the `code` +
 *    `installation_id` to the web-backend proxy at
 *    `POST /api/v1/operations/pr-merge/onboarding/claim`, which forwards to
 *    coord's `POST /coord/onboarding/github-accounts/claim` (coord PR #901).
 *    Coord exchanges the code, verifies the operator administers the org,
 *    binds the GitHub account to their tenant, and enrolls its repos. We show
 *    a claiming → success / error state, then render {@link OnboardingDoctor}
 *    so the operator can watch the newly-enrolled repos go green.
 *
 * 2. Status view (`?repo=owner/name`, or a bare visit): no claim params, so we
 *    render {@link OnboardingDoctor} exactly as before — the per-repo
 *    onboarding checklist read from coord's onboarding-doctor endpoint.
 *
 * An installer without a session hits the normal `(app)` auth wall first.
 * Admin-gating + CoordNav come from the /admin/coord layout.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  consumeNonce,
  parseConnectState,
} from "@/lib/onboarding-connect-state";
import { Button } from "@/components/ui/button";
import { ConnectedOrgs } from "@/components/operations/ConnectedOrgs";
import { OnboardingDoctor } from "@/components/operations/OnboardingDoctor";
import { OPERATIONS_API } from "@/components/operations/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { httpClient } from "@/services/service-factory";

/** Coord's claim success envelope (frozen contract, coord PR #901). */
interface ClaimResponse {
  ok: boolean;
  account_login: string;
  installation_id: number;
  tenant_id: string;
  // `enrolled` shape is coord-owned (count or flag) — rendered generically.
  enrolled?: unknown;
}

type ClaimPhase = "claiming" | "success" | "error" | "handoff";

/** The claim target — exactly one of the two shapes GitHub's redirects allow. */
type ClaimTarget = { installation_id: number } | { account_login: string };

/**
 * The P2 runner-native return: hand the OAuth code back to the desktop runner,
 * which validates the nonce (single-use, time-bounded) and claims with its OWN
 * Cognito bearer — binding to the runner's tenant, not the browser session's.
 * Mirrors `wake_handler.rs`'s `github-connected` host contract.
 */
function buildRunnerDeepLink(
  code: string,
  target: ClaimTarget,
  runnerState: string,
): string {
  const params = new URLSearchParams({ code, state: runnerState });
  if ("installation_id" in target) {
    params.set("installation_id", String(target.installation_id));
  } else {
    params.set("account_login", target.account_login);
  }
  return `qontinui://github-connected?${params.toString()}`;
}

/**
 * Map coord's pass-through status code (+ body) to an operator-facing message.
 * The backend proxy forwards coord's status verbatim, so 403/409/400/500 are
 * distinguishable here without parsing an error string.
 */
function messageForClaimError(status: number, body: unknown): string {
  // The `oauth_not_configured` marker may ride any field coord picks
  // (`detail`/`error`), so scan the serialized body rather than one key.
  const serialized =
    typeof body === "string" ? body : JSON.stringify(body ?? {});
  switch (status) {
    case 403:
      return (
        "You don't administer this GitHub installation — only the org " +
        "owner/admin who installed the app can complete onboarding."
      );
    case 409:
      return "This GitHub account is already connected to a different Qontinui tenant.";
    case 400:
      return (
        "The GitHub authorization code was invalid or expired — please " +
        "reinstall/retry from GitHub."
      );
    case 500:
      if (serialized.includes("oauth_not_configured")) {
        return "Onboarding OAuth isn't configured yet — contact the operator.";
      }
      return "Onboarding hit a server error — please retry in a moment.";
    default:
      return `Onboarding failed (HTTP ${status}) — please retry.`;
  }
}

/**
 * Remove the spent OAuth `code` from the address bar so a browser refresh does
 * not re-POST an already-consumed code. Other params (installation_id /
 * setup_action) are preserved. Uses history.replaceState so we don't trigger a
 * Next.js navigation (which would remount + re-fire the claim).
 */
function stripSpentCodeFromUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("code")) return;
  url.searchParams.delete("code");
  window.history.replaceState(window.history.state, "", url.toString());
}

export default function OnboardingStatusPage() {
  const searchParams = useSearchParams();
  const code = searchParams?.get("code") ?? null;
  const installationIdRaw = searchParams?.get("installation_id") ?? null;
  const repo = searchParams?.get("repo") ?? null;
  // `state` carries the flow marker, the target org (authorize path only) and a
  // CSRF nonce — see lib/onboarding-connect-state. A bare `runner-clone` is the
  // shipped runner's legacy value and still parses.
  const connectState = useMemo(
    () => parseConnectState(searchParams?.get("state") ?? null),
    [searchParams],
  );
  // The `runner-clone` flow is set by /connect-runner-github (the desktop
  // runner's clone-picker connect entry). It makes the claim bind-only: bind the
  // account so its repos are listable/cloneable WITHOUT enrolling them or
  // opening bootstrap PRs (D2 in the clone-picker plan). Also reframes the copy
  // and skips the enroll-watching doctor (nothing is enrolling).
  const isRunnerClone = connectState?.flow === "runner-clone";
  // The org named in `state`, for the authorize (already-installed) path where
  // GitHub sends a code but NO installation_id.
  const stateLogin = connectState?.login ?? null;
  // Two claimable redirect shapes: the fresh-install Setup-URL redirect
  // (code + installation_id) and the user-authorization callback
  // (code + login-from-state). The `?repo=` status view and bare visits have no
  // code and fall through to the doctor.
  const hasClaimParams = !!code && (!!installationIdRaw || !!stateLogin);

  // P2 native hand-off: when the connect flow was started by a deep-link-capable
  // runner, `state` carries the runner's return nonce and the code goes BACK to
  // the runner (which claims with its own bearer) instead of being spent here.
  const runnerState = connectState?.runnerState ?? null;

  const [phase, setPhase] = useState<ClaimPhase | null>(
    hasClaimParams ? "claiming" : null,
  );
  const [claim, setClaim] = useState<ClaimResponse | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  // Fire the claim POST exactly once per mount (belt to the URL-strip braces).
  const firedRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // The (code, target) captured for the hand-off fallback: the OAuth code is
  // single-use, so EITHER the runner claims it (deep link) or the browser does
  // (fallback button) — never both automatically.
  const pendingClaimRef = useRef<{ code: string; target: ClaimTarget } | null>(
    null,
  );

  const fireBrowserClaim = useCallback(
    async (claimCode: string, target: ClaimTarget) => {
      setPhase("claiming");
      try {
        const res = await httpClient.fetch(
          `${OPERATIONS_API}/pr-merge/onboarding/claim`,
          {
            method: "POST",
            body: JSON.stringify({
              code: claimCode,
              ...target,
              // Clone-picker connect binds only — no repo enrollment / PRs.
              ...(isRunnerClone ? { bind_only: true } : {}),
            }),
          },
        );
        const body = await res
          .json()
          .catch(() => ({}) as Record<string, unknown>);
        if (!mountedRef.current) return;
        if (!res.ok) {
          setClaimError(messageForClaimError(res.status, body));
          setPhase("error");
          return;
        }
        setClaim(body as ClaimResponse);
        setPhase("success");
        // The code is single-use — drop it so a refresh can't re-submit it.
        stripSpentCodeFromUrl();
      } catch (e) {
        if (!mountedRef.current) return;
        setClaimError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    },
    [isRunnerClone],
  );

  useEffect(() => {
    if (!hasClaimParams || firedRef.current) return;
    firedRef.current = true;

    // Reject a callback whose nonce doesn't match the one we minted: the code is
    // single-use, so a crafted link must not spend it. A state with no nonce is
    // the legacy runner / fresh-install shape and passes.
    if (!consumeNonce(connectState?.nonce ?? null)) {
      setClaimError(
        "This connect link didn't originate from this browser session — " +
          "please start again from the Connect page.",
      );
      setPhase("error");
      return;
    }

    // Exactly one target: the id GitHub named (fresh install), else the org from
    // `state` (authorize path — no installation_id exists there).
    let target: ClaimTarget;
    if (installationIdRaw) {
      const installationId = Number(installationIdRaw);
      if (!Number.isInteger(installationId)) {
        setClaimError(
          "The installation id in the URL was malformed — please retry from GitHub.",
        );
        setPhase("error");
        return;
      }
      target = { installation_id: installationId };
    } else {
      target = { account_login: stateLogin as string };
    }

    if (runnerState && code) {
      // P2: hand the code to the runner instead of spending it here. Keep the
      // (code, target) around for the explicit browser fallback, and strip the
      // code from the address bar so a refresh can't replay the hand-off.
      const link = buildRunnerDeepLink(code, target, runnerState);
      pendingClaimRef.current = { code, target };
      setDeepLink(link);
      setPhase("handoff");
      stripSpentCodeFromUrl();
      // Same-tab nav to the custom scheme: the OS opens the runner; the page
      // stays put (custom-scheme navigations don't unload the document).
      window.location.href = link;
      return;
    }

    void fireBrowserClaim(code as string, target);
  }, [
    hasClaimParams,
    code,
    installationIdRaw,
    stateLogin,
    connectState,
    runnerState,
    fireBrowserClaim,
  ]);

  return (
    <div className="p-3 sm:p-6 space-y-3" data-testid="coord-onboarding-status-page">
      {/* Bare status/doctor visits (no claim params) get a subtle pointer back
          to the primary self-serve entry point. Hidden during/after a claim so
          it never competes with the claim result. */}
      {phase === null && (
        <p className="text-xs text-muted-foreground">
          <Link
            href="/admin/coord/onboarding"
            className="underline underline-offset-4 hover:text-foreground"
          >
            New here? Connect your GitHub organization →
          </Link>
        </p>
      )}

      {/* Bare visit (no claim in flight/done, no `?repo=` deep-link): the
          account-level "Connected organizations" summary. A connected org with
          zero enrolled repos reads as success here (closing the empty-org
          dead-end); each repo links to `?repo=` which loads the doctor below. */}
      {phase === null && !repo && <ConnectedOrgs />}

      {phase === "handoff" && (
        <Card data-testid="onboarding-claim-handoff">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              Finishing in your Qontinui runner…
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              GitHub approved the connection. Your runner should have opened to
              complete it — once it does, your repositories appear in the clone
              picker automatically.
            </p>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            {deepLink && (
              <a
                href={deepLink}
                data-testid="onboarding-claim-handoff-open"
                className="text-sm underline underline-offset-4"
              >
                Nothing happened? Open the runner
              </a>
            )}
            {/* The OAuth code is single-use: this spends it in the browser
                instead (the pre-P2 behavior), for the cross-device case where
                the runner isn't on this machine. */}
            <Button
              variant="outline"
              size="sm"
              data-testid="onboarding-claim-handoff-fallback"
              onClick={() => {
                const pending = pendingClaimRef.current;
                if (pending) void fireBrowserClaim(pending.code, pending.target);
              }}
            >
              Complete in this browser instead
            </Button>
          </CardContent>
        </Card>
      )}

      {phase === "claiming" && (
        <Card data-testid="onboarding-claim-claiming">
          <CardContent className="flex items-center gap-2 py-6 text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            {isRunnerClone
              ? "Connecting your GitHub account…"
              : "Connecting your GitHub account and enrolling its repositories…"}
          </CardContent>
        </Card>
      )}

      {phase === "success" && claim && (
        <Card data-testid="onboarding-claim-success">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-500" />
              GitHub account connected
              <Badge variant="default" className="ml-2">
                {claim.account_login}
              </Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {isRunnerClone ? (
                <>
                  <span className="font-mono">{claim.account_login}</span> is now
                  connected to your Qontinui workspace. Return to your runner and
                  click <span className="font-medium">Refresh</span> to see and
                  clone its repositories.
                </>
              ) : (
                <>
                  <span className="font-mono">{claim.account_login}</span> is now
                  bound to your Qontinui tenant and its repositories are being
                  enrolled. Watch them go green below — the checklist
                  auto-refreshes as onboarding completes.
                </>
              )}
            </p>
          </CardHeader>
        </Card>
      )}

      {phase === "error" && (
        <Card data-testid="onboarding-claim-error">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <XCircle className="h-4 w-4 text-destructive" />
              Couldn&apos;t complete onboarding
            </CardTitle>
            <p
              className="text-sm text-destructive"
              data-testid="onboarding-claim-error-message"
            >
              {claimError}
            </p>
          </CardHeader>
        </Card>
      )}

      {/*
        Doctor is the default view (bare visit / `?repo=`) and also the
        post-claim follow-up in success/error. It is hidden only WHILE the
        claim POST is in flight so the operator sees a single clear state.
      */}
      {phase !== "claiming" && phase !== "handoff" && !isRunnerClone && (
        <OnboardingDoctor key={repo ?? "bare"} />
      )}
    </div>
  );
}
