"use client";

/**
 * UI Bridge Provider Wrapper
 *
 * Configures UIBridgeProvider with appropriate features based on environment.
 * Includes AutoRegisterProvider for automatic element registration.
 * Supports both WebSocket and HTTP polling for remote automation.
 *
 * In development, captured browser events are batched and persisted
 * to .dev-logs/browser-events.jsonl via a Next.js API route.
 *
 * Transport modes:
 * - 'auto' (default): Try WebSocket first, fall back to HTTP polling
 * - 'websocket': Use WebSocket only
 * - 'http': Use HTTP polling only
 */

import React, { useCallback, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  UIBridgeProvider,
  AutoRegisterProvider,
} from "@qontinui/ui-bridge/react";
import type {
  UIBridgeFeatures,
  UIBridgeConfig,
  BridgeEvent,
} from "@qontinui/ui-bridge/core";
import type {
  BrowserCaptureConfig,
  AnyCapturedEvent,
} from "@qontinui/ui-bridge/debug";
import { CommandRelayListener } from "@qontinui/ui-bridge/react";
import { getGlobalSpecStore } from "@qontinui/ui-bridge/specs";
import { RouteAwarenessProvider } from "./RouteAwarenessProvider";
import { useDiscoveredSpecs } from "./use-discovered-specs";
import { tokenStorage, authService } from "@/services/service-factory";
import { useCoPilotPreference } from "@/hooks/useCoPilotPreference";
import { useCoPilotSessionConsent } from "@/hooks/useCoPilotSessionConsent";
import { CoPilotConsentModal } from "@/components/co-pilot/CoPilotConsentModal";

/**
 * Auth-header hook for the SDK's CommandRelayListener (SDK ≥ 0.10.0).
 *
 * Reads the current bearer token from sessionStorage on every outbound
 * relay request so a token rotation is picked up without remounting the
 * listener. Returns `null` when no token is available — the SDK then
 * falls back to legacy cookie / unauth'd behavior.
 *
 * Required to authenticate against the relay route when
 * `UI_BRIDGE_REQUIRE_AUTH=1` is set in the deployment env (see
 * `app/api/ui-bridge/[...path]/_auth.ts`). Default-off in production,
 * so this hook is a no-op until the env flag is flipped.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.1.2.
 */
function commandRelayAuthHeader(): string | null {
  return tokenStorage.getAccessToken();
}

/**
 * sessionStorage key for the stable per-tab relay session id.
 *
 * The previous implementation sourced `sessionId` from the access
 * token's `jti` claim — but under HttpOnly-cookie auth there is no
 * JS-readable token after a page load/refresh (the token lives in an
 * HttpOnly cookie + in-memory only on the login navigation), so the
 * claim is unavailable and registration never resolved. A stable
 * per-tab UUID is the correct identifier here: the relay uses
 * `sessionId` to scope/identify the tab's session, and the
 * AUTHORITATIVE user scoping is done server-side via the
 * `X-Caller-User-Id` header the relay route injects from the verified
 * cookie session (see `app/api/ui-bridge/[...path]/route.ts` +
 * `_auth.ts`). The SDK contract does not require `sessionId` to match
 * any token claim — it only requires a non-empty `{userId, sessionId}`.
 */
const RELAY_SESSION_ID_KEY = "ui_bridge_relay_session_id";

/**
 * Module-scoped cache of the current user's id, resolved once per tab
 * via a cookie-authed `GET /api/v1/auth/users/me` (see
 * `resolveRelayUserId` below). `commandRelayRegistrationMetadata` is a
 * SYNC function the SDK calls per heartbeat, so it cannot itself await
 * the `/me` round-trip; the wrapper pre-fetches on mount and writes the
 * id here. Null until resolved (or when logged out), which keeps the
 * registration metadata — and therefore the listener's `enabled` gate
 * — off until a real user id is known.
 */
let cachedRelayUserId: string | null = null;

/**
 * Get (or lazily create) the stable per-tab relay session id. Persisted
 * in `sessionStorage` so it survives a same-tab reload but is unique per
 * browser tab (sessionStorage is tab-scoped), which matches the relay's
 * per-tab session semantics. SSR-safe: returns null when `window` is
 * unavailable.
 */
function getRelaySessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    let id = sessionStorage.getItem(RELAY_SESSION_ID_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `relay-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(RELAY_SESSION_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

/**
 * Resolve the current user's id via the cookie-authed `/me` endpoint and
 * cache it in `cachedRelayUserId`. Uses the app's `authService`, which
 * sends `credentials: "include"` (cookie auth) and attaches the in-memory
 * Bearer when present — so it works on the post-refresh, JS-token-absent
 * path that the old `tokenStorage.getUserId()` (token `sub` claim) could
 * not. Best-effort: a 401 / network error leaves the cache null (listener
 * stays unmounted). Idempotent — no-op once resolved.
 */
async function resolveRelayUserId(): Promise<void> {
  if (cachedRelayUserId) return;
  try {
    const user = await authService.getCurrentUser();
    if (user && typeof user.id === "string" && user.id.length > 0) {
      cachedRelayUserId = user.id;
    }
  } catch {
    // Logged out / cookie session not (yet) established. Leave null; the
    // listener's `enabled` gate keeps it unmounted until a retry resolves.
  }
}

/**
 * Per-user tab scoping hook for the SDK's CommandRelayListener
 * (SDK ≥ 0.12.0).
 *
 * Returns `{userId, sessionId}` where `userId` is the id resolved from a
 * cookie-authed `/me` call (cached in `cachedRelayUserId` by the
 * wrapper's mount effect) and `sessionId` is a stable per-tab UUID. The
 * SDK sends this with every heartbeat; the relay rejects heartbeats
 * without it (strict mode) and uses it to identify the tab's session.
 * The authoritative per-user scoping is enforced server-side via the
 * `X-Caller-User-Id` header injected from the verified cookie session.
 *
 * Returns null until the `/me` id resolves (and on the logged-out path),
 * so the listener's `enabled` gate (below) keeps the listener un-mounted
 * until a real user id + tab session id are both available. Called fresh
 * per heartbeat so it picks up the resolved id without remounting.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.2.
 */
function commandRelayRegistrationMetadata():
  | { userId: string; sessionId: string }
  | null {
  const userId = cachedRelayUserId;
  const sessionId = getRelaySessionId();
  if (!userId || !sessionId) return null;
  return { userId, sessionId };
}

const isDev = process.env.NODE_ENV === "development";

// Production opt-in for the UI Bridge command relay. When this env var is
// set at build time (e.g. for staging deploys driven by /manual-test-coord),
// the CommandRelayListener mounts even though NODE_ENV is "production".
// Without it, production tabs never register with the bridge and any
// /control/* command fails with "No browser connected".
const remoteCommandsOptIn =
  process.env.NEXT_PUBLIC_UI_BRIDGE_REMOTE_COMMANDS === "1";

/**
 * Build-time / env-level enablement of the command relay — the OUTER gate
 * that composes with the per-user preference + per-session consent. True
 * in development or when `NEXT_PUBLIC_UI_BRIDGE_REMOTE_COMMANDS=1` is set
 * at build time. Exported so the readiness badge can mirror the provider's
 * gate exactly instead of re-deriving it (and drifting).
 */
export function isRemoteCommandsEnvEnabled(): boolean {
  return isDev || remoteCommandsOptIn;
}

/**
 * True once the relay registration metadata is fully resolvable — i.e. a
 * cookie-authed `/me` user id has been cached AND a per-tab session id
 * exists. The readiness badge uses this to distinguish "consent granted
 * but relay not yet registered/connecting" from "actually ready to drive
 * the page". The SDK exposes no connection/registration callback (its
 * `CommandRelayListener` returns `null` with no status prop), so this
 * metadata-resolved signal is the closest client-side proxy for "the tab
 * can register and heartbeats will carry the required envelope".
 */
export function isRelayRegistrationReady(): boolean {
  return commandRelayRegistrationMetadata() !== null;
}

/**
 * Feature configuration for UI Bridge
 * Render logging is always enabled for state discovery.
 */
const features: UIBridgeFeatures = {
  renderLog: true,
  control: true,
  debug: isDev,
};

/**
 * Configuration for UI Bridge
 */
const config: UIBridgeConfig = {
  verbose: isDev,
  maxLogEntries: 10, // Reduced from 1000 - each entry is a full DOM snapshot (several MB)
  captureChanges: false, // Disable DOM change tracking — causes memory leak (unbounded pendingChanges array)
};

const FLUSH_INTERVAL_MS = 5000;
const EVENTS_ENDPOINT = "/api/dev-debug/browser-events";
const PERF_EVENTS_ENDPOINT = "/api/dev-debug/perf-events";

/**
 * Browser capture configuration.
 * Enables performance-relevant captures: long tasks, long animation frames,
 * network failures, web vitals (LCP, CLS), and memory snapshots.
 */
const browserCaptureConfig: BrowserCaptureConfig = {
  console: true, // Capture console.error() for UI Bridge getConsoleErrors command
  network: true,
  navigation: true,
  longTasks: true,
  longAnimationFrames: false, // Disabled — large events (script attribution arrays), enable on-demand for profiling
  resourceErrors: true,
  wsDisconnections: true,
  hmr: false,
  webVitals: true,
  memory: true,
  memoryIntervalMs: 30000, // Relaxed from 15s — memory trends visible at 30s granularity
  freezeDetector: true,
  freezeIntervalMs: 1000, // Relaxed from 200ms — 3s freeze threshold doesn't need 200ms resolution
  freezeThresholdMs: 3000,
  domMetrics: true,
  domMetricsIntervalMs: 30000, // Relaxed from 10s — DOM node counts don't change fast enough for 10s
  maxEntries: 200, // Reduced from 500 — less memory in BrowserEventCapture's internal buffer
};

/**
 * Loads bundled page specs into the global SpecStore on mount so they are
 * returned by the /control/specs relay command.
 */
function BundledSpecsLoader() {
  const { specs } = useDiscoveredSpecs();
  React.useEffect(() => {
    if (specs.length === 0) return;
    const store = getGlobalSpecStore();
    for (const spec of specs) {
      // Cast config to satisfy SpecConfig's literal version type
      store.load(spec.specId, spec.config as Parameters<typeof store.load>[1]);
    }
    return () => {
      for (const spec of specs) {
        store.unload(spec.specId);
      }
    };
  }, [specs]);
  return null;
}

interface UIBridgeWrapperProps {
  children: React.ReactNode;
  /**
   * Build-time / env-level enablement of the command relay. This is the
   * OUTER gate; the inner gates (per-user preference + per-session
   * consent) compose with it inside the wrapper. Defaults to true in
   * development, or in production when
   * NEXT_PUBLIC_UI_BRIDGE_REMOTE_COMMANDS=1 is set at build time.
   */
  enableRemoteCommands?: boolean;
}

/**
 * UI Bridge Provider wrapper component.
 *
 * This wraps the application with UIBridgeProvider for state discovery.
 * Render logging is always enabled.
 *
 * Features:
 * - Automatic element registration via AutoRegisterProvider
 * - Remote command listening via WebSocket (primary) or HTTP polling (fallback)
 * - SWC plugin integration for compile-time instrumentation
 * - Browser event persistence to .dev-logs (dev only)
 */
export function UIBridgeWrapper({
  children,
  enableRemoteCommands: envEnableRemoteCommands = isRemoteCommandsEnvEnabled(),
}: UIBridgeWrapperProps) {
  // §4.5 consent layer — compose the env-level gate with the per-user
  // durable preference AND the per-session transient consent. The
  // CommandRelayListener only mounts when ALL THREE are positive:
  //
  //     (envEnableRemoteCommands)            // dev OR build-time opt-in
  //   && userPreference.enabled              // toggled in /settings/co-pilot
  //   && sessionConsent.state === "granted"  // explicit per-session OK
  //
  // The per-user preference is a single GET; in OSS/loopback or when the
  // user is unauthenticated it returns false (the hook gracefully
  // resolves enabled=false on error), keeping the listener off.
  const userPreference = useCoPilotPreference();
  const sessionConsent = useCoPilotSessionConsent();
  const consentGranted =
    envEnableRemoteCommands &&
    userPreference.enabled === true &&
    sessionConsent.state === "granted";

  // Resolve the relay user id via a cookie-authed `/me` once all three
  // consent gates pass. Under HttpOnly-cookie auth the access token is
  // NOT JS-readable after a load/refresh, so the registration metadata
  // (userId) can't come from a token claim — it comes from `/me`. The
  // SDK's `commandRelayRegistrationMetadata` is sync (called per
  // heartbeat) so we pre-fetch the id here into a module-scoped cache and
  // flip `relayUserIdReady` to re-render once it's available.
  const [relayUserIdReady, setRelayUserIdReady] = React.useState(
    cachedRelayUserId !== null
  );
  useEffect(() => {
    if (!consentGranted || relayUserIdReady) return;
    let cancelled = false;
    void resolveRelayUserId().then(() => {
      if (!cancelled && cachedRelayUserId !== null) {
        setRelayUserIdReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [consentGranted, relayUserIdReady]);

  // The listener mounts only once the user id + per-tab session id are
  // both resolvable, so `commandRelayRegistrationMetadata` never returns
  // null while mounted — strict-mode heartbeats always carry the
  // {userId, sessionId} envelope.
  const enableRemoteCommands = consentGranted && relayUserIdReady;

  const bufferRef = useRef<BridgeEvent[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const perfBufferRef = useRef<AnyCapturedEvent[]>([]);
  const perfTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    timerRef.current = null;
    const batch = bufferRef.current;
    if (batch.length === 0) return;
    bufferRef.current = [];

    const body = JSON.stringify({ events: batch });

    // Use sendBeacon if available (more reliable during unload), else fetch
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(
        EVENTS_ENDPOINT,
        new Blob([body], { type: "application/json" })
      );
    } else {
      fetch(EVENTS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  }, []);

  const flushPerf = useCallback(() => {
    perfTimerRef.current = null;
    const batch = perfBufferRef.current;
    if (batch.length === 0) return;
    perfBufferRef.current = [];

    const body = JSON.stringify({ events: batch });

    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(
        PERF_EVENTS_ENDPOINT,
        new Blob([body], { type: "application/json" })
      );
    } else {
      fetch(PERF_EVENTS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  }, []);

  const onEvent = useCallback(
    (event: BridgeEvent) => {
      bufferRef.current.push(event);
      if (!timerRef.current) {
        timerRef.current = setTimeout(flush, FLUSH_INTERVAL_MS);
      }
    },
    [flush]
  );

  const onBrowserEvent = useCallback(
    (event: AnyCapturedEvent) => {
      perfBufferRef.current.push(event);
      if (!perfTimerRef.current) {
        perfTimerRef.current = setTimeout(flushPerf, FLUSH_INTERVAL_MS);
      }
    },
    [flushPerf]
  );

  // Clear the JSONL files on mount (new session)
  const clearLogsMutation = useMutation({
    mutationFn: async () => {
      const headers = { "Content-Type": "application/json" };
      const body = JSON.stringify({ clear: true });
      await Promise.allSettled([
        fetch(EVENTS_ENDPOINT, { method: "POST", headers, body }),
        fetch(PERF_EVENTS_ENDPOINT, { method: "POST", headers, body }),
      ]);
    },
  });

  useEffect(() => {
    if (!isDev) return;
    clearLogsMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flush remaining events on page unload
  useEffect(() => {
    if (!isDev) return;
    const handleUnload = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      flush();
      if (perfTimerRef.current) {
        clearTimeout(perfTimerRef.current);
        perfTimerRef.current = null;
      }
      flushPerf();
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      // Also flush on unmount
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      flush();
      if (perfTimerRef.current) {
        clearTimeout(perfTimerRef.current);
        perfTimerRef.current = null;
      }
      flushPerf();
    };
  }, [flush, flushPerf]);

  return (
    <UIBridgeProvider
      features={features}
      config={config}
      onEvent={isDev ? onEvent : undefined}
      onBrowserEvent={isDev ? onBrowserEvent : undefined}
      browserCaptureConfig={isDev ? browserCaptureConfig : undefined}
    >
      <BundledSpecsLoader />
      {/* AutoRegisterProvider enables automatic element registration for UI Bridge */}
      {/* All interactive elements (buttons, inputs, links, etc.) are auto-discovered */}
      <AutoRegisterProvider
        enabled={true}
        idStrategy="prefer-existing"
        debounceMs={100}
        excludeSelectors={["[data-no-register]"]}
        contentDiscovery={{ enabled: true, maxContentElements: 200 }}
      >
        {/* Command relay listener for remote automation via SSE.
            authHeader wires the session bearer into the SDK transport so
            the relay's session-bound auth gate (UI_BRIDGE_REQUIRE_AUTH=1)
            sees the token. registrationMetadata wires the {userId,
            sessionId} envelope so the relay's per-user tab scoping (SDK
            ≥ 0.12.0, strict mode) accepts the heartbeat. Default-off —
            no-op when the build-time flag is off. */}
        <CommandRelayListener
          enabled={enableRemoteCommands}
          authHeader={commandRelayAuthHeader}
          registrationMetadata={commandRelayRegistrationMetadata}
        />
        {/* §4.5 — global per-session consent modal. Renders ONLY when
            the user-level preference is on AND the session decision is
            still null. The wrapper sits inside the AutoRegisterProvider
            so the modal's Switch/Buttons get the usual auto-register
            treatment (the SDK already skips ``data-bridge-invisible``
            subtrees; the modal itself is not invisible since it IS the
            user surfacing the consent decision). */}
        {envEnableRemoteCommands && userPreference.enabled && (
          <CoPilotConsentModal />
        )}
        <RouteAwarenessProvider>
          {children as Parameters<typeof AutoRegisterProvider>[0]["children"]}
        </RouteAwarenessProvider>
      </AutoRegisterProvider>
    </UIBridgeProvider>
  );
}
