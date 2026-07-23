import { TokenManager } from "./token-manager";
import { refreshCognitoTokens } from "./cognito-oauth";
import { createLogger } from "@/lib/logger";

const log = createLogger("TokenRefresh");

/**
 * Renew this many ms BEFORE the bearer's `exp`. Sized well above the request
 * timeout so an in-flight call started just before the wake-up still carries a
 * token the backend accepts, and above `TokenValidator`'s 5-minute clock-skew
 * tolerance so a client clock that runs fast can't push the renewal past the
 * point where the backend already considers the token dead.
 */
const PROACTIVE_REFRESH_LEAD_MS = 6 * 60 * 1000;

/**
 * Floor for a scheduled wake-up. Guards against a pathological expiry (already
 * inside the lead window, or a clock jump) arming a zero-delay timer that
 * re-fires in a tight loop.
 */
const MIN_PROACTIVE_DELAY_MS = 10 * 1000;

/**
 * TokenRefreshService - Single Responsibility: keep the bearer token fresh.
 *
 * Authentication is Cognito-only. The bearer is the Cognito **ID token** (not
 * the access token — only the ID token carries the identity claims the backend
 * provisions from; see `/auth/callback`), and the hosted-UI Authorization Code
 * + PKCE flow also hands back a long-lived refresh token which is stored
 * alongside it. This service spends that refresh token on the Cognito token
 * endpoint (`grant_type=refresh_token`) to mint a new ID token silently, so a
 * session outlives the app client's `IdTokenValidity` instead of the user being
 * bounced to `/login` the moment it lapses.
 *
 * Two paths drive it, both funnelling through the SAME single-flight promise so
 * a burst of concurrent 401s spends the refresh token exactly once:
 *  - reactive: `HttpClient` on a 401 with a stale bearer,
 *  - proactive: `start()` arms a timer that renews shortly before `exp`.
 *
 * When the refresh grant fails (revoked/expired refresh token, no refresh token
 * at all) the session really is dead: local token state is cleared and
 * `session-expired` is dispatched, which the auth context handles by routing
 * the user back through the hosted UI.
 */
export class TokenRefreshService {
  private tokenManager: TokenManager;

  /**
   * The in-flight refresh, shared by every caller (reactive + proactive) for
   * the duration of one exchange. This is the ONLY refresh mutex in the auth
   * stack — `HttpClient` delegates here rather than keeping its own.
   */
  private refreshPromise: Promise<boolean> | null = null;

  /** Handle of the armed proactive-refresh timer, or null when disarmed. */
  private proactiveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Whether `start()` has armed the proactive path (idempotence guard). */
  private proactiveStarted = false;

  constructor(tokenManager: TokenManager) {
    this.tokenManager = tokenManager;
  }

  /**
   * Refresh the bearer token, returning whether a usable token is now stored.
   *
   * Single-flight: concurrent callers await the SAME exchange rather than
   * firing N parallel token-endpoint calls (the dashboard runs several polling
   * loops that all 401 within the same tick once the bearer lapses).
   */
  async refreshAccessToken(): Promise<boolean> {
    if (this.refreshPromise) {
      log.debug("Refresh already in flight — joining it");
      return this.refreshPromise;
    }

    const inFlight = this.doRefresh().finally(() => {
      // Only clear if we're still the current attempt, so a refresh started
      // after this one settled isn't cancelled out from under its callers.
      if (this.refreshPromise === inFlight) {
        this.refreshPromise = null;
      }
    });
    this.refreshPromise = inFlight;
    return inFlight;
  }

  /** Whether a refresh exchange is currently in flight. */
  isRefreshing(): boolean {
    return this.refreshPromise !== null;
  }

  /**
   * Arm the proactive refresh path: renew the bearer shortly before it expires
   * instead of waiting for a 401. Safe to call repeatedly (idempotent).
   *
   * Deliberately a single self-rescheduling `setTimeout`, not an interval: it
   * only exists while a user is signed in and the tab is visible, so a
   * backgrounded or logged-out tab does no work at all. Returning to the
   * foreground re-evaluates immediately (background timers are throttled, so a
   * hidden tab's token may well have lapsed while it slept).
   */
  start(): void {
    if (typeof window === "undefined" || this.proactiveStarted) return;
    this.proactiveStarted = true;
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.scheduleProactiveRefresh();
  }

