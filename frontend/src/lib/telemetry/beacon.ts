/**
 * Ξ_ClientTelemetry — the client beacon (plan §3.1 / §3.2 / §3.3 / §3.6).
 *
 * Plan: D:/qontinui-root/plans/2026-05-31-twin-client-telemetry-layer.md
 *
 * ============================================================================
 * ⚠️  COUNSEL-REVIEW GATE — THIS BEACON SHIPS DISABLED BY DEFAULT.  ⚠️
 * ============================================================================
 * Per the plan's bottom gate + §3.6, the LIVE beacon rollout to production
 * users is held behind a counsel review (LIA / DPIA-lite + DPA) where EU/UK
 * users exist. Therefore this code is gated behind an EXPLICIT, opt-in env
 * flag — ``NEXT_PUBLIC_TELEMETRY_BEACON_ENABLED === "1"`` — that is
 * ABSENT/UNSET by default. When the flag is off (the default), ``installBeacon``
 * installs NO listeners and sends NOTHING — it is a pure no-op. Do NOT enable
 * it by default. Do NOT wire it to fire in production until the counsel review
 * clears it. This is non-negotiable.
 * ============================================================================
 *
 * What it does (when enabled AND not opted-out):
 *  - installs ``window.onerror``, ``window.onunhandledrejection``, a ``fetch``
 *    wrapper (fetch/CORS/network failures), and a ``securitypolicyviolation``
 *    (CSP) listener;
 *  - on each incident: scrub (§3.2) → build a ClientTelemetryEvent → enqueue;
 *  - transmits via ``navigator.sendBeacon`` / ``fetch(keepalive:true)`` to a
 *    DEDICATED, hardcoded ingest origin from ``NEXT_PUBLIC_TELEMETRY_INGEST_URL``
 *    — CRITICAL: a SEPARATE env var, NEVER derived from ``NEXT_PUBLIC_API_URL``
 *    (the worked-example bug WAS a wrong API URL; the sensor must not share the
 *    failure mode it observes — §3.3 / real-user-observation §4 sensor
 *    integrity);
 *  - applies client-side sampling + rate-limit + circuit-breaker;
 *  - honors GPC (``navigator.globalPrivacyControl === true``) + DNT
 *    (``navigator.doNotTrack === "1"``) → sets ``opt_out`` and drops at source;
 *  - filters to OWN-bundle frames only (carve-out: drops third-party /
 *    extension-injected errors, §4.1).
 */

import { resolveRelease } from "./release";
import {
  browserFamily,
  normalizeErrorMessage,
  scrubFrame,
  scrubHost,
  scrubPathTemplate,
  scrubStack,
} from "./scrub";
import {
  envelopeEndpoint,
  parseDsn,
  toSentryEnvelope,
} from "./sentry-envelope";
import { getSessionHash } from "./session-hash";
import type { ClientTelemetryEvent, ClientTelemetryFrame } from "./types";

// --- configuration knobs (conservative defaults) ----------------------------

/** Fraction of incidents to keep (client-side sampling). 1.0 = keep all. */
const DEFAULT_SAMPLE_RATE = 1.0;
/** Max events transmitted per rolling window before rate-limiting drops. */
const RATE_LIMIT_MAX = 30;
/** Rolling rate-limit window (ms). */
const RATE_LIMIT_WINDOW_MS = 60_000;
/** Consecutive ingest failures before the circuit breaker trips (stops sending). */
const CIRCUIT_BREAKER_THRESHOLD = 5;
/** Top N stack frames to keep. */
const MAX_FRAMES = 10;

// --- module state ------------------------------------------------------------

interface BeaconState {
  installed: boolean;
  /** The raw configured ingest URL (a Sentry DSN in DSN-mode, else a generic URL). */
  ingestUrl: string;
  /** The endpoint we actually POST to (the Sentry envelope endpoint in DSN-mode). */
  transmitUrl: string;
  /** The DSN string when in Sentry-envelope mode; null for the generic raw-JSON contract. */
  dsn: string | null;
  /** The host used for self-observation exclusion (DSN host in DSN-mode). */
  ingestHost: string | null;
  release: string;
  sampleRate: number;
  // rate-limit ring
  sentTimestamps: number[];
  // circuit breaker
  consecutiveFailures: number;
  tripped: boolean;
  // teardown handles
  prevOnError: OnErrorEventHandler | null;
  prevOnRejection: ((ev: PromiseRejectionEvent) => void) | null;
  originalFetch: typeof fetch | null;
  cspListener: ((ev: SecurityPolicyViolationEvent) => void) | null;
}

