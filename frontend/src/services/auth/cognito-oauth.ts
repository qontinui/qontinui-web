/**
 * Cognito hosted-UI OAuth helpers — Authorization Code + PKCE.
 *
 * The Qontinui web app uses a **public** Cognito app client (no client
 * secret), so PKCE (RFC 7636, S256) is mandatory for the Authorization Code
 * flow. "Sign in with Google / Microsoft / GitHub" all route through the same
 * Cognito hosted UI; the only difference is the `identity_provider` value, so
 * the entire flow here is provider-agnostic.
 *
 * Flow:
 *  1. `startCognitoLogin(provider)` — mint a PKCE verifier + S256 challenge and
 *     a random `state`, stash both in sessionStorage, then navigate the browser
 *     to the Cognito authorize endpoint.
 *  2. Cognito redirects back to `/auth/callback?code=…&state=…`.
 *  3. The callback verifies `state`, then `exchangeCodeForTokens(code)` POSTs to
 *     the token endpoint with the stored verifier (NO client secret) and returns
 *     the Cognito tokens.
 *
 * Config defaults to the production app client / pool; everything is
 * overridable via `NEXT_PUBLIC_COGNITO_*` env vars so non-prod deployments can
 * point at a different pool without code changes.
 *
 * **Generic OpenID Connect.** Setting `NEXT_PUBLIC_OIDC_ISSUER` (plus
 * `NEXT_PUBLIC_OIDC_CLIENT_ID`) points the same Authorization Code + PKCE flow
 * at any OIDC issuer — Entra ID, Keycloak, Okta — instead of the Cognito
 * hosted UI. Its endpoints come from the issuer's discovery document
 * (`<issuer>/.well-known/openid-configuration`), whose `issuer` must equal the
 * configured one. The backend must accept the same issuer and client id
 * (`OIDC_PROVIDERS`). In that mode there is no `identity_provider` hint, no
 * separate sign-up screen and no Cognito-native identity linking.
 */

// Public Cognito web app client (no secret → PKCE mandatory).
export const COGNITO_CLIENT_ID =
  process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || "q6ns1a8bokf2np1mj8v8arl31";

// Hosted-UI domain (custom domain in production).
export const COGNITO_HOSTED_UI_DOMAIN =
  process.env.NEXT_PUBLIC_COGNITO_HOSTED_UI_DOMAIN ||
  "https://auth.qontinui.io";

// OAuth scopes requested from the hosted UI.
export const COGNITO_SCOPES =
  process.env.NEXT_PUBLIC_COGNITO_SCOPES || "openid email profile";

/**
 * Federated identity providers configured on the Cognito app client. These are
 * the exact `identity_provider` values Cognito expects. `undefined` (the
 * generic button) omits the param so the hosted UI shows its own chooser.
 */
export type CognitoProvider = "Google" | "MicrosoftEntra" | "GitHub";

// Generic OIDC issuer. Empty = the Cognito hosted UI above.
export const OIDC_ISSUER = (process.env.NEXT_PUBLIC_OIDC_ISSUER || "")
  .trim()
  .replace(/\/+$/, "");

// Public client id registered at the generic issuer (PKCE, no secret).
export const OIDC_CLIENT_ID = process.env.NEXT_PUBLIC_OIDC_CLIENT_ID || "";

// Scopes requested from the generic issuer. `offline_access` asks for the
// refresh token that silent renewal spends (OIDC Core §11; issuers commonly
// issue no refresh token to a browser client without it).
export const OIDC_SCOPES =
  process.env.NEXT_PUBLIC_OIDC_SCOPES || "openid email profile offline_access";

// What the sign-in button calls the generic issuer.
export const OIDC_DISPLAY_NAME =
  process.env.NEXT_PUBLIC_OIDC_DISPLAY_NAME || "single sign-on";

/** Whether sign-in goes to a generic OIDC issuer rather than Cognito. */
export function isGenericOidc(): boolean {
  return OIDC_ISSUER !== "";
}

/** The endpoints and client the flow talks to, for whichever mode is active. */
export interface OAuthEndpoints {
  mode: "cognito" | "oidc";
  clientId: string;
  scopes: string;
  authorize: string;
  token: string;
  /** Registration screen; `null` where the issuer has none (generic OIDC). */
  signup: string | null;
  /** RP-initiated logout endpoint; `null` when the issuer advertises none. */
  logout: string | null;
}

