/**
 * Redaction of Redis connection strings from anything we log.
 *
 * Why this exists: the relay / rate-limiter Redis URL
 * (`UI_BRIDGE_RELAY_REDIS_URL`) carries the Upstash password as userinfo, and
 * it is frequently configured WITHOUT a `rediss://` scheme
 * (`default:<pw>@host:6379`). Library errors (URL parsing, `err.input`,
 * wrapped messages, stacks) can embed the URL, and a logged string then leaks
 * the password. Every log site that touches a Redis error or URL must go
 * through `safeRedisErrorText` / `redactRedisSecrets` / `redisHostOnly`.
 *
 * Two independent passes, because neither alone is enough:
 *  (a) substitute the KNOWN userinfo/password parsed from the Redis URL env
 *      vars, including from malformed values (catches a bare password with no
 *      userinfo shape around it);
 *  (b) a per-token pattern pass that masks whatever precedes a token's last
 *      `@`, and a `//user:secret` start with no `@` (catches URLs that are not
 *      in our env, whatever characters the password holds).
 */

export const REDACTED = "***";

/** Env vars that may hold a Redis URL / credential this module family reads. */
const REDIS_ENV_VARS = [
  "UI_BRIDGE_RELAY_REDIS_URL",
  "REDIS_URL",
  "UPSTASH_REDIS_URL",
  "UPSTASH_REDIS_REST_URL",
] as const;

/** Env vars holding a bare secret (not a URL). */
const REDIS_SECRET_ENV_VARS = ["UPSTASH_REDIS_REST_TOKEN"] as const;

/**
 * Extract HOST[:port] from a redis connection string for structured logging.
 * Credentials (`user:pass@`) and path/query are dropped — we never log secrets.
 * Falls back to a constant marker if the URL is unparseable.
 */
export function redisHostOnly(url: string): string {
  try {
    const u = new URL(url);
    return u.host || "<unknown-host>";
  } catch {
    return "<unparseable-url>";
  }
}

/** Passwords shorter than this are not substituted (they would garble text). */
const MIN_SECRET_LENGTH = 4;

/** A password's `/`-tail shorter than this is not substituted on its own. */
const MIN_TAIL_LENGTH = 8;

/**
 * Split a possibly scheme-less redis URL into its userinfo parts by hand
 * (`new URL` rejects `default:pw@host:6379`). Only the AUTHORITY (up to the
 * first `/`, `?` or `#` after the scheme) is searched, so `redis://h/0?x=a@b`
 * yields nothing. The userinfo ends at the LAST `@` of the authority, so an
 * unencoded `@` in a password still resolves.
 */
