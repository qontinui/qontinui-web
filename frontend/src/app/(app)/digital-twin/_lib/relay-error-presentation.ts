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
 * Explain a 503 — `ws_session_id IS NULL`, i.e. the runner is not registered
 * with the backend at all. Which of the three branches applies turns entirely
 * on `wsConnectedAt`, whose `null`-vs-`undefined` distinction is load-bearing
 * (see `RunnerRelayDiagnostics`).
 */
function explainNotConnected(err: RunnerRelayError, now: Date): string {
  if (err.wsConnectedAt === undefined) {
    // The backend omits the key when its coord read failed, and an older
    // backend never sent it. Either way we do not know — and must not round
    // that off to "never registered".
    return (
      "The runner is not connected to the cloud relay. How long ago it last " +
      "held a session is unknown — the backend could not read the device row."
    );
  }
  if (err.wsConnectedAt === null) {
    return (
      "The runner has never registered a relay session with the backend, so " +
      "there is nothing for the cloud relay to reach. This is the runner's " +
      "web integration, not the app — check the runner itself."
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

  const { status, requestId } = error;

  if (status === 503) {
    return { headline, cause: explainNotConnected(error, now), requestId };
  }
  if (status === 404) {
    return {
      headline,
      cause:
        "The backend has no device with this id registered to your account — " +
        "the runner pairing is stale. Re-pair the runner.",
      requestId,
    };
  }
  if (status === undefined) {
    // No response at all: the fetch itself failed, so the message is the
    // transport error and there is no body to have read.
    return { headline, cause: error.message, requestId };
  }
  return {
    headline,
    cause: error.detail
      ? `The relay answered HTTP ${status}: ${error.detail}.`
      : `The relay answered HTTP ${status}.`,
    requestId,
  };
}
