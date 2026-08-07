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
 *    Coord exchanges the code, verifies the operator can REACH the org's
 *    installation (their own `/user/installations` lists it — MEMBERSHIP, not
 *    org-admin AUTHORITY; plan `2026-08-01-onboarding-bind-requires-org-admin`,
 *    F8), binds the GitHub account to their tenant, and enrolls its repos. We show
 *    a claiming → success / error state, then render {@link OnboardingDoctor}
 *    so the operator can watch the newly-enrolled repos go green.
 *
 * 2. Status view (`?repo=owner/name`, or a bare visit): no claim params, so we
 *    render {@link OnboardingDoctor} exactly as before — the per-repo
 *    onboarding checklist read from coord's onboarding-doctor endpoint.
 *
 * An installer without a session hits the normal `(app)` auth wall first.
 * Admin-gating + CoordNav come from the /admin/coord layout.
 *
 * Since plan `2026-07-26-coord-onboarding-claim-caller-tenant-binding` the claim
 * also forwards the coord-minted `connect_state` that rode through GitHub's
 * `state`, and **fails closed without it** — coord binds to the token's tenant,
 * so a stateless callback can no longer bind an arbitrary org into whichever
 * tenant happens to be looking at this page. The one legitimate stateless
 * arrival (an install started from GitHub's Marketplace rather than from one of
 * our links) is rendered as a restartable "start the connect again" card.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  consumeNonce,
  parseConnectState,
} from "@/lib/onboarding-connect-state";
import { ConnectedOrgs } from "@/components/operations/ConnectedOrgs";
import { InstallGitHubAppButton } from "@/components/operations/InstallGitHubAppButton";
import { OnboardingDoctor } from "@/components/operations/OnboardingDoctor";
import { OPERATIONS_API } from "@/components/operations/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
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

/**
 * `recover` is a claim we deliberately did not (or could not) complete but
 * which the operator can simply restart — a missing/unusable connect-state
 * token. It is rendered as a "start the connect again" card with a working
 * install button, NOT as a raw error: the honest legitimate case is an admin
 * who installed the App from GitHub's Marketplace or the App's own page, whose
 * Setup-URL redirect never passed through one of our links and so carries no
 * state at all.
 */
type ClaimPhase = "claiming" | "success" | "error" | "recover";

/** coord's connect-state rejection codes (plan §2 / coord `ClaimError`). */
const RECOVERABLE_CLAIM_CODES = [
  "connect_state_required",
  "connect_state_invalid",
];

/**
 * True when coord's rejection is a connect-state problem rather than a real
 * failure.
 *
 * Deliberately stricter than `messageForClaimError`'s whole-body substring
 * scan: this predicate decides whether the operator is told "retry" or "you
 * aren't an admin", so a 400 whose message merely *mentions* the code (a
 * field-validation error naming the field, say) must not be downgraded to a
 * restart prompt. Coord may put the code on any of `error`/`code`/`detail`
 * (`ClaimError::parts` shapes the envelope), so match those fields exactly.
 */