let state: BeaconState | null = null;

// --- gating ------------------------------------------------------------------

/**
 * The enable gate. The beacon is OFF unless ``NEXT_PUBLIC_TELEMETRY_BEACON_ENABLED``
 * is exactly ``"1"``. Counsel-review gate (see file header) — do not change the
 * default.
 */
export function isBeaconEnabled(): boolean {
  return process.env.NEXT_PUBLIC_TELEMETRY_BEACON_ENABLED === "1";
}

/**
 * GPC/DNT opt-out check (plan §3.6). When the user signals Global Privacy
 * Control or Do-Not-Track, we drop everything at source.
 */
export function isOptedOut(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & {
    globalPrivacyControl?: boolean;
    msDoNotTrack?: string;
  };
  if (nav.globalPrivacyControl === true) return true;
  // DNT can live on navigator or window; "1" / "yes" both mean opt-out.
  const dnt =
    nav.doNotTrack ??
    nav.msDoNotTrack ??
    (typeof window !== "undefined"
      ? (window as Window & { doNotTrack?: string }).doNotTrack
      : undefined);
  if (dnt === "1" || dnt === "yes") return true;
  return false;
}

// --- own-bundle frame carve-out (§4.1) ---------------------------------------

/**
 * Is this stack attributable to OUR OWN bundle (vs a third-party script or a
 * browser extension injecting errors)? The carve-out admits only frames whose
 * file is same-origin or a recognized bundle asset; extension schemes
 * (chrome-extension://, moz-extension://, safari-web-extension://) and clearly
 * cross-origin script files are dropped. With no parseable frames we keep the
 * event (errors with no usable stack are still our own runtime's signal) unless
 * the message clearly came from an extension.
 */
function isOwnBundleStack(
  frames: ClientTelemetryFrame[],
  pageOrigin: string
): boolean {
  if (frames.length === 0) return true;
  let sawOwn = false;
  let sawForeign = false;
  for (const f of frames) {
    if (!f.file) continue;
    if (/^[a-z-]+-extension:\/\//i.test(f.file)) {
      sawForeign = true;
      continue;
    }
    // Relative/bundle-path file (already host-stripped by scrubFrame) → ours.
    if (f.file.startsWith("/")) {
      sawOwn = true;
      continue;
    }
    try {
      const u = new URL(f.file);
      if (u.origin === pageOrigin) sawOwn = true;
      else sawForeign = true;
    } catch {
      // Unparseable file → treat as ours (bundle-relative).
      sawOwn = true;
    }
  }
  // Admit if any frame is ours; reject only when it's purely foreign.
  if (sawOwn) return true;
  return !sawForeign;
}

// --- event construction ------------------------------------------------------

function buildEvent(
  partial: Pick<ClientTelemetryEvent, "kind" | "error_name"> &
    Partial<ClientTelemetryEvent>
): ClientTelemetryEvent {
  const origin =
    typeof window !== "undefined" ? window.location?.origin ?? "" : "";
  const routeTemplate =
    partial.route_template ??
    scrubPathTemplate(
      typeof window !== "undefined" ? window.location?.pathname ?? "/" : "/",
      origin
    ) ??
    "/";

  return {
    event_id: makeUuid(),
    client_ts: new Date().toISOString(),
    kind: partial.kind,
    release: state?.release ?? resolveRelease(),
    surface: "web",
    origin,
    route_template: routeTemplate,
    request_host: partial.request_host,
    request_path_tmpl: partial.request_path_tmpl,
    failure_class: partial.failure_class,
    http_status: partial.http_status,
    error_name: partial.error_name,
    error_message_norm:
      partial.error_message_norm ??
      normalizeErrorMessage(partial.error_name, partial.error_message_norm),
    stack_top: partial.stack_top ?? [],
    browser_family: browserFamily(),
    session_hash: getSessionHash(),
    count: partial.count ?? 1,
    opt_out: false,
  };
}

