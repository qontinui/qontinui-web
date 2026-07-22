/**
 * JWT builders for tests.
 *
 * Shared so the auth suites all exercise REAL, decodable tokens rather than
 * placeholder strings. A fake that accepts `"new.id.token"` and derives the
 * expiry from `expires_in` is MORE generous than production (where
 * `TokenManager.setTokens` reads the bearer's own `exp` claim), and that gap is
 * exactly what hid the base64url decoder bug.
 */

/** Base64url-encode bytes, unpadded (RFC 7515 §2). */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Base64url-encode a value as UTF-8 JSON (handles non-ASCII claims). */
function encodeSegment(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

/** Build an unsigned JWT carrying the given payload claims. */
export function makeJwt(claims: Record<string, unknown>): string {
  const header = encodeSegment({ alg: "RS256", typ: "JWT" });
  return `${header}.${encodeSegment(claims)}.signature`;
}

const SECOND_MS = 1000;

/**
 * Build an unsigned JWT whose payload carries the given `exp` (milliseconds,
 * truncated to whole seconds as a real `exp` claim is), plus any extra claims.
 */
export function jwtExpiringAt(
  expMs: number,
  extraClaims: Record<string, unknown> = {}
): string {
  return makeJwt({
    sub: "u1",
    exp: Math.floor(expMs / SECOND_MS),
    ...extraClaims,
  });
}
