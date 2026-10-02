/**
 * Post-deploy AUTHENTICATED behavioral smoke for the production frontend.
 *
 * Invoked by `.github/workflows/verify-frontend-run.yml` AFTER the shallow
 * public-route smoke (verify-deploy-smoke.ts), this is the deep half: it
 * verifies the AUTHENTICATED prod surface so authed regressions (e.g. a
 * session teardown, a 401 cascade, a protected-route bounce) are caught — a
 * class of failure the unauthenticated public crawl structurally cannot see.
 *
 * How it authenticates against PROD (no build-time hook, no /api proxy):
 *   1. Mint a ci-bot Cognito id token directly from Cognito — POST
 *      `https://cognito-idp.<region>.amazonaws.com/` `InitiateAuth`
 *      (USER_PASSWORD_AUTH, public CI app-client, no secret) -> IdToken. (The
 *      local `/api/v1/auth/jwt/login` was deleted in the legacy-auth teardown
 *      (T3); the backend now verifies the Cognito id token.)
 *   2. SEED the exact storage surface the app boots authenticated from
 *      (frontend/src/services/auth/token-storage.ts) BEFORE any navigation via
 *      page.addInitScript:
 *        - sessionStorage.auth_bearer_access_token  (Authorization: Bearer ...)
 *        - sessionStorage.auth_bearer_refresh_token
 *        - localStorage.is_authenticated = "true"
 *        - localStorage.token_expiry     = <far-future ms>
 *      and, on the browser CONTEXT before the first navigation (not from the
 *      init script, which misses the first request — see auth-marker-cookie.ts):
 *        - cookie qontinui_auth=1 (the middleware soft-gate marker; carries no
 *          token — see token-storage.ts AUTH_MARKER_COOKIE).
 *      The app's http-client.ts then attaches the Bearer header on every call,
 *      and middleware.ts lets protected routes through.
 *
 * Playwright's OWN page.addInitScript/page.evaluate (the CI test driver) is NOT
 * the forbidden UI-Bridge relay /control/page/evaluate route — so this seeding
 * is allowed against prod.
 *
 * Reuses the Spec CI gate contract verbatim — the same console classifier
 * (`classifyConsole`) and same-origin 5xx scope (`isSameOriginServerError`).
 *
 * Exit codes (read by the workflow's gate + rollback steps):
 *   0 = all routes stayed authed + landmarks present + no critical console
 *       error + no same-origin 5xx.
 *   1 = a GENUINE finding (bounce to /login, missing landmark, console error,
 *       or same-origin 5xx) — eligible for rollback.
 *   2 = harness error (no env/creds, login failed, could not reach ANY authed
 *       route, or an unexpected throw) — must NOT trigger a rollback.
 */
import { chromium, type Page } from "@playwright/test";
import {
  classifyConsole,
  type ConsoleErrorEntry,
  type ConsoleLevel,
} from "./console-policy";
import { seedAuthMarkerCookie } from "./auth-marker-cookie";
import { settleRoute } from "./route-settle";
import {
  isSameOriginServerError,
  type ServerErrorEntry,
} from "./server-error-policy";

/**
 * Authenticated routes with per-route landmark assertions. Each route is
 * checked for (a) no bounce to /login (the protected-route gate held) and
 * (b) a stable landmark being visible (the page actually rendered, not just a
 * blank/error shell). Landmarks verified against the prod source:
 *   - /sessions        -> <h1>Live Sessions</h1> (sessions/page.tsx) /
 *                         [data-ui-bridge-id="sessions.page"]
 *   - /build/workflows -> <h1>Workflows</h1> (build/workflows/page.tsx —
 *                         renamed from "Workflow Builder" in #524)
 *   - /runs/active     -> <h1>Active Dashboard</h1> (always rendered in the
 *                         header regardless of loading/idle/data state —
 *                         ActiveRunsContent.tsx) + no-bounce
 *   - /settings/account-> [data-content-label="user email"]
 *                         (settings/account/page.tsx)
 */
