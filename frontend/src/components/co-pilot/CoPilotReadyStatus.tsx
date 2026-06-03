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
 * Composes ALL gates that feed ``enableRemoteCommands`` in
 * ``lib/ui-bridge/provider.tsx`` — previously this badge showed green from
 * preference + consent ALONE, so it claimed "ready" even when the relay was
 * never going to connect (the env gate was off, or — under HttpOnly-cookie
 * auth — the registration metadata could not resolve). That masked the
 * whole "co-pilot silently no-ops" bug. The badge now mirrors the provider:
 *
 *   - {@link isRemoteCommandsEnvEnabled} — the build-time env gate
 *     (``NEXT_PUBLIC_UI_BRIDGE_REMOTE_COMMANDS``, or dev).
 *   - {@link useCoPilotPreference} — the durable per-user opt-in.
 *   - {@link useCoPilotSessionConsent} — the transient per-session consent.
 *   - {@link isRelayRegistrationReady} — the relay registration metadata
 *     (cookie-authed ``/me`` user id + per-tab session id) being resolved,
 *     which is the closest client-side proxy for "the tab can register and
 *     heartbeats will carry the required envelope". The UI Bridge SDK
 *     exposes no relay-connection/registration callback, so this is the
 *     strongest readiness signal available without one.
 *
 * Rendered states:
 *   - env gate OFF                          → "⚠ Co-pilot unavailable here"
 *   - preference OFF                        → "⚠ Co-pilot disabled" (→ settings)
 *   - preference ON, consent !granted       → "⚠ Enabled, consent not granted this session"
 *   - consent granted, registration pending → "Connecting co-pilot…"
 *   - registration resolved                 → "✓ Connected & ready this session"
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.5.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useCoPilotPreference } from "@/hooks/useCoPilotPreference";
import { useCoPilotSessionConsent } from "@/hooks/useCoPilotSessionConsent";
import {
  isRemoteCommandsEnvEnabled,
  isRelayRegistrationReady,
} from "@/lib/ui-bridge/provider";

/** Poll interval (ms) while waiting for relay registration to resolve. */
const REGISTRATION_POLL_MS = 1000;

export function CoPilotReadyStatus() {
  const { enabled, isLoading } = useCoPilotPreference();
  const { state } = useCoPilotSessionConsent();

  // The env gate is read at module-eval time on the client; safe to read
  // directly (returns false on the server, true only when the build flag /
  // dev is set).
  const envEnabled = isRemoteCommandsEnvEnabled();

  const consentGranted = envEnabled && enabled && state === "granted";

  // Relay registration metadata (cookie-authed `/me` id + per-tab session
  // id) resolves asynchronously OUTSIDE React state — the provider caches
  // it in a module var. Poll it while consent is granted but registration
  // hasn't resolved yet, so the badge flips from "connecting" to "ready"
  // without needing a render trigger from the provider.
  const [registrationReady, setRegistrationReady] = useState(false);
  useEffect(() => {
    if (!consentGranted) {
      setRegistrationReady(false);
      return;
    }
    if (isRelayRegistrationReady()) {
      setRegistrationReady(true);
      return;
    }
    const id = setInterval(() => {
      if (isRelayRegistrationReady()) {
        setRegistrationReady(true);
        clearInterval(id);
      }
    }, REGISTRATION_POLL_MS);
    return () => clearInterval(id);
  }, [consentGranted]);

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
  if (!envEnabled) {
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

  // ---- consent granted, relay registration not yet resolved ----
  if (!registrationReady) {
    return (
      <Badge
        variant="secondary"
        data-testid="co-pilot-ready-status"
        data-status="connecting"
      >
        <Loader2 className="animate-spin" aria-hidden />
        Connecting co-pilot…
      </Badge>
    );
  }

  // ---- fully ready: env + preference + consent + relay registration ----
  return (
    <Badge
      variant="success"
      data-testid="co-pilot-ready-status"
      data-status="ready"
    >
      ✓ Connected &amp; ready this session
    </Badge>
  );
}
