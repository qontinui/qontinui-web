/**
 * Up-front validity check for the relay / rate-limiter Redis URL.
 *
 * Why: an unparseable `UI_BRIDGE_RELAY_REDIS_URL` (typically a reserved
 * character such as `/` or `@` left unencoded in the password) makes ioredis
 * throw `ERR_INVALID_URL` whose `input` property and message can carry the
 * whole URL, password included. Classifying the URL BEFORE constructing a
 * client turns that failure into one fixed, value-free, actionable line and
 * means no client (and no error object) is ever created for it.
 *
 * Normalisation mirrors ioredis: a URL with no leading `scheme://` gets `redis://` prepended.
 */

/** The one fixed line logged for an unparseable URL. Carries NO value. */
export const REDIS_URL_UNPARSEABLE_MESSAGE =
  "UI_BRIDGE_RELAY_REDIS_URL is not a parseable Redis URL; a reserved character in the password probably needs percent-encoding";

/** True when ioredis would be able to parse `url` (host + numeric port). */
export function isParseableRedisUrl(url: string): boolean {
  // A unix-socket path is a valid ioredis target and carries no userinfo.
  if (url.startsWith("/")) return true;
  // Same protocol test as the SDK's own check: only a leading `scheme://`
  // counts, so `host:6379?x=//` is still scheme-less.
  const normalised = /^[a-z][a-z0-9+.-]*:\/\//i.test(url)
    ? url
    : `redis://${url}`;
  try {
    const u = new URL(normalised);
    if (!u.hostname) return false;
    // `new URL` already rejects a non-numeric port; this guards the empty case.
    return u.port === "" || /^\d+$/.test(u.port);
  } catch {
    return false;
  }
}
