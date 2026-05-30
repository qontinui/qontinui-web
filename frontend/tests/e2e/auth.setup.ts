/**
 * Authentication setup for Playwright tests.
 *
 * This file logs in once and saves the authentication state (cookies, localStorage)
 * to a file. Other tests can reuse this state to start already authenticated,
 * avoiding the need to log in for every test.
 *
 * Credentials are configurable via environment variables:
 * - PLAYWRIGHT_TEST_USERNAME: Username or email for login
 * - PLAYWRIGHT_TEST_PASSWORD: Password for login
 *
 * Falls back to the standard dev credentials from test-credentials.ts
 */

import { test as setup, expect } from "@playwright/test";
import { TEST_USER } from "./test-credentials";
import { STORAGE_STATE_PATH } from "./auth.constants";

// Get credentials from environment or use defaults.
// The form field is labeled "username" but the backend's auth manager
// (`backend/app/auth/config.py:266`) looks the user up via
// `get_by_email(credentials.username)` — fastapi-users treats the
// OAuth2 `username` field as an email. Send the email by default;
// override via PLAYWRIGHT_TEST_USERNAME if a deployment supports
// username-based lookup.
const getCredentials = () => {
  const username = process.env.PLAYWRIGHT_TEST_USERNAME || TEST_USER.email;
  const password = process.env.PLAYWRIGHT_TEST_PASSWORD || TEST_USER.password;
  return { username, password };
};

// Cognito CI app client — see `frontend/tests/spec-ci/run-spec-ci.ts`. The
// id is a public app-client id, not a secret.
const COGNITO_CI_CLIENT_ID =
  process.env.QONTINUI_COGNITO_CI_CLIENT_ID || "tb0epbojige1900ipu6q80j6b";
const COGNITO_REGION = process.env.QONTINUI_COGNITO_REGION || "us-east-1";

/**
 * Mint a Cognito id token for the ci-bot account via the public
 * InitiateAuth API (USER_PASSWORD_AUTH, no secret → unauthenticated POST).
 * Returns null on any failure so the caller falls back to the UI form.
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
  // Cognito-first lane (Phase T1 of the legacy-auth teardown). Opt-in: only
  // when ci-bot prod credentials (`QONTINUI_TEST_AUTO_LOGIN_*`) are present —
  // i.e. CI/staging runs against the real Cognito pool. Local-dev runs (which
  // use the local `dev-credentials.json` user against a local backend) have no
  // such env and keep the UI-form path below unchanged.
  const ciEmail = process.env.QONTINUI_TEST_AUTO_LOGIN_EMAIL;
  const ciPassword = process.env.QONTINUI_TEST_AUTO_LOGIN_PASSWORD;
  if (ciEmail && ciPassword) {
    const idToken = await mintCognitoIdToken(ciEmail, ciPassword);
    if (idToken) {
      console.log(`[Auth Setup] Cognito login as: ${ciEmail}`);
      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");
      const origin = new URL(page.url()).origin;
      // Seed the access_token cookie (backend routes it to the Cognito
      // verifier by `iss`) + the client-side `is_authenticated` flag the
      // route guard reads, then reload so the app hydrates authenticated.
      await context.addCookies([
        { name: "access_token", value: idToken, url: origin },
      ]);
      await page.addInitScript(() => {
        window.localStorage.setItem("is_authenticated", "true");
      });
      await page.reload();
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(1000);
      // Verify the token actually authenticated (until the backend deploy
      // trusting the CI audience lands, a minted token is rejected and the
      // app falls back to a signed-out state). If a Sign in button is still
      // showing, clear the stale cookie and fall through to the UI form.
      const stillSignedOut = await page
        .getByRole("button", { name: /sign in/i })
        .isVisible()
        .catch(() => false);
      if (!stillSignedOut) {
        await page.context().storageState({ path: STORAGE_STATE_PATH });
        console.log(
          `[Auth Setup] Authentication state (Cognito) saved to ${STORAGE_STATE_PATH}`,
        );
        return;
      }
      console.warn(
        "[Auth Setup] Cognito token not accepted yet — falling back to UI form",
      );
      await context.clearCookies();
    } else {
      console.warn("[Auth Setup] Cognito mint failed — falling back to UI form");
    }
  }

  const { username, password } = getCredentials();

  console.log(`[Auth Setup] Logging in as: ${username}`);

  // Navigate to homepage
  await page.goto("/");
  // Use domcontentloaded instead of networkidle because the app has continuous polling
  // on /api/ui-bridge/commands that prevents networkidle from ever completing
  await page.waitForLoadState("domcontentloaded");

  // Open login dialog
  const signInButton = page.getByRole("button", { name: /sign in/i });
  await expect(signInButton).toBeVisible({ timeout: 30000 });
  await signInButton.click();

  // Wait for dialog
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Fill credentials and submit
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await dialog.getByRole("button", { name: /sign in/i }).click();

  // Wait for dialog to close (indicates successful login)
  await expect(dialog).not.toBeVisible({ timeout: 15000 });

  // Verify we're authenticated by checking for user-specific content
  // Wait for either redirect OR authenticated state on current page
  await page.waitForTimeout(1000); // Brief wait for state to settle

  // Save the authenticated state
  await page.context().storageState({ path: STORAGE_STATE_PATH });

  console.log(
    `[Auth Setup] Authentication state saved to ${STORAGE_STATE_PATH}`
  );
});
