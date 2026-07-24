"use client";

/**
 * ConnectInstalledOrg — connect an org whose App is ALREADY installed.
 *
 * The gap this closes: "Install the GitHub App" only works for a *fresh*
 * install. When the org already has the App, GitHub shows "Configure" and
 * issues **no Setup-URL `code`** — and coord's claim requires a code (that's
 * what proves you administer the org). So an already-installed-but-unbound org
 * could not be connected from the product at all; it took an operator calling
 * coord's unverified `bind` route by hand. That route stays operator-only on
 * purpose: it trusts the request body, so exposing it here would let anyone
 * first-bind an org they don't own and permanently block the real owner.
 *
 * Instead we get a real code the honest way: `login/oauth/authorize` issues one
 * regardless of install state. The claim then runs its normal org-admin gate.
 * Because that callback carries no `installation_id`, the org rides through in
 * `state` and coord resolves it against the caller's own installations — naming
 * an org you don't administer just 403s.
 *
 * The org is typed rather than picked from a list: coord exposes no
 * installed-but-unbound listing today, and the `code` is single-use so a
 * pick-then-claim flow would need a second authorize round-trip. Typing is
 * honest (the user knows their org) and costs no safety — the gate is coord's.
 */

import { useEffect, useState } from "react";
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
import { OPERATIONS_API } from "@/components/operations/utils";
import { httpClient } from "@/services/service-factory";
import {
  authorizeUrl,
  beginConnectState,
  type ConnectFlow,
} from "@/lib/onboarding-connect-state";

/** Coord's app-config envelope (`GET /coord/onboarding/github-app`). */
interface GithubAppConfig {
  app_slug: string;
  client_id: string | null;
  oauth_configured: boolean;
}

/**
 * GitHub org/user logins are alphanumeric + single hyphens, no leading/trailing
 * hyphen. Validated here only to catch typos before a pointless round-trip —
 * the authoritative check is coord's org-admin gate.
 */
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

export function ConnectInstalledOrg({
  flow = "connect",
  runnerState = null,
}: {
  /** `runner-clone` claims bind-only (no enrollment / bootstrap PRs). */
  flow?: ConnectFlow;
  /**
   * P2 native hand-off: the runner's return nonce, carried through the GitHub
   * round-trip so the callback deep-links back to the runner instead of
   * claiming in the browser. Null → unchanged browser-claim behavior.
   */
  runnerState?: string | null;
}) {
  const [config, setConfig] = useState<GithubAppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [login, setLogin] = useState("");

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

  // Hide entirely when coord has no OAuth creds: without them the authorize
  // round-trip would end in a 500 `oauth_not_configured`, so offering it would
  // be a worse dead end than the one we're fixing.
  if (loading || !config?.oauth_configured || !config.client_id) return null;

  const trimmed = login.trim();
  const valid = LOGIN_RE.test(trimmed);

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
          organization and authorize instead — GitHub confirms you administer
          it, then we connect it to your workspace.
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
          An <a> rather than a fetch+redirect: the browser must land on GitHub
          itself, and the same-tab nav means the callback returns into this
          authenticated session (a session-less tab can't complete the claim).
          `beginConnectState` mints the CSRF nonce as the URL is built, so it is
          always stored before we navigate.
        */}
        <a
          href={
            valid
              ? authorizeUrl(
                  config.client_id,
                  beginConnectState(flow, trimmed, runnerState)
                )
              : undefined
          }
          aria-disabled={!valid}
          data-testid="connect-installed-org-authorize"
          className={cn(
            buttonVariants({ variant: "secondary" }),
            "w-fit",
            !valid && "pointer-events-none opacity-50"
          )}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ExternalLink className="h-4 w-4" />
          )}
          Authorize &amp; connect
        </a>
        <p className="text-xs text-muted-foreground">
          You must be an admin of the organization. Authorizing doesn&apos;t
          change the App&apos;s permissions or install it anywhere new.
        </p>
      </CardContent>
    </Card>
  );
}