/** Endpoints derived from the hosted-UI domain. */
const COGNITO_ENDPOINTS: OAuthEndpoints = {
  mode: "cognito",
  clientId: COGNITO_CLIENT_ID,
  scopes: COGNITO_SCOPES,
  authorize: `${COGNITO_HOSTED_UI_DOMAIN}/oauth2/authorize`,
  token: `${COGNITO_HOSTED_UI_DOMAIN}/oauth2/token`,
  logout: `${COGNITO_HOSTED_UI_DOMAIN}/logout`,
  // Hosted-UI registration screen. Same OAuth2 params as `/oauth2/authorize`
  // (and the same `/auth/callback` round-trip), but lands the user directly on
  // the "create account" form instead of the sign-in form — the right
  // destination for a "Get started"/new-user CTA.
  signup: `${COGNITO_HOSTED_UI_DOMAIN}/signup`,
};

let discoveredEndpoints: Promise<OAuthEndpoints> | null = null;

/**
 * Whether `hostname` is this machine. Plain `http:` is acceptable only there:
 * an http issuer or endpoint anywhere else lets anyone on the path rewrite the
 * discovery document or read the authorization code.
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    /^127(\.\d{1,3}){3}$/.test(host)
  );
}

/** `https:`, or `http:` on a loopback host — anything else is refused. */
function isAcceptableUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && isLoopbackHost(url.hostname))
    );
  } catch {
    return false;
  }
}

/**
 * An endpoint URL from the document, or an error. It must be acceptable on
 * its own (https, or http on localhost) AND never weaker than the issuer: an
 * https issuer's endpoints must be https — no downgrade, not even to a
 * localhost http URL, which would hand the code/tokens to whatever listens
 * on the user's machine.
 */
function requireEndpoint(doc: Record<string, unknown>, key: string): string {
  const value = doc[key];
  if (typeof value === "string" && value && isAcceptableUrl(value)) {
    const downgrade =
      new URL(OIDC_ISSUER).protocol === "https:" &&
      new URL(value).protocol !== "https:";
    if (!downgrade) {
      return value;
    }
  }
  throw new Error(
    `The identity provider's discovery document has no usable ${key} ` +
      "(it must use https — or http only for a localhost issuer)."
  );
}

async function discoverOidcEndpoints(): Promise<OAuthEndpoints> {
  if (!OIDC_CLIENT_ID) {
    throw new Error(
      "NEXT_PUBLIC_OIDC_ISSUER is set but NEXT_PUBLIC_OIDC_CLIENT_ID is not."
    );
  }
  if (!isAcceptableUrl(OIDC_ISSUER)) {
    throw new Error(
      "NEXT_PUBLIC_OIDC_ISSUER must be an https URL (plain http is accepted " +
        "only for a localhost issuer)."
    );
  }
  const url = `${OIDC_ISSUER}/.well-known/openid-configuration`;
  let doc: Record<string, unknown>;
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    doc = (await response.json()) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Sign-in is unavailable: the identity provider's discovery document ` +
        `could not be read (${error instanceof Error ? error.message : String(error)}).`
    );
  }
  // OIDC Discovery §4.3: a document for another issuer must be refused.
  const advertised =
    typeof doc.issuer === "string" ? doc.issuer.trim().replace(/\/+$/, "") : "";
  if (advertised !== OIDC_ISSUER) {
    throw new Error(
      "Sign-in is unavailable: the identity provider's discovery document " +
        "names a different issuer."
    );
  }
  const endSession = doc.end_session_endpoint;
  return {
    mode: "oidc",
    clientId: OIDC_CLIENT_ID,
    scopes: OIDC_SCOPES,
    authorize: requireEndpoint(doc, "authorization_endpoint"),
    token: requireEndpoint(doc, "token_endpoint"),
    signup: null,
    logout:
      typeof endSession === "string" && endSession
        ? requireEndpoint(doc, "end_session_endpoint")
        : null,
  };
}

/**
 * The endpoints for the active mode. Cognito's are static; a generic issuer's
 * come from its discovery document, fetched once per page load (a failed
 * fetch is not cached, so the next attempt retries).
 */
