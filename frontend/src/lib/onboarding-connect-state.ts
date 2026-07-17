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
 * `state` also carries the flow marker (`runner-clone` ⇒ bind-only) and a CSRF
 * nonce.
 *
 * ## Why the login in `state` is not a privilege hole
 * It names WHICH installation to claim, never the tenant (that always comes
 * from the caller's Cognito auth) and never grants anything: coord resolves the
 * login against the caller's own accessible installations and 403s
 * `installation_not_administered` on a miss. A tampered login can therefore
 * only select an org the *caller already administers*. The nonce is defence in
 * depth against a crafted authorize link (worst case without it: a user is
 * tricked into connecting an org they already own), not the primary gate.
 *
 * ## Wire format
 * `<flow>~<login>~<nonce>` — `~` is safe as a separator because GitHub logins
 * are alphanumeric + hyphen only. A bare `runner-clone` is also accepted: the
 * shipped desktop runner sends exactly that, and those installs are fresh (they
 * carry `installation_id`), so they need no login and predate the nonce.
 */

export type ConnectFlow = "connect" | "runner-clone";

export interface ConnectState {
  flow: ConnectFlow;
  /** Target org login — present only on the authorize (already-installed) path. */
  login: string | null;
  nonce: string | null;
}

const SEP = "~";
const NONCE_STORAGE_KEY = "qontinui.onboarding_connect_nonce";

/** Legacy value sent by shipped runners; predates login/nonce. */
const LEGACY_RUNNER_CLONE = "runner-clone";

function randomNonce(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Build the `state` for an outbound connect nav and persist its nonce so the
 * callback can verify it. sessionStorage (not localStorage) because the nonce
 * is scoped to this tab's round-trip and should not outlive it.
 */
export function beginConnectState(flow: ConnectFlow, login: string): string {
  const nonce = randomNonce();
  try {
    sessionStorage.setItem(NONCE_STORAGE_KEY, nonce);
  } catch {
    // Private-mode / storage-disabled: proceed without the CSRF check rather
    // than dead-end the user. Coord's org-admin gate is the real protection.
  }
  return [flow, login.trim(), nonce].join(SEP);
}

/** Parse a returned `state`. Returns null when absent/unrecognized. */
export function parseConnectState(raw: string | null): ConnectState | null {
  if (!raw) return null;
  if (raw === LEGACY_RUNNER_CLONE) {
    return { flow: LEGACY_RUNNER_CLONE, login: null, nonce: null };
  }
  const [flow, login, nonce] = raw.split(SEP);
  if (flow !== "connect" && flow !== LEGACY_RUNNER_CLONE) return null;
  return {
    flow,
    login: login?.trim() ? login.trim() : null,
    nonce: nonce?.trim() ? nonce.trim() : null,
  };
}

/**
 * Verify a returned nonce against the one we stored, and consume it so a
 * replayed callback can't re-fire. A state with NO nonce passes: that's the
 * legacy runner value and the fresh-install path, neither of which minted one.
 */
export function consumeNonce(nonce: string | null): boolean {
  if (!nonce) return true;
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(NONCE_STORAGE_KEY);
    sessionStorage.removeItem(NONCE_STORAGE_KEY);
  } catch {
    return true; // storage unavailable → same fallback as beginConnectState
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
