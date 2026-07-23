import { TokenManager } from "./token-manager";
import { CognitoRefreshError, refreshCognitoTokens } from "./cognito-oauth";
import { createLogger } from "@/lib/logger";

const log = createLogger("TokenRefresh");

/**
 * Outcome of one refresh attempt.
 *
 * `expired` and `transient` both mean "no fresh bearer", but they are NOT
 * interchangeable: `expired` is Cognito authoritatively rejecting the refresh
 * token (session torn down), while `transient` is a blip on a session that is
 * still alive and must be left intact. Callers that only need "did I get a
 * usable token" use `refreshAccessToken()`; callers that must not tear a live
 * session down (HttpClient's 401 path) use `refreshWithOutcome()`.
 */
export type RefreshOutcome = "refreshed" | "expired" | "transient";

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
 * Much larger floor used when we cannot resolve the bearer's expiry at all, or
 * when a successful refresh did NOT move it forward.
 *
 * `MIN_PROACTIVE_DELAY_MS` is the right floor for a token whose expiry is known
 * and near; it is the WRONG floor when the expiry is unknowable, because then
 * every wake-up looks "due" and the timer becomes a 10-second token-exchange
 * hot loop against Cognito. Backing right off keeps the session renewable
 * (rather than going dead for the life of the tab) without hammering.
 */
const UNRESOLVED_EXPIRY_RETRY_MS = 5 * 60 * 1000;

/** First backoff step after a transient (non-authoritative) refresh failure. */
const TRANSIENT_RETRY_BASE_MS = 30 * 1000;

/** Ceiling for the transient-failure backoff. */
const TRANSIENT_RETRY_MAX_MS = 5 * 60 * 1000;

/**
 * Consecutive TRANSIENT refresh failures tolerated before the session is torn
 * down anyway.
 *
 * A transient failure deliberately keeps the session, so something has to stop
 * an endless "401 → refresh fails → 401" with no recovery. With the backoff
 * above, five consecutive failures span roughly seven minutes of a token
 * endpoint that is continuously unreachable — by which point the bearer this
 * lead window was protecting has lapsed regardless, so tearing down is no
 * longer an EARLY logout. Reset by any successful refresh.
 */
const MAX_CONSECUTIVE_TRANSIENT_FAILURES = 5;

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
 * Only an AUTHORITATIVE rejection tears the session down — Cognito answering
 * `invalid_grant`/401, or there being no refresh token to spend at all. A
 * transient failure (offline, DNS/CORS, 5xx, 429, aborted fetch) leaves the
 * tokens exactly where they are and retries with a bounded backoff: the
 * proactive timer fires while the bearer is STILL VALID, so discarding it on a
 * network blip would log the user out six minutes early — the very logout this
 * service exists to prevent.
 */
export class TokenRefreshService {
  private tokenManager: TokenManager;

  /**
   * The in-flight refresh, shared by every caller (reactive + proactive) for
   * the duration of one exchange. This is the ONLY refresh mutex in the auth
   * stack — `HttpClient` delegates here rather than keeping its own.
   */
  private refreshPromise: Promise<RefreshOutcome> | null = null;

  /** Handle of the armed proactive-refresh timer, or null when disarmed. */
  private proactiveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Whether `start()` has armed the proactive path (idempotence guard). */
  private proactiveStarted = false;

  /**
   * Consecutive transient failures since the last successful refresh. Drives
   * the retry backoff and the `MAX_CONSECUTIVE_TRANSIENT_FAILURES` backstop.
   */
  private consecutiveTransientFailures = 0;

  /**
   * Fire-once guard for `expireSession()`, held for the life of the service
   * (which outlives any single HttpClient instance).
   *
   * Several 401 handlers outside `HttpClient` (`lib/api-client`,
   * `lib/api-client/client`, `services/workflow-templates-api`) call
   * `refreshAccessToken()` on ANY 401 with no staleness predicate and no
   * fire-once flag of their own. After a teardown each of their later 401s
   * re-enters here, finds no refresh token, and would dispatch `session-expired`
   * AGAIN — and the polling consumers (`RunnerMonitor`, `useTreeEvents`) do that
   * every tick. Centralising the guard here makes the teardown fire once for
   * EVERY caller, not just the one that owns a flag.
   */
  private sessionExpiryDispatched = false;

