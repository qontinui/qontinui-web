"use client";

/**
 * Co-pilot relay gates — the ONE predicate for "may the UI Bridge command
 * relay drive this tab?".
 *
 * Every surface that depends on or reports that answer composes it from
 * here: the relay listener mount in `provider.tsx`, `CoPilotActiveBanner`
 * (whose Stop button is the revoke path), `CoPilotReadyStatus` and
 * `CoPilotHome`. They used to re-derive the gate expression by hand, so when
 * the loopback-dev auto-grant landed in the provider alone the relay went
 * live while the banner stayed dark (no Stop button) and the readiness badge
 * and home page kept saying consent was missing.
 *
 *     relay enabled = isRemoteCommandsEnvEnabled && isCoPilotConsentSatisfied
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.5.
 */

import { useEffect, useState } from "react";
import type { CoPilotSessionConsentState } from "@/hooks/useCoPilotSessionConsent";

const isDev = process.env.NODE_ENV === "development";

/**
 * Build-time / env-level enablement of the command relay — the OUTER gate.
 *
 * Development always; production only when
 * `NEXT_PUBLIC_UI_BRIDGE_REMOTE_COMMANDS=1` is set at build time (e.g. for
 * staging deploys driven by /manual-test-coord). Without it, production tabs
 * never register with the bridge and any /control/* command fails with
 * "No browser connected".
 */
export const isRemoteCommandsEnvEnabled =
  isDev || process.env.NEXT_PUBLIC_UI_BRIDGE_REMOTE_COMMANDS === "1";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Is this hostname the loopback interface? Asserted in the test against
 * literal hostnames rather than against LOOPBACK_HOSTNAMES itself, so
 * widening the set reddens the test rather than silently passing.
 */
export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname);
}

/**
 * Loopback-dev detection for the co-pilot consent auto-grant.
 *
 * On a developer's own machine the developer IS the operator, so the
 * per-user preference + per-session consent handshake (§4.5) is pure
 * friction: it must be re-granted every session before any `/control/*`
 * command can reach the tab, and with the preference off NO modal renders
 * at all, so the bridge is silently absent with no affordance explaining
 * why.
 *
 * WHY THE CHECK IS `window.location.hostname` AND NOT `isDev` ALONE.
 * The dev server binds `--hostname 0.0.0.0` (package.json `dev`), so it is
 * reachable from the LAN, and `UI_BRIDGE_REQUIRE_AUTH` is default-off — a
 * registered tab is drivable by anyone who can reach the relay. Keying on
 * the ORIGIN THE BROWSER ADDRESSED means a LAN visitor (who reaches the app
 * by IP, never by `localhost`) does not auto-grant, so this never creates a
 * takeover-able tab for a non-local caller. It is not a substitute for
 * binding the server to 127.0.0.1, which is the change that actually closes
 * the relay to the LAN.
 *
 * Returns false during SSR and on the first client render, then flips after
 * mount — deliberately, to avoid a hydration mismatch.
 */
export function useIsLoopbackDev(): boolean {
  const [isLoopback, setIsLoopback] = useState(false);
  useEffect(() => {
    if (!isDev) return;
    if (typeof window === "undefined") return;
    setIsLoopback(isLoopbackHostname(window.location.hostname));
  }, []);
  return isLoopback;
}

export interface CoPilotConsentInputs {
  /** The browser addressed loopback on a development build. */
  loopbackDev: boolean;
  /** Durable per-user opt-in (`useCoPilotPreference().enabled`). */
  preferenceEnabled: boolean;
  /** Per-session decision (`useCoPilotSessionConsent().state`). */
  consentState: CoPilotSessionConsentState;
}

/**
 * The consent half of the relay gate (everything except the env gate).
 *
 * On loopback dev the handshake is auto-granted, but an EXPLICIT revoke
 * still wins: auto-grant is a default, never an override of a decision the
 * developer actually made. Clearing the decision (`consent.reset()`, the
 * home page's "Grant consent") restores the auto-grant.
 */
export function isCoPilotConsentSatisfied({
  loopbackDev,
  preferenceEnabled,
  consentState,
}: CoPilotConsentInputs): boolean {
  return (
    (loopbackDev && consentState !== "revoked") ||
    (preferenceEnabled && consentState === "granted")
  );
}

/**
 * True when consent is satisfied ONLY by the loopback-dev auto-grant — no
 * explicit preference + grant stands behind it. Lets a surface say "auto-
 * granted on localhost" instead of claiming the user consented.
 */
export function isLoopbackAutoGrant(inputs: CoPilotConsentInputs): boolean {
  return (
    isCoPilotConsentSatisfied(inputs) &&
    !(inputs.preferenceEnabled && inputs.consentState === "granted")
  );
}