export async function resolveOAuthEndpoints(): Promise<OAuthEndpoints> {
  if (!isGenericOidc()) {
    return COGNITO_ENDPOINTS;
  }
  if (!discoveredEndpoints) {
    discoveredEndpoints = discoverOidcEndpoints().catch((error: unknown) => {
      discoveredEndpoints = null;
      throw error;
    });
  }
  return discoveredEndpoints;
}

// sessionStorage keys for the in-flight PKCE values. Tab-scoped, single-use:
// cleared by `consumePkceState()` as soon as the callback reads them.
const PKCE_VERIFIER_KEY = "cognito_pkce_verifier";
const PKCE_STATE_KEY = "cognito_oauth_state";

// Marker, embedded in the OAuth `state`, that flags a "link mode" round-trip
// (connecting an additional IdP to the ALREADY signed-in canonical account)
// as opposed to a normal sign-in. The callback inspects this to decide whether
// to establish a session (login) or POST the federated id_token to the link
// endpoint WITHOUT clobbering the canonical session bearer. It is part of the
// signed-against-itself `state` (verified by `verifyStateAndExtractNext`), so a
// tampered marker fails the CSRF check rather than silently changing behaviour.
const LINK_MODE_STATE_PREFIX = "link:";

/** Cognito token endpoint response (public-client Authorization Code grant). */
export interface CognitoTokenResponse {
  id_token: string;
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

/**
 * Why a refresh-token exchange failed.
 *
 * - `authoritative` — Cognito told us the session is DEAD (a 400 carrying
 *   `error: "invalid_grant"`, i.e. the refresh token was revoked or has itself
 *   expired, or a 401). The caller should tear the session down.
 * - `transient` — we could not get an answer we can trust: offline, DNS/CORS
 *   failure, an aborted fetch, a 5xx, a 429, an unparseable body. The refresh
 *   token may well still be good, so the caller MUST keep the session and try
 *   again later.
 *
 * The distinction exists because the proactive renewal fires SIX MINUTES BEFORE
 * `exp`, while the bearer is still perfectly valid. Treating a blip there as a
 * dead session throws away a working token and bounces the user to `/login`
 * early — the exact logout this whole feature removes. Anything not positively
 * known to be authoritative is therefore classified transient.
 */
export type CognitoRefreshFailureKind = "authoritative" | "transient";

/** A failed Cognito refresh-token exchange, carrying its failure class. */
export class CognitoRefreshError extends Error {
  readonly kind: CognitoRefreshFailureKind;
  /** HTTP status, or null when the request never produced a response. */
  readonly status: number | null;
  /** Cognito's OAuth `error` code, when the body carried one. */
  readonly oauthError: string | null;
  /**
   * A NEW refresh token the issuer returned even though the refresh failed
   * (a 200 with a rotated `refresh_token` but no `id_token`). A rotating
   * issuer may already have invalidated the old one, so the caller must
   * persist this before retrying.
   */
  readonly rotatedRefreshToken: string | null;

