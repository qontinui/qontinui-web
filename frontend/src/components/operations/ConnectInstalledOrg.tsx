"use client";

/**
 * ConnectInstalledOrg — connect an org whose App is ALREADY installed.
 *
 * The gap this closes: "Install the GitHub App" only works for a *fresh*
 * install. When the org already has the App, GitHub shows "Configure" and
 * issues **no Setup-URL `code`** — and coord's claim requires a code (that's
 * what proves you can REACH the org). So an already-installed-but-unbound org
 * could not be connected from the product at all; it took an operator calling
 * coord's unverified `bind` route by hand. That route stays operator-only on
 * purpose: it trusts the request body, so exposing it here would let anyone
 * first-bind an org they don't own and permanently block the real owner.
 *
 * Instead we get a real code the honest way: `login/oauth/authorize` issues one
 * regardless of install state. The claim then runs its normal install-access
 * gate. Because that callback carries no `installation_id`, the org rides
 * through in `state` and coord resolves it against the caller's own
 * installations — naming an org you cannot reach just 403s.
 *
 * That gate proves MEMBERSHIP, not AUTHORITY: `/user/installations` lists every
 * install the caller can reach and carries no role field, so an ordinary org
 * member passes it. Plan `2026-08-01-onboarding-bind-requires-org-admin` (F8)
 * tracks the real authority check.
 *
 * The org is typed rather than picked from a list: coord exposes no
 * installed-but-unbound listing today, and the `code` is single-use so a
 * pick-then-claim flow would need a second authorize round-trip. Typing is
 * honest (the user knows their org) and costs no safety — the gate is coord's.
 */

import { useCallback, useEffect, useState } from "react";
import { Github, ExternalLink, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useResetOnBackNavigation } from "@/hooks/useResetOnBackNavigation";
import { OPERATIONS_API } from "@/components/operations/utils";
import { httpClient } from "@/services/service-factory";
import {
  assertNonceStorageAvailable,
  authorizeUrl,
  beginConnectState,
  isValidLogin,
  mintConnectState,
  type ConnectFlow,
} from "@/lib/onboarding-connect-state";

/** Coord's app-config envelope (`GET /coord/onboarding/github-app`). */
interface GithubAppConfig {
  app_slug: string;
  client_id: string | null;
  oauth_configured: boolean;
}

export function ConnectInstalledOrg({
  flow,
  runnerState = null,
}: {
  /**
   * `runner-clone` claims bind-only (no enrollment / bootstrap PRs).
   *
   * REQUIRED for the same reason as {@link InstallGitHubAppButton}'s: the
   * value is now recorded on the minted row and is what authorises the
   * claim's `bind_only`, so defaulting it to the more privileged `connect`
   * would let a future call site escalate by omission.
   */
  flow: ConnectFlow;
  /**
   * P2 runner-native hand-off: the runner's return nonce, when this page was
   * opened by a deep-link-capable runner. Rides slot 5 of the wire format so
   * the callback can deep-link the claim back to the originating runner window.
   * Omitted on browser-only entry points.
   */
  runnerState?: string | null;
}) {
  const [config, setConfig] = useState<GithubAppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [login, setLogin] = useState("");
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await httpClient.fetch(
          `${OPERATIONS_API}/pr-merge/onboarding/github-app`
        );
        if (cancelled) return;
        if (res.ok) setConfig((await res.json()) as GithubAppConfig);
      } catch {
        // Leave config null → the card hides. This is a secondary path; a
        // failed probe must not break the primary install CTA above it.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // `minting` stays true through the outbound nav (the document is leaving);
  // clear it if the browser restores this page from the bfcache on Back, or the
  // authorize button comes back permanently disabled.
  const clearMinting = useCallback(() => setMinting(false), []);
  useResetOnBackNavigation(clearMinting);

  const trimmed = login.trim();
  // Catches typos before a pointless round-trip; the authoritative check is
  // coord's install-access gate. Deliberately the SAME predicate `parseConnectState`
  // applies on the way back in, not a second copy of the regex — the two must
  // agree, or a login accepted outbound would be dropped to null inbound and
  // silently turn a valid authorize callback into a doctor-page fall-through.
  const valid = isValidLogin(trimmed);
  const clientId = config?.client_id ?? null;

  /**
   * Mint the connect state, then navigate. This has to happen on CLICK, not
   * during render: the mint is an authenticated round-trip to coord (via the
   * web proxy) and a render-time call could neither await it nor report its
   * failure. Building the href during render — which is what this component did
   * before plan `2026-07-26-coord-onboarding-claim-caller-tenant-binding` — also
   * minted a fresh CSRF nonce on every keystroke, so only the last one ever
   * matched.
   *
   * On failure we stay put and show a retryable message rather than navigating
   * to a stateless authorize URL that coord will refuse to complete.
   *
   * This is the ONE path where the target org is known before the GitHub hop
   * (the user typed it, and `isValidLogin` has already validated it), so the mint
   * binds it: the token then authorises a claim of *that* org only, rather than
   * of any org the caller happens to be able to reach.
   */
  const onAuthorize = useCallback(async () => {
    if (!clientId || !valid || minting) return;
    setMinting(true);
    setMintError(null);
    try {
      // BEFORE the mint, not after: a storage-blocked browser can never finish
      // this connect, and every mint allocates a single-use row against the
      // tenant's capped quota. `beginConnectState` would catch it below, but
      // only once that row already exists.
      assertNonceStorageAvailable();
      const token = await mintConnectState({ flow, targetLogin: trimmed });
      const state = beginConnectState(flow, trimmed, token, runnerState);
      // Same-tab nav: the callback must return into this authenticated session
      // (a session-less tab can't complete the claim).
      window.location.assign(authorizeUrl(clientId, state));
    } catch (e) {
      setMintError(e instanceof Error ? e.message : String(e));
      setMinting(false);
    }
  }, [clientId, flow, minting, runnerState, trimmed, valid]);

  // Hide entirely when coord has no OAuth creds: without them the authorize
  // round-trip would end in a 500 `oauth_not_configured`, so offering it would
  // be a worse dead end than the one we're fixing.
  if (loading || !config?.oauth_configured || !clientId) return null;

  return (
    <Card data-testid="connect-installed-org">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Github className="h-4 w-4" />
          Already installed the App on your organization?
        </CardTitle>
        <CardDescription>
          If the Qontinui GitHub App is already installed on your organization,
          GitHub won&apos;t send you back through the install flow. Enter the
          organization and authorize instead — GitHub confirms you have access
          to it, then we connect it to your workspace.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          placeholder="your-org"
          aria-label="GitHub organization login"
          data-testid="connect-installed-org-login"
          spellCheck={false}
          autoCapitalize="none"
        />
        {/*
          A button that navigates rather than a bare <a href>: the URL can only
          be built AFTER the connect-state mint resolves. The browser still lands
          on GitHub itself, same-tab, so the callback returns into this
          authenticated session.
        */}
        <button
          type="button"
          onClick={onAuthorize}
          disabled={!valid || minting}
          data-testid="connect-installed-org-authorize"
          className={cn(
            buttonVariants({ variant: "secondary" }),
            "w-fit",
            (!valid || minting) && "opacity-50"
          )}
        >
          {minting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ExternalLink className="h-4 w-4" />
          )}
          Authorize &amp; connect
        </button>
        {mintError && (
          <p
            className="text-xs text-destructive"
            role="alert"
            data-testid="connect-installed-org-error"
          >
            {mintError}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          You must be an admin of the organization. Authorizing doesn&apos;t
          change the App&apos;s permissions or install it anywhere new.
        </p>
      </CardContent>
    </Card>
  );
}
