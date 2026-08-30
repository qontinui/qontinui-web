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
 * ## This is the console's ONLY status reader
 *
 * Four surfaces had hand-rolled their own probe, and every one of them read the
 * body: `useSessionCompliance.isRouteUnavailable`
 * (`/ failed: (404|405|501) /`), `DeployRow`'s rollback proposal (`/404/` —
 * which also matched the deploy id, since the URL is in the message too), and
 * `notificationStatus`'s `isMigrationPending` / `isContractError`
 * (`/failed:\s*NNN\b/`, under a docstring that already claimed to be anchored).
 * They now all call this. A fifth spelling is a bug, not a style choice: the
 * shapes differed enough that each failed on inputs the others caught, and none
 * of them could be reviewed once, here.
 *
 * ## Mechanism here, policy at the call site
 *
 * This function answers *what status came back* and nothing else. What a status
 * MEANS is per-surface and the surfaces genuinely disagree — `/questions/[id]`
 * reads 404 as "coord answered and holds no such row", while
 * `useSessionCompliance` reads it as "this build does not deploy the route",
 * and both are right about their own endpoint. So the policy stays at the call
 * site as a named predicate; only the parsing lives here. Folding the policies
 * together would make one of the two surfaces lie.
 *
 * Returns `null` for anything that is not an `httpClient` status rejection —
 * a `TypeError: Failed to fetch`, an abort, a thrown validation error. `null`
 * means "no status", never "not an error". Every caller therefore has to spell
 * out what it does with "no status", and the safe answer is always the loud
 * one: `null` must never fall into a calm arm.
 */
export function httpStatusOf(err: unknown): number | null {
  const text = err instanceof Error ? err.message : String(err);
  const m = /^[A-Z]+ \S+ failed: (\d{3})\b/.exec(text);
  return m ? Number(m[1]) : null;
}
