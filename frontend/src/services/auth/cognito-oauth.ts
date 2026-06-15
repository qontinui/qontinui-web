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

/** Endpoints derived from the hosted-UI domain. */
const AUTHORIZE_ENDPOINT = `${COGNITO_HOSTED_UI_DOMAIN}/oauth2/authorize`;
const TOKEN_ENDPOINT = `${COGNITO_HOSTED_UI_DOMAIN}/oauth2/token`;
const LOGOUT_ENDPOINT = `${COGNITO_HOSTED_UI_DOMAIN}/logout`;
// Hosted-UI registration screen. Same OAuth2 params as `/oauth2/authorize`
// (and the same `/auth/callback` round-trip), but lands the user directly on
// the "create account" form instead of the sign-in form — the right
// destination for a "Get started"/new-user CTA.
const SIGNUP_ENDPOINT = `${COGNITO_HOSTED_UI_DOMAIN}/signup`;

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
  await beginAuthorize(
    undefined,
    buildLoginState(generateState(), next),
    SIGNUP_ENDPOINT
  );
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
  endpoint: string = AUTHORIZE_ENDPOINT
): Promise<void> {
  const verifier = generateCodeVerifier();
  const challenge = await deriveCodeChallenge(verifier);

  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  sessionStorage.setItem(PKCE_STATE_KEY, stateValue);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: COGNITO_CLIENT_ID,
    redirect_uri: getRedirectUri(),
    scope: COGNITO_SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: stateValue,
  });
  if (provider) {
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

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: COGNITO_CLIENT_ID,
    code,
    redirect_uri: getRedirectUri(),
    code_verifier: verifier,
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    let detail = `${response.status}`;
    try {
      const err = (await response.json()) as {
        error?: string;
        error_description?: string;
      };
      detail = err.error_description || err.error || detail;
    } catch {
      // non-JSON error body — keep the status code
    }
    throw new Error(`Token exchange failed: ${detail}`);
  }

  return (await response.json()) as CognitoTokenResponse;
}

/** Clear the single-use PKCE verifier + state after the exchange completes. */
export function consumePkceState(): void {
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  sessionStorage.removeItem(PKCE_STATE_KEY);
}

/**
 * Sign the user out of the Cognito hosted-UI session (true SSO logout) by
 * navigating to the hosted `/logout` endpoint. This revokes the Cognito
 * session cookie so a subsequent sign-in re-prompts for credentials instead of
 * silently re-federating. Cognito then redirects the browser to
 * `logout_uri` (the app's `/login` page).
 *
 * The hosted `/logout` endpoint is a top-level navigation (no CORS) — it cannot
 * be called via fetch, so this performs a full-page redirect and never returns.
 * Local token state should already be cleared by the caller before invoking it.
 */
export function startCognitoLogout(): void {
  const params = new URLSearchParams({
    client_id: COGNITO_CLIENT_ID,
    logout_uri: getLogoutRedirectUri(),
  });
  window.location.assign(`${LOGOUT_ENDPOINT}?${params.toString()}`);
}
