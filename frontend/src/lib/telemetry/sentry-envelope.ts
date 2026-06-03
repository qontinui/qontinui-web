/**
 * Ξ_ClientTelemetry — Sentry SaaS (EU region) envelope transport.
 *
 * Plan: D:/qontinui-root/plans/2026-05-31-twin-client-telemetry-layer.md
 *
 * The vendor decision (plan §3.5 buy-vs-build) is Sentry. When the configured
 * ingest URL (``NEXT_PUBLIC_TELEMETRY_INGEST_URL``) is a Sentry DSN, the beacon
 * serializes each scrubbed ``ClientTelemetryEvent`` into a Sentry *envelope*
 * (the store-event ingestion format) and POSTs it to the DSN's envelope
 * endpoint. Auth rides in the envelope header's ``dsn`` field (Sentry accepts
 * DSN-in-envelope), so the request needs NO custom header — it can use the
 * CORS-safelisted ``text/plain`` content type and avoid a preflight.
 *
 * ⚠️ PRIVACY INVARIANT (plan §3.2 allowlist-not-denylist): the envelope carries
 * ONLY fields already present on the scrubbed ``ClientTelemetryEvent``. We add
 * NOTHING new here — no user, no IP, no user-agent, no request/headers context.
 * Sentry's SDK would normally attach all of those; we deliberately hand-roll
 * the envelope so it cannot. Keep this property: any new field added below MUST
 * already exist (scrubbed) on the event.
 *
 * All functions here are PURE and unit-testable.
 */

import type { ClientTelemetryEvent, ClientTelemetryFrame } from "./types";

/** Parsed parts of a Sentry DSN. */
export interface ParsedDsn {
  /** The public key (DSN user-info component). */
  publicKey: string;
  /** The ingest host, e.g. ``o0.ingest.de.sentry.io``. */
  host: string;
  /** The numeric project id (DSN path tail). */
  projectId: string;
}

/**
 * Parse a Sentry DSN. A DSN is a URL with a user-info public key and a
 * numeric-ish project id as the (last) path segment:
 *
 *   ``https://<public_key>@o<org>.ingest.de.sentry.io/<project_id>``
 *
 * Returns ``null`` for any URL that is NOT DSN-shaped (no user-info key, or a
 * non-numeric project-id path) — that signals the beacon to fall back to the
 * generic raw-JSON contract.
 */
export function parseDsn(dsn: string): ParsedDsn | null {
  if (!dsn || !dsn.trim()) return null;
  let u: URL;
  try {
    u = new URL(dsn.trim());
  } catch {
    return null;
  }
  // Must be http(s).
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  // A DSN carries the public key as the URL user-info (before ``@``).
  const publicKey = u.username;
  if (!publicKey) return null;
  // The project id is the last non-empty path segment and must be numeric.
  const segments = u.pathname.split("/").filter((s) => s.length > 0);
  const projectId = segments[segments.length - 1];
  if (!projectId || !/^\d+$/.test(projectId)) return null;
  if (!u.host) return null;
  return { publicKey, host: u.host, projectId };
}

/**
 * Derive the Sentry envelope ingestion endpoint from a DSN:
 *   ``https://<host>/api/<projectId>/envelope/``
 * Returns ``null`` when the DSN is not parseable.
 */
export function envelopeEndpoint(dsn: string): string | null {
  const parsed = parseDsn(dsn);
  if (!parsed) return null;
  return `https://${parsed.host}/api/${parsed.projectId}/envelope/`;
}

/** Strip dashes from our UUID → Sentry's 32-hex ``event_id`` shape. */
function toSentryEventId(eventId: string): string {
  return eventId.replace(/-/g, "");
}

/**
 * Map our scrubbed frames to Sentry stacktrace frames.
 *
 * Sentry wants frames OLDEST-first (the crashing frame last). Our
 * ``scrubStack`` (scrub.ts) parses ``Error.stack`` line-by-line, which is
 * TOP-first (innermost / crashing frame first) for both the V8 and the
 * Firefox/Safari formats. So we REVERSE to satisfy Sentry's ordering.
 */
function toSentryFrames(
  frames: ClientTelemetryFrame[]
): Array<{
  function: string;
  filename?: string;
  lineno?: number;
  colno?: number;
}> {
  // Copy then reverse (do not mutate the event's array): top-first → oldest-first.
  return [...frames].reverse().map((f) => ({
    function: f.symbol,
    ...(f.file ? { filename: f.file } : {}),
    ...(typeof f.line === "number" ? { lineno: f.line } : {}),
    ...(typeof f.column === "number" ? { colno: f.column } : {}),
  }));
}

/**
 * Build the Sentry *event* payload (envelope item body) from a scrubbed event.
 * ONLY scrubbed fields are projected — no user/ip/ua/request contexts.
 */
function toSentryEvent(
  event: ClientTelemetryEvent,
  sentryEventId: string
): Record<string, unknown> {
  // Tags: only-present scrubbed dimensions (http_status stringified per Sentry).
  const tags: Record<string, string> = {
    kind: event.kind,
    origin: event.origin,
    route_template: event.route_template,
    browser_family: event.browser_family,
    session_hash: event.session_hash,
  };
  if (event.request_host) tags.request_host = event.request_host;
  if (event.request_path_tmpl) tags.request_path_tmpl = event.request_path_tmpl;
  if (event.failure_class) tags.failure_class = event.failure_class;
  if (typeof event.http_status === "number")
    tags.http_status = String(event.http_status);

  return {
    event_id: sentryEventId,
    timestamp: event.client_ts,
    platform: "javascript",
    level: "error",
    release: event.release,
    environment: "production",
    logger: "qontinui-beacon",
    message: {
      formatted: `${event.error_name}: ${event.error_message_norm}`,
    },
    tags,
    extra: { count: event.count },
    exception: {
      values: [
        {
          type: event.error_name,
          value: event.error_message_norm,
          stacktrace: { frames: toSentryFrames(event.stack_top) },
        },
      ],
    },
  };
}

/**
 * Serialize a scrubbed ``ClientTelemetryEvent`` into a Sentry envelope: a
 * newline-delimited body of exactly three lines —
 *   1. envelope header   ``{"event_id","dsn","sent_at"}``
 *   2. item header       ``{"type":"event"}``
 *   3. the Sentry event JSON
 *
 * Auth is carried by the ``dsn`` field in the envelope header (no auth header
 * needed). The body is sent as ``text/plain`` (CORS-safelisted) by the beacon.
 */
export function toSentryEnvelope(
  event: ClientTelemetryEvent,
  dsn: string
): string {
  const sentryEventId = toSentryEventId(event.event_id);
  const header = JSON.stringify({
    event_id: sentryEventId,
    dsn,
    sent_at: new Date().toISOString(),
  });
  const itemHeader = JSON.stringify({ type: "event" });
  const payload = JSON.stringify(toSentryEvent(event, sentryEventId));
  return `${header}\n${itemHeader}\n${payload}`;
}