  /**
   * The bearer expiry observed after the last successful proactive refresh,
   * used to detect a refresh that does not move `exp` forward (see
   * `UNRESOLVED_EXPIRY_RETRY_MS`).
   */
  private lastRefreshedExpiry: number | null = null;

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
    return (await this.refreshWithOutcome()) === "refreshed";
  }

  /**
   * Refresh, reporting WHY it failed.
   *
   * `HttpClient` needs the distinction: on `transient` it must surface the 401
   * to the caller while leaving the session alone, whereas on `expired` the
   * teardown has already happened here and it only has to stop re-firing it.
   * Same single-flight promise as `refreshAccessToken()`.
   */
  async refreshWithOutcome(): Promise<RefreshOutcome> {
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
    // A live session is being armed, so any earlier teardown is history — re-arm
    // the fire-once guard so a genuine future expiry is still announced.
    this.sessionExpiryDispatched = false;
    this.consecutiveTransientFailures = 0;
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
   * Spend the refresh token on a new ID token.
   *
   * Failure is classified, not lumped together:
   *  - no refresh token at all, or Cognito answering `invalid_grant`/401 —
   *    the session really is dead, so tear it down (`expired`);
   *  - anything else (offline, DNS/CORS, timeout, 5xx, 429, unreadable body) —
   *    keep every token exactly where it is and report `transient`, because the
   *    proactive path calls this SIX MINUTES BEFORE `exp` with a bearer the
   *    backend still accepts. A bounded run of consecutive transient failures
   *    does eventually tear down, so nothing can get stuck unrenewable.
   */
  private async doRefresh(): Promise<RefreshOutcome> {
    const refreshToken = this.tokenManager.getRefreshToken();
    if (!refreshToken) {
      log.debug("No Cognito refresh token stored — session expired");
      this.expireSession();
      return "expired";
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
      this.consecutiveTransientFailures = 0;
      // A live bearer again: re-arm the teardown announcement for a future,
      // genuine expiry.
      this.sessionExpiryDispatched = false;
      return "refreshed";
    } catch (error) {
      if (
        error instanceof CognitoRefreshError &&
        error.kind === "authoritative"
      ) {
        log.warn("Cognito rejected the refresh token — session expired:", error);
        this.expireSession();
        return "expired";
      }

      this.consecutiveTransientFailures++;
      if (
        this.consecutiveTransientFailures >= MAX_CONSECUTIVE_TRANSIENT_FAILURES
      ) {
        log.warn(
          `Cognito refresh failed transiently ${this.consecutiveTransientFailures}x in a row — ` +
            "giving up and expiring the session rather than leaving it unrenewable:",
          error
        );
        this.expireSession();
        return "expired";
      }

      log.warn(
        `Cognito refresh failed transiently (${this.consecutiveTransientFailures}/${MAX_CONSECUTIVE_TRANSIENT_FAILURES}) — ` +
          "keeping the session and retrying:",
        error
      );
      return "transient";
    }
  }

  /**
   * Clear local token state and signal session expiry, so the auth context
   * routes the user back through the Cognito hosted UI.
   *
   * Fires the `session-expired` event AT MOST ONCE per live session. The token
   * clear itself is idempotent and repeated on every call, so a late caller
   * still ends up with clean state; only the announcement is debounced. See
   * `sessionExpiryDispatched` for why the guard has to live here.
   */
  private expireSession(): void {
    this.consecutiveTransientFailures = 0;
    this.lastRefreshedExpiry = null;
    this.tokenManager.clearTokens();
    this.clearProactiveTimer();

    if (this.sessionExpiryDispatched) {
      log.debug("Session already expired — not re-dispatching session-expired");
      return;
    }
    this.sessionExpiryDispatched = true;

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("session-expired"));
    }
  }

  /**
   * Arm the next proactive wake-up, or leave the timer disarmed when there is
   * nothing to renew (signed out, nothing to spend, or a hidden tab — the
   * visibility listener re-arms on return).
   */
  private scheduleProactiveRefresh(): void {
    const expiry = this.tokenManager.getAccessTokenExpiry();
    if (expiry === null) {
      // No usable expiry: an undecodable bearer, or a session restored with
      // nothing persisted. Returning here silently is what used to kill the
      // proactive path for the life of the tab (leaving `isAccessTokenExpired()`
      // permanently true, so EVERY 401 was routed into a refresh). Arm a slow
      // probe instead — renewable, but nowhere near a hot loop.
      //
      // Only when there IS a refresh token to spend, though: a cookie-restored
      // session holds no client-side bearer at all, and probing it would land
      // in `doRefresh`'s "no refresh token" branch and log a perfectly good
      // session out.
      if (this.tokenManager.getRefreshToken()) {
        this.armProactiveTimer(UNRESOLVED_EXPIRY_RETRY_MS);
      } else {
        this.clearProactiveTimer();
      }
      return;
    }

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
    this.armProactiveTimer(delay);
  }

  /**
   * Arm the single proactive timer, subject to the shared preconditions
   * (started, signed in, tab visible). Every scheduling path goes through here
   * so none of them can arm a timer the others would consider illegal.
   */
  private armProactiveTimer(delay: number): void {
    this.clearProactiveTimer();

    if (typeof window === "undefined" || !this.proactiveStarted) return;
    if (!this.tokenManager.isAuthenticated()) return;
    if (document.visibilityState === "hidden") return;

    this.proactiveTimer = setTimeout(
      () => {
        this.proactiveTimer = null;
        void this.runProactiveRefresh();
      },
      Math.max(delay, MIN_PROACTIVE_DELAY_MS)
    );
  }

  /**
   * Refresh if the bearer needs renewing, then re-arm. A wake-up on a
   * still-fresh token (a clock jump, or a visibility change well before expiry)
   * just re-arms without spending the refresh token.
   */
  private async runProactiveRefresh(): Promise<void> {
    if (!this.proactiveStarted) return;
    if (!this.tokenManager.isAuthenticated()) return;

    if (!this.isRenewalNeeded()) {
      this.scheduleProactiveRefresh();
      return;
    }

    const outcome = await this.refreshWithOutcome();

    if (outcome === "expired") {
      // Session torn down — nothing left to schedule.
      return;
    }

    if (outcome === "transient") {
      // The bearer was NOT discarded; the token endpoint just couldn't be
      // reached. Retry on an exponential backoff so a blip at `exp - 6min`
      // costs the user nothing instead of an early logout.
      const attempt = Math.max(1, this.consecutiveTransientFailures);
      this.armProactiveTimer(
        Math.min(
          TRANSIENT_RETRY_BASE_MS * 2 ** (attempt - 1),
          TRANSIENT_RETRY_MAX_MS
        )
      );
      return;
    }

    // Refreshed. If the renewed bearer's expiry did not move FORWARD (an
    // undecodable token, or an issuer echoing the same `exp`), re-arming on the
    // normal floor would spend a token exchange every ten seconds forever.
    const expiry = this.tokenManager.getAccessTokenExpiry();
    const stalled =
      expiry === null ||
      (this.lastRefreshedExpiry !== null && expiry <= this.lastRefreshedExpiry);
    this.lastRefreshedExpiry = expiry;

    if (stalled) {
      log.warn(
        "Refreshed bearer carries no usable/advancing expiry — backing off " +
          "instead of re-arming on the floor (would be a refresh hot loop)"
      );
      this.armProactiveTimer(UNRESOLVED_EXPIRY_RETRY_MS);
      return;
    }

    this.scheduleProactiveRefresh();
  }

  /**
   * Whether the proactive path should spend the refresh token now.
   *
   * `isRefreshDue()` needs a KNOWN expiry, so it answers false when the bearer's
   * `exp` can't be resolved — which is precisely the case where we cannot prove
   * the token is fresh. The proactive path therefore also renews on an unknown
   * expiry (bounded by `UNRESOLVED_EXPIRY_RETRY_MS`); `isRefreshDue()` itself is
   * left skew-free and conservative for its other caller, the boot path.
   *
   * The unknown-expiry clause additionally requires a refresh token to spend —
   * without one the attempt could only end in a teardown, which would sign out
   * a cookie-restored session that legitimately holds no client-side bearer.
   */
  private isRenewalNeeded(): boolean {
    if (this.isRefreshDue()) return true;
    return (
      this.tokenManager.getAccessTokenExpiry() === null &&
      !!this.tokenManager.getRefreshToken()
    );
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
