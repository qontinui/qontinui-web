/**
 * Recover the HTTP status from an `httpClient` rejection.
 *
 * `httpClient` throws a plain `Error` rather than a typed one, so the status
 * is only available as text: `GET <url> failed: <status> - <body>`
 * (`services/http-client.ts`, one line per verb). Every coord console surface
 * that needs to tell "the server ANSWERED something specific" from "the read
 * never landed" has to recover it from there.
 *
 * ## Why this is anchored, and why that matters
 *
 * The obvious spelling — `/ failed: 404 /.test(message)` — scans the whole
 * string, and the tail of that string is `await response.text()`: the raw
 * upstream BODY, which the operations proxy fills with coord's own `resp.text`.
 * So an unanchored probe reads attacker-adjacent, upstream-controlled prose. A
 * 500 whose body happens to contain `" failed: 404 "` — an echoed client-error
 * string, an HTML error page — is then classified as a 404, and a caller that
 * suppresses its error banner for the not-found case shows the operator the
 * calm copy and never mentions the 500.
 *
 * Anchoring to the verb and reading the status FIELD, once, removes the body
 * from the decision entirely.
 *
 * Returns `null` for anything that is not an `httpClient` status rejection —
 * a `TypeError: Failed to fetch`, an abort, a thrown validation error. `null`
 * means "no status", never "not an error".
 */
export function httpStatusOf(err: unknown): number | null {
  const text = err instanceof Error ? err.message : String(err);
  const m = /^[A-Z]+ \S+ failed: (\d{3})\b/.exec(text);
  return m ? Number(m[1]) : null;
}
