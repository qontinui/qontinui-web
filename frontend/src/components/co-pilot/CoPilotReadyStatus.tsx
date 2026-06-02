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
 * Composes the two gates that feed ``enableRemoteCommands``:
 *   - {@link useCoPilotPreference} — the durable per-user opt-in.
 *   - {@link useCoPilotSessionConsent} — the transient per-session consent.
 *
 * Rendered states:
 *   - preference OFF                        → "⚠ Co-pilot disabled" (→ settings)
 *   - preference ON, consent !granted       → "⚠ Enabled, consent not granted this session"
 *   - preference ON + consent granted       → "✓ Enabled & consented this session"
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.5.
 */

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useCoPilotPreference } from "@/hooks/useCoPilotPreference";
import { useCoPilotSessionConsent } from "@/hooks/useCoPilotSessionConsent";

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

  // ---- preference ON + consent granted ----
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
