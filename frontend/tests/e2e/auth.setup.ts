/**
 * Authentication setup for Playwright tests.
 *
 * Two auth lanes, tried in order (mirrors the Spec-CI executor's
 * `seedAuth` in tests/spec-ci/run-spec-ci.ts so the two harnesses share ONE
 * canonical auth contract):
 *
 *   1. HERMETIC INJECTED TOKEN (preferred when present) — `QONTINUI_TEST_ID_TOKEN`
 *      carries a pre-minted id token signed by a RUN-LOCAL issuer
 *      (backend/scripts/spec_ci_local_idp.py); the run-local backend's Cognito
 *      verifier is pointed at that issuer (COGNITO_ISSUER) and JIT-provisions
 *      the ci-bot `auth.users` row on the token's first authenticated request.
 *      No real Cognito, no shared account, no network beyond localhost. This is
 *      what the style-gate workflow (.github/workflows/style-gate.yml) uses so
 *      the captured routes render the REAL authed app against the local stack —
 *      a real-Cognito token's `iss` would NOT be trusted by the local backend,
 *      so without this lane every authed route bounced to /login (the original
 *      "the gate audits the login page" P0).
 *
 *   2. REAL COGNITO (fallback) — mints a Cognito id token for the ci-bot
 *      account via the public USER_PASSWORD_AUTH InitiateAuth API. Used by the
 *      nightly Frontend-E2E suite when it runs against a backend that trusts
 *      real Cognito. Credentials come from the environment:
 *      - QONTINUI_TEST_AUTO_LOGIN_EMAIL / QONTINUI_TEST_AUTO_LOGIN_PASSWORD, or
 *      - PLAYWRIGHT_TEST_USERNAME / PLAYWRIGHT_TEST_PASSWORD.
 *
 * Both lanes seed the SAME browser state: the `access_token` cookie (the
 * backend's CookieOrBearer scheme routes it to the verifier by `iss`) + the
 * client-side `is_authenticated` flag the route guard reads, then storageState
 * is persisted for the authed projects. There is NO local-password form
 * fallback — the app no longer has a password form to drive (legacy-auth
 * teardown T3).
 */

import { test as setup, type BrowserContext, type Page } from "@playwright/test";
import { STORAGE_STATE_PATH } from "./auth.constants";

// Cognito CI app client — see `frontend/tests/spec-ci/run-spec-ci.ts`. The id
// is a public app-client id (USER_PASSWORD_AUTH, no secret), not a secret.
const COGNITO_CI_CLIENT_ID =
  process.env.QONTINUI_COGNITO_CI_CLIENT_ID || "tb0epbojige1900ipu6q80j6b";
const COGNITO_REGION = process.env.QONTINUI_COGNITO_REGION || "us-east-1";

/**
 * Mint a Cognito id token via the public InitiateAuth API
 * (USER_PASSWORD_AUTH, no secret → unauthenticated POST). Returns null on any
 * failure.
 */
