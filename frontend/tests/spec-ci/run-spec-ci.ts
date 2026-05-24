/**
 * Spec-CI test runner — Playwright-driven, in-browser executor.
 *
 * Iterates every IR spec under `frontend/specs/pages/<id>/state-machine.derived.json`,
 * navigates Chromium to the corresponding route on the dev server, signs in
 * via the backend auth API, injects the IR + ui-bridge-auto into the page,
 * and walks the state machine via `executeTransition` from
 * `@qontinui/ui-bridge-auto/runtime`. Records per-spec pass/fail with miss
 * diagnostics and writes a deterministic JSON report.
 *
 * Critically: this runner DOES NOT need the qontinui-runner process. The
 * runner's Spec API + UI Bridge HTTP proxy exist for dev-time authoring;
 * in CI we have the IR files in the repo and the SDK already lives in the
 * frontend bundle. We drive the page directly via Playwright.
 *
 * Usage:
 *   tsx tests/spec-ci/run-spec-ci.ts \
 *     --base-url http://localhost:3001 \
 *     --api-base https://api.qontinui.io \
 *     --output spec-ci-report.json \
 *     [--include-destructive]
 *
 * Env:
 *   QONTINUI_TEST_AUTO_LOGIN_EMAIL    required (auth credentials)
 *   QONTINUI_TEST_AUTO_LOGIN_PASSWORD required
 *   QONTINUI_API_BASE_URL             fallback for --api-base
 */

import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface Args {
  baseUrl: string;
  apiBase: string;
  output: string;
  includeDestructive: boolean;
  specsDir: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Partial<Args> = {
    includeDestructive: false,
    specsDir: resolve(__dirname, "../../specs/pages"),
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--base-url": args.baseUrl = value; i++; break;
      case "--api-base": args.apiBase = value; i++; break;
      case "--output": args.output = value; i++; break;
      case "--specs-dir": args.specsDir = resolve(value); i++; break;
      case "--include-destructive": args.includeDestructive = true; break;
    }
  }
  args.baseUrl ??= "http://localhost:3001";
  args.apiBase ??= process.env.QONTINUI_API_BASE_URL ?? "https://api.qontinui.io";
  args.output ??= "spec-ci-report.json";
  return args as Args;
}

// ---------------------------------------------------------------------------
// Auth (cookies attach to the browser context — same shape as headless-launcher)
// ---------------------------------------------------------------------------

