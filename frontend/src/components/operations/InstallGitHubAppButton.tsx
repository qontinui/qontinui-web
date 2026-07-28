"use client";

/**
 * InstallGitHubAppButton — the single "send the browser to GitHub's App-install
 * page" control, shared by every fresh-install entry point.
 *
 * It exists because the install URL can no longer be a constant. Plan
 * `2026-07-26-coord-onboarding-claim-caller-tenant-binding` makes the connect
 * flow carry a coord-minted, tenant-bound, single-use token in GitHub's `state`
 * — and minting it is an authenticated network call. A plain `<a href>` computed
 * at module-import or render time cannot await that, so every install entry
 * point has to mint inside the click handler. Centralising it here is what
 * stops one entry point from being left on a stateless URL, which would look
 * fine until coord arms `COORD_REQUIRE_CONNECT_STATE` and then 400 forever.
 *
 * A mint failure renders inline and retryable. It deliberately does NOT fall
 * back to a stateless install URL: that would spend the user's GitHub round-trip
 * on a connect that cannot be completed.
 */

import { useCallback, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { useResetOnBackNavigation } from "@/hooks/useResetOnBackNavigation";
import { cn } from "@/lib/utils";
import {
  GITHUB_APP_SLUG,
  beginConnectState,
  installUrl,
  mintConnectState,
  type ConnectFlow,
} from "@/lib/onboarding-connect-state";

export function InstallGitHubAppButton({
  flow = "connect",
  login = "",
  label = "Install the GitHub App",
  testId,
  variant = "default",
}: {
  /** `runner-clone` makes the eventual claim bind-only (no enrollment / PRs). */
  flow?: ConnectFlow;
  /**
   * Target org login. Empty on the fresh-install path — GitHub names the
   * installation itself in the Setup-URL redirect.
   */
  login?: string;
  label?: string;
  testId: string;
  variant?: "default" | "secondary";
}) {
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `minting` is deliberately left true on the success path (the document is
  // leaving), so a bfcache-restored Back would otherwise strand this button
  // disabled and spinning forever.
  const clearMinting = useCallback(() => setMinting(false), []);
  useResetOnBackNavigation(clearMinting);

  const onClick = useCallback(async () => {
    if (minting) return;
    setMinting(true);
    setError(null);
    try {
      const token = await mintConnectState();
      const state = beginConnectState(flow, login, token);
      // Same-tab nav so GitHub's post-install redirect returns into THIS
      // authenticated session — the Setup URL can't complete a claim without one.
      window.location.assign(installUrl(GITHUB_APP_SLUG, state));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMinting(false);
    }
  }, [flow, login, minting]);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onClick}
        disabled={minting}
        data-testid={testId}
        className={cn(
          buttonVariants({ variant }),
          "w-fit",
          minting && "opacity-70"
        )}
      >
        {minting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ExternalLink className="h-4 w-4" />
        )}
        {label}
      </button>
      {error && (
        <p
          className="text-xs text-destructive"
          role="alert"
          data-testid={`${testId}-error`}
        >
          {error}
        </p>
      )}
    </div>
  );
}
