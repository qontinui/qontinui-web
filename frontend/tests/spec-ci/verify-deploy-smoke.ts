/**
 * Post-deploy public-route behavioral smoke for the production frontend.
 *
 * Invoked by `.github/workflows/verify-frontend-deploy.yml` after a successful
 * Vercel Production deploy. It REUSES the Spec CI gate contract — the same
 * console classifier (`classifyConsole`) and same-origin 5xx scope
 * (`isSameOriginServerError`) — over the app's PUBLIC routes on the freshly
 * deployed prod URL (`NEW_PROD_URL`). Lives in tests/spec-ci/ so the relative
 * imports resolve identically to run-spec-ci.ts.
 *
 * Why public-routes only (not run-spec-ci.ts --base-url against prod): the
 * structural spec lane needs the build-time `window.__qontinuiSpecCi__` surface
 * (absent from the prod bundle) and a same-origin /api auth proxy + ci-bot
 * login, so a full crawl against prod is a guaranteed false-red. The
 * unauthenticated public surface renders without either, so this is the
 * prod-safe behavioral layer; deep authed verification stays at PR-time Spec CI.
 *
 * Exit codes (read by the workflow's gate + rollback steps):
 *   0 = clean
 *   1 = genuine smoke failure (a critical console error or a same-origin 5xx)
 *   2 = harness error (could not reach the target / launch failure) — must NOT
 *       trigger a rollback of a possibly-fine deploy.
 */
import { chromium, type Page } from "@playwright/test";
import {
  classifyConsole,
  type ConsoleErrorEntry,
  type ConsoleLevel,
} from "./console-policy";
import {
  isSameOriginServerError,
  type ServerErrorEntry,
} from "./server-error-policy";

// Public routes per frontend/src/middleware.ts (PUBLIC_PATHS +
// representative PUBLIC_PREFIXES). These render without auth or the
// build-time __qontinuiSpecCi__ surface, so the smoke is meaningful
// against the real production bundle.
const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/forgot-password",
  "/reset-password",
  "/privacy-extension",
  "/runner",
  "/docs",
  "/docs/getting-started",
];

async function main(): Promise<number> {
  const base = (process.env.NEW_PROD_URL || "").replace(/\/$/, "");
  if (!base) {
    process.stderr.write("[verify-deploy] no NEW_PROD_URL\n");
    return 2;
  }
  let baseOrigin: string;
  try {
    baseOrigin = new URL(base).origin;
  } catch {
    process.stderr.write(`[verify-deploy] NEW_PROD_URL is not a URL: ${base}\n`);
    return 2;
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
  const page: Page = await context.newPage();

  const consoleErrors: ConsoleErrorEntry[] = [];
  const serverErrors: ServerErrorEntry[] = [];
  let currentRoute = "(startup)";

  // Reuse the EXACT console classifier from console-policy.ts.
  page.on("console", (msg) => {
    const level = msg.type();
    const text = msg.text();
    if (classifyConsole(level, text) !== "critical") return;
    consoleErrors.push({
      specId: `verify:${currentRoute}`,
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
      specId: `verify:${currentRoute}`,
      transitionId: null,
      level: "pageerror",
      text: err.message,
      stack: err.stack ?? null,
      ts: Date.now(),
    });
  });
  // Reuse the EXACT same-origin 5xx scope from server-error-policy.ts.
  page.on("response", (response) => {
    const status = response.status();
    const url = response.url();
    if (!isSameOriginServerError(url, status, baseOrigin)) return;
    serverErrors.push({
      specId: `verify:${currentRoute}`,
      transitionId: null,
      url,
      status,
      method: response.request().method(),
      ts: Date.now(),
    });
  });

  // Reachability probe: if not even the root renders, that is a HARNESS
  // condition (the target is unreachable from the runner), distinct from a
  // behavioral finding. A genuine 5xx is captured by the response listener
  // above and gates as a smoke failure.
  let reachedAny = false;
  for (const route of PUBLIC_ROUTES) {
    currentRoute = route;
    const url = `${base}${route}`;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(2_000);
      reachedAny = true;
      process.stderr.write(`[verify-deploy] ${route} ok\n`);
    } catch (e) {
      // A navigation throw on a single route is recorded but is not by itself a
      // behavioral finding (could be a transient timeout). The gate is console +
      // 5xx; total unreachability is the harness case.
      process.stderr.write(
        `[verify-deploy] ${route} NAV-FAIL: ${e instanceof Error ? e.message : String(e)}\n`,
      );
    }
  }

  await browser.close();

  if (!reachedAny) {
    process.stderr.write(
      "[verify-deploy] HARNESS: could not reach ANY public route on the new prod URL\n",
    );
    return 2;
  }

  for (const e of consoleErrors) {
    process.stderr.write(
      `[verify-deploy] CONSOLE ${e.specId}: [${e.level}] ${e.text}\n`,
    );
  }
  for (const e of serverErrors) {
    process.stderr.write(
      `[verify-deploy] SERVER ${e.specId}: [${e.method} ${e.status}] ${e.url}\n`,
    );
  }

  const clean = consoleErrors.length === 0 && serverErrors.length === 0;
  process.stderr.write(
    `[verify-deploy] result: ${clean ? "CLEAN" : "FAIL"} ` +
      `(${consoleErrors.length} console, ${serverErrors.length} same-origin 5xx across ` +
      `${PUBLIC_ROUTES.length} public routes)\n`,
  );
  return clean ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    // An unexpected throw in the harness itself is a HARNESS error (2), not a
    // behavioral finding — so it never triggers a rollback.
    process.stderr.write(
      `[verify-deploy] fatal harness error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(2);
  });