function makeUuid(): string {
  const c =
    typeof globalThis !== "undefined"
      ? (globalThis.crypto as Crypto | undefined)
      : undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

// --- transmit ----------------------------------------------------------------

function withinRateLimit(): boolean {
  if (!state) return false;
  const now = Date.now();
  state.sentTimestamps = state.sentTimestamps.filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  return state.sentTimestamps.length < RATE_LIMIT_MAX;
}

function transmit(event: ClientTelemetryEvent): void {
  if (!state) return;
  if (state.tripped) return; // circuit breaker open
  if (!withinRateLimit()) return;
  if (Math.random() > state.sampleRate) return; // sampling

  state.sentTimestamps.push(Date.now());
  // DSN-mode: serialize a Sentry envelope sent as text/plain (CORS-safelisted →
  // no preflight; auth rides in the envelope header's dsn field). Generic mode:
  // the raw scrubbed-event JSON to the configured ingest URL (the §3.3 contract).
  const dsnMode = state.dsn !== null;
  const body = dsnMode
    ? toSentryEnvelope(event, state.dsn as string)
    : JSON.stringify(event);
  const contentType = dsnMode
    ? "text/plain;charset=UTF-8"
    : "application/json";
  const url = state.transmitUrl;

  let ok = false;
  try {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
    ) {
      const blob = new Blob([body], { type: contentType });
      ok = navigator.sendBeacon(url, blob);
    }
  } catch {
    ok = false;
  }

  if (!ok) {
    // Fallback to keepalive fetch. We do NOT await — best-effort.
    try {
      void fetchKeepalive(url, body, contentType)
        .then(() => onTransmitSuccess())
        .catch(() => onTransmitFailure());
      return;
    } catch {
      onTransmitFailure();
      return;
    }
  }
  onTransmitSuccess();
}

function fetchKeepalive(
  url: string,
  body: string,
  contentType: string
): Promise<unknown> {
  // Use the ORIGINAL fetch (captured before we wrapped it) so our own beacon
  // POST never re-enters the fetch wrapper / observes itself.
  const f = state?.originalFetch ?? fetch;
  return f(url, {
    method: "POST",
    body,
    keepalive: true,
    headers: { "Content-Type": contentType },
    // No credentials — the ingest origin is decoupled from the app (§3.3) and
    // we never want to attach app cookies to telemetry.
    credentials: "omit",
    mode: "cors",
  });
}

function onTransmitSuccess(): void {
  if (!state) return;
  state.consecutiveFailures = 0;
}

function onTransmitFailure(): void {
  if (!state) return;
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    state.tripped = true;
  }
}

// --- the central capture path ------------------------------------------------

function capture(
  partial: Pick<ClientTelemetryEvent, "kind" | "error_name"> &
    Partial<ClientTelemetryEvent> & { _rawStack?: string }
): void {
  if (!state) return;
  // Opt-out is checked at install AND here (in case it flips mid-session).
  if (isOptedOut()) return;

  const stack =
    partial.stack_top ?? scrubStack(partial._rawStack, MAX_FRAMES);
  const origin =
    typeof window !== "undefined" ? window.location?.origin ?? "" : "";

  // Carve-out: drop third-party / extension-injected errors (§4.1).
  if (!isOwnBundleStack(stack, origin)) return;

  const { _rawStack: _omit, ...rest } = partial;
  void _omit;
  const event = buildEvent({ ...rest, stack_top: stack });
  transmit(event);
}

// --- listeners ---------------------------------------------------------------

function handleWindowError(
  message: string | Event,
  source?: string,
  lineno?: number,
  colno?: number,
  error?: Error
): void {
  const errorName = error?.name ?? "Error";
  const rawMessage =
    typeof message === "string" ? message : (error?.message ?? "");
  const stack = error?.stack
    ? scrubStack(error.stack, MAX_FRAMES)
    : source
      ? [scrubFrame({ symbol: "<global>", file: source, line: lineno, column: colno })]
      : [];

  const isHydration = /hydrat/i.test(rawMessage);
  capture({
    kind: isHydration ? "hydration_error" : "window_error",
    error_name: errorName,
    error_message_norm: normalizeErrorMessage(errorName, rawMessage),
    stack_top: stack,
  });
}

