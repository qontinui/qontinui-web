/**
 * The console's read-failure vocabulary — R6's "not fetched includes fetched
 * and FAILED", in one place.
 *
 * The style guide says a count that has not been fetched renders `–`, never
 * `0`, and that every surface derived from a list must consult the failure
 * flag. Holding that across a page means the STRIP and the `empty=` slot have
 * to agree about the same read; when each spells the predicate itself they
 * drift, and the drift is invisible because both spellings look right. So the
 * predicate lives here and both sides import it.
 */

/**
 * A read failed AND coord has never answered — so nothing is known.
 *
 * **Keyed on `loaded`, not on the list being empty.** The obvious spelling,
 * `readFailed && rows.length === 0`, is wrong in a way that shows up as a
 * flicker: a list coord has confirmed EMPTY is indistinguishable from one that
 * never arrived, so a single blipped poll on a genuinely-empty window flips the
 * page from "nothing matches" to "unknown" and back on the next tick. It is
 * also inconsistent with the stale arm — a retained count of 7 is kept and
 * labelled old, while a retained count of 0 would be thrown away and called
 * unknown, though both are equally fetched.
 *
 * Once coord has answered, a later failure is {@link staleDetail}'s business,
 * whatever the count.
 */
export function readIsUnknown(loaded: boolean, readFailed: boolean): boolean {
  return readFailed && !loaded;
}

/**
 * Did this error come from coord ANSWERING "no such record" (404), or from the
 * read not landing at all?
 *
 * The distinction is the whole difference between "not found" and "unknown",
 * and it is easy to get backwards: `httpClient.get` throws on every non-2xx
 * (`http-client.ts:546-549`), so a 404 — the most definitive answer coord
 * gives — arrives through the SAME `catch` as a dead socket. A page that
 * treats "there is an error" as "we could not read" therefore reports every
 * genuinely-absent record, and every soft-deleted memory, as an
 * infrastructure fault.
 *
 * The status is recovered from the message `httpClient` formats, which is
 * `GET <url> failed: <status> - <body>`. Parsing a message is not lovely, but
 * it is the only place the status survives today, and getting this backwards
 * is worse than the coupling. The pattern is anchored on the separator that
 * template emits so a status-like number inside the URL or the body cannot
 * match first.
 */
export function isNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /\sfailed:\s404\s-\s/.test(message);
}

/** The detail line for a strip whose counts nobody managed to fetch. */
export const UNKNOWN_COUNTS_DETAIL =
  "coord did not answer; these counts are a dash, not a zero";

/**
 * The detail line for counts an earlier poll delivered and a later one failed
 * to refresh. It LEADS with the failure because the headline above it may be
 * the green all-clear, and that is the sentence being qualified.
 */
export function staleDetail(window: string): string {
  return `Last refresh failed — these counts are stale. ${window}`;
}
