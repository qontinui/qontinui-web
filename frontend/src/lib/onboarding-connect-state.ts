/**
 * The OAuth `state` round-trip for GitHub App onboarding.
 *
 * Two flows land on the same Setup/callback URL
 * (`/admin/coord/onboarding-status`) and must be told apart:
 *
 * 1. **Fresh install** — GitHub's post-install redirect carries
 *    `?code=&installation_id=`. The target is unambiguous (GitHub named it).
 * 2. **Already-installed org** — GitHub issues NO Setup-URL code on a re-visit
 *    ("Configure" instead), so the only way to get a code is the
 *    user-authorization endpoint (`login/oauth/authorize`). Its callback
 *    carries `?code=&state=` and **no `installation_id`** — so the org we're
 *    claiming has to ride through in `state`, and coord resolves the id from
 *    the caller's own `/user/installations`.
 *
 * `state` also carries the flow marker (`runner-clone` ⇒ bind-only), a CSRF
 * nonce, and — since plan `2026-07-26-coord-onboarding-claim-caller-tenant-
 * binding` — the server-minted **connect-state token**.
 *
 * ## Why the login in `state` is not a privilege hole
 * It names WHICH installation to claim, never the tenant, and never grants
 * anything: coord resolves the login against the caller's own accessible
 * installations and 403s `installation_not_administered` on a miss. A tampered
 * login can therefore only select an org the *caller already administers*.
 *
 * ## Why the connect-state token is the real gate
 * Coord's claim used to derive the destination tenant from the caller's bearer,
 * independently of the OAuth code that proves org admin — so a never-bound org
 * was claimable by any caller holding any valid bearer. {@link mintConnectState}
 * asks coord for a single-use, tenant-bound token BEFORE we navigate to GitHub;
 * the token rides through `state` and is forwarded on the claim, and coord binds
 * to the *token's* tenant. That makes "the tenant that receives the bind is the
 * tenant that initiated the flow" a server-enforced invariant rather than a
 * client convention.
 *
 * The client nonce below is **not** redundant with it and must not be
 * "simplified" away: the token proves *which tenant initiated*, the nonce proves
 * *this browser tab initiated*. Neither implies the other.
 *
 * ## Wire format
 * `<flow>~<login>~<nonce>~<connect_state>` — `~` is safe as a separator because
 * GitHub logins are alphanumeric + hyphen only and the connect-state token is
 * hex. A bare `runner-clone` is also still parsed: it is the value that
 * `/connect-runner-github` hardcoded before this change (it comes from *web*, not
 * from the desktop runner — the runner only opens that web page), and it may
 * still arrive from a connect that was in flight across the deploy. Such a state
 * carries no token, so the claim now fails closed onto the "start again"
 * recovery path.
 */

import { ApiConfig } from "@/services/api-config";
import { httpClient } from "@/services/service-factory";

export type ConnectFlow = "connect" | "runner-clone";

export interface ConnectState {
  flow: ConnectFlow;
  /** Target org login — present only on the authorize (already-installed) path. */
  login: string | null;
  nonce: string | null;
  /** Coord-minted, tenant-bound, single-use token. Null on legacy/out-of-band states. */
  connectState: string | null;
}

const SEP = "~";
const NONCE_STORAGE_KEY = "qontinui.onboarding_connect_nonce";

/** Legacy value hardcoded by `/connect-runner-github` before the token existed. */
const LEGACY_RUNNER_CLONE = "runner-clone";

/** Web-backend proxy for coord's connect-state mint. */
const CONNECT_STATE_MINT_URL = `${ApiConfig.API_BASE_URL}/api/v1/operations/pr-merge/onboarding/connect-state`;