function handleRejection(ev: PromiseRejectionEvent): void {
  const reason = ev.reason;
  let errorName = "UnhandledRejection";
  let rawMessage = "";
  let rawStack: string | undefined;
  if (reason instanceof Error) {
    errorName = reason.name;
    rawMessage = reason.message;
    rawStack = reason.stack;
  } else if (typeof reason === "string") {
    rawMessage = reason;
  }
  capture({
    kind: "unhandled_rejection",
    error_name: errorName,
    error_message_norm: normalizeErrorMessage(errorName, rawMessage),
    _rawStack: rawStack,
  });
}

function handleCspViolation(ev: SecurityPolicyViolationEvent): void {
  capture({
    kind: "csp_violation",
    error_name: "SecurityPolicyViolation",
    error_message_norm: `SecurityPolicyViolation:${ev.violatedDirective || "unknown"}`,
    request_host: scrubHost(ev.blockedURI || ""),
    failure_class: "opaque",
  });
}

/**
 * Wrap ``window.fetch`` to observe fetch / CORS / network failures. A rejected
 * fetch (``TypeError: Failed to fetch``) is the worked-example signal — it
 * fires for CORS-blocked + DNS + network-down requests. We classify by the
 * error + (when reachable) the response status.
 */
function installFetchWrapper(): void {
  if (!state || typeof window === "undefined") return;
  const original = window.fetch.bind(window);
  state.originalFetch = original;

  const wrapped: typeof fetch = async (input, init) => {
    const url = requestUrlOf(input);
    const host = scrubHost(url);
    // NEVER observe our OWN beacon traffic (avoid feedback loops + self-noise).
    if (state && host && state.ingestHost && host === state.ingestHost) {
      return original(input as RequestInfo, init);
    }
    try {
      const res = await original(input as RequestInfo, init);
      // A successful network round-trip. Surface only error statuses.
      if (!res.ok && (res.status >= 400)) {
        capture({
          kind: "fetch_failure",
          error_name: "HttpError",
          error_message_norm: `HttpError:${res.status}`,
          request_host: host,
          request_path_tmpl: scrubPathTemplate(url),
          failure_class: res.status >= 500 ? "http_5xx" : "http_4xx",
          http_status: res.status,
        });
      } else if (res.type === "opaque" && res.status === 0) {
        // Opaque response — often a no-cors / blocked cross-origin read.
        capture({
          kind: "cors_failure",
          error_name: "OpaqueResponse",
          error_message_norm: "OpaqueResponse:opaque",
          request_host: host,
          request_path_tmpl: scrubPathTemplate(url),
          failure_class: "opaque",
        });
      }
      return res;
    } catch (err) {
      // A thrown fetch = network/CORS/DNS failure (the worked-example path:
      // `TypeError: Failed to fetch`). Classify as cors_failure when the
      // request crossed an origin (the most likely cause + the §5 incident),
      // network otherwise.
      const e = err as Error;
      const crossOrigin =
        !!host &&
        typeof window !== "undefined" &&
        host !== window.location?.host;
      capture({
        kind: crossOrigin ? "cors_failure" : "fetch_failure",
        error_name: e?.name ?? "TypeError",
        error_message_norm: normalizeErrorMessage(
          e?.name ?? "TypeError",
          e?.message
        ),
        request_host: host,
        request_path_tmpl: scrubPathTemplate(url),
        failure_class: crossOrigin ? "cors" : "network",
        _rawStack: e?.stack,
      });
      throw err; // re-throw — we observe, never swallow the app's error
    }
  };
  window.fetch = wrapped;
}

function requestUrlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  return String(input);
}

// --- install / teardown ------------------------------------------------------

/**
 * Install the beacon. NO-OP unless the counsel-gated flag is on AND the user is
 * not opted out (GPC/DNT). Idempotent — a second call while installed is a
 * no-op. Returns ``true`` if listeners were installed, ``false`` otherwise.
 */
