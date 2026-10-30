/**
 * When an answer was TRUE — coord's own `as_of` where the body states one,
 * otherwise the moment the answer arrived (plan
 * `2026-10-23-console-presentation-spaces` Phase 7; style guide §3.11, "A
 * read is dated only by its answers").
 *
 * Coord stamps `as_of` on the bodies of `GET /coord/fleet/health`
 * (`fleet_health.rs`), `GET /coord/fleet/drain` (`fleet_drain.rs`
 * `DrainReadResponse`) and `GET /coord/fleet/dispatch-roles`
 * (`dispatch_role_routes.rs` `DispatchRolesResponse`), and the web backend
 * passes each body through untouched. Coord's instant is when its read was
 * true; the browser's receipt is later by the network and the proxy, so it is
 * only the fallback for a body that names no time (a coord predating the
 * field).
 *
 * Read, never trusted: only an RFC 3339 date-time counts, and an instant
 * AFTER the receipt — coord's clock running ahead of the browser's — is
 * clamped to the receipt, so an answer is never dated later than it arrived.
 * Pure; the hooks call it on success only.
 */

/** An RFC 3339 date-time, as coord's `chrono::DateTime<Utc>` serialises. */
const RFC3339_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;

/** `body.as_of` in epoch ms, clamped to `receivedAtMs`; else `receivedAtMs`. */
export function servedAsOfMs(body: unknown, receivedAtMs: number): number {
  const raw =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)["as_of"]
      : undefined;
  if (typeof raw !== "string" || !RFC3339_DATE_TIME.test(raw)) {
    return receivedAtMs;
  }
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.min(at, receivedAtMs) : receivedAtMs;
}
