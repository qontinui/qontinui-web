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
 *      vars (catches values a regex cannot, e.g. an unencoded `/` or `@`);
 *  (b) a pattern pass for `scheme://user:pass@host`, `scheme://pass@host` and
 *      scheme-less `user:pass@host` (catches URLs that are not in our env).
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
    if (s && s.length > 0) out.add(s);
  };
  const urls = [...REDIS_ENV_VARS.map((k) => process.env[k]), ...extraUrls];
  for (const u of urls) {
    if (!u) continue;
    const parts = parseUserinfo(u);
    if (!parts) continue;
    add(parts.userinfo);
    add(parts.password);
    add(tryDecode(parts.password));
    add(encodeURIComponent(parts.password));
  }
  for (const k of REDIS_SECRET_ENV_VARS) add(process.env[k]);
  return [...out].sort((a, b) => b.length - a.length);
}

/**
 * `scheme://[user]:pass@`  |  `scheme://pass@`  |  scheme-less `user:pass@`.
 * Userinfo may not contain whitespace, quotes or `/`; it MAY contain `@` (the
 * match is greedy to the last `@` of the run), so an unencoded `@` in a
 * password is covered. Known false positives, accepted: `ssh://git@host` and
 * `mailto:x@y` text are masked too. A `/` inside a password is not covered by
 * the pattern pass (it is indistinguishable from a path); the known-secret
 * pass handles it when the URL is in our env.
 */
const SCHEME_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)[^\s'"<>/]*@/gi;
const SCHEMELESS_USERPASS = /(^|[\s'"(<=,;:\]])[^\s:@/'"<>]*:[^\s'"<>/]+@/g;

/** Replace every credential in `text` with `***`. Safe on any string. */
export function redactRedisSecrets(
  text: string,
  extraUrls: readonly (string | null | undefined)[] = []
): string {
  let out = text;
  for (const secret of knownSecrets(extraUrls)) {
    out = out.split(secret).join(REDACTED);
  }
  out = out.replace(
    SCHEME_USERINFO,
    (_m, prefix: string) => `${prefix}${REDACTED}@`
  );
  out = out.replace(
    SCHEMELESS_USERPASS,
    (_m, prefix: string) => `${prefix}${REDACTED}@`
  );
  return out;
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
