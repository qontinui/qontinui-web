/**
 * The UI Bridge SDK's own transport: the three requests a browser tab's relay
 * client makes to stay connected, and the cadences the SDK makes them at.
 *
 *   - `GET  /commands/stream` → `stream`    — the tab opening its SSE command stream
 *   - `POST /heartbeat`       → `heartbeat` — the tab's keep-alive / registration
 *   - `POST /commands`        → `result`    — the tab posting a command's RESULT
 *
 * They are SDK bookkeeping, never a user command. Two consumers read this one
 * set: `_rate-limit.ts` gives each route its own per-principal sub-lane
 * instead of charging it to the command lanes, and `_audit.ts` keeps all
 * three out of the co-pilot activity log. Matching is exact and
 * method-qualified: `GET /heartbeat`, `POST /commands/stream`, `/heartbeat/`
 * and `/commands/streamx` are not transport.
 *
 * Not to be confused with `_browser-required.ts` `RELAY_TRANSPORT_ROUTES`,
 * the known-route gate for every path the SDK's relay handler claims
 * (`/health`, `/tabs`, the CDP tab routes…). Those are requests a DRIVER
 * makes, and they stay in the command lanes.
 *
 * # The cadences, restated
 *
 * The SDK keeps its cadences module-private, so this module restates them,
 * each citing the ui-bridge file and symbol it copies. `_rate-limit.ts`
 * derives the transport ceilings from them, and `route.real-sdk.test.ts`
 * holds them to the SDK that `node_modules` resolves: it reads each constant
 * out of the installed bundles, and it drives the installed
 * `startRelayClient` under fake timers to count what one tab really sends.
 */

/** A transport sub-lane: one per SDK transport route. */
export type SdkTransportLane = "stream" | "heartbeat" | "result";

/** One SDK transport route, method-qualified, with the sub-lane it bills. */
export interface SdkTransportRoute {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly lane: SdkTransportLane;
}

/** The SDK's transport routes — the whole set; nothing else is transport. */
export const SDK_TRANSPORT_ROUTES: readonly SdkTransportRoute[] = [
  { method: "GET", path: "/commands/stream", lane: "stream" },
  { method: "POST", path: "/heartbeat", lane: "heartbeat" },
  { method: "POST", path: "/commands", lane: "result" },
];

/**
 * The transport sub-lane `(path, method)` bills, or `null` when it is not an
 * SDK transport route. `path` is the relay-relative path (`/heartbeat`, as
 * `route.ts` `resolvePath` produces it), without a query string.
 */
export function sdkTransportLane(
  path: string,
  method: string
): SdkTransportLane | null {
  for (const route of SDK_TRANSPORT_ROUTES) {
    if (route.method === method && route.path === path) {
      return route.lane;
    }
  }
  return null;
}

/** True when `(path, method)` is one of the SDK's own transport routes. */
export function isSdkTransportRoute(path: string, method: string): boolean {
  return sdkTransportLane(path, method) !== null;
}

/* -------------------------------------------------------------------- */
/* SDK cadences (restated)                                              */
/* -------------------------------------------------------------------- */

/**
 * ui-bridge `packages/ui-bridge/src/relay/relay-client.ts`
 * `HEARTBEAT_INTERVAL_MS`: the period of the tab's heartbeat timer. The timer
 * calls `sendHeartbeat` directly, NOT through `maybeSendHeartbeat`'s
 * throttle, so it beats at this period whatever else beats. qontinui-web's
 * `CommandRelayListener` passes no `heartbeatInterval`, so the default holds.
 */
export const HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * ui-bridge `packages/ui-bridge/src/relay/stream-lifecycle.ts`
 * `SSE_RECONNECT_DELAY_MS` (module-private; it moved out of `relay-client.ts`
 * in 0.50.0, first published as 0.51.0, with no change of value): a refused open, or a stream that ended
 * before it was healthy, is reopened after this delay. Two other paths reopen
 * it AT ONCE (see `STREAM_OPENS_PER_TAB_PER_MIN`).
 */
export const SSE_RECONNECT_DELAY_MS = 10_000;

/**
 * ui-bridge `packages/ui-bridge/src/relay/stream-lifecycle.ts`
 * `HEALTHY_STREAM_MIN_MS` (re-exported by `relay-client.ts`): how long a
 * stream must live after `connected` to count as healthy. A healthy stream
 * that ends is reopened at once, and it is the floor between the opens the
 * client makes on its own — the reopen after an end, and the replacement a
 * `rotate` frame asks for each come at least this long after the previous
 * open.
 */