function isRecoverableClaimRejection(status: number, body: unknown): boolean {
  // Both codes are 400s (coord's `ClaimError::parts`). A 403
  // `connect_state_tenant_mismatch` is deliberately NOT recoverable here — it
  // means the token belongs to another tenant, which is the attack signal.
  if (status !== 400) return false;
  if (typeof body === "string") return RECOVERABLE_CLAIM_CODES.includes(body);
  if (!body || typeof body !== "object") return false;
  const envelope = body as Record<string, unknown>;
  return ["error", "code", "detail"].some((key) => {
    const value = envelope[key];
    return typeof value === "string" && RECOVERABLE_CLAIM_CODES.includes(value);
  });
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
      if (serialized.includes("connect_state_tenant_mismatch")) {
        return (
          "This connect link was started from a different Qontinui workspace " +
          "— sign in to that workspace, or start the connect again from here."
        );
      }
      // Deliberately says "can't reach" rather than "you're not an admin":
      // coord's gate checks whether your own `/user/installations` lists the
      // installation, which is reachability/membership, not authority. The
      // weaker wording also presupposes nothing about the installation
      // existing, matching coord's own 403 text.
      return (
        "Your GitHub account can't reach this installation — check you're " +
        "signed in to GitHub as a user with access to that organization, and " +
        "that the app is installed there."
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
 * Remove the OAuth `code` and the connect `state` from the address bar. Other
 * params (installation_id / setup_action) are preserved. Uses
 * history.replaceState so we don't trigger a Next.js navigation (which would
 * remount + re-fire the claim).
 *
 * Called ONCE, UNCONDITIONALLY, the moment the claim effect commits to running
 * — before any branch, before any `await`, and before the claim POST is issued.
 *
 * This used to say "called after a claim resolves either way", and that was
 * false: three exits returned without stripping — the hard claim error
 * (403/409/500), the malformed-`installation_id` early return, and the async
 * `catch` (network failure / non-JSON body). Each left a **live OAuth code and
 * a live connect-state token** in the address bar, in browser history, and in
 * the `Referer` of everything the page then renders (`OnboardingDoctor` mounts
 * on the error path). The code stays spendable until it is spent; the token
 * stays live for the rest of its 15-minute TTL.
 *
 * It deliberately is NOT a `finally`, and NOT a list of the failing exits:
 * - a `finally` on the async IIFE cannot fire for the early returns, which run
 *   before that IIFE is ever created;
 * - an enumeration of exits was already wrong once, in this very file.
 *
 * Stripping up front is the only shape with no list to keep in sync, and it is
 * strictly stronger: it shrinks the exposure window rather than merely closing
 * the error paths. Nothing downstream reads these params back off the URL —
 * `code`, `stateToken`, `stateLogin` and `installationIdRaw` are all captured in
 * closure consts — and `firedRef` guards a re-fire if `searchParams` updates.
 */
function stripClaimParamsFromUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("code") && !url.searchParams.has("state")) return;
  url.searchParams.delete("code");
  url.searchParams.delete("state");
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
  // The coord-minted, tenant-bound, single-use token that rode through GitHub.
  // Its ABSENCE is now disqualifying (see the recover branch below): every path
  // we initiate mints one, so a callback without it either bypassed our links
  // (out-of-band install) or was crafted.
  const stateToken = connectState?.connectState ?? null;
  // Two claimable redirect shapes: the fresh-install Setup-URL redirect
  // (code + installation_id) and the user-authorization callback
  // (code + login-from-state). The `?repo=` status view and bare visits have no
  // code and fall through to the doctor.
  const hasClaimParams = !!code && (!!installationIdRaw || !!stateLogin);

  const [phase, setPhase] = useState<ClaimPhase | null>(
    hasClaimParams ? "claiming" : null,
  );
  const [claim, setClaim] = useState<ClaimResponse | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [recoverMessage, setRecoverMessage] = useState<string | null>(null);
  // Fire the claim POST exactly once per mount (belt to the URL-strip braces).
  const firedRef = useRef(false);

  useEffect(() => {
    if (!hasClaimParams || firedRef.current) return;
    firedRef.current = true;

    // Drop the live OAuth code + connect-state token from the URL FIRST, on
    // EVERY path, before any branch or `await`. See `stripClaimParamsFromUrl`
    // for why this is here and not in a `finally` or on the error returns.
    // Every value the rest of this effect needs is already in a closure const
    // above, so this cannot starve a downstream branch.
    stripClaimParamsFromUrl();

    // FAIL CLOSED without a server-minted connect state. This callback carries a
    // live OAuth code, and until now a state-less one was claimed anyway —
    // binding whatever org the URL named into whichever tenant happened to load
    // the page (plan `2026-07-26-…-caller-tenant-binding` §1, exploit #1). The
    // legitimate case that lands here is an out-of-band install (GitHub
    // Marketplace / the App's own page), so it gets a restart, not a dead end.
    if (!stateToken) {
      setRecoverMessage(
        "This connect didn't start from Qontinui, so we can't safely finish it " +
          "here. Start the connect again below — it takes one click and GitHub " +
          "will bring you straight back.",
      );
      setPhase("recover");
      return;
    }

    // Reject a callback whose nonce doesn't match the one we minted: the code is
    // single-use, so a crafted link must not spend it. Restartable — a cleared
    // sessionStorage looks the same as a crafted link from here.
    if (!consumeNonce(connectState?.nonce ?? null)) {
      setRecoverMessage(
        "This connect link didn't originate from this browser session, so we " +
          "stopped before using it. Start the connect again below.",
      );
      setPhase("recover");
      return;
    }

    // Exactly one target: the id GitHub named (fresh install), else the org from
    // `state` (authorize path — no installation_id exists there).
    let target: { installation_id: number } | { account_login: string };
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

    let cancelled = false;
    setPhase("claiming");
    (async () => {
      try {
        const res = await httpClient.fetch(
          `${OPERATIONS_API}/pr-merge/onboarding/claim`,
          {
            method: "POST",
            body: JSON.stringify({
              code,
              ...target,
              // The server-minted state is what binds this claim to the tenant
              // that STARTED the flow, instead of to whoever's bearer arrives.
              connect_state: stateToken,
              // Clone-picker connect binds only — no repo enrollment / PRs.
              ...(isRunnerClone ? { bind_only: true } : {}),
            }),
          },
        );
        const body = await res
          .json()
          .catch(() => ({}) as Record<string, unknown>);
        if (cancelled) return;
        if (!res.ok) {
          if (isRecoverableClaimRejection(res.status, body)) {
            setRecoverMessage(
              "Your connect link expired or had already been used, so we " +
                "stopped before binding anything. Start the connect again below.",
            );
            setPhase("recover");
            return;
          }
          setClaimError(messageForClaimError(res.status, body));
          setPhase("error");
          return;
        }
        setClaim(body as ClaimResponse);
        setPhase("success");
      } catch (e) {
        if (cancelled) return;
        setClaimError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    hasClaimParams,
    code,
    installationIdRaw,
    isRunnerClone,
    stateLogin,
    stateToken,
    connectState,
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

      {phase === "recover" && (
        <Card data-testid="onboarding-claim-recover">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
              Start the connect again
            </CardTitle>
            <p
              className="text-sm text-muted-foreground"
              data-testid="onboarding-claim-recover-message"
            >
              {recoverMessage}
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {/*
              The flow the user STARTED with, when the callback still told us
              (a legacy bare `runner-clone`, or a parsed-but-tokenless state).
              A stateless callback — out-of-band Marketplace install, or a
              crafted link — makes it genuinely unknowable, and this is the
              merge-orchestrator onboarding surface, so `connect` is the
              intended default there. That is not an escalation: the /admin/coord
              layout admits any authenticated tenant member (it gates mutations,
              not views) and /admin/coord/onboarding offers the same `connect`
              CTA to the same audience, so re-minting `connect` here grants
              nothing the user could not request directly. The runner-clone
              alternative stays one click away in the link below.
            */}
            <InstallGitHubAppButton
              flow={isRunnerClone ? "runner-clone" : "connect"}
              label="Connect GitHub"
              testId="onboarding-claim-recover-install"
            />
            <p className="text-xs text-muted-foreground">
              Already installed the App on your organization? GitHub won&apos;t
              send you back through the install flow —{" "}
              <Link
                href={
                  isRunnerClone
                    ? "/connect-runner-github"
                    : "/admin/coord/onboarding"
                }
                className="underline underline-offset-4 hover:text-foreground"
              >
                authorize it here instead →
              </Link>
            </p>
          </CardContent>
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
      {phase !== "claiming" && !isRunnerClone && (
        <OnboardingDoctor key={repo ?? "bare"} />
      )}
    </div>
  );
}
