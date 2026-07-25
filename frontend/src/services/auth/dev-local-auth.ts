/**
 * Dev-local-auth frontend handoff (dev-only, strictly gated).
 *
 * WHY THIS EXISTS: the `/verify-web` harness seeds an authenticated tab by
 * injecting a Playwright `storageState`, which can set cookies + localStorage
 * but NOT sessionStorage. The app's bearer, however, lives in sessionStorage
 * (`TokenStorage.SESSION_ACCESS_TOKEN_KEY = "auth_bearer_access_token"`), and
 * `AppAuthGate` needs a real `user` resolved from that bearer — so a tab with
 * only localStorage + the marker cookie set has no usable bearer and bounces
 * to `/login`.
 *
 * THE HANDOFF: the harness drops a token into localStorage under
 * `DEV_LOCAL_AUTH_TOKEN_KEY`; on boot we consume it ONCE and replay it through
 * the SAME `TokenManager.setTokens(...)` path the genuine Cognito callback uses
 * (`completeExternalLogin` in auth-context.tsx). That lands the bearer in
 * sessionStorage, sets the `qontinui_auth` marker cookie, and records the
 * expiry — making the session indistinguishable from a real login. The normal
 * `checkAuth()` flow then hydrates the user from `/users/me`.
 *
 * The token minted by the dev-local IdP (`backend/scripts/dev_local_idp.py`)
 * is a signed RS256 JWT carrying `exp` — the same kind of ID token the Cognito
 * hosted-UI callback sends as the bearer — so `setTokens` derives the access
 * expiry from the token's own `exp` claim. `expires_in` below is only a
 * fallback for an undecodable token (see TokenManager.setTokens).
 *
 * STRICT GATE: every entry point is a no-op unless
 * `NEXT_PUBLIC_ENABLE_DEV_LOCAL_AUTH === "1"`. `NEXT_PUBLIC_*` vars are inlined
 * by Next at build time, so in any normal/prod build the flag is falsy, the
 * guard short-circuits, and the branch is dead code the minifier can drop.
 */
import { TokenManager } from "./token-manager";
import { decodeJwtClaims } from "./jwt-claims";

/**
 * localStorage key the `/verify-web` harness writes the dev token to. Kept in
 * sync with the harness that seeds it (qontinui-claude-config).
 */
export const DEV_LOCAL_AUTH_TOKEN_KEY = "qontinui_dev_local_auth_token";

/** Fallback access-token TTL used only when the token carries no readable `exp`. */
const DEV_FALLBACK_EXPIRES_IN_SECONDS = 3600;

/**
 * True only in a build explicitly opted into dev-local auth. Read at call time
 * (not module load) so tests can toggle it via `vi.stubEnv`.
 */
export function isDevLocalAuthEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_DEV_LOCAL_AUTH === "1";
}

/** Seconds until the JWT `exp`, or the fallback TTL for an undecodable token. */
function deriveExpiresInSeconds(token: string): number {
  const claims = decodeJwtClaims(token);
  const exp = claims && typeof claims.exp === "number" ? claims.exp : null;
  if (exp !== null) {
    const secondsRemaining = Math.floor(exp - Date.now() / 1000);
    if (secondsRemaining > 0) return secondsRemaining;
  }
  return DEV_FALLBACK_EXPIRES_IN_SECONDS;
}

/**
 * Consume a one-shot dev-local-auth handoff token from localStorage, if the
 * feature is enabled and a token is present, and replay it through the real
 * `TokenManager.setTokens(...)` path so the session is established exactly as a
 * genuine login would establish it.
 *
 * Returns true iff a token was consumed. Strict no-op (returns false without
 * touching storage) when the flag is off, off-browser, or no token is present.
 * The localStorage key is removed on consume so it never re-fires on reload.
 */
export function consumeDevLocalAuthToken(tokenManager: TokenManager): boolean {
  if (!isDevLocalAuthEnabled()) return false;
  if (typeof window === "undefined") return false;

  const token = window.localStorage.getItem(DEV_LOCAL_AUTH_TOKEN_KEY);
  if (!token) return false;

  // One-shot: drop the key up front so a later failure can't loop-consume it.
  window.localStorage.removeItem(DEV_LOCAL_AUTH_TOKEN_KEY);

  // Mirror the shape completeExternalLogin() passes for a Cognito ID token:
  // opaque/absent refresh (dev re-auths by re-seeding, not a refresh grant),
  // and an expiry derived from the token's own `exp` (fallback for a
  // non-JWT). This is the SAME setTokens API a real login calls.
  const expiresIn = deriveExpiresInSeconds(token);
  tokenManager.setTokens({
    access_token: token,
    refresh_token: "",
    token_type: "bearer",
    expires_in: expiresIn,
    refresh_expires_in: expiresIn,
  });

  return true;
}