interface AuthedRoute {
  route: string;
  /** Returns true iff the route's landmark is visible. */
  landmark: (page: Page) => Promise<boolean>;
  /** Human-readable description of the landmark for log output. */
  landmarkDesc: string;
}

const AUTHED_ROUTES: AuthedRoute[] = [
  {
    route: "/sessions",
    landmarkDesc: 'h1 "Live Sessions" or [data-ui-bridge-id="sessions.page"]',
    landmark: async (page) => {
      const byHeading = await page
        .getByRole("heading", { name: /Live Sessions/i })
        .first()
        .isVisible()
        .catch(() => false);
      if (byHeading) return true;
      return page
        .locator('[data-ui-bridge-id="sessions.page"]')
        .first()
        .isVisible()
        .catch(() => false);
    },
  },
  {
    route: "/build/workflows",
    landmarkDesc: 'h1 "Workflows"',
    landmark: async (page) =>
      page
        .getByRole("heading", { name: /^Workflows$/i, level: 1 })
        .first()
        .isVisible()
        .catch(() => false),
  },
  {
    route: "/runs/active",
    landmarkDesc: 'h1 "Active Dashboard" (no-bounce is the primary check)',
    landmark: async (page) =>
      page
        .getByRole("heading", { name: /Active Dashboard/i })
        .first()
        .isVisible()
        .catch(() => false),
  },
  {
    route: "/settings/account",
    landmarkDesc: '[data-content-label="user email"] or account heading',
    landmark: async (page) => {
      const byEmail = await page
        .locator('[data-content-label="user email"]')
        .first()
        .isVisible()
        .catch(() => false);
      if (byEmail) return true;
      return page
        .getByRole("heading", { name: /account/i })
        .first()
        .isVisible()
        .catch(() => false);
    },
  },
];

interface LoginTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Log ci-bot in against the prod API. Returns null on any failure (the caller
 * treats a login-infra failure as HARNESS — a bad deploy isn't the cause).
 * Never logs the credentials or the tokens.
 */
async function login(
  _apiBase: string,
  email: string,
  password: string
): Promise<LoginTokens | null> {
  // Cognito is the sole auth mechanism (legacy-auth teardown T3): the local
  // /api/v1/auth/jwt/login endpoint was deleted (it now 404s). Mint a ci-bot
  // id token via the public CI app-client (USER_PASSWORD_AUTH InitiateAuth, no
  // AWS creds / no client secret) — the same path the backend deploy smoke and
  // E2E setup use. The backend's Cognito arm verifies the id token (the CI
  // client id is in COGNITO_ALLOWED_AUDIENCES); the seeded bearer then
  // authenticates the smoke's authed page loads.
  const region = process.env.QONTINUI_COGNITO_REGION || "us-east-1";
  const clientId =
    process.env.QONTINUI_COGNITO_CI_CLIENT_ID || "tb0epbojige1900ipu6q80j6b";
  let res: Response;
  try {
    res = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      body: JSON.stringify({
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: clientId,
        AuthParameters: { USERNAME: email, PASSWORD: password },
      }),
    });
  } catch (e) {
    process.stderr.write(
      `[authed-smoke] Cognito InitiateAuth request failed (harness): ${e instanceof Error ? e.message : String(e)}\n`
    );
    return null;
  }
  if (!res.ok) {
    process.stderr.write(
      `[authed-smoke] Cognito InitiateAuth returned non-2xx (harness): ${res.status}\n`
    );
    return null;
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    process.stderr.write(
      "[authed-smoke] Cognito response was not JSON (harness)\n"
    );
    return null;
  }
  const ar = (
    json as {
      AuthenticationResult?: { IdToken?: unknown; ExpiresIn?: unknown };
    }
  ).AuthenticationResult;
  if (!ar || typeof ar.IdToken !== "string" || ar.IdToken.length === 0) {
    process.stderr.write(
      "[authed-smoke] Cognito response had no IdToken (harness)\n"
    );
    return null;
  }
  return {
    accessToken: ar.IdToken,
    refreshToken: "",
    expiresIn: typeof ar.ExpiresIn === "number" ? ar.ExpiresIn : 3600,
  };
}