function randomNonce(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Mint a single-use, tenant-bound connect-state token from coord (via the web
 * proxy, which forwards the operator's bearer — coord's mint is Cognito-gated
 * and cannot be reached with a device token).
 *
 * Throws on any failure. Callers MUST surface that as a visible, retryable
 * error and must NOT fall back to navigating to a stateless GitHub URL: a
 * connect begun without a token cannot be completed once coord arms
 * `COORD_REQUIRE_CONNECT_STATE`, so a silent fallback would just move the
 * failure to a point where the OAuth code has already been spent.
 */
export async function mintConnectState(): Promise<string> {
  const res = await httpClient.fetch(CONNECT_STATE_MINT_URL, {
    method: "POST",
    body: JSON.stringify({}),
    // A mint is a write that allocates a single-use row; retrying it silently
    // would leak rows and mask a genuine coord outage.
    maxRetries: 0,
  });
  if (!res.ok) {
    throw new Error(
      `Couldn't start the GitHub connect (HTTP ${res.status}) — please retry.`
    );
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // Coord's envelope key is `connect_state`; `token` is accepted as an alias
  // because the coord half of this plan lands in a separate PR. Anything else
  // throws rather than producing an unusable `undefined` segment.
  const raw = body.connect_state ?? body.token;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("Coord returned no connect-state token — please retry.");
  }
  const token = raw.trim();
  assertTokenIsWireSafe(token);
  return token;
}

/**
 * Characters that survive BOTH the `~`-delimited wire format and GitHub's
 * `state` round-trip unchanged. Coord mints hex, which is well inside this set.
 *
 * Rejecting everything else — not just `~` — matters because this is a
 * security-relevant value produced by another service: a `~` would silently
 * split into extra segments and be forwarded truncated, and a `+` (standard
 * base64 rather than base64url) round-trips back as a SPACE under
 * form-urlencoded decoding, producing a mangled token, a `connect_state_invalid`
 * 400, and a restart loop with no visible cause. Fail loudly at mint time
 * instead.
 */
const WIRE_SAFE_TOKEN_RE = /^[A-Za-z0-9._-]+$/;

function assertTokenIsWireSafe(token: string): void {
  if (!WIRE_SAFE_TOKEN_RE.test(token)) {
    throw new Error(
      "Connect-state token contains characters that can't survive the GitHub " +
        "state round-trip — refusing to start the connect."
    );
  }
}

/**
 * Build the `state` for an outbound connect nav and persist its nonce so the
 * callback can verify it. sessionStorage (not localStorage) because the nonce
 * is scoped to this tab's round-trip and should not outlive it.
 *
 * `connectState` is taken as a parameter rather than minted here so this stays
 * synchronous and pure-ish: the mint is an authenticated network call that each
 * call site must be able to await, retry and report on (see
 * {@link mintConnectState}).
 *
 * `login` may be empty on the fresh-install path, where GitHub names the
 * installation itself.
 */
export function beginConnectState(
  flow: ConnectFlow,
  login: string,
  connectState: string
): string {
  assertTokenIsWireSafe(connectState);
  const nonce = randomNonce();
  try {
    sessionStorage.setItem(NONCE_STORAGE_KEY, nonce);
  } catch {
    // Private-mode / storage-disabled: proceed without the same-tab check
    // rather than dead-end the user. The server-side `connect_state` above is
    // the actual authorization gate (it is what binds the flow to this tenant);
    // the nonce only narrows it further to this browser tab.
  }
  return [flow, login.trim(), nonce, connectState].join(SEP);
}

/** Parse a returned `state`. Returns null when absent/unrecognized. */
export function parseConnectState(raw: string | null): ConnectState | null {
  if (!raw) return null;
  if (raw === LEGACY_RUNNER_CLONE) {
    return {
      flow: LEGACY_RUNNER_CLONE,
      login: null,
      nonce: null,
      connectState: null,
    };
  }
  const [flow, login, nonce, connectState] = raw.split(SEP);
  if (flow !== "connect" && flow !== LEGACY_RUNNER_CLONE) return null;
  return {
    flow,
    login: login?.trim() ? login.trim() : null,
    nonce: nonce?.trim() ? nonce.trim() : null,
    connectState: connectState?.trim() ? connectState.trim() : null,
  };
}

/**
 * Verify a returned nonce against the one we stored, and consume it so a
 * replayed callback can't re-fire.
 *
 * A state with NO nonce now **fails**. It used to pass, which is what let a
 * crafted `?code=&installation_id=` link with no `state` at all auto-claim an
 * attacker's org into whichever tenant loaded the page (plan
 * `2026-07-26-coord-onboarding-claim-caller-tenant-binding` §1, exploit #1).
 * Every path we initiate now mints both a nonce and a connect-state token, so
 * the only callers that reach here without one are crafted links and
 * out-of-band installs — and the latter get the recoverable "start again"
 * page, not a dead end.
 */
export function consumeNonce(nonce: string | null): boolean {
  if (!nonce) return false;
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(NONCE_STORAGE_KEY);
    sessionStorage.removeItem(NONCE_STORAGE_KEY);
  } catch {
    // Storage unreadable → we could not have stored one at mint time either,
    // so this check is simply unavailable in this browser. Same reasoning as
    // `beginConnectState`: the server-side `connect_state` is the gate, and it
    // is still required and still verified by coord.
    return true;
  }
  return stored === nonce;
}

/**
 * The user-authorization URL. Unlike `installations/new`, this issues a `code`
 * regardless of whether the App is already installed — which is the whole point
 * for an already-installed org. No `redirect_uri`: GitHub falls back to the
 * App's configured callback, so this needs no per-environment URL config.
 */
export function authorizeUrl(clientId: string, state: string): string {
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("state", state);
  return u.toString();
}

/** The install URL for a FRESH install (GitHub returns a Setup-URL code). */
export function installUrl(appSlug: string, state: string): string {
  const u = new URL(`https://github.com/apps/${appSlug}/installations/new`);
  u.searchParams.set("state", state);
  return u.toString();
}

/** Default GitHub App slug, shared by every install entry point. */
export const GITHUB_APP_SLUG =
  process.env.NEXT_PUBLIC_GITHUB_APP_SLUG || "qontinui-merge-orchestrator";
