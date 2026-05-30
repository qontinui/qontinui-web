/**
 * Authentication setup for Playwright tests.
 *
 * Cognito is the sole authentication mechanism (legacy-auth teardown T3). This
 * mints a Cognito id token for the ci-bot account via the public
 * USER_PASSWORD_AUTH InitiateAuth API and seeds the `access_token` cookie the
 * backend verifies by `iss`. There is NO local-password form fallback — the app
 * no longer has a password form to drive (sign-in is a redirect to the Cognito
 * hosted UI, an external origin).
 *
 * Credentials (a real Cognito user, e.g. ci-bot) come from the environment:
 * - QONTINUI_TEST_AUTO_LOGIN_EMAIL / QONTINUI_TEST_AUTO_LOGIN_PASSWORD (preferred), or
 * - PLAYWRIGHT_TEST_USERNAME / PLAYWRIGHT_TEST_PASSWORD.
 */

import { test as setup } from "@playwright/test";
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

setup("authenticate", async ({ page, context }) => {
  const username =
    process.env.QONTINUI_TEST_AUTO_LOGIN_EMAIL ||
    process.env.PLAYWRIGHT_TEST_USERNAME;
  const password =
    process.env.QONTINUI_TEST_AUTO_LOGIN_PASSWORD ||
    process.env.PLAYWRIGHT_TEST_PASSWORD;

  if (!username || !password) {
    throw new Error(
      "[Auth Setup] Cognito credentials required. Set " +
        "QONTINUI_TEST_AUTO_LOGIN_EMAIL/_PASSWORD (or PLAYWRIGHT_TEST_USERNAME/_PASSWORD) " +
        "to a Cognito user (e.g. ci-bot@qontinui.io). Local password login was removed " +
        "in the Cognito legacy-auth teardown — there is no UI-form fallback.",
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
