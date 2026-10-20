/**
 * The post-login destination (`?next=`, or the `next` carried through the
 * Cognito `state`), accepted only when it stays on this origin.
 *
 * A `next` is attacker-influenced: anyone can send a link to
 * `/login?next=...`. A prefix test such as `startsWith("/")` is not a
 * same-origin test. Browsers' URL parsers read several spellings that begin
 * with a slash as a reference to ANOTHER host: a second leading slash, a
 * backslash, or either of those reached after the parser strips tabs and
 * newlines. So the value is resolved the way the browser will resolve it,
 * against this origin, and accepted only if the result is still this origin.
 * A value carrying a backslash or a control character is refused outright.
 * What is returned is the RESOLVED path, query and fragment, never the raw
 * string: resolution can turn a value that passes the origin check (one
 * leading slash, then a dot segment, literal or percent-encoded) into a path
 * that begins with two slashes. A router that rebuilds a URL from that path
 * would produce a protocol-relative reference, so such a path is refused,
 * and a Unicode path comes back percent-encoded.
 *
 * Every consumer of a post-login `next` goes through this one function: the
 * login page, the sign-in form, and the OAuth callback's state decoder.
 */

/** `next` as a resolved same-origin path (`/path?query#hash`), or `null`. */
export function sameOriginNext(
  raw: string | null | undefined,
  origin: string = typeof window === "undefined" ? "" : window.location.origin
): string | null {
  if (
    typeof raw !== "string" ||
    !raw.startsWith("/") ||
    raw.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(raw) ||
    origin === ""
  ) {
    return null;
  }
  let resolved: URL;
  try {
    resolved = new URL(raw, origin);
  } catch {
    return null;
  }
  if (resolved.origin !== new URL(origin).origin) {
    return null;
  }
  const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
  return path.startsWith("//") || path.startsWith("/\\") ? null : path;
}