async function main(): Promise<number> {
  const base = (process.env.SMOKE_BASE_URL || "").replace(/\/$/, "");
  const apiBase = (process.env.PROD_API_BASE || "").replace(/\/$/, "");
  const email = process.env.QONTINUI_TEST_AUTO_LOGIN_EMAIL || "";
  const password = process.env.QONTINUI_TEST_AUTO_LOGIN_PASSWORD || "";

  if (!base) {
    process.stderr.write("[authed-smoke] no SMOKE_BASE_URL (harness)\n");
    return 2;
  }
  if (!apiBase) {
    process.stderr.write("[authed-smoke] no PROD_API_BASE (harness)\n");
    return 2;
  }
  if (!email || !password) {
    process.stderr.write(
      "[authed-smoke] no QONTINUI_TEST_AUTO_LOGIN_EMAIL/_PASSWORD (harness)\n"
    );
    return 2;
  }
  let baseOrigin: string;
  try {
    baseOrigin = new URL(base).origin;
  } catch {
    process.stderr.write(
      `[authed-smoke] SMOKE_BASE_URL is not a URL: ${base}\n`
    );
    return 2;
  }
  let apiOrigin: string | null = null;
  try {
    apiOrigin = new URL(apiBase).origin;
  } catch {
    // Diagnostics only; a malformed PROD_API_BASE just disables them.
  }

  // ci-bot login. A login-infra failure is HARNESS, not a deploy regression.
  const tokens = await login(apiBase, email, password);
  if (!tokens) {
    process.stderr.write(
      "[authed-smoke] HARNESS: ci-bot login failed; not a deploy finding\n"
    );
    return 2;
  }
  process.stderr.write("[authed-smoke] ci-bot login ok\n");

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
  // The marker cookie goes on the context so the FIRST request carries it;
  // see auth-marker-cookie.ts for the false /sessions bounce this prevents.
  await seedAuthMarkerCookie(context, base);
  const page: Page = await context.newPage();

  // Seed the auth surface the app boots from BEFORE any navigation. Mirrors
  // token-storage.ts: Bearer tokens in sessionStorage (the primary auth path),
  // and is_authenticated + a far-future token_expiry in localStorage.
  const farFutureExpiryMs = Date.now() + 23 * 60 * 60 * 1000; // ~23h ahead
  await page.addInitScript(
    ([accessToken, refreshToken, expiry]) => {
      try {
        sessionStorage.setItem("auth_bearer_access_token", accessToken);
        sessionStorage.setItem("auth_bearer_refresh_token", refreshToken);
        localStorage.setItem("is_authenticated", "true");
        localStorage.setItem("token_expiry", expiry);
      } catch {
        // sessionStorage/localStorage may be unavailable on the very first
        // about:blank init; the per-route goto re-runs this init script.
      }
    },
    [
      tokens.accessToken,
      tokens.refreshToken,
      String(farFutureExpiryMs),
    ] as const
  );

  const consoleErrors: ConsoleErrorEntry[] = [];
  const serverErrors: ServerErrorEntry[] = [];
  let currentRoute = "(startup)";

  // Reuse the EXACT console classifier from console-policy.ts.
  page.on("console", (msg) => {
    const level = msg.type();
    const text = msg.text();
    if (classifyConsole(level, text) !== "critical") return;
    consoleErrors.push({
      specId: `authed:${currentRoute}`,
      transitionId: null,
      level: level as ConsoleLevel,
      text,
      stack: null,
      ts: Date.now(),
    });
  });
  page.on("pageerror", (err) => {
    if (classifyConsole("pageerror", err.message) !== "critical") return;
    consoleErrors.push({
      specId: `authed:${currentRoute}`,
      transitionId: null,
      level: "pageerror",
      text: err.message,
      stack: err.stack ?? null,
      ts: Date.now(),
    });
  });
  // DIAGNOSTIC ONLY (never a finding, never widens the rollback gate): the
  // prod API is cross-origin, so its auth rejections and 5xx were invisible
  // here — a bounce or missing landmark then gave no hint whether the backend
  // refused the seeded bearer or merely answered slowly.
  const apiDiagnostics: string[] = [];
  page.on("response", (response) => {
    const status = response.status();
    const url = response.url();
    if (
      apiOrigin !== null &&
      (status === 401 || status === 403 || status >= 500)
    ) {
      try {
        const u = new URL(url);
        if (u.origin === apiOrigin) {
          apiDiagnostics.push(
            `${currentRoute}: [${response.request().method()} ${status}] ${u.pathname}`
          );
        }
      } catch {
        // Unparseable URL — not an API response we can attribute.
      }
    }
    // Reuse the EXACT same-origin 5xx scope from server-error-policy.ts.
    if (!isSameOriginServerError(url, status, baseOrigin)) return;
    serverErrors.push({
      specId: `authed:${currentRoute}`,
      transitionId: null,
      url,
      status,
      method: response.request().method(),
      ts: Date.now(),
    });
  });

  // Per-route findings: a bounce to /login (the gate kicked us out) or a
  // missing landmark after no-bounce (the page didn't actually render).
  const routeFindings: string[] = [];
  let reachedAny = false;

  for (const { route, landmark, landmarkDesc } of AUTHED_ROUTES) {
    currentRoute = route;
    const url = `${base}${route}`;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch (e) {
      // A single nav throw is recorded but not by itself a behavioral finding
      // (could be a transient timeout); total unreachability is the harness
      // case handled by reachedAny below.
      process.stderr.write(
        `[authed-smoke] ${route} NAV-FAIL: ${e instanceof Error ? e.message : String(e)}\n`
      );
      continue;
    }
    reachedAny = true;

    // (a) bounce: a redirect to /login means the protected-route gate rejected
    // our seeded session — an authed regression. (b) landmark: the page must
    // have actually rendered within the settle deadline.
    const outcome = await settleRoute(page, landmark);
    if (outcome.kind === "bounce") {
      routeFindings.push(
        `${route}: BOUNCED to /login (landed ${outcome.landedPath})`
      );
      process.stderr.write(
        `[authed-smoke] ${route} BOUNCE -> ${outcome.landedPath}\n`
      );
      continue;
    }
    if (outcome.kind === "missing") {
      routeFindings.push(
        `${route}: landmark missing (${landmarkDesc}); url=${page.url()}`
      );
      process.stderr.write(
        `[authed-smoke] ${route} LANDMARK-MISSING (${landmarkDesc})\n`
      );
      continue;
    }
    process.stderr.write(`[authed-smoke] ${route} ok (no bounce + landmark)\n`);
  }

  await browser.close();

  if (!reachedAny) {
    process.stderr.write(
      "[authed-smoke] HARNESS: could not reach ANY authed route on the new prod URL\n"
    );
    return 2;
  }

  for (const e of consoleErrors) {
    process.stderr.write(
      `[authed-smoke] CONSOLE ${e.specId}: [${e.level}] ${e.text}\n`
    );
  }
  for (const e of serverErrors) {
    process.stderr.write(
      `[authed-smoke] SERVER ${e.specId}: [${e.method} ${e.status}] ${e.url}\n`
    );
  }
  for (const f of routeFindings) {
    process.stderr.write(`[authed-smoke] ROUTE-FINDING ${f}\n`);
  }
  for (const d of apiDiagnostics) {
    process.stderr.write(`[authed-smoke] API-DIAGNOSTIC ${d}\n`);
  }

  const clean =
    routeFindings.length === 0 &&
    consoleErrors.length === 0 &&
    serverErrors.length === 0;
  process.stderr.write(
    `[authed-smoke] result: ${clean ? "CLEAN" : "FAIL"} ` +
      `(${routeFindings.length} route findings, ${consoleErrors.length} console, ` +
      `${serverErrors.length} same-origin 5xx across ${AUTHED_ROUTES.length} authed routes)\n`
  );
  return clean ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    // An unexpected throw in the harness itself is a HARNESS error (2), not a
    // behavioral finding — so it never triggers a rollback.
    process.stderr.write(
      `[authed-smoke] fatal harness error: ${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(2);
  });