async function mintCognitoIdToken(
  username: string,
  password: string,
): Promise<string | null> {
  try {
    const resp = await fetch(`https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      body: JSON.stringify({
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: COGNITO_CI_CLIENT_ID,
        AuthParameters: { USERNAME: username, PASSWORD: password },
      }),
    });
    if (!resp.ok) {
      console.warn(`[Auth Setup] Cognito InitiateAuth http_${resp.status}`);
      return null;
    }
    const body = (await resp.json()) as {
      AuthenticationResult?: { IdToken?: string };
    };
    return body.AuthenticationResult?.IdToken ?? null;
  } catch (e) {
    console.warn(
      `[Auth Setup] Cognito InitiateAuth error: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

/**
 * Seed an id token as the browser's auth state and VERIFY it actually
 * authenticates before persisting storageState.
 *
 * Mirrors run-spec-ci.ts's seed+probe: the token goes on the `access_token`
 * cookie (backend's CookieOrBearer reads it and routes to the verifier by
 * `iss`); the `is_authenticated` localStorage flag is what the client route
 * guard reads to render a protected route instead of redirecting to /login. We
 * then probe a real authed endpoint — a rejected token (wrong issuer / not yet
 * provisioned) must FAIL here loudly, not silently produce an unauthenticated
 * storageState that makes every captured route render the /login screen (the P0
 * "the gate audits the login page" failure).
 *
 * Returns true on a verified-authed seed, false on a rejected token (so the
 * caller can fall through to the next lane). Throws only on unexpected errors.
 */
async function seedAndVerifyToken(
  page: Page,
  context: BrowserContext,
  idToken: string,
  lane: string,
): Promise<boolean> {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  const origin = new URL(page.url()).origin;

  await context.addCookies([
    { name: "access_token", value: idToken, url: origin },
  ]);

  // Verify the token authenticates against a real authed endpoint via the
  // same-origin proxy (the cookie lives on the frontend origin; every API call
  // goes through the Next /api proxy). `/api/v1/auth/users/me` JIT-provisions
  // the user on first call in the hermetic lane, so this probe both verifies
  // AND triggers provisioning.
  const probe = await context.request.get(`${origin}/api/v1/auth/users/me`);
  if (!probe.ok()) {
    console.warn(
      `[Auth Setup] ${lane} token rejected by probe ` +
        `GET /api/v1/auth/users/me -> http_${probe.status()}.`,
    );
    // Clear the bad cookie so the next lane (or the storageState) is clean.
    await context.clearCookies();
    return false;
  }

  await page.addInitScript(() => {
    window.localStorage.setItem("is_authenticated", "true");
  });
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);

  await page.context().storageState({ path: STORAGE_STATE_PATH });
  console.log(
    `[Auth Setup] Authentication state (${lane}) saved to ${STORAGE_STATE_PATH}`,
  );
  return true;
}

setup("authenticate", async ({ page, context }) => {
  // ── Lane 1: hermetic injected token (preferred when present) ──────────────
  // The style-gate + Spec-CI workflows mint a run-local RS256 id token
  // (backend/scripts/spec_ci_local_idp.py) and export it here. The run-local
  // backend trusts that issuer (COGNITO_ISSUER) and JIT-provisions the user on
  // the probe below — no real Cognito, no create_admin.py seed step.
  const injected = process.env.QONTINUI_TEST_ID_TOKEN;
  if (injected) {
    console.log("[Auth Setup] Using hermetic injected id token");
    if (await seedAndVerifyToken(page, context, injected, "injected")) {
      return;
    }
    // A rejected INJECTED token means the hermetic stack is misconfigured —
    // falling through to real Cognito would only mask it. Fail loudly.
    throw new Error(
      "[Auth Setup] QONTINUI_TEST_ID_TOKEN was set but the run-local backend " +
        "rejected it (probe /api/v1/auth/users/me non-2xx). The hermetic stack " +
        "is misconfigured: check that COGNITO_ISSUER points at the run-local " +
        "JWKS server, COGNITO_ALLOWED_AUDIENCES matches the token's `aud`, and " +
        "the JWKS server is serving .well-known/jwks.json. NOT falling back to " +
        "real Cognito — that would mask a broken hermetic auth wiring.",
    );
  }

  // ── Lane 2: real Cognito (fallback) ───────────────────────────────────────
  const username =
    process.env.QONTINUI_TEST_AUTO_LOGIN_EMAIL ||
    process.env.PLAYWRIGHT_TEST_USERNAME;
  const password =
    process.env.QONTINUI_TEST_AUTO_LOGIN_PASSWORD ||
    process.env.PLAYWRIGHT_TEST_PASSWORD;

  if (!username || !password) {
    throw new Error(
      "[Auth Setup] No auth lane available. Set QONTINUI_TEST_ID_TOKEN (hermetic " +
        "injected lane) OR QONTINUI_TEST_AUTO_LOGIN_EMAIL/_PASSWORD " +
        "(or PLAYWRIGHT_TEST_USERNAME/_PASSWORD) for the real-Cognito lane. Local " +
        "password login was removed in the Cognito legacy-auth teardown — there " +
        "is no UI-form fallback.",
    );
  }

  const idToken = await mintCognitoIdToken(username, password);
  if (!idToken) {
    throw new Error(
      "[Auth Setup] Cognito InitiateAuth failed — cannot authenticate. There is no " +
        "local-password fallback after the legacy-auth teardown. Check the CI client id, " +
        "region, and that the credentials are a valid Cognito user.",
    );
  }

  console.log(`[Auth Setup] Cognito login as: ${username}`);
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  const origin = new URL(page.url()).origin;
  // Seed the access_token cookie (backend routes it to the Cognito verifier by
  // `iss`) + the client-side `is_authenticated` flag the route guard reads,
  // then reload so the app hydrates authenticated.
  await context.addCookies([
    { name: "access_token", value: idToken, url: origin },
  ]);
  await page.addInitScript(() => {
    window.localStorage.setItem("is_authenticated", "true");
  });
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);

  await page.context().storageState({ path: STORAGE_STATE_PATH });
  console.log(
    `[Auth Setup] Authentication state (Cognito) saved to ${STORAGE_STATE_PATH}`,
  );
});
