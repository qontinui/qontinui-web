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
 * ``lib/ui-bridge/provider.tsx`` from the shared ``co-pilot-gates`` module —
 * previously this badge showed green from preference + consent ALONE, so it
 * claimed "ready" even when the relay was never going to connect because the
 * build-time env gate was off, and later claimed consent was missing while a
 * loopback-dev auto-grant had the relay live. Reading the one predicate is
 * what keeps the two from drifting:
 *
 *   - {@link isRemoteCommandsEnvEnabled} — the build-time env gate.
 *   - {@link useIsLoopbackDev} — loopback dev auto-grants consent.
 *   - {@link useCoPilotPreference} — the durable per-user opt-in.
 *   - {@link useCoPilotSessionConsent} — the transient per-session consent.
 *
 * Rendered states:
 *   - env gate OFF                          → "⚠ Co-pilot unavailable here"
 *   - loopback dev, not revoked (no explicit grant) → "✓ Auto-granted on localhost"
 *   - loopback dev, revoked this session    → "⚠ Revoked this session"
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
import {
  isLoopbackAutoGrant,
  isRemoteCommandsEnvEnabled,
  useIsLoopbackDev,
} from "@/lib/ui-bridge/co-pilot-gates";

export function CoPilotReadyStatus() {
  const { enabled, isLoading } = useCoPilotPreference();
  const { state } = useCoPilotSessionConsent();
  const loopbackDev = useIsLoopbackDev();

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

  // ---- loopback dev: consent auto-granted unless explicitly revoked ----
  if (
    isLoopbackAutoGrant({
      loopbackDev,
      preferenceEnabled: enabled,
      consentState: state,
    })
  ) {
    return (
      <Badge
        variant="success"
        data-testid="co-pilot-ready-status"
        data-status="loopback-auto-granted"
      >
        ✓ Auto-granted on localhost
      </Badge>
    );
  }

  if (loopbackDev && state === "revoked") {
    return (
      <Badge
        variant="warning"
        data-testid="co-pilot-ready-status"
        data-status="revoked"
      >
        ⚠ Revoked this session
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
