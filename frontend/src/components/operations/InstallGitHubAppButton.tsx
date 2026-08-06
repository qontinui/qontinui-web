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
  flow,
  runnerState = null,
  label = "Install the GitHub App",
  testId,
  variant = "default",
}: {
  /**
   * `runner-clone` makes the eventual claim bind-only (no enrollment / PRs).
   * It is recorded on the minted row, so coord derives `bind_only` from it
   * rather than from the claim body — see {@link mintConnectState}.
   *
   * REQUIRED, deliberately: it used to default to `connect`, which is the
   * MORE privileged of the two (bind + enroll + bootstrap PRs). Now that the
   * value is recorded server-side and authorises the claim, a call site that
   * forgot it would silently mint the privileged flow with nothing — not
   * `tsc`, not a test — noticing. Making it required turns that into a
   * compile error.
   */
  flow: ConnectFlow;
  /**
   * P2 runner-native hand-off: the runner's return nonce, when this page was
   * opened by a deep-link-capable runner (`?state=<nonce>`). It rides slot 5 of
   * the wire format so the callback can deep-link the claim back to the runner
   * window that started the flow. Omitted on every browser-only entry point,
   * which keeps the exact 4-field state shape.
   */
  runnerState?: string | null;
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
      // No target is bound on this path, deliberately: GitHub names the
      // installation only in its post-install redirect, i.e. AFTER the mint.
      // Coord skips the target assertion when the row records none; inventing
      // one here would 403 every legitimate fresh install.
      const token = await mintConnectState({ flow });
      // Empty login for the same reason — on the fresh-install path the
      // Setup-URL redirect carries `installation_id`, so `state` needs no login.
      const state = beginConnectState(flow, "", token, runnerState);
      // Same-tab nav so GitHub's post-install redirect returns into THIS
      // authenticated session — the Setup URL can't complete a claim without one.
      window.location.assign(installUrl(GITHUB_APP_SLUG, state));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMinting(false);
    }
  }, [flow, minting, runnerState]);

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