  /** Disarm the proactive refresh path (logout / provider unmount). */
  stop(): void {
    if (typeof window === "undefined" || !this.proactiveStarted) return;
    this.proactiveStarted = false;
    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange
    );
    this.clearProactiveTimer();
  }

  /**
   * Spend the refresh token on a new ID token. On failure — no refresh token,
   * or Cognito rejecting it as revoked/expired — tear the session down so an
   * actually-dead session still logs the user out.
   */
  private async doRefresh(): Promise<boolean> {
    const refreshToken = this.tokenManager.getRefreshToken();
    if (!refreshToken) {
      log.debug("No Cognito refresh token stored — session expired");
      this.expireSession();
      return false;
    }

    try {
      const tokens = await refreshCognitoTokens(refreshToken);

      // Store the new ID token in the bearer slot, matching what
      // `/auth/callback` does at login: the backend's verifier wants the ID
      // token (aud == client_id), and only it carries `email`/`name`/`sub`.
      // Cognito returns no refresh token on this grant, so the existing one is
      // written straight back — it stays valid until its own, much longer,
      // expiry. `setTokens` re-derives the bearer expiry from the JWT `exp`.
      this.tokenManager.setTokens({
        access_token: tokens.id_token,
        refresh_token: refreshToken,
        token_type: "bearer",
        expires_in: tokens.expires_in,
        // Omitted deliberately (0 => falsy => not persisted): the refresh
        // token's own expiry is unchanged by this grant, so the stored
        // `refresh_token_expiry` must not be moved.
        refresh_expires_in: 0,
      });

      log.debug("Cognito bearer refreshed silently");
      return true;
    } catch (error) {
      log.warn("Cognito refresh-token exchange failed:", error);
      this.expireSession();
      return false;
    }
  }

  /**
   * Clear local token state and signal session expiry, so the auth context
   * routes the user back through the Cognito hosted UI.
   */
  private expireSession(): void {
    this.tokenManager.clearTokens();
    this.clearProactiveTimer();

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("session-expired"));
    }
  }

  /**
   * Arm the next proactive wake-up, or leave the timer disarmed when there is
   * nothing to renew (signed out, no known expiry, or a hidden tab — the
   * visibility listener re-arms on return).
   */
  private scheduleProactiveRefresh(): void {
    this.clearProactiveTimer();

    if (typeof window === "undefined" || !this.proactiveStarted) return;
    if (!this.tokenManager.isAuthenticated()) return;
    if (document.visibilityState === "hidden") return;

    const expiry = this.tokenManager.getAccessTokenExpiry();
    if (expiry === null) return;

    const remaining = this.tokenManager.getTimeUntilExpiry();
    const delay = Math.max(
      remaining > PROACTIVE_REFRESH_LEAD_MS
        ? remaining - PROACTIVE_REFRESH_LEAD_MS
        : // Token lifetime shorter than the lead window (an app client
          // configured near Cognito's 5-minute `IdTokenValidity` floor): renew
          // at the halfway point rather than instantly, so every fresh token
          // isn't immediately "due" and the timer can't become a refresh loop.
          remaining / 2,
      MIN_PROACTIVE_DELAY_MS
    );
    this.proactiveTimer = setTimeout(() => {
      this.proactiveTimer = null;
      void this.runProactiveRefresh();
    }, delay);
  }

  /**
   * Refresh if the bearer is inside the lead window, then re-arm. A wake-up on
   * a still-fresh token (a clock jump, or a visibility change well before
   * expiry) just re-arms without spending the refresh token.
   */
  private async runProactiveRefresh(): Promise<void> {
    if (!this.proactiveStarted) return;
    if (!this.tokenManager.isAuthenticated()) return;

    if (!this.isRefreshDue()) {
      this.scheduleProactiveRefresh();
      return;
    }

    const refreshed = await this.refreshAccessToken();
    if (refreshed) {
      // New `exp` => new wake-up. On failure the session was torn down, so
      // there is nothing left to schedule.
      this.scheduleProactiveRefresh();
    }
  }

  /**
   * Whether the bearer is inside the proactive-renewal window (or already past
   * `exp`) and should be renewed now.
   *
   * Public because the boot path needs it too: `TokenManager.isAccessTokenExpired()`
   * carries `TokenValidator`'s 5-minute clock-skew tolerance, so for the five
   * minutes AFTER `exp` it reports "not expired" while the backend already
   * rejects the token — a dead zone in which the auth context would skip the
   * refresh and sign the user out on the first 401. This predicate has no skew
   * grace, so it covers that window.
   */
  isRefreshDue(): boolean {
    const expiry = this.tokenManager.getAccessTokenExpiry();
    if (expiry === null) return false;

    // `isAccessTokenExpiringSoon` covers "inside the lead window but not yet
    // past `exp`"; it reports false once `exp` has actually passed, so the
    // zero-time-remaining case is checked explicitly — that's exactly the tab
    // that was backgrounded through the whole token lifetime.
    return (
      this.tokenManager.isAccessTokenExpiringSoon(PROACTIVE_REFRESH_LEAD_MS) ||
      this.tokenManager.getTimeUntilExpiry() === 0
    );
  }

  /** Re-evaluate on foreground; do nothing while hidden. */
  private handleVisibilityChange = (): void => {
    if (document.visibilityState !== "visible") {
      this.clearProactiveTimer();
      return;
    }
    void this.runProactiveRefresh();
  };

  private clearProactiveTimer(): void {
    if (this.proactiveTimer !== null) {
      clearTimeout(this.proactiveTimer);
      this.proactiveTimer = null;
    }
  }
}