  constructor(
    message: string,
    kind: CognitoRefreshFailureKind,
    status: number | null = null,
    oauthError: string | null = null,
    rotatedRefreshToken: string | null = null
  ) {
    super(message);
    this.name = "CognitoRefreshError";
    this.kind = kind;
    this.status = status;
    this.oauthError = oauthError;
    this.rotatedRefreshToken = rotatedRefreshToken;
  }
}

/**
 * Token endpoint response for the **refresh_token** grant.
 *
 * Cognito does NOT rotate/return a refresh token on this grant, so the caller
 * keeps the one it already holds (it stays valid for the app client's much
 * longer `RefreshTokenValidity`). Generic issuers may rotate refresh tokens
 * (OAuth 2.0 Security BCP recommends rotation for public clients): when
 * `refresh_token` is present it replaces the old one, which a rotating
 * issuer may have just invalidated.
 */
export interface CognitoRefreshResponse {
  id_token: string;
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

/**
 * The redirect URI for the current origin. MUST be one of the URIs registered
 * on the Cognito app client and MUST be byte-for-byte identical between the
 * authorize request and the token exchange. Deriving it from the live origin
 * keeps prod (`https://qontinui.io`) and dev (`http://localhost:3000`) correct
 * without branching on env.
 */
export function getRedirectUri(): string {
  if (typeof window === "undefined") {
    // SSR fallback — never used for the actual redirect, which only runs in
    // the browser, but keeps the function total.
    return "https://qontinui.io/auth/callback";
  }
  return `${window.location.origin}/auth/callback`;
}

/**
 * Post-logout landing URL for the current origin. MUST be registered as an
 * "Allowed sign-out URL" on the Cognito app client and match byte-for-byte.
 * After Cognito clears its hosted-UI session it redirects here, so we send the
 * user straight back to the app's login page. Origin-derived to keep prod
 * (`https://qontinui.io/login`) and dev (`http://localhost:3000/login`)
 * correct without branching on env.
 */
export function getLogoutRedirectUri(): string {
  if (typeof window === "undefined") {
    return "https://qontinui.io/login";
  }
  return `${window.location.origin}/login`;
}

/** Base64url-encode bytes without padding (RFC 7636 §A). */
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

/**
 * Base64url-decode to bytes (inverse of `base64UrlEncode`). Restores the
 * standard alphabet (`-`→`+`, `_`→`/`) and the padding that the unpadded
 * encoder stripped, then `atob`s. Throws on a malformed input (callers wrap
 * this in try/catch and treat a failure as "no usable value").
 */
function base64UrlDecode(value: string): Uint8Array {
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  // atob requires padding to a multiple of 4.
  const padded = standard.padEnd(
    standard.length + ((4 - (standard.length % 4)) % 4),
    "="
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Base64url-encode a string as UTF-8. We go through `TextEncoder` first so that
 * non-Latin1 characters (any unicode path segment) survive — `btoa` alone
 * throws on code points > 0xFF.
 */
function base64UrlEncodeString(value: string): string {
  return base64UrlEncode(new TextEncoder().encode(value));
}

/** Base64url-decode a UTF-8 string (inverse of `base64UrlEncodeString`). */
function base64UrlDecodeString(value: string): string {
  return new TextDecoder().decode(base64UrlDecode(value));
}

/**
 * Generate a high-entropy PKCE `code_verifier`: 32 random bytes →
 * base64url = 43 unreserved chars, comfortably inside the RFC's 43-128 range.
 */
function generateCodeVerifier(): string {
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  return base64UrlEncode(random);
}

/** S256 PKCE challenge: base64url(SHA-256(verifier)). */
async function deriveCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

/** Random, opaque CSRF `state` (base64url of 16 random bytes). */
function generateState(): string {
  const random = new Uint8Array(16);
  crypto.getRandomValues(random);
  return base64UrlEncode(random);
}

/**
 * Build the authorize URL and navigate the browser to the Cognito hosted UI to
 * begin the Authorization Code + PKCE flow. Stores the PKCE verifier + state in
 * sessionStorage so `/auth/callback` can complete the exchange.
 *
 * @param provider Federated IdP to jump straight into, or `undefined` to show
 *                 the hosted-UI provider chooser.
 * @param next     Optional post-login destination (a same-origin path). Carried
 *                 through `state` so the callback can honour it.
 */
export async function startCognitoLogin(
  provider?: CognitoProvider,
  next?: string
): Promise<void> {
  // `state` carries the CSRF token and (optionally) the post-login path. The
  // WHOLE state string is stored verbatim and compared byte-for-byte on return
  // (that equality IS the CSRF/replay check), so the path can't be swapped for
  // an attacker-chosen redirect without failing verification.
  await beginAuthorize(provider, buildLoginState(generateState(), next));
}

/**
 * Begin account creation: navigate to the Cognito hosted-UI **registration**
 * screen (`/signup`) so a brand-new user lands directly on the "create account"
 * form instead of the sign-in form. Wire-identical to `startCognitoLogin()`
 * with no provider (same PKCE verifier/challenge, same `state`, same
 * `/auth/callback` round-trip) — only the hosted-UI endpoint differs, and the
 * hosted UI still links back to "Sign in" for users who already have an
 * account. This is the correct destination for a "Get started" CTA.
 *
 * @param next Optional post-signup destination (a same-origin path), carried
 *             through `state` exactly as in the login flow.
 */
export async function startCognitoSignup(next?: string): Promise<void> {
  // A generic issuer has no separate registration screen in OIDC; its own
  // sign-in page offers registration where the deployment enables it.
  await beginAuthorize(undefined, buildLoginState(generateState(), next), "signup");
}

/**
 * Build the login-mode OAuth `state`: the CSRF token, optionally followed by
 * `.` + the **base64url** of the post-login `next` path.
 *
 * WHY base64url (and not `encodeURIComponent`): base64url output is drawn from
 * `A-Za-z0-9-_` and the `.` separator and CSRF token are themselves base64url,
 * so the entire state string contains NO `%xx` sequences. That makes it
 * byte-stable (idempotent) under any number of percent-encode/decode round
 * trips on ANY Cognito return path. The hosted-UI **email** (form-POST) return
 * path applies one EXTRA percent-decode to `state`; with the old
 * `encodeURIComponent` packing, a `next` containing `/` (e.g. `%2Fco-pilot`)
 * came back decoded to `/co-pilot`, breaking the strict-equality CSRF check and
 * failing every email sign-in that carried a `next` — the prod bug this fixes.
 */
export function buildLoginState(csrf: string, next?: string): string {
  return next ? `${csrf}.${base64UrlEncodeString(next)}` : csrf;
}

/**
 * Begin a **link-mode** Authorization Code + PKCE round-trip: connect an
 * additional federated IdP (Google / Microsoft / GitHub) to the account the
 * user is ALREADY signed in to, WITHOUT logging them in as the federated
 * identity. The only wire-level difference from `startCognitoLogin` is the
 * `link:` marker baked into `state`; the callback reads it to branch.
 *
 * SECURITY: the federated `id_token` produced by this round-trip must NOT be
 * stored as the session bearer (that would clobber the canonical session and
 * effectively switch the user to the federated identity). The callback instead
 * POSTs it to `/auth/identities/link` using the EXISTING canonical bearer. See
 * `app/(marketing)/auth/callback/page.tsx`.
 *
 * Cognito always shows its credential prompt for the chosen IdP, so this links
 * whichever account the user authenticates with at the IdP — it never silently
 * links the current hosted-UI session.
 */
export async function startCognitoLink(
  provider: CognitoProvider
): Promise<void> {
  const csrf = generateState();
  // `link:<csrf>` — verified intact on return by `verifyStateAndExtractNext`
  // (it compares the whole stored string), so the marker can't be tampered
  // with without failing the CSRF check.
  const stateValue = `${LINK_MODE_STATE_PREFIX}${csrf}`;
  await beginAuthorize(provider, stateValue);
}

/**
 * Shared authorize-URL builder + redirect for login, signup, and link modes.
 * Mints the PKCE verifier/challenge, stashes the verifier + the caller-built
 * `state` in sessionStorage, and navigates to the given Cognito hosted-UI
 * endpoint (`/oauth2/authorize` for login/link, `/signup` for registration).
 */
async function beginAuthorize(
  provider: CognitoProvider | undefined,
  stateValue: string,
  screen: "authorize" | "signup" = "authorize"
): Promise<void> {
  const endpoints = await resolveOAuthEndpoints();
  const endpoint =
    screen === "signup" && endpoints.signup ? endpoints.signup : endpoints.authorize;

  const verifier = generateCodeVerifier();
  const challenge = await deriveCodeChallenge(verifier);

  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  sessionStorage.setItem(PKCE_STATE_KEY, stateValue);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: endpoints.clientId,
    redirect_uri: getRedirectUri(),
    scope: endpoints.scopes,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: stateValue,
  });
  // `identity_provider` is a Cognito hosted-UI extension; a generic issuer
  // federates (if at all) behind its own sign-in page.
  if (provider && endpoints.mode === "cognito") {
    params.set("identity_provider", provider);
  }

  window.location.assign(`${endpoint}?${params.toString()}`);
}

/**
 * Whether the `state` returned by Cognito marks a link-mode round-trip (an
 * additional-IdP connect) rather than a normal sign-in. The callback uses this
 * to decide whether to establish a session or link an identity. Returns false
 * for `null` so a bare/direct callback hit is treated as login.
 */
export function isLinkModeState(returnedState: string | null): boolean {
  return !!returnedState && returnedState.startsWith(LINK_MODE_STATE_PREFIX);
}

/**
 * Validate the `state` returned by Cognito against the one stored before the
 * redirect, then return the post-login `next` path encoded into it (if any).
 *
 * Throws on mismatch (CSRF / replay protection). Does NOT consume the verifier;
 * the caller exchanges the code afterwards and then calls `consumePkceState()`.
 */
export function verifyStateAndExtractNext(
  returnedState: string | null
): string | null {
  const stored = sessionStorage.getItem(PKCE_STATE_KEY);
  if (!stored || !returnedState || stored !== returnedState) {
    throw new Error(
      "OAuth state mismatch — the sign-in attempt could not be verified. Please try again."
    );
  }
  // `state` is `<csrf>` or `<csrf>.<base64url(next)>`.
  const dot = stored.indexOf(".");
  if (dot === -1) return null;
  const encodedNext = stored.slice(dot + 1);
  try {
    const decoded = base64UrlDecodeString(encodedNext);
    // Only honour same-origin absolute paths — never an attacker-controlled
    // absolute URL (open-redirect guard).
    return decoded.startsWith("/") && !decoded.startsWith("//")
      ? decoded
      : null;
  } catch {
    return null;
  }
}

/**
 * Exchange the authorization `code` for Cognito tokens via the token endpoint.
 *
 * Public client → form-encoded body with `code_verifier`, NO `Authorization:
 * Basic` / client secret. `redirect_uri` MUST match the authorize request
 * exactly (same origin-derived value).
 */
export async function exchangeCodeForTokens(
  code: string
): Promise<CognitoTokenResponse> {
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  if (!verifier) {
    throw new Error(
      "Missing PKCE verifier — the sign-in session expired. Please try again."
    );
  }

  const endpoints = await resolveOAuthEndpoints();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: endpoints.clientId,
    code,
    redirect_uri: getRedirectUri(),
    code_verifier: verifier,
  });

