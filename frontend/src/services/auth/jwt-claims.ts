/**
 * Shared JWT payload decoder — the ONE base64url-aware decoder in the auth
 * stack.
 *
 * The signature is NOT verified (only the backend can verify); this exists so
 * the client can read its own `exp` / `sub` / `jti` without a round-trip.
 *
 * WHY base64url normalisation is load-bearing: a JWT payload is base64**url**
 * (`-` and `_` in place of `+` and `/`), and `atob` accepts only the standard
 * alphabet — it throws `InvalidCharacterError` the moment either character
 * appears. Whether they appear depends on the payload BYTES, so a Cognito ID
 * token carrying a non-ASCII `name` claim (accented / CJK / emoji) hits it for
 * an appreciable fraction of tokens, and because `exp`/`iat`/`jti` change on
 * every refresh it is effectively a per-token coin flip for those users. A
 * decoder that throws there reports "no expiry", which the refresh scheduler
 * used to read as "renew immediately" — a 10-second token-exchange hot loop.
 *
 * The payload is decoded as UTF-8 (`atob` yields a latin1 byte string, so a
 * multi-byte claim would otherwise come back as mojibake).
 *
 * Returns null for any malformed input (wrong segment count, non-base64,
 * non-JSON, non-object) — callers treat that as "no usable value".
 */
export function decodeJwtClaims(
  token: string | null | undefined
): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const payload = parts[1];
  if (!payload) return null;
  if (typeof atob !== "function") return null;

  try {
    // base64url -> base64, then restore the padding the encoder stripped
    // (`atob` requires a length that is a multiple of 4).
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      "="
    );
    const binary = atob(padded);
    const json =
      typeof TextDecoder === "function"
        ? new TextDecoder().decode(
            Uint8Array.from(binary, (char) => char.charCodeAt(0))
          )
        : binary;
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
