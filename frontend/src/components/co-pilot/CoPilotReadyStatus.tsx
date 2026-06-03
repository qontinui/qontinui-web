"use client";

/**
 * CoPilotReadyStatus — a small, persistent at-a-glance indicator of whether
 * the AI co-pilot is actually ready to drive this tab.
 *
 * This is DISTINCT from the active banner mounted in the UI Bridge provider:
 * the banner only appears while the relay listener is mounted, whereas this
 * badge surfaces the composed readiness state at all times so a user who
 * "enabled it but nothing happened" can see exactly which gate is unmet.
 *
 * Composes the gates that feed ``enableRemoteCommands`` in
 * ``lib/ui-bridge/provider.tsx`` — previously this badge showed green from
 * preference + consent ALONE, so it claimed "ready" even when the relay was
 * never going to connect because the build-time env gate was off. That masked
 * a "co-pilot silently no-ops" bug. The badge now ALSO requires the env gate,
 * mirroring the provider's expression exactly so the two can't drift:
 *
 *   - the build-time env gate
 *     (``isDev || NEXT_PUBLIC_UI_BRIDGE_REMOTE_COMMANDS === "1"``).
 *   - {@link useCoPilotPreference} — the durable per-user opt-in.
 *   - {@link useCoPilotSessionConsent} — the transient per-session consent.
 *
 * Rendered states:
 *   - env gate OFF                          → "⚠ Co-pilot unavailable here"
 *   - preference OFF                        → "⚠ Co-pilot disabled" (→ settings)
 *   - preference ON, consent !granted       → "⚠ Enabled, consent not granted this session"
 *   - env + preference + consent granted    → "✓ Enabled & consented this session"
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.5.
 */

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useCoPilotPreference } from "@/hooks/useCoPilotPreference";
import { useCoPilotSessionConsent } from "@/hooks/useCoPilotSessionConsent";

/**
 * Build-time / env-level enablement of the command relay — the OUTER gate that
 * composes with the per-user preference + per-session consent. Mirrors the
 * exact expression used for ``enableRemoteCommands`` in
 * ``lib/ui-bridge/provider.tsx`` (``isDev || remoteCommandsOptIn``) so the
 * badge can never claim "ready" on a build where the relay can't connect.
 */
const isDev = process.env.NODE_ENV === "development";
const isRemoteCommandsEnvEnabled =
  isDev || process.env.NEXT_PUBLIC_UI_BRIDGE_REMOTE_COMMANDS === "1";

export function CoPilotReadyStatus() {
  const { enabled, isLoading } = useCoPilotPreference();
  const { state } = useCoPilotSessionConsent();

  if (isLoading) {
    return (
      <Badge
        variant="secondary"
        data-testid="co-pilot-ready-status"
        data-status="loading"
      >
        <Loader2 className="animate-spin" aria-hidden />
        Checking co-pilot…
      </Badge>
    );
  }

  // ---- env gate OFF (relay can never connect on this build) ----
  if (!isRemoteCommandsEnvEnabled) {
    return (
      <Badge
        variant="warning"
        data-testid="co-pilot-ready-status"
        data-status="env-disabled"
      >
        ⚠ Co-pilot unavailable here
      </Badge>
    );
  }

  // ---- preference OFF ----
  if (!enabled) {
    return (
      <Badge
        asChild
        variant="warning"
        data-testid="co-pilot-ready-status"
        data-status="disabled"
      >
        <Link href="/settings/co-pilot">⚠ Co-pilot disabled</Link>
      </Badge>
    );
  }

  // ---- preference ON, consent not granted ----
  if (state !== "granted") {
    return (
      <Badge
        variant="warning"
        data-testid="co-pilot-ready-status"
        data-status="consent-pending"
      >
        ⚠ Enabled, consent not granted this session
      </Badge>
    );
  }

  // ---- env + preference ON + consent granted ----
  return (
    <Badge
      variant="success"
      data-testid="co-pilot-ready-status"
      data-status="ready"
    >
      ✓ Enabled &amp; consented this session
    </Badge>
  );
}