  const response = await fetch(endpoints.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${await tokenErrorDetail(response)}`);
  }

  return (await response.json()) as CognitoTokenResponse;
}

/**
 * Exchange a stored Cognito **refresh token** for a fresh `id_token` /
 * `access_token` — the silent renewal that keeps a session alive past the app
 * client's `IdTokenValidity` instead of bouncing the user to `/login`.
 *
 * Same public-client conventions as `exchangeCodeForTokens`: form-encoded body,
 * NO client secret / `Authorization: Basic`. The refresh grant takes no
 * `redirect_uri` and no `code_verifier` (PKCE binds the authorization code, not
 * the refresh token).
 *
 * Cognito returns NO `refresh_token` here, so callers keep the token they
 * already hold.
 *
 * ALWAYS rejects with a `CognitoRefreshError` whose `kind` says whether the
 * session is authoritatively dead (tear down) or the attempt merely failed
 * transiently (keep the session, retry later) — see `CognitoRefreshFailureKind`.
 */
export async function refreshCognitoTokens(
  refreshToken: string
): Promise<CognitoRefreshResponse> {
  let endpoints: OAuthEndpoints;
  try {
    endpoints = await resolveOAuthEndpoints();
  } catch (error) {
    // The issuer's discovery document is unreachable: no verdict on the
    // refresh token itself, so keep the session.
    throw new CognitoRefreshError(
      `Token refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      "transient"
    );
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: endpoints.clientId,
    refresh_token: refreshToken,
  });

  let response: Response;
  try {
    response = await fetch(endpoints.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (error) {
    // Offline, DNS failure, CORS rejection, aborted fetch — no verdict from
    // Cognito at all, so the session is NOT known to be dead.
    throw new CognitoRefreshError(
      `Token refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      "transient"
    );
  }

  if (!response.ok) {
    const { detail, error } = await tokenErrorBody(response);
    // ONLY these two are Cognito saying the refresh token itself is no good.
    // 5xx / 429 / anything else is an availability problem, not a verdict.
    const authoritative =
      response.status === 401 ||
      (response.status === 400 && error === "invalid_grant");
    throw new CognitoRefreshError(
      `Token refresh failed: ${detail}`,
      authoritative ? "authoritative" : "transient",
      response.status,
      error
    );
  }

  let parsed: CognitoRefreshResponse;
  try {
    parsed = (await response.json()) as CognitoRefreshResponse;
  } catch (error) {
    // A 200 we cannot parse (truncated response, captive-portal HTML) says
    // nothing about the refresh token's validity.
    throw new CognitoRefreshError(
      `Token refresh returned an unreadable body: ${error instanceof Error ? error.message : String(error)}`,
      "transient",
      response.status
    );
  }

  // The ID token IS the bearer. A 200 without one (an issuer that returns
  // only an access token on refresh, or a truncated body) must not blank the
  // session: report a failed attempt so the caller keeps every token as is.
  if (!parsed || typeof parsed.id_token !== "string" || !parsed.id_token) {
    const rotated =
      parsed && typeof parsed.refresh_token === "string" && parsed.refresh_token
        ? parsed.refresh_token
        : null;
    throw new CognitoRefreshError(
      "Token refresh returned no id_token; keeping the current session.",
      "transient",
      response.status,
      null,
      rotated
    );
  }
  return parsed;
}

/**
 * Best-effort read of a failed token-endpoint response body: Cognito's OAuth
 * `error` code plus a human-readable detail (`error_description` / `error`,
 * falling back to the bare status code for a non-JSON body).
 */
async function tokenErrorBody(
  response: Response
): Promise<{ detail: string; error: string | null }> {
  try {
    const err = (await response.json()) as {
      error?: string;
      error_description?: string;
    };
    return {
      detail: err.error_description || err.error || `${response.status}`,
      error: err.error ?? null,
    };
  } catch {
    // non-JSON error body — keep the status code
    return { detail: `${response.status}`, error: null };
  }
}

/**
 * Best-effort human-readable detail from a failed token-endpoint response.
 */
async function tokenErrorDetail(response: Response): Promise<string> {
  return (await tokenErrorBody(response)).detail;
}

/** Clear the single-use PKCE verifier + state after the exchange completes. */
export function consumePkceState(): void {
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  sessionStorage.removeItem(PKCE_STATE_KEY);
}

/**
 * Sign the user out at the issuer (true SSO logout) by navigating to its
 * logout endpoint, which then redirects back to the app's `/login` page.
 *
 * Cognito: the hosted `/logout` endpoint with `client_id` + `logout_uri`.
 * Generic OIDC: the discovered `end_session_endpoint` (RP-Initiated Logout
 * 1.0) with `client_id`, `post_logout_redirect_uri` and, when supplied, the
 * `id_token_hint`. The hint is sent whenever we hold the ID token: RP-Initiated
 * Logout 1.0 RECOMMENDS it and says an OP SHOULD accept one whose `exp` has
 * passed (https://openid.net/specs/openid-connect-rpinitiated-1_0.html#RPLogout);
 * some issuers require it, and others use it to skip a "sign out?" prompt. It
 * is the user's own ID token going to the issuer that minted it, over a top-level
 * navigation, so it discloses nothing new. An issuer that advertises no
 * end-session endpoint — or whose discovery document cannot be read — gets a
 * local sign-out only: straight to `/login`, the tokens already cleared.
 *
 * A top-level navigation (no CORS); never returns on success. Local token
 * state should already be cleared by the caller before invoking it.
 */
export async function startCognitoLogout(
  idTokenHint?: string | null
): Promise<void> {
  let endpoints: OAuthEndpoints | null = null;
  try {
    endpoints = await resolveOAuthEndpoints();
  } catch {
    endpoints = null;
  }
  if (!endpoints?.logout) {
    window.location.assign(getLogoutRedirectUri());
    return;
  }
  const params = new URLSearchParams({ client_id: endpoints.clientId });
  if (endpoints.mode === "cognito") {
    params.set("logout_uri", getLogoutRedirectUri());
  } else {
    params.set("post_logout_redirect_uri", getLogoutRedirectUri());
    if (idTokenHint) {
      params.set("id_token_hint", idTokenHint);
    }
  }
  window.location.assign(`${endpoints.logout}?${params.toString()}`);
}

/** Forget the discovered endpoints (tests; a changed issuer configuration). */
export function resetOAuthEndpointCache(): void {
  discoveredEndpoints = null;
}
