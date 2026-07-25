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

/**
 * Seconds until the JWT `exp`:
 *   - a positive number when the token carries a future `exp`;
 *   - the fallback TTL when the token carries NO decodable `exp` (a non-JWT
 *     handoff string) — a real, freshly-minted token is assumed;
 *   - `null` when the token DOES carry an `exp` that is already in the PAST.
 *     An already-expired token must NOT be stored as fresh (the old 3600
 *     fallback did exactly that, seeding a session that 401s on its first API
 *     call); the caller skips the handoff instead.
 */
function deriveExpiresInSeconds(token: string): number | null {
  const claims = decodeJwtClaims(token);
  const exp = claims && typeof claims.exp === "number" ? claims.exp : null;
  if (exp === null) return DEV_FALLBACK_EXPIRES_IN_SECONDS;
  const secondsRemaining = Math.floor(exp - Date.now() / 1000);
  return secondsRemaining > 0 ? secondsRemaining : null;
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
  // This clears the key even for an already-expired token below — it has been
  // consumed/discarded, and a re-seed writes a fresh value rather than us
  // retrying a stale one on every reload.
  window.localStorage.removeItem(DEV_LOCAL_AUTH_TOKEN_KEY);

  const expiresIn = deriveExpiresInSeconds(token);
  if (expiresIn === null) {
    // The handoff token is ALREADY expired. Do not replay a stale bearer as
    // if it were fresh — that would establish a session that 401s on the
    // first API call and mask the real cause. A fresh mint is expected here
    // (the harness re-seeds); skip the handoff and let auth fall through to
    // the normal /login path.
    console.warn(
      "[dev-local-auth] handoff token is already expired; skipping session " +
        "handoff. Re-seed a freshly minted dev token.",
    );
    return false;
  }

  // Mirror the shape completeExternalLogin() passes for a Cognito ID token:
  // opaque/absent refresh (dev re-auths by re-seeding, not a refresh grant),
  // and an expiry derived from the token's own `exp` (fallback for a
  // non-JWT). This is the SAME setTokens API a real login calls.
  tokenManager.setTokens({
    access_token: token,
    refresh_token: "",
    token_type: "bearer",
    expires_in: expiresIn,
    refresh_expires_in: expiresIn,
  });

  return true;
}