function parseUserinfo(
  raw: string
): { userinfo: string; password: string } | null {
  const noScheme = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const authority = noScheme.split(/[/?#]/, 1)[0] ?? "";
  const at = authority.lastIndexOf("@");
  if (at <= 0) return null;
  const userinfo = authority.slice(0, at);
  const colon = userinfo.indexOf(":");
  const password = colon === -1 ? userinfo : userinfo.slice(colon + 1);
  if (password.length < MIN_SECRET_LENGTH) return null;
  return { userinfo, password };
}

/**
 * The userinfo of a MALFORMED value, which `parseUserinfo` cannot see: a `/`
 * in the password (`u:SEC/RET@h`), a stray prefix (`KEY=rediss://u:p@h`) or
 * quotes (`"rediss://u:p@h"`). These are exactly the values ioredis
 * mis-parses into an error message carrying the password (finding 57f04594).
 * The userinfo is taken back from the LAST `@` to the first `//` (else to the
 * start of the value), and is only believed when it has a `user:password`
 * colon, so a path/query `@` (`redis://h/0?x=a@b`) still yields nothing that
 * a later colon-less search would.
 */
function parseUserinfoLoose(
  raw: string
): { userinfo: string; password: string } | null {
  const at = raw.lastIndexOf("@");
  if (at <= 0) return null;
  const head = raw.slice(0, at);
  const slashes = head.indexOf("//");
  const userinfo = slashes === -1 ? head : head.slice(slashes + 2);
  const colon = userinfo.indexOf(":");
  if (colon === -1) return null;
  const password = userinfo.slice(colon + 1);
  if (password.length < MIN_SECRET_LENGTH) return null;
  return { userinfo, password };
}

function tryDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The literal secret strings to scrub, longest first. */
function knownSecrets(
  extraUrls: readonly (string | null | undefined)[]
): string[] {
  const out = new Set<string>();
  const add = (s: string | undefined) => {
    if (s && s.length >= MIN_SECRET_LENGTH) out.add(s);
  };
  const urls = [...REDIS_ENV_VARS.map((k) => process.env[k]), ...extraUrls];
  for (const u of urls) {
    if (!u) continue;
    for (const parts of [parseUserinfo(u), parseUserinfoLoose(u)]) {
      if (!parts) continue;
      add(parts.userinfo);
      for (const pw of [parts.password, tryDecode(parts.password)]) {
        add(pw);
        add(encodeURIComponent(pw));
        // ioredis reads `u:1234/pw@h` as host `u`, port 1234 and SOCKET PATH
        // `/pw@h`, so the error text carries only the password's tail after a
        // `/`. Scrub every such tail too.
        let slash = pw.indexOf("/");
        while (slash !== -1) {
          const tail = pw.slice(slash + 1);
          // A short tail (`x/6379`) would mask ordinary text such as ports.
          if (tail.length >= MIN_TAIL_LENGTH) add(tail);
          slash = pw.indexOf("/", slash + 1);
        }
      }
    }
  }
  for (const k of REDIS_SECRET_ENV_VARS) {
    const v = process.env[k];
    if (v && v.length > 0) out.add(v);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/**
 * The pattern pass, applied to every whitespace/quote-delimited TOKEN, so it
 * does not depend on what the userinfo contains (an earlier regex pass
 * excluded `/` from a password, which is exactly the socket-path leak shape):
 *
 *  - a token with an `@`: everything before its LAST `@` is userinfo-like and
 *    is masked. A leading `scheme://` or `//` is kept for readability when
 *    nothing before it could be a credential, so
 *    `connect ENOENT //default:SEC/RET@h:6379` -> `connect ENOENT //***@h:6379`
 *    and `redis://default:sec@ret@h` -> `redis://***@h`.
 *  - a token with NO `@` but a `//user:secret` start (a message cut before its
 *    `@`, e.g. a truncated socket path) where the text after the colon is not
 *    a numeric port: the remainder after `//` is masked, so
 *    `//default:SEC/RET` -> `//***` while `redis://h.example:6379/0` stays.
 *
 * Tokens split on whitespace and `<>` only (not quotes), so a quote inside a
 * password does not shield its first half. A password with whitespace in it,
 * or a message cut before its `@` whose post-colon text is a number
 * (`//u:1234/pw`), is left to the known-secret pass; the classifier refuses
 * both URL shapes before any client exists.
 *
 * Known false positives, accepted: any `x@y` token (an e-mail address,
 * `ssh://git@host`) has its local part masked. A credential the token pass
 * cannot shape-match (a bare password with no `@`) is the known-secret pass's.
 */
const TOKEN = /[^\s<>]+/g;

function redactToken(token: string): string {
  const at = token.lastIndexOf("@");
  if (at > 0) {
    const head = token.slice(0, at);
    const slashes = head.indexOf("//");
    // Keep `scheme://` or `//` only when what precedes it is at most a scheme
    // (`rediss:`, `KEY=rediss:`), never `user:pw` (`default:ab//cd@h`).
    const keep =
      slashes !== -1 &&
      /^(?:(?:[^\s:]*=)?[a-z][a-z0-9+.-]*:)?$/i.test(head.slice(0, slashes))
        ? head.slice(0, slashes + 2)
        : "";
    return `${keep}${REDACTED}${token.slice(at)}`;
  }
  const slashes = token.indexOf("//");
  if (slashes !== -1) {
    const rest = token.slice(slashes + 2);
    // Stop at a quote, so a JSON-ish `"redis://h:6379","x"` stays a port.
    const m = /^[^/:"']*:([^/"']*)/.exec(rest);
    if (m && m[1] && !/^\d+$/.test(m[1])) {
      return `${token.slice(0, slashes + 2)}${REDACTED}`;
    }
  }
  return token;
}

/** Replace every credential in `text` with `***`. Safe on any string. */
export function redactRedisSecrets(
  text: string,
  extraUrls: readonly (string | null | undefined)[] = []
): string {
  let out = text;
  for (const secret of knownSecrets(extraUrls)) {
    out = out.split(secret).join(REDACTED);
  }
  return out.replace(TOKEN, redactToken);
}

/**
 * Loggable text for an unknown thrown value: the message only (never the
 * stack, `input`, `options` or a serialised object), redacted.
 */
export function safeRedisErrorText(
  err: unknown,
  extraUrls: readonly (string | null | undefined)[] = []
): string {
  let text: string;
  if (err instanceof Error) {
    text = err.message;
  } else {
    try {
      text = String(err);
    } catch {
      text = "<unprintable-error>";
    }
  }
  return redactRedisSecrets(text, extraUrls);
}
