/**
 * sessionQuery — what the `/sessions` search box puts on the wire.
 *
 * Plan `2026-10-19-session-lookup-by-name-shows-claude-account-in-web`
 * Phase 3. The box accepts three things, and the operator should not have to
 * know which one they are holding:
 *
 * | typed / pasted | sent as `?q=` |
 * |---|---|
 * | a session name (`spaceship-latency`) | the name |
 * | a session id (a Claude Code session uuid, or a `coord.sessions` id) | the id |
 * | a commit trailer line — `Session-Id: <uuid>` or `Session-Name: <name>` | the value after the prefix |
 *
 * The trailer prefix is stripped CLIENT-side because neither half of the
 * search would match it: coord's full-text search would look for the literal
 * words "session" and "id", and the lifecycle half's substring match would
 * look for the colon too. Pure — no React, no fetch.
 *
 * ## Pasting more than one line
 *
 * `git log` prints the trailers as a block, so a paste often carries both, and
 * a single-line `<input>` STRIPS the newlines (HTML's value sanitisation),
 * gluing them: `Session-Id: 86e2…c8Session-Name: spaceship-latency`. So each
 * value runs up to the next trailer token or line end, and the `Session-Id`
 * value is preferred when both are present — it names exactly one session,
 * where a name may name several. A `Session-Id` value that starts with a uuid
 * is cut to that uuid, so a glued suffix cannot leak into the query.
 *
 * A value is also cut at the OTHER trailer keys this fleet's commits carry
 * beside these two — `Claude-Session:`, `Co-Authored-By:`, `Plan:` — matched
 * in their canonical spelling only. Deliberately NOT a generic `Word:` rule:
 * a session name derived from a plan or commit title can contain `feat: …`
 * or `fix: …`, and cutting there would search for half a name.
 */

/** Which trailer a query was lifted out of, if any. */
export type SessionQueryTrailer = "Session-Id" | "Session-Name";

export interface NormalizedSessionQuery {
  /** What goes on the wire as `?q=`. Empty means "send no filter". */
  query: string;
  /** The trailer the value came from, or `null` for a plain name / id. */
  trailer: SessionQueryTrailer | null;
}

/**
 * A `Session-Id:` / `Session-Name:` token and the value after it, up to the
 * next such token or the end of the line. Case-insensitive: git trailer keys
 * are case-insensitive, and a hand-typed `session-id:` means the same thing.
 */
const TRAILER_RE =
  /session-(id|name)[ \t]*:[ \t]*(.*?)(?=session-(?:id|name)[ \t]*:|\r?\n|$)/gis;

/**
 * The other trailer keys a fleet commit carries, as the fleet writes them
 * (`prepare-commit-msg`, the harness attribution line, the plan trailer).
 * Case-SENSITIVE on purpose — see the module doc.
 */
const OTHER_FLEET_TRAILER_RE = /(?:Claude-Session|Co-Authored-By|Plan)[ \t]*:/;

const UUID_PREFIX_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Normalize what the operator typed into the `?q=` value.
 *
 * Trims, and when the text carries a `Session-Id:` / `Session-Name:` trailer,
 * returns the trailer's VALUE (preferring `Session-Id`). A trailer prefix with
 * nothing after it yet — the operator is mid-paste or mid-type — normalizes to
 * an empty query rather than searching for the literal word "Session".
 */
export function normalizeSessionQuery(raw: string): NormalizedSessionQuery {
  const text = raw.trim();
  let id: string | null = null;
  let name: string | null = null;
  let sawTrailer: SessionQueryTrailer | null = null;

  for (const match of text.matchAll(TRAILER_RE)) {
    const kind: SessionQueryTrailer =
      (match[1] ?? "").toLowerCase() === "id" ? "Session-Id" : "Session-Name";
    sawTrailer ??= kind;
    const raw = match[2] ?? "";
    const cut = OTHER_FLEET_TRAILER_RE.exec(raw);
    const value = (cut ? raw.slice(0, cut.index) : raw).trim();
    if (!value) continue;
    if (kind === "Session-Id" && id === null) {
      id = UUID_PREFIX_RE.exec(value)?.[0] ?? value;
    } else if (kind === "Session-Name" && name === null) {
      name = value;
    }
  }

  if (id !== null) return { query: id, trailer: "Session-Id" };
  if (name !== null) return { query: name, trailer: "Session-Name" };
  if (sawTrailer !== null) return { query: "", trailer: sawTrailer };
  return { query: text, trailer: null };
}
