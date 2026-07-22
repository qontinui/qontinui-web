/**
 * TokenValidator JWT-decoding tests.
 *
 * BUG (root cause of the 10-second refresh hot loop): `decodeToken` did
 * `atob(parts[1])` with no base64url normalisation. A JWT payload is
 * base64**url** — `-` and `_` in place of `+` and `/` — and `atob` throws
 * `InvalidCharacterError` the moment either appears. Whether they appear
 * depends on the payload BYTES, so an ID token whose `name` claim contains
 * astral-plane / multi-byte characters (emoji, Hangul, symbols) hits it for a
 * large fraction of tokens; and because `exp`/`iat`/`jti` change on every
 * refresh it is a fresh coin flip per token for those users.
 *
 * The throw surfaced as "no expiry", which the proactive refresh scheduler
 * read as "renew now" — a token exchange every ten seconds, forever.
 */

import { describe, it, expect } from "vitest";

import { TokenValidator } from "./token-validator";
import { makeJwt, jwtExpiringAt } from "@/test/jwt";

const SECOND_MS = 1000;

describe("TokenValidator.decodeToken", () => {
  it("decodes a payload whose base64url form contains `-`/`_` (non-ASCII `name` claim)", () => {
    const exp = 1_800_000_000;
    const token = makeJwt({
      sub: "u1",
      exp,
      name: "Zoë 🎉",
      email: "k@example.com",
    });

    // Guard the guard: if this payload ever stopped containing a base64url-only
    // character the test would silently stop being a regression test.
    expect(token.split(".")[1]).toMatch(/[-_]/);

    const validator = new TokenValidator();
    const payload = validator.decodeToken(token);

    expect(payload).not.toBeNull();
    expect(payload!.exp).toBe(exp);
    // Decoded as UTF-8, not as latin1 bytes (which would be mojibake).
    expect(payload!.name).toBe("Zoë 🎉");
    expect(validator.extractExpiry(token)).toBe(exp * SECOND_MS);
  });

  it("extracts the expiry from an ordinary ASCII token", () => {
    const validator = new TokenValidator();
    const exp = Date.now() + 3 * 60 * 60 * SECOND_MS;
    expect(validator.extractExpiry(jwtExpiringAt(exp))).toBe(
      Math.floor(exp / SECOND_MS) * SECOND_MS
    );
  });

  it("returns null for a non-JWT string rather than throwing", () => {
    const validator = new TokenValidator();
    expect(validator.decodeToken("not-a-jwt")).toBeNull();
    expect(validator.extractExpiry("not-a-jwt")).toBeNull();
  });

  it("returns no expiry when `exp` is absent or not a number (never a NaN timestamp)", () => {
    const validator = new TokenValidator();
    expect(validator.extractExpiry(makeJwt({ sub: "u1" }))).toBeNull();
    expect(
      validator.extractExpiry(makeJwt({ sub: "u1", exp: "1800000000" }))
    ).toBeNull();
  });
});
