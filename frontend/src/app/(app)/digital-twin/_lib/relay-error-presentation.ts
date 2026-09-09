/**
 * Turn a relay failure into something an operator can act on.
 *
 * The backend's 404/503 bodies carry `detail`, `ws_connected_at`,
 * `last_seen_at` and a `request_id` that joins to every log line the request
 * emitted, and `runner-relay.ts` parses all of it onto `RunnerRelayError`.
 * Until this module existed nothing read those fields: the one component that
 * catches these errors rendered a fixed sentence and dropped the error object,
 * so the diagnosis stopped one hop short of the person doing the diagnosing.
 *
 * The rule this module follows is the same one the backend adopted for the
 * wire: **say only what is known**. A cause is emitted when the error actually
 * establishes one, and omitted otherwise — an "unknown" that reads as unknown
 * beats a plausible sentence that happens to be wrong, which is the exact
 * failure ("try reconnecting via USB", for a starved runtime) that started
 * this whole remediation loop.
 */

import { formatDistance } from "date-fns";
import { RunnerRelayError } from "./runner-relay";

/**
 * The relay's two fixed `detail` strings, which are what identify a body as
 * having come from the relay handler at all.
 *
 * A bare status code does NOT identify one. These requests go same-origin
 * through a rewrite and a CDN, any of which emits its own 503 (origin down)
 * or 404 (rewrite miss) with an HTML body — and answering those with "the
 * runner is not connected" would invent a runner fault out of a backend
 * outage. `detail` is the discriminator because it is already parsed, and is
 * `undefined` for every body that was not this backend's JSON.
 */
const DETAIL_NOT_CONNECTED = "runner not connected";
const DETAIL_DEVICE_NOT_OWNED = "device not found or not owned by caller";

export interface RelayFailureExplanation {
  /** What failed, in the caller's terms. Always present. */
  headline: string;
  /** Why — only when the error actually establishes it. */
  cause?: string;
  /** Correlation id; matches `X-Request-ID` and every server log line. */
  requestId?: string;
}

/** `formatDistance`, but never throws and never invents a date. */
function ago(iso: string, now: Date): string | null {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  return formatDistance(then, now, { addSuffix: true });
}

/**
 * The heartbeat clock, as a trailing sentence.
 *
 * This is a different fact from `wsConnectedAt` and is the only one still
 * available in the two branches where the WS claim clock says `null` or
 * nothing at all — a device can be heartbeating happily while never having
 * registered a relay session.
 */
function heartbeat(err: RunnerRelayError, now: Date): string {
  if (typeof err.lastSeenAt !== "string") return "";
  const when = ago(err.lastSeenAt, now);
  return when ? ` The device itself last checked in ${when}.` : "";
}

/**
 * Explain a 503 — `ws_session_id IS NULL`, i.e. the runner is not registered
 * with the backend at all. Which of the three branches applies turns entirely
 * on `wsConnectedAt`, whose `null`-vs-`undefined` distinction is load-bearing
 * (see `RunnerRelayDiagnostics`).
 */
function explainNotConnected(err: RunnerRelayError, now: Date): string {
  if (err.wsConnectedAt === undefined) {
    // Absent, which is the wire spelling of "unknown". There are several ways
    // to land here — the backend's coord read failed, or an older backend
    // never sent the key — so name NONE of them. Picking one and stating it
    // would re-introduce, one layer up, exactly the confident-wrong-answer
    // this field's null/absent split exists to prevent.
    return (
      "The runner is not connected to the cloud relay. When it last held a " +
      "session is unknown." +
      heartbeat(err, now)
    );
  }
  if (err.wsConnectedAt === null) {
    return (
      "The runner has never registered a relay session with the backend, so " +
      "there is nothing for the cloud relay to reach. This is the runner's " +
      "web integration, not the app — check the runner itself." +
      heartbeat(err, now)
    );
  }
  const when = ago(err.wsConnectedAt, now);
  return when
    ? `The runner held a relay session until ${when}, then dropped it — it is flapping rather than absent.`
    : "The runner held a relay session and has since dropped it — it is flapping rather than absent.";
}

/**
 * Explain any relay failure. `subject` names what the caller was reading, so
 * the headline stays specific ("spec pages for qontinui-web").
 */
export function explainRelayFailure(
  error: unknown,
  subject: string,
  now: Date = new Date()
): RelayFailureExplanation {
  const headline = `Could not load ${subject}.`;

  if (!(error instanceof RunnerRelayError)) {
    // Not ours — a React Query error from somewhere else, or a non-Error
    // throw. Report the message if there is one and claim nothing further.
    const cause = error instanceof Error ? error.message : undefined;
    return { headline, cause };
  }

  const { status, detail, requestId } = error;

  // Both relay-specific arms require the matching `detail`, not just the
  // status — see DETAIL_NOT_CONNECTED.
  if (status === 503 && detail === DETAIL_NOT_CONNECTED) {
    return { headline, cause: explainNotConnected(error, now), requestId };
  }
  if (status === 404 && detail === DETAIL_DEVICE_NOT_OWNED) {
    // The backend echoes back the device id it was asked for. Naming it is
    // what makes this actionable: the id the page is holding is exactly the
    // stale value, and it is not otherwise visible anywhere in this UI.
    const which = error.deviceId ? ` (${error.deviceId})` : "";
    return {
      headline,
      cause:
        `The backend has no device${which} registered to your account — ` +
        "the runner pairing is stale. Re-pair the runner.",
      requestId,
    };
  }
  if (status === undefined) {
    // No response at all: the fetch itself failed, so the message is the
    // transport error and there is no body to have read.
    return { headline, cause: error.message, requestId };
  }
  // Anything else, including a 503/404 that did not come from the relay
  // handler. Report the status and whatever `detail` there was; claim nothing
  // about the runner, which this response says nothing about.
  return {
    headline,
    cause: detail
      ? `The relay answered HTTP ${status}: ${detail}.`
      : `The relay answered HTTP ${status}.`,
    requestId,
  };
}

/**
 * Whether two failures would be explained in exactly the same words.
 *
 * The panel fires several queries at one runner, and in the dominant failure
 * — the runner is not connected — they all fail identically. Rendering the
 * same explanation once per query is noise, so the caller groups them. The
 * test is on the rendered `cause` rather than on status codes, because that
 * is precisely the thing that would be duplicated; two failures that happen
 * to share a status but not a diagnosis must stay apart.
 *
 * `requestId` is deliberately NOT compared: each query is its own HTTP
 * request and so has its own id. Grouped failures keep all of them.
 */
export function sharesRelayCause(
  a: unknown,
  b: unknown,
  now: Date = new Date()
): boolean {
  // One `now` for both, or the relative time in a flapping cause could differ
  // between the two calls and split a genuinely identical pair.
  return (
    explainRelayFailure(a, "", now).cause ===
    explainRelayFailure(b, "", now).cause
  );
}