export const HEALTHY_STREAM_MIN_MS = 10_000;

/**
 * ui-bridge `packages/ui-bridge/src/server/stream-lease.ts`
 * `STREAM_LEASE_MS`: the relay's default lease on a stream whose client
 * declared `caps=rotate` (every 0.51+ client does). At the lease the relay
 * sends a `{"type":"rotate"}` frame; the client opens its next stream and the
 * relay ends the old one once that replacement registers (make-before-break).
 * So a healthy tab opens one stream per lease. qontinui-web's
 * `lib/ui-bridge/relay.ts` sets no `streamLeaseMs`; `UI_BRIDGE_STREAM_LEASE_MS`
 * overrides it per deployment, floored at 15 s by the SDK.
 */
export const STREAM_LEASE_MS = 50_000;

/**
 * ui-bridge `packages/ui-bridge/src/server/nextjs.ts`
 * `RELAY_COMMAND_STREAM_HEARTBEAT_MS`: the relay's `ping` on every open
 * command stream. Each ping calls the client's `maybeSendHeartbeat`, which
 * beats when the last beat started at least `HEARTBEAT_INTERVAL_MS` ago —
 * the clock that keeps a hidden tab (whose timers the browser clamps)
 * registered.
 */
export const RELAY_COMMAND_STREAM_HEARTBEAT_MS = 15_000;

/**
 * ui-bridge `packages/ui-bridge/src/server/command-relay.ts`, the proactive
 * snapshot (`proactiveSnapshot`, on by default; qontinui-web
 * `lib/ui-bridge/relay.ts` constructs its `CommandRelay` without turning it
 * off): 500 ms after every stream connect the relay sends the tab a
 * `getControlSnapshot` (`captureSnapshot`), and retries once, 1.5 s after a
 * failed capture. Each is answered by a `POST /commands` that no principal's
 * command lane paid for.
 */
export const RELAY_SNAPSHOTS_PER_STREAM_OPEN = 2;

/* -------------------------------------------------------------------- */
/* What one live tab sends, per minute                                  */
/* -------------------------------------------------------------------- */

const MINUTE_MS = 60_000;

/**
 * Stream opens per live tab per minute: a failing stream's reconnect cadence.
 *
 * Lease-driven rotation stays inside it. A healthy tab opens one stream per
 * `STREAM_LEASE_MS` (60 000 / 50 000 = 1.2 opens a minute), and the client
 * floors each rotation and each reopen after an end at `HEALTHY_STREAM_MIN_MS`
 * after the previous open, so even an env-shortened lease (floored at 15 s by
 * the SDK) cannot push those opens past 60 000 / `HEALTHY_STREAM_MIN_MS` = 6 —
 * the same 6 the reconnect delay gives, because both are 10 s.
 *
 * Two paths in `relay-client.ts` reopen a stream AT ONCE, and the envelope
 * deliberately does not absorb either (an envelope sized to absorb a defect
 * hides it, so an overflow surfaces as a typed, logged refusal):
 *   - `forceReconnect`, after a heartbeat answered `tabRegistered: false`. The
 *     relay answers that from the instance's open stream listeners, so it is
 *     what every tab whose stream is down — including a stream this lane just
 *     refused — gets. It also clears the pending reconnect, so the steady
 *     state stays one open per heartbeat; the excess is one open in the
 *     window where the outage starts (the plan's Phase 7 (f)).
 *   - `handleVisibility`, reconnecting a dropped stream the moment the tab
 *     becomes visible again.
 */
export const STREAM_OPENS_PER_TAB_PER_MIN = MINUTE_MS / SSE_RECONNECT_DELAY_MS;

/** Heartbeats per live tab per minute: the timer's, plus at most one per relay `ping`. */
export const HEARTBEATS_PER_TAB_PER_MIN =
  MINUTE_MS / HEARTBEAT_INTERVAL_MS +
  MINUTE_MS / RELAY_COMMAND_STREAM_HEARTBEAT_MS;

/**
 * Relay-originated results per live tab per minute: the proactive snapshots
 * of every stream open. Results a DRIVER causes are bounded by that driver's
 * own command lanes instead; `_rate-limit.ts` adds those.
 */
export const RELAY_RESULTS_PER_TAB_PER_MIN =
  RELAY_SNAPSHOTS_PER_STREAM_OPEN * STREAM_OPENS_PER_TAB_PER_MIN;
