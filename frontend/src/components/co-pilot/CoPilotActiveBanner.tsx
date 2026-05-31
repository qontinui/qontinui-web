"use client";

/**
 * CoPilotActiveBanner — visible "AI in control" indicator.
 *
 * Renders a fixed-top banner whenever the AI co-pilot has issued ≥1
 * command in the last 30 seconds. Provides:
 *
 *   - a "Stop" button that immediately revokes the per-session consent
 *     (the relay listener un-mounts within the next React render);
 *   - a "Disable for this account" link that ALSO flips the per-user
 *     durable preference back to false so a fresh session won't re-prompt.
 *
 * # data-bridge-invisible="true"
 *
 * The OUTERMOST element is wrapped in ``data-bridge-invisible="true"`` so
 * the SDK's AutoRegister ancestor walk skips this subtree. Critical:
 * without this gate the bridge could click its own Stop button + silence
 * the indicator that proves it's running, defeating the whole purpose.
 * (See ``data-bridge-redact`` precedent in §4.6.)
 *
 * # Activity detection
 *
 * Polls the §4.8 audit-log endpoint via ``useCoPilotActivity``. Polling
 * (rather than relay-side push) is the chosen path because the SDK's
 * ``CommandRelayListener`` has no per-command browser-side callback in
 * 0.13.0. Audit-log polling is the canonical signal — it's the row that
 * proves a command happened for THIS user.
 *
 * # Stop semantics
 *
 * "Stop" revokes ONLY the per-session consent (sessionStorage). The
 * per-user preference stays on so the user can re-grant for the next
 * session if they choose. "Disable for this account" is a separate
 * small link inside the banner for the harder revoke. Spec choice:
 * Stop = lightweight reversible; full opt-out = explicit, secondary.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.5.
 */

import { useMemo } from "react";
import { Bot, X } from "lucide-react";
import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";
import { useCoPilotActivity } from "@/hooks/useCoPilotActivity";
import { useCoPilotPreference } from "@/hooks/useCoPilotPreference";
import { useCoPilotSessionConsent } from "@/hooks/useCoPilotSessionConsent";

const REVOCATION_AUDIT_URL = `${ApiConfig.API_BASE_URL}/api/v1/users/me/co-pilot/activity`;

function relativeAgo(lastActionAt: number | null): string {
  if (lastActionAt === null) return "";
  const deltaMs = Date.now() - lastActionAt;
  if (deltaMs < 1_000) return "just now";
  if (deltaMs < 60_000) return `${Math.floor(deltaMs / 1_000)}s ago`;
  return `${Math.floor(deltaMs / 60_000)}m ago`;
}

/**
 * Fire a synthetic audit-log row capturing the Stop revocation. The
 * banner's revoke is a user-driven action that the audit feed should
 * surface alongside the AI's own actions — the user wants to be able to
 * see "I stopped it at 10:42:17" in the activity viewer.
 *
 * Fire-and-forget — UI consent revocation MUST NOT block on a server
 * round-trip. If the POST fails, the local revoke still stands.
 */
function recordRevocation(reason: "stop_button" | "disable_for_account") {
  const body = {
    command_name: "consent.revoked",
    path: "/co-pilot/banner",
    method: "POST",
    status_code: 200,
    payload_summary: { reason },
  };
  httpClient
    .fetch(REVOCATION_AUDIT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    .catch(() => {
      /* swallow — UI revocation is unconditional */
    });
}

export function CoPilotActiveBanner() {
  const preference = useCoPilotPreference();
  const consent = useCoPilotSessionConsent();
  // Only poll when the listener is actually live — opting out of polling
  // while the consent layer is closed avoids unnecessary load on the
  // audit-log endpoint for the 99% of users who haven't opted in.
  const pollingEnabled =
    preference.enabled && consent.state === "granted";
  const { isActive, lastActionAt } = useCoPilotActivity({
    enabled: pollingEnabled,
  });

  const visible = pollingEnabled && isActive;

  const ago = useMemo(() => relativeAgo(lastActionAt), [lastActionAt]);

  if (!visible) {
    // CRITICAL: still wrap the empty render in data-bridge-invisible so
    // a transient activity flip can't reveal a non-invisible mount.
    return <div data-bridge-invisible="true" data-testid="co-pilot-active-banner-hidden" />;
  }

  const handleStop = () => {
    consent.revoke();
    recordRevocation("stop_button");
  };

  const handleDisableForAccount = () => {
    consent.revoke();
    void preference.mutate(false);
    recordRevocation("disable_for_account");
  };

  return (
    <div
      data-bridge-invisible="true"
      data-testid="co-pilot-active-banner"
      style={{ zIndex: 9999 }}
      className="fixed top-0 left-0 right-0 bg-amber-950 text-amber-100 border-b border-amber-800 shadow-lg"
    >
      <div className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
        <div className="flex items-center gap-2 min-w-0">
          <Bot className="size-4 shrink-0" aria-hidden />
          <span className="font-medium">AI co-pilot is active</span>
          {ago && (
            <span
              className="text-amber-200/70"
              data-testid="co-pilot-active-banner-ago"
            >
              (last action {ago})
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleDisableForAccount}
            className="text-xs underline underline-offset-2 hover:text-white"
            data-testid="co-pilot-active-banner-disable-account"
          >
            Disable for this account
          </button>
          <button
            type="button"
            onClick={handleStop}
            className="inline-flex items-center gap-1 rounded-md bg-amber-700/60 hover:bg-amber-700 px-3 py-1 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            data-testid="co-pilot-active-banner-stop"
          >
            <X className="size-3.5" aria-hidden />
            Stop
          </button>
        </div>
      </div>
    </div>
  );
}