export function installBeacon(): boolean {
  // --- the hard gate (see file header — counsel-review gate) ---
  if (!isBeaconEnabled()) return false;
  if (typeof window === "undefined") return false; // SSR no-op
  if (isOptedOut()) return false; // GPC/DNT → drop at source, install nothing
  if (state?.installed) return true; // idempotent

  const ingestUrl = process.env.NEXT_PUBLIC_TELEMETRY_INGEST_URL;
  // CRITICAL: a dedicated ingest origin, NEVER derived from NEXT_PUBLIC_API_URL
  // (§3.3 sensor integrity). With no dedicated ingest URL configured we install
  // NOTHING — we will not fall back to the app API.
  if (!ingestUrl || !ingestUrl.trim()) return false;

  // Vendor detection: if the ingest URL parses as a Sentry DSN, switch to the
  // Sentry-envelope transport; otherwise keep the generic raw-JSON contract.
  const trimmedIngestUrl = ingestUrl.trim();
  const parsedDsn = parseDsn(trimmedIngestUrl);
  const dsn = parsedDsn ? trimmedIngestUrl : null;
  const transmitUrl =
    (dsn && envelopeEndpoint(trimmedIngestUrl)) || trimmedIngestUrl;

  // Self-observation exclusion host: the DSN's ingest host in DSN-mode (so the
  // fetch wrapper never observes our own envelope POST), else the ingest URL host.
  let ingestHost: string | null = null;
  if (parsedDsn) {
    ingestHost = parsedDsn.host;
  } else {
    try {
      ingestHost = new URL(trimmedIngestUrl).host;
    } catch {
      ingestHost = null;
    }
  }

  const sampleRateRaw = process.env.NEXT_PUBLIC_TELEMETRY_SAMPLE_RATE;
  const sampleRate = sampleRateRaw
    ? Math.max(0, Math.min(1, Number(sampleRateRaw) || DEFAULT_SAMPLE_RATE))
    : DEFAULT_SAMPLE_RATE;

  state = {
    installed: true,
    ingestUrl: trimmedIngestUrl,
    transmitUrl,
    dsn,
    ingestHost,
    release: resolveRelease(),
    sampleRate,
    sentTimestamps: [],
    consecutiveFailures: 0,
    tripped: false,
    prevOnError: window.onerror ?? null,
    prevOnRejection: null,
    originalFetch: null,
    cspListener: null,
  };

  // window.onerror — chain to any previous handler.
  const prevOnError = window.onerror;
  window.onerror = function (message, source, lineno, colno, error) {
    try {
      handleWindowError(message, source, lineno, colno, error);
    } catch {
      /* never let the beacon break the app */
    }
    if (typeof prevOnError === "function") {
      return prevOnError.call(this, message, source, lineno, colno, error);
    }
    return false;
  };

  // unhandledrejection
  const rejectionListener = (ev: PromiseRejectionEvent) => {
    try {
      handleRejection(ev);
    } catch {
      /* swallow — never break the app */
    }
  };
  state.prevOnRejection = rejectionListener;
  window.addEventListener("unhandledrejection", rejectionListener);

  // CSP violations
  const cspListener = (ev: SecurityPolicyViolationEvent) => {
    try {
      handleCspViolation(ev);
    } catch {
      /* swallow */
    }
  };
  state.cspListener = cspListener;
  document.addEventListener("securitypolicyviolation", cspListener);

  // fetch wrapper (fetch / CORS / network failures)
  installFetchWrapper();

  return true;
}

/**
 * Tear down the beacon (restore wrapped globals + remove listeners). Primarily
 * for tests / hot-reload; production installs once and leaves it.
 */
export function uninstallBeacon(): void {
  if (!state) return;
  if (typeof window !== "undefined") {
    if (state.originalFetch) window.fetch = state.originalFetch;
    if (state.prevOnRejection)
      window.removeEventListener("unhandledrejection", state.prevOnRejection);
    if (state.cspListener)
      document.removeEventListener("securitypolicyviolation", state.cspListener);
    window.onerror = state.prevOnError;
  }
  state = null;
}

/** Test-only: is the beacon currently installed? */
export function __isInstalledForTests(): boolean {
  return !!state?.installed;
}
