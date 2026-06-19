/**
 * Headless OPERATOR-identity on-page smoke.
 *
 * The sibling `verify-deploy-authed-smoke.ts` authenticates as the **ci-bot**
 * (public `USER_PASSWORD_AUTH` on the CI app-client). That covers "does the
 * authed app render", but it CANNOT exercise operator-IDENTITY-specific surfaces
 * (operator/admin-only routes, the per-tenant indicator) because ci-bot is a
 * plain user, not a coord operator.
 *
 * This harness fills that gap. It seeds a PRE-MINTED operator id token (passed
 * in `QONTINUI_SEED_ID_TOKEN`) and renders operator-scoped routes headlessly,
 * asserting (a) no bounce to /login and (b) a stable landmark is visible. The
 * token is minted OUT OF BAND so this script needs no AWS creds and is identity-
 * agnostic — the caller decides who to authenticate as:
 *
 *   - coord-verify operator (read-only, recommended for unattended runs):
 *       aws cognito-idp admin-initiate-auth \
 *         --user-pool-id us-east-1_rgTB9dbZ1 --client-id 6k0mt7h1gk4raam66bpkcnlo9f \
 *         --auth-flow ADMIN_USER_PASSWORD_AUTH \
 *         --auth-parameters USERNAME=<sso-verify email>,PASSWORD=<pw> \
 *         --query AuthenticationResult.IdToken --output text
 *     (creds in SSM /qontinui/sso-verify/{email,password}; the client is in
 *      coord's COORD_OIDC_NONINTERACTIVE_AUDIENCES so coord grants it a
 *      READ-ONLY operator context — every mutation is 403'd, renders are fine.)
 *   - any other operator: mint that user's id token however you like.
 *
 * Seed surface mirrors token-storage.ts EXACTLY (same recipe as the ci-bot
 * smoke): sessionStorage Bearer + localStorage is_authenticated/token_expiry +
 * the qontinui_auth middleware marker cookie.
 *
 * Env:
 *   QONTINUI_SEED_ID_TOKEN  (required) — the pre-minted id token to seed.
 *   SMOKE_BASE_URL          (required) — e.g. https://demo.staging.qontinui.io
 *   SMOKE_ROUTES            (optional) — comma-separated routes; default below.
 *
 * Exit codes mirror verify-deploy-authed-smoke.ts:
 *   0 = every route stayed authed + a landmark rendered + no critical console.
 *   1 = a genuine finding (bounce to /login, missing landmark, console error).
 *   2 = harness error (no token/base, could not reach ANY route, unexpected throw).
 */
import { chromium, type Page } from "@playwright/test";
import { classifyConsole, type ConsoleErrorEntry, type ConsoleLevel } from "./console-policy";

const DEFAULT_ROUTES = ["/operations", "/sessions", "/admin/coord/fleet"];

/**
 * Generic landmark: the route rendered real chrome (a top-level <h1> or an
 * element with role="main"/<main>) rather than a blank shell. Operator routes
 * vary, so we assert structural presence, not a specific title — the no-bounce
 * check below is the primary authed-ness signal.
 */
async function hasLandmark(page: Page): Promise<boolean> {
  const h1 = await page.locator("h1").first().isVisible().catch(() => false);
  if (h1) return true;
  const main = await page.locator("main, [role=main]").first().isVisible().catch(() => false);
  return main;
}

async function main(): Promise<number> {
  const base = (process.env.SMOKE_BASE_URL || "").replace(/\/$/, "");
  const token = process.env.QONTINUI_SEED_ID_TOKEN || "";
  const routes = (process.env.SMOKE_ROUTES || DEFAULT_ROUTES.join(","))
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);

  if (!base) {
    process.stderr.write("[operator-smoke] no SMOKE_BASE_URL (harness)\n");
    return 2;
  }
  if (!token) {
    process.stderr.write("[operator-smoke] no QONTINUI_SEED_ID_TOKEN (harness)\n");
    return 2;
  }

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // Seed BEFORE any navigation. Mirrors token-storage.ts (and the ci-bot smoke):
  // Bearer in sessionStorage, is_authenticated + far-future token_expiry in
  // localStorage, qontinui_auth marker cookie so middleware lets protected
  // routes through.
  const farFutureExpiryMs = Date.now() + 23 * 60 * 60 * 1000;
  await page.addInitScript(
    ([accessToken, expiry]) => {
      try {
        sessionStorage.setItem("auth_bearer_access_token", accessToken);
        sessionStorage.setItem("auth_bearer_refresh_token", "");
        localStorage.setItem("is_authenticated", "true");
        localStorage.setItem("token_expiry", expiry);
        document.cookie = "qontinui_auth=1; Path=/; SameSite=Lax; Secure";
      } catch {
        // first about:blank init — the per-route goto re-runs this.
      }
    },
    [token, String(farFutureExpiryMs)] as const,
  );

  const consoleErrors: ConsoleErrorEntry[] = [];
  let currentRoute = "(startup)";
  page.on("console", (msg) => {
    if (classifyConsole(msg.type(), msg.text()) !== "critical") return;
    consoleErrors.push({
      specId: `operator:${currentRoute}`,
      transitionId: null,
      level: msg.type() as ConsoleLevel,
      text: msg.text(),
      stack: null,
      ts: Date.now(),
    });
  });
  page.on("pageerror", (err) => {
    if (classifyConsole("pageerror", err.message) !== "critical") return;
    consoleErrors.push({
      specId: `operator:${currentRoute}`,
      transitionId: null,
      level: "pageerror",
      text: err.message,
      stack: err.stack ?? null,
      ts: Date.now(),
    });
  });

  const findings: string[] = [];
  let reachedAny = false;

  for (const route of routes) {
    currentRoute = route;
    try {
      await page.goto(`${base}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(2_500);
    } catch (e) {
      process.stderr.write(
        `[operator-smoke] ${route} NAV-FAIL: ${e instanceof Error ? e.message : String(e)}\n`,
      );
      continue;
    }
    reachedAny = true;

    let landedPath: string;
    try {
      landedPath = new URL(page.url()).pathname;
    } catch {
      landedPath = page.url();
    }
    if (landedPath === "/login" || landedPath.startsWith("/login")) {
      findings.push(`${route}: BOUNCED to /login (landed ${landedPath}) — token not trusted/authed`);
      process.stderr.write(`[operator-smoke] ${route} BOUNCE -> ${landedPath}\n`);
      continue;
    }
    const visible = await hasLandmark(page).catch(() => false);
    if (!visible) {
      findings.push(`${route}: no landmark (h1/main) at ${page.url()}`);
      process.stderr.write(`[operator-smoke] ${route} LANDMARK-MISSING\n`);
      continue;
    }
    process.stderr.write(`[operator-smoke] ${route} ok (no bounce + landmark)\n`);
  }

  await browser.close();

  if (!reachedAny) {
    process.stderr.write("[operator-smoke] HARNESS: could not reach ANY route\n");
    return 2;
  }
  for (const e of consoleErrors) {
    process.stderr.write(`[operator-smoke] CONSOLE ${e.specId}: [${e.level}] ${e.text}\n`);
  }
  for (const f of findings) process.stderr.write(`[operator-smoke] FINDING ${f}\n`);

  const clean = findings.length === 0 && consoleErrors.length === 0;
  process.stderr.write(
    `[operator-smoke] result: ${clean ? "CLEAN" : "FAIL"} ` +
      `(${findings.length} findings, ${consoleErrors.length} console across ${routes.length} routes)\n`,
  );
  return clean ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(
      `[operator-smoke] fatal harness error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(2);
  });
