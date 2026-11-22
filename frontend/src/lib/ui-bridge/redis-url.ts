/**
 * Up-front validity check for the relay / rate-limiter Redis URL.
 *
 * Why: a malformed `UI_BRIDGE_RELAY_REDIS_URL` puts the password into an error
 * MESSAGE before any of our redaction runs. Two shapes are measured:
 *
 *  - a reserved character such as `/` in the password makes ioredis throw
 *    `ERR_INVALID_URL` with the whole URL on its `input` property;
 *  - a value ioredis 5.x reads as a UNIX SOCKET PATH. ioredis treats only a
 *    leading `redis://` / `rediss://` (or `//`) as a scheme; anything else gets
 *    `redis://` prepended, and when the result has a pathname that pathname
 *    becomes `path`. So `KEY=rediss://u:p@h`, `"rediss://u:p@h"`,
 *    `https://u:p@h` and `u:1234/p@h` all connect to a socket named after the
 *    credentials, and every failed connect reports `connect ENOENT //u:p@h`
 *    (finding 57f04594: the limiter's `redis_error_failing_open` line on
 *    deployed 8f90977). Each of those parsed under a bare `new URL` check.
 *
 * So the check is a strict GRAMMAR of the shapes ioredis reads as a TCP host,
 * not a parse attempt: anything else is refused BEFORE a client is
 * constructed, with one fixed, value-free, actionable line, so no client (and
 * no error object) ever exists for it.
 *
 * Accepted: `[redis://|rediss://][user][:password]@host[:port]` where the
 * scheme may carry `/db` and either form a `?query`, plus a bare socket path
 * that carries no `@` or `:`. Userinfo is RFC 3986 unreserved / sub-delims /
 * percent-escapes, so `/ ? # @ \` and whitespace in a password must be
 * percent-encoded.
 */

/** The one fixed line logged for a refused URL. Carries NO value. */
export const REDIS_URL_UNPARSEABLE_MESSAGE =
  "UI_BRIDGE_RELAY_REDIS_URL is not a parseable Redis URL (expected [redis[s]://][user:password@]host[:port]); a reserved character in the password probably needs percent-encoding, or the value carries a stray prefix, quotes or a non-redis scheme";

/** RFC 3986 userinfo characters minus `:` (unreserved, sub-delims, %XX). */
const USER = String.raw`(?:[A-Za-z0-9\-._~!$&()*+,;=]|%[0-9A-Fa-f]{2})*`;
/** A password may also contain `:`. */
const PASSWORD = String.raw`(?:[A-Za-z0-9\-._~!$&()*+,;=:]|%[0-9A-Fa-f]{2})*`;
const HOST = String.raw`(?:[A-Za-z0-9_](?:[A-Za-z0-9_-]*[A-Za-z0-9_])?(?:\.[A-Za-z0-9_](?:[A-Za-z0-9_-]*[A-Za-z0-9_])?)*|\[[0-9A-Fa-f:.]+\])`;
const AUTHORITY = String.raw`(?:${USER}(?::${PASSWORD})?@)?${HOST}(?::(\d{1,5}))?`;
const QUERY = String.raw`(?:\?[A-Za-z0-9\-._~!$&()*+,;=:%/]*)?`;

// Built by concatenation, not template literals: a `${…}$` regex anchor reads
// as a glued currency symbol to the cost-render lint (costRenders.test.ts).
const END = "$";
/** Scheme-less: NO path (ioredis would read any pathname as a socket path). */
const SCHEMELESS_RE = new RegExp("^" + AUTHORITY + QUERY + END);
/** `redis://` / `rediss://`: the pathname is a db index. */
const SCHEMED_RE = new RegExp(
  "^rediss?://" + AUTHORITY + String.raw`(?:/\d*)?` + QUERY + END,
  "i"
);
/** A unix-socket path: a valid ioredis target, and carries no userinfo. */
const SOCKET_RE = /^\/[A-Za-z0-9\-._~/]+(?:\?[A-Za-z0-9\-._~=&]*)?$/;

/** True when ioredis reads `url` as a TCP host (or a credential-free socket). */
export function isParseableRedisUrl(raw: string): boolean {
  // A TRAILING newline/space (a common paste accident in an env dashboard) is
  // harmless: ioredis's WHATWG parse strips it. A LEADING one is not (ioredis
  // then prepends `redis://` to it), so only the tail is trimmed.
  const url = raw.replace(/[\u0000- ]+$/, "");
  // A protocol-relative `//u:p@h` parses in ioredis, but is refused here: the
  // grammar names the shapes we support, and the safe direction is refusal.
  // The trim applies to the TCP grammar only: ioredis keeps a socket path raw.
  if (raw.startsWith("/")) return SOCKET_RE.test(raw) && !raw.startsWith("//");
  const m = SCHEMED_RE.exec(url) ?? SCHEMELESS_RE.exec(url);
  if (!m) return false;
  const port = m[1];
  if (port !== undefined && Number(port) > 65535) return false;
  // ioredis merges query keys into its options, so `?path=` would turn a TCP
  // URL into a socket target and `?host=`/`?port=` would redirect it.
  const q = url.indexOf("?");
  if (q !== -1) {
    const keys = [...new URLSearchParams(url.slice(q + 1)).keys()];
    if (keys.some((k) => ["path", "host", "port"].includes(k.toLowerCase())))
      return false;
  }
  // Belt and braces: ioredis itself parses with WHATWG URL after the same
  // normalisation; a value it cannot parse is refused too.
  const normalised = /^rediss?:\/\//i.test(url) ? url : `redis://${url}`;
  try {
    return new URL(normalised).hostname !== "";
  } catch {
    return false;
  }
}
