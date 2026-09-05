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
 * installed-but-unbound LISTING (the pending table has no tenant column, so a
 * list would leak every other prospective tenant's org), and the `code` is
 * single-use so a pick-then-claim flow would need a second authorize
 * round-trip. Typing is honest (the user knows their org) and costs no safety —
 * the gate is coord's.
 *
 * What it is no longer is BLIND. Since plan
 * `2026-09-05-tenant-onboarding-friction-and-multi-tenant-device-visibility`
 * (P1) the typed org is pre-checked against coord's KEYED pending-installation
 * read on blur / Enter (debounced) and the answer renders inline — "coord saw
 * the App installed on <org> (N repos) at <when>", "already connected on
 * <when>", "coord has not seen an install; install the App first", or
 * "couldn't check" (UNKNOWN, never rendered as not-installed). The submit path
 * is untouched: the pre-check informs the click, it does not gate it. `defaultOrg`
 * (P4) prefills the field from the recover card's `?connect=<org>` hand-off
 * and fires the check on mount, so the operator's only action is the click.
 */

import { useCallback, useEffect, useRef, useState } from "react";
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
import { InstallGitHubAppButton } from "@/components/operations/InstallGitHubAppButton";
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
import {
  describePendingInstallation,
  describePendingInstallationFailure,
  fetchPendingInstallation,
  type PendingInstallationVerdict,
} from "@/lib/onboarding-pending";

/** Coord's app-config envelope (`GET /coord/onboarding/github-app`). */
interface GithubAppConfig {
  app_slug: string;
  client_id: string | null;
  oauth_configured: boolean;
}

/**
 * Blur → check debounce. A blur/focus flutter (tabbing through the form, a
 * click that lands on the button) must not spend a coord round-trip per
 * event; Enter and the mount-time `defaultOrg` check bypass it.
 */
const PRECHECK_DEBOUNCE_MS = 300;

/**
 * Text colour per verdict, R3 of `docs/console-ui-style-guide.md`: calm for
 * every state we KNOW (the ask — connect, install — is stated in the words),
 * amber for the one we do not (`unknown` — coord could not answer, and a
 * later check may). Nothing here is red: nothing is broken, and nothing
 * blocks the click.
 */
const PRECHECK_CLASS: Record<PendingInstallationVerdict["kind"], string> = {
  pending: "text-foreground",
  claimed: "text-muted-foreground",
  unseen: "text-muted-foreground",
  unknown: "text-amber-600 dark:text-amber-400",
};

export function ConnectInstalledOrg({
  flow,
  runnerState = null,
  defaultOrg,
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
  /**
   * Prefill for the org field (P4): the recover card on
   * `/admin/coord/onboarding-status` hands the org coord named for a stateless
   * arrival through `?connect=<org>`. Only a login `isValidLogin` accepts is
   * honoured — anything else leaves the field empty — and a valid one fires
   * the pre-check on mount.
   */
  defaultOrg?: string;
}) {
  const [config, setConfig] = useState<GithubAppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [login, setLogin] = useState(() => {
    const initial = defaultOrg?.trim() ?? null;
    return isValidLogin(initial) ? initial : "";
  });
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [precheck, setPrecheck] = useState<PendingInstallationVerdict | null>(
    null
  );
  const [prechecking, setPrechecking] = useState(false);
  // The login the LAST check was issued for, so a blur that changed nothing
  // does not re-ask, and a stale answer cannot land on a newer login: each
  // response is compared against this before it is rendered.
  const precheckForRef = useRef<string | null>(null);
  const precheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingPrecheck = useCallback(() => {
    if (precheckTimerRef.current !== null) {
      clearTimeout(precheckTimerRef.current);
      precheckTimerRef.current = null;
    }
  }, []);

  /**
   * Ask coord what it knows about `target`. Never throws and never gates the
   * submit: a failed check is the UNKNOWN verdict, rendered as such.
   */
  const runPrecheck = useCallback(async (target: string) => {
    precheckForRef.current = target;
    setPrechecking(true);
    let verdict: PendingInstallationVerdict;
    try {
      const resp = await fetchPendingInstallation({ account_login: target });
      verdict = describePendingInstallation(resp, target);
    } catch (e) {
      verdict = describePendingInstallationFailure(e);
    }
    // A later check superseded this one while it was in flight.
    if (precheckForRef.current !== target) return;
    setPrecheck(verdict);
    setPrechecking(false);
  }, []);

  /** Debounced entry point for blur; `immediate` for Enter and mount. */
  const schedulePrecheck = useCallback(
    (target: string, immediate: boolean) => {
      cancelPendingPrecheck();
      if (!isValidLogin(target)) return;
      if (target === precheckForRef.current) return;
      if (immediate) {
        void runPrecheck(target);
        return;
      }
      precheckTimerRef.current = setTimeout(() => {
        precheckTimerRef.current = null;
        void runPrecheck(target);
      }, PRECHECK_DEBOUNCE_MS);
    },
    [cancelPendingPrecheck, runPrecheck]
  );

  useEffect(() => cancelPendingPrecheck, [cancelPendingPrecheck]);

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

  // P4 hand-off: a prefilled, valid org is checked as soon as the card is
  // actually shown (config loaded, OAuth configured). `precheckForRef` makes a
  // re-run of this effect a no-op.
  // Read through a ref rather than a dep: this is the prefill check, not a
  // keystroke one (blur and Enter own those), and it must not fire for a
  // `defaultOrg` the operator has already typed over while config loaded.
  const loginRef = useRef(login);
  useEffect(() => {
    if (loading || !config?.oauth_configured) return;
    const initial = defaultOrg?.trim() ?? null;
    if (!isValidLogin(initial) || loginRef.current.trim() !== initial) return;
    schedulePrecheck(initial, true);
  }, [loading, config?.oauth_configured, defaultOrg, schedulePrecheck]);

  const onLoginChange = useCallback(
    (value: string) => {
      loginRef.current = value;
      setLogin(value);
      // The rendered verdict describes the org it was asked about; once the
      // field names a different one it is stale, so drop it (and let the next
      // blur/Enter ask again for whatever is there then).
      if (value.trim() !== precheckForRef.current) {
        cancelPendingPrecheck();
        precheckForRef.current = null;
        setPrecheck(null);
        setPrechecking(false);
      }
    },
    [cancelPendingPrecheck]
  );

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
      // this connect, and every mint allocates a single-use row in coord for a
      // connect that is already known to be uncompletable. `beginConnectState`
      // would catch it below, but only once that dead row exists — and again on
      // every retry.
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
          onChange={(e) => onLoginChange(e.target.value)}
          onBlur={() => schedulePrecheck(trimmed, false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              schedulePrecheck(trimmed, true);
            }
          }}
          placeholder="your-org"
          aria-label="GitHub organization login"
          data-testid="connect-installed-org-login"
          spellCheck={false}
          autoCapitalize="none"
        />
        {/*
          The pre-check's answer. `role="status"` so a screen reader hears it
          when it lands; `data-kind` carries the verdict for tests and styling.
          It informs the click below, it never disables it: coord's claim gate
          is the authority, and an UNKNOWN here must not block a connect that
          would succeed.
        */}
        {prechecking && !precheck && (
          <p
            className="flex items-center gap-2 text-xs text-muted-foreground"
            role="status"
            data-testid="connect-installed-org-precheck"
            data-kind="checking"
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            Checking with coord…
          </p>
        )}
        {precheck && (
          <p
            className={cn("text-xs", PRECHECK_CLASS[precheck.kind])}
            role="status"
            data-testid="connect-installed-org-precheck"
            data-kind={precheck.kind}
          >
            {precheck.message}
          </p>
        )}
        {/*
          The unseen arm's remedy is the install, not the authorize: the SAME
          CTA the card above this one offers, so the operator does not have
          to scroll back up to find it. It mints on click only, so rendering
          it here costs nothing until it is used.
        */}
        {precheck?.kind === "unseen" && (
          <InstallGitHubAppButton
            flow={flow}
            runnerState={runnerState}
            variant="secondary"
            testId="connect-installed-org-precheck-install"
          />
        )}
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