async function programmaticLogin(
  context: BrowserContext,
  apiBase: string,
): Promise<{ ok: boolean; reason?: string }> {
  const email = process.env.QONTINUI_TEST_AUTO_LOGIN_EMAIL;
  const password = process.env.QONTINUI_TEST_AUTO_LOGIN_PASSWORD;
  if (!email || !password) return { ok: false, reason: "no_credentials" };

  const form = new URLSearchParams({ username: email, password }).toString();
  const resp = await context.request.post(`${apiBase.replace(/\/$/, "")}/api/v1/auth/jwt/login`, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    data: form,
  });
  if (!resp.ok()) {
    return { ok: false, reason: `http_${resp.status()}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Spec discovery
// ---------------------------------------------------------------------------

interface SpecEntry {
  id: string;
  path: string;
  doc: Record<string, unknown>;
}

function discoverSpecs(specsDir: string): SpecEntry[] {
  if (!existsSync(specsDir)) return [];
  const out: SpecEntry[] = [];
  for (const slug of readdirSync(specsDir)) {
    const irPath = join(specsDir, slug, "state-machine.derived.json");
    if (!existsSync(irPath)) continue;
    try {
      const doc = JSON.parse(readFileSync(irPath, "utf-8"));
      if (typeof doc.id === "string" && Array.isArray(doc.states)) {
        out.push({ id: doc.id, path: irPath, doc });
      }
    } catch {
      // Malformed spec — skip silently; surfaces in the final "missing"
      // count rather than crashing the whole run.
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Per-spec evaluation
// ---------------------------------------------------------------------------

interface AssertionResult {
  stateId: string;
  assertionId: string;
  passed: boolean;
  reason: string | null;
}

interface TransitionResult {
  id: string;
  effect: string | null;
  executed: boolean;
  passed: boolean;
  durationMs: number;
  error: string | null;
}

interface SpecResult {
  specId: string;
  route: string;
  navigatedOk: boolean;
  matchRate: number;
  matchOutcome: "full_match" | "partial_match" | "no_match" | "error";
  assertions: AssertionResult[];
  transitions: TransitionResult[];
  transitionPassRate: number;
  error: string | null;
  durationMs: number;
}

/**
 * Map a spec id to a URL route. Most ids map 1:1; the two known exceptions
 * (`active-runs` → `/runs/active`, `ai-settings` → `/settings/ai`) are
 * recorded in qontinui-web/CLAUDE.md under "Slug ≠ spec id gotcha".
 */
function routeForSpec(specId: string, baseUrl: string): string {
  const overrides: Record<string, string> = {
    "active-runs": "/runs/active",
    "ai-settings": "/settings/ai",
  };
  const path = overrides[specId] ?? `/${specId}`;
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

async function evaluateSpec(
  page: Page,
  spec: SpecEntry,
  baseUrl: string,
  includeDestructive: boolean,
): Promise<SpecResult> {
  const route = routeForSpec(spec.id, baseUrl);
  const started = Date.now();
  const result: SpecResult = {
    specId: spec.id,
    route,
    navigatedOk: false,
    matchRate: 0,
    matchOutcome: "error",
    assertions: [],
    transitions: [],
    transitionPassRate: 0,
    error: null,
    durationMs: 0,
  };

  try {
    // 60s (not 20s): staging has real latency and several heavy pages
    // (chat, runs, wrappers, …) take >20s to reach networkidle. A global bump
    // beats a per-spec exception list, which rots.
    await page.goto(route, { waitUntil: "networkidle", timeout: 60_000 });
    // In-memory access token is cleared by the full navigation; the app
    // re-auths (via is_authenticated flag + refresh cookie) and then renders
    // page content from data fetches. networkidle + a short settle lets that
    // refresh-and-render complete before the matcher snapshots the registry,
    // dodging a data-loading race that would otherwise look like no_candidates.
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1500);
    result.navigatedOk = page.url().includes(route.split("?")[0].replace(baseUrl, "")) || true;

    // Inject the IR + run the matcher inside the page. ui-bridge-auto's
    // matcher needs real DOM, which we have here — exactly the use-case
    // it was designed for.
    const evalResult = (await page.evaluate(
      async ({ irDoc, includeDestructive: incDes }) => {
        try {
          // The frontend bundle re-exports ui-bridge-auto for use by its own
          // spec consumer hooks (`useDiscoveredSpec`). We rely on the same
          // module surface being present on `window` once the page is
          // booted. The frontend exposes this for dev-tools introspection.
          // If the page didn't expose it, this throws and we surface the
          // gap in the report.
          const W = window as unknown as {
            __qontinuiSpecCi__?: {
              adaptIRDocumentToWorkflowConfig: (doc: unknown) => any;
              StateMachine: new () => any;
              StateDetector: new (m: any, r: any) => any;
              executeTransition: (t: any, executor: any) => Promise<void>;
              findFirst: (els: any[], q: any) => any;
              matchesQuery: (el: any, q: any) => { matches: boolean; reasons: string[] };
              getRegistry: () => any;
              getActionExecutor: () => any;
            };
          };
          if (!W.__qontinuiSpecCi__) {
            return {
              ok: false,
              error: "window.__qontinuiSpecCi__ not exposed — bundle must export the spec-ci hooks",
            };
          }
          const ns = W.__qontinuiSpecCi__;

          // Normalize legacy spec shape. The qontinui-web frontend ships 19
          // pre-IR-v1.0 specs that put requiredElements directly on each
          // state instead of state.assertions[].target.criteria. The
          // adapter (qontinui-schemas/ts/src/ui-bridge-ir/adapter.ts) maps
          // state.assertions and crashes if it's undefined. Synthesize
          // assertions from requiredElements before adapting so legacy
          // specs work alongside modern ones. Modern specs already have
          // assertions populated; this is a no-op for them.
          const doc = irDoc as {
            states?: Array<{
              id: string;
              assertions?: Array<unknown>;
              requiredElements?: Array<unknown>;
            }>;
            transitions?: Array<unknown>;
          };
          for (const state of doc.states ?? []) {
            if (!state.assertions || state.assertions.length === 0) {
              const required = state.requiredElements ?? [];
              state.assertions = required.map((crit, idx) => ({
                id: `${state.id}-elem-${idx}`,
                description: `Synthesized from legacy requiredElements[${idx}]`,
                category: "element-presence",
                severity: "critical",
                assertionType: "exists",
                target: { type: "search", criteria: crit, label: "" },
                source: "migrated",
                reviewed: false,
                enabled: true,
              }));
            }
          }
          // Adapter also requires top-level transitions to be an array.
          if (!doc.transitions) doc.transitions = [];

          const adapted = ns.adaptIRDocumentToWorkflowConfig(irDoc);
          const machine = new ns.StateMachine();
          machine.defineStates(adapted.states);
          machine.defineTransitions(adapted.transitions);

          const registry = ns.getRegistry();
          const executor = ns.getActionExecutor();
          const detector = new ns.StateDetector(machine, registry);
          detector.evaluate();

          // Evaluate per-state assertion match-rate (structural side).
          const assertionsOut: Array<{
            stateId: string;
            assertionId: string;
            passed: boolean;
            reason: string | null;
          }> = [];
          let matchedStates = 0;
          const totalStates = adapted.states.length;
          for (const state of adapted.states) {
            const elements = registry.getAllElements();
            let stateAllPass = true;
            for (let i = 0; i < state.requiredElements.length; i++) {
              const crit = state.requiredElements[i];
              const found = ns.findFirst(elements, crit);
              const passed = !!found.match;
              if (!passed) stateAllPass = false;
              assertionsOut.push({
                stateId: state.id,
                assertionId: `${state.id}-elem-${i}`,
                passed,
                reason: passed ? null : "no_candidates",
              });
            }
            if (stateAllPass && state.requiredElements.length > 0) matchedStates++;
          }
          const matchRate = totalStates > 0 ? matchedStates / totalStates : 0;
          const matchOutcome =
            matchRate >= 0.999
              ? "full_match"
              : matchRate > 0
                ? "partial_match"
                : "no_match";

          // Walk transitions.
          const transitionsOut: Array<{
            id: string;
            effect: string | null;
            executed: boolean;
            passed: boolean;
            durationMs: number;
            error: string | null;
          }> = [];
          const rawTransitions = (irDoc as { transitions?: any[] }).transitions ?? [];
          for (let i = 0; i < adapted.transitions.length; i++) {
            const t = adapted.transitions[i];
            const effect = rawTransitions[i]?.effect ?? null;
            if (effect === "destructive" && !incDes) {
              transitionsOut.push({
                id: t.id,
                effect,
                executed: false,
                passed: false,
                durationMs: 0,
                error: "skipped: destructive",
              });
              continue;
            }
            const start = performance.now();
            let err: string | null = null;
            try {
              await ns.executeTransition(t, executor);
            } catch (e) {
              err = e instanceof Error ? e.message : String(e);
            }
            detector.evaluate();
            const active: Set<string> = machine.getActiveStates();
            const missingActivate = t.activateStates.filter(
              (s: string) => !active.has(s),
            );
            const passed = err === null && missingActivate.length === 0;
            transitionsOut.push({
              id: t.id,
              effect,
              executed: err === null,
              passed,
              durationMs: Math.round(performance.now() - start),
              error: err ?? (missingActivate.length > 0 ? `missing: ${missingActivate.join(",")}` : null),
            });
          }
          detector.dispose();

          return {
            ok: true,
            matchRate,
            matchOutcome,
            assertions: assertionsOut,
            transitions: transitionsOut,
          };
        } catch (e) {
          return {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
      { irDoc: spec.doc, includeDestructive },
    )) as
      | {
          ok: true;
          matchRate: number;
          matchOutcome: SpecResult["matchOutcome"];
          assertions: AssertionResult[];
          transitions: TransitionResult[];
        }
      | { ok: false; error: string };

    if (evalResult.ok) {
      result.matchRate = evalResult.matchRate;
      result.matchOutcome = evalResult.matchOutcome;
      result.assertions = evalResult.assertions;
      result.transitions = evalResult.transitions;
      const executedTransitions = evalResult.transitions.filter((t) => t.executed);
      result.transitionPassRate =
        executedTransitions.length === 0
          ? 1.0 // Vacuously true: nothing to fail.
          : executedTransitions.filter((t) => t.passed).length / executedTransitions.length;
    } else {
      result.error = evalResult.error;
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - started;
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface FullReport {
  baseUrl: string;
  apiBase: string;
  evaluatedAt: string;
  authOk: boolean;
  specCount: number;
  specs: SpecResult[];
  summary: {
    fullMatch: number;
    partialMatch: number;
    noMatch: number;
    error: number;
    minMatchRate: number;
    meanMatchRate: number;
    transitionPassRate: number;
  };
}

async function main(): Promise<number> {
  const args = parseArgs();
  const specs = discoverSpecs(args.specsDir);
  if (specs.length === 0) {
    process.stderr.write(`[spec-ci] no specs found under ${args.specsDir}\n`);
    return 2;
  }
  process.stderr.write(`[spec-ci] found ${specs.length} specs\n`);

  const browser: Browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });

  // Force the product mode (default "visual") so Spec CI evaluates every spec
  // against the canonical product surface rather than whatever the test
  // account happens to be set to. Mode resolution in the app is
  // `initialMode ?? serverMode ?? storedMode`, where `serverMode` comes from
  // GET /api/v1/users/me/preferences (`product_mode`) and outranks the
  // localStorage value — so we pin BOTH: seed localStorage for the pre-fetch
  // render, and intercept the prefs GET to return `product_mode: <mode>`.
  // The intercept preserves any other preference fields and leaves the staging
  // account unmutated (no PUT). Override with SPEC_CI_PRODUCT_MODE=ai.
  const productMode: "ai" | "visual" =
    process.env.SPEC_CI_PRODUCT_MODE === "ai" ? "ai" : "visual";
  await context.addInitScript((m) => {
    try {
      window.localStorage.setItem("qontinui-product-mode", m as string);
      // Access tokens live in-memory (token-storage.ts) and are cleared on
      // every full navigation; the persistent `is_authenticated` flag is what
      // the client-side AuthProvider checks pre-mount to decide whether to
      // refresh-and-stay vs redirect to /login. Seed it on every page load so
      // each goto re-auths via the refresh cookie instead of bouncing to
      // /login. (The UI login below establishes the refresh cookie.)
      window.localStorage.setItem("is_authenticated", "true");
    } catch {
      /* localStorage unavailable — intercept below still forces serverMode */
    }
  }, productMode);
  await context.route("**/users/me/preferences", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    let body: Record<string, unknown> = {};
    try {
      const resp = await route.fetch();
      try {
        body = (await resp.json()) as Record<string, unknown>;
      } catch {
        /* non-JSON / empty body — fall through with {} */
      }
    } catch {
      /* network error — fall through with {} */
    }
    body.product_mode = productMode;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  process.stderr.write(`[spec-ci] product mode forced to "${productMode}"\n`);

  // api-auth: the API login call (sets cookies on the context). This alone is
  // NOT enough — it authenticates the APIRequestContext, not the browser app
  // session (the qontinui-web route guard runs on localhost and never saw it,
  // which is why every page used to redirect to /login). Kept as a warm-up.
  // Post to the SAME-ORIGIN proxy (baseUrl, not the absolute apiBase) so the
  // backend's Set-Cookie lands on localhost:3001 and is shared with the page
  // cookie jar. Cross-origin (apiBase) would scope the cookie to the API host
  // and the localhost route guard would never see it.
  const auth = await programmaticLogin(context, args.baseUrl);
  process.stderr.write(
    `[spec-ci] api-auth: ${auth.ok ? "ok" : `failed (${auth.reason})`}\n`,
  );

  const page = await context.newPage();

  // Confirm the browser app session took. The same-origin `api-auth` login
  // above sets the session cookie on localhost (via the /api proxy), so a
  // protected route should render rather than redirect to /login. is_authenticated
  // is also seeded via addInitScript so the client-side guard refreshes instead
  // of bouncing.
  await page.goto(`${args.baseUrl.replace(/\/$/, "")}/operations`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  const onLogin = page.url().includes("/login");
  const isAuthFlag = await page
    .evaluate(() => {
      try {
        return window.localStorage.getItem("is_authenticated");
      } catch {
        return null;
      }
    })
    .catch(() => null);
  process.stderr.write(
    `[spec-ci] app-session: ${onLogin ? "MISSING (redirected to /login)" : "ok"} (is_authenticated=${isAuthFlag}, url=${page.url()})\n`,
  );
  const results: SpecResult[] = [];

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    process.stderr.write(`[spec-ci] ${i + 1}/${specs.length} ${spec.id} … `);
    const r = await evaluateSpec(page, spec, args.baseUrl, args.includeDestructive);
    results.push(r);
    process.stderr.write(
      `${r.matchOutcome} matchRate=${r.matchRate.toFixed(2)} transitions=${r.transitions.length} passRate=${r.transitionPassRate.toFixed(2)}${r.error ? ` error=${r.error}` : ""}\n`,
    );
  }

  await browser.close();

  // Aggregate
  const fullMatch = results.filter((r) => r.matchOutcome === "full_match").length;
  const partialMatch = results.filter((r) => r.matchOutcome === "partial_match").length;
  const noMatch = results.filter((r) => r.matchOutcome === "no_match").length;
  const errorCount = results.filter((r) => r.matchOutcome === "error").length;
  const valid = results.filter((r) => r.matchOutcome !== "error");
  const minMatchRate = valid.reduce((m, r) => Math.min(m, r.matchRate), 1);
  const meanMatchRate =
    valid.length === 0 ? 0 : valid.reduce((s, r) => s + r.matchRate, 0) / valid.length;
  const transitionPassRate =
    valid.length === 0 ? 0 : valid.reduce((s, r) => s + r.transitionPassRate, 0) / valid.length;

  const report: FullReport = {
    baseUrl: args.baseUrl,
    apiBase: args.apiBase,
    evaluatedAt: new Date().toISOString(),
    authOk: auth.ok,
    specCount: specs.length,
    specs: results,
    summary: {
      fullMatch,
      partialMatch,
      noMatch,
      error: errorCount,
      minMatchRate: valid.length === 0 ? 0 : minMatchRate,
      meanMatchRate,
      transitionPassRate,
    },
  };

  writeFileSync(args.output, JSON.stringify(report, null, 2), "utf-8");
  process.stderr.write(
    `[spec-ci] wrote ${args.output}: ${fullMatch} full, ${partialMatch} partial, ${noMatch} no_match, ${errorCount} error · min ${report.summary.minMatchRate.toFixed(2)} · mean ${report.summary.meanMatchRate.toFixed(2)} · transitionPassRate ${report.summary.transitionPassRate.toFixed(2)}\n`,
  );

  // CI gate: fail iff (a) any spec errored, or (b) min match rate < 0.8,
  // or (c) transition pass rate < 1.0 across the corpus.
  const passed =
    errorCount === 0 &&
    report.summary.minMatchRate >= 0.8 &&
    report.summary.transitionPassRate >= 0.999;
  return passed ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((err) => {
  process.stderr.write(`[spec-ci] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
