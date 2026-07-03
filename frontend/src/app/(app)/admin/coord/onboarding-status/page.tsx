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

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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

type ClaimPhase = "claiming" | "success" | "error";

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
  // Only the OAuth-redirect shape (code + installation_id) triggers a claim;
  // the `?repo=` status-view path and bare visits fall through to the doctor.
  const hasClaimParams = !!code && !!installationIdRaw;

  const [phase, setPhase] = useState<ClaimPhase | null>(
    hasClaimParams ? "claiming" : null,
  );
  const [claim, setClaim] = useState<ClaimResponse | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  // Fire the claim POST exactly once per mount (belt to the URL-strip braces).
  const firedRef = useRef(false);

  useEffect(() => {
    if (!hasClaimParams || firedRef.current) return;
    firedRef.current = true;

    const installationId = Number(installationIdRaw);
    if (!Number.isInteger(installationId)) {
      setClaimError(
        "The installation id in the URL was malformed — please retry from GitHub.",
      );
      setPhase("error");
      return;
    }

    let cancelled = false;
    setPhase("claiming");
    (async () => {
      try {
        const res = await httpClient.fetch(
          `${OPERATIONS_API}/pr-merge/onboarding/claim`,
          {
            method: "POST",
            body: JSON.stringify({ code, installation_id: installationId }),
          },
        );
        const body = await res
          .json()
          .catch(() => ({}) as Record<string, unknown>);
        if (cancelled) return;
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
        if (cancelled) return;
        setClaimError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasClaimParams, code, installationIdRaw]);

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

      {phase === "claiming" && (
        <Card data-testid="onboarding-claim-claiming">
          <CardContent className="flex items-center gap-2 py-6 text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            Connecting your GitHub account and enrolling its repositories…
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
              <span className="font-mono">{claim.account_login}</span> is now
              bound to your Qontinui tenant and its repositories are being
              enrolled. Watch them go green below — the checklist auto-refreshes
              as onboarding completes.
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
      {phase !== "claiming" && <OnboardingDoctor />}
    </div>
  );
}
