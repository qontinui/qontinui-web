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
 *     [--include-write]        # run reversible effect:"write" transitions
 *     [--include-destructive]  # run irreversible effect:"destructive" (nightly)
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
  includeWrite: boolean;
  specsDir: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Partial<Args> = {
    includeDestructive: false,
    includeWrite: false,
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
      case "--include-write": args.includeWrite = true; break;
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
// Fixture project seed (Unlock 1)
//
// `<RequireProject>`-gated pages (marketplace, automation-builder, ~40 others)
// render an empty "No projects yet" gate unless the ci-bot account owns at
// least one project AND a project is selected. ci-bot's staging account is
// intentionally empty, so we seed a fixed, EMPTY fixture project once per run.
//
// This mirrors the proven idempotent get-or-create shape from
// `backend/tests/utils/seed_test_project.py` (fixed name, empty configuration),
// but goes through the staging API as ci-bot (via the same-origin proxy, like
// `programmaticLogin`) — Spec CI can't touch the DB. The selection half of the
// gate is satisfied per-spec via the `?project=<id>` URL param (see
// `routeForSpec` + `GATED_SPECS`), not via provider hydration.
//
// Robust by design: a failure here never aborts the run — it logs and returns
// null, and the gated specs simply fall back to their empty-state assertions.
// ---------------------------------------------------------------------------

const FIXTURE_PROJECT_NAME = "spec-ci-fixture";

async function seedFixtureProject(
  context: BrowserContext,
  apiBase: string,
): Promise<{ id: string | null; reason: string }> {
  const base = apiBase.replace(/\/$/, "");
  try {
    // Get-or-create on a stable name. List first so re-runs are idempotent and
    // don't accumulate duplicate fixture projects on the shared account.
    const listResp = await context.request.get(`${base}/api/v1/projects`);
    if (listResp.ok()) {
      const projects = (await listResp.json()) as Array<{ id?: string; name?: string }>;
      if (Array.isArray(projects)) {
        const existing = projects.find((p) => p?.name === FIXTURE_PROJECT_NAME);
        if (existing?.id) {
          return { id: existing.id, reason: "reused" };
        }
      }
    } else {
      process.stderr.write(
        `[spec-ci] seed: list http_${listResp.status()} (continuing to create)\n`,
      );
    }

    // Only `name` is required; `configuration` defaults to {} server-side.
    // Keep the project EMPTY — it's the correct start-state for gated pages.
    const createResp = await context.request.post(`${base}/api/v1/projects`, {
      headers: { "Content-Type": "application/json" },
      data: { name: FIXTURE_PROJECT_NAME },
    });
    if (!createResp.ok()) {
      return { id: null, reason: `create_http_${createResp.status()}` };
    }
    const created = (await createResp.json()) as { id?: string };
    if (created?.id) return { id: created.id, reason: "created" };
    return { id: null, reason: "create_no_id" };
  } catch (e) {
    return { id: null, reason: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Idempotent pre-run baseline reset (Unlock 2)
//
// ci-bot is a SHARED staging account, so write transitions (settings toggle,
// create/delete workflow) could in principle leave residue if a run crashes
// mid-spec before its in-spec revert runs. The pre-run reset restores ci-bot's
// mutable surface to a known baseline at the START of every run so a
// crashed/aborted prior run self-heals and never dirties this run — we do NOT
// rely solely on per-spec teardown (the directive's safety net #1).
//
// What it resets:
//   (a) The fixture project's `configuration` -> {} via `PUT /projects/<id>`,
//       which deletes ANY leftover workflows (the create/delete-workflow write
//       persists workflows into the fixture project's configuration via the
//       automation-builder auto-save). Resetting to {} matches every leftover
//       fixture-created workflow at once and is the empty start-state the
//       create-workflow spec expects.
//   (b) The settings-toggle preference touched by the settings-write spec is a
//       CLIENT-only switch (the page's "Save" button — which is the only thing
//       that persists it — is never clicked by the write spec; the spec just
//       flips and reverts the in-DOM Radix switch). So there is no server-side
//       value to reset for it: it reloads to its default on every page load.
//       Documented here so the safety posture is explicit; nothing to do.
//
// Robust by design: every step is wrapped + non-fatal. A reset failure logs and
// continues — it must never abort the run (the in-spec reverts + in-DOM
// assertions are the primary determinism mechanism; this is the backstop).
// ---------------------------------------------------------------------------

async function baselineReset(
  context: BrowserContext,
  apiBase: string,
  fixtureProjectId: string | null,
): Promise<{ ok: boolean; detail: string }> {
  if (!fixtureProjectId) return { ok: true, detail: "no fixture project — nothing to reset" };
  const base = apiBase.replace(/\/$/, "");
  try {
    // PUT configuration:{} clears any leftover workflows created by a prior
    // (possibly crashed) run's create-workflow write. Idempotent: a project
    // that is already empty stays empty.
    const resp = await context.request.put(`${base}/api/v1/projects/${fixtureProjectId}`, {
      headers: { "Content-Type": "application/json" },
      data: { configuration: {} },
    });
    if (!resp.ok()) {
      return { ok: false, detail: `config-reset http_${resp.status()}` };
    }
    return { ok: true, detail: "config reset to {}" };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Spec discovery
// ---------------------------------------------------------------------------

interface SpecEntry {
  id: string;
  path: string;
  doc: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Unauthenticated lane tagging (Unlock 3)
//
// Auth flows (login, invalid-creds, password-reset) must start
// UNauthenticated — impossible in the shared pre-authed context. We tag those
// specs with `metadata.requiresUnauthenticated: true` and route them through a
// dedicated `browser.newContext()` that runs NO `programmaticLogin` and seeds
// NO `is_authenticated` flag, so pages render the `/login` screen. The tag is a
// spec-metadata flag (not a path rule) so it travels with the spec and is
// trivially auditable in the JSON. Everything else stays on the pre-authed
// context — the lane is purely additive and cannot regress the 37 authed specs.
// ---------------------------------------------------------------------------

function requiresUnauthenticated(doc: Record<string, unknown>): boolean {
  const meta = (doc as { metadata?: { requiresUnauthenticated?: unknown } }).metadata;
  return meta?.requiresUnauthenticated === true;
}

// ---------------------------------------------------------------------------
// Per-spec extra settle (smoke-parity / demo-detail)
//
// A few pages resolve their stable, assertable content only AFTER a data fetch
// that the default fixed settle (2500ms below) is too short for. The clearest
// case is /demo/[id] for a non-existent project: react-query retries the 404
// fetch 3x with exponential backoff (~1s+2s+4s) before settling to the
// Not-Found render, so the matcher would otherwise snapshot the transient
// "Loading project..." flash. A spec opts into a longer settle via
// `metadata.extraSettleMs` (added to the fixed 2500ms). The flag travels with
// the spec (trivially auditable in the JSON) and is purely additive — specs
// without it are unchanged. Clamped so a typo can't hang the run.
// ---------------------------------------------------------------------------

const MAX_EXTRA_SETTLE_MS = 15_000;

function extraSettleMs(doc: Record<string, unknown>): number {
  const meta = (doc as { metadata?: { extraSettleMs?: unknown } }).metadata;
  const raw = meta?.extraSettleMs;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(raw, MAX_EXTRA_SETTLE_MS);
}

// ---------------------------------------------------------------------------
// Secret substitution (Unlock 3)
//
// The login transition needs ci-bot's password, which must NEVER live in a
// committed spec JSON. Specs reference it as the literal placeholder
// `{{SPEC_CI_AUTH_PASSWORD}}` in a transition action param; just before the
// in-browser executor runs, we deep-clone the spec doc and replace any such
// placeholder with `process.env.QONTINUI_TEST_AUTO_LOGIN_PASSWORD` (the value
// the GHA workflow injects from the `SPEC_CI_AUTH_PASSWORD` secret). Only the
// throwaway clone passed to `page.evaluate` carries the secret — the report
// and `spec.doc` keep the placeholder. The substituted value is NEVER logged.
//
// The mapping is a fixed allow-list so an arbitrary `{{...}}` can't pull an
// unintended env var into the page.
// ---------------------------------------------------------------------------

const SECRET_PLACEHOLDERS: Record<string, () => string | undefined> = {
  "{{SPEC_CI_AUTH_PASSWORD}}": () => process.env.QONTINUI_TEST_AUTO_LOGIN_PASSWORD,
};

/**
 * Deep-clone `doc` and substitute any known `{{SECRET}}` placeholder found in a
 * string value (recursively). Returns a tuple of the substituted clone and
 * whether every referenced placeholder resolved to a non-empty value — the
 * caller surfaces an unresolved secret as a spec error rather than typing the
 * literal placeholder into the login form.
 */
function substituteSecrets(
  doc: Record<string, unknown>,
): { doc: Record<string, unknown>; ok: boolean; missing: string[] } {
  const missing = new Set<string>();
  const walk = (val: unknown): unknown => {
    if (typeof val === "string") {
      let out = val;
      for (const [placeholder, getter] of Object.entries(SECRET_PLACEHOLDERS)) {
        if (out.includes(placeholder)) {
          const secret = getter();
          if (!secret) {
            missing.add(placeholder);
            continue;
          }
          out = out.split(placeholder).join(secret);
        }
      }
      return out;
    }
    if (Array.isArray(val)) return val.map(walk);
    if (val && typeof val === "object") {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        obj[k] = walk(v);
      }
      return obj;
    }
    return val;
  };
  const cloned = walk(doc) as Record<string, unknown>;
  return { doc: cloned, ok: missing.size === 0, missing: [...missing] };
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
 * Spec ids whose pages are wrapped in `<RequireProject>` and so need the
 * fixture project SELECTED to render their real (non-empty-gate) content.
 * For these, `routeForSpec` appends `?project=<fixtureId>` — the verified
 * selection lever (`require-project.tsx:31-46`: `urlProjectId` satisfies the
 * "selected" half of the gate alongside the non-empty `useProjects()` list).
 */
const GATED_SPECS = new Set<string>([
  "marketplace",
  "automation-builder",
  // Unlock 2 create/delete-workflow write spec — needs the fixture project
  // selected so the builder renders (and so the new workflow auto-saves into a
  // real project). routeForSpec maps this id back to /automation-builder.
  "automation-builder-workflow-crud",
  // Smoke-parity: NavigationTestGenerator lives under the project-scoped
  // automation-builder surface; its smoke test (navigation-test-generator.spec
  // .ts:14) navigates with ?project=<id>. Threading the fixture project keeps
  // the page on its real (project-selected) render. routeForSpec maps this id
  // to /automation-builder/navigation-tests (slug != spec id).
  "navigation-test-generator",
]);

/**
 * localStorage key the automation store uses to persist the SELECTED project
 * (`stores/automation/slices/project-slice.ts:20,62-64`). It survives full
 * navigations on the same origin, so once one spec selects a project (e.g.
 * automation-builder's project-loader fires `setProjectId` when visited with
 * `?project=`), every LATER `<RequireProject>` spec hydrates that selection
 * and renders real content instead of its expected "No project selected"
 * gate. We clear this key before each spec navigation so every spec is
 * order-independent: gated specs without `?project=` deterministically show
 * the gate, and threaded specs (GATED_SPECS) select via the URL param —
 * which `require-project.tsx` reads independently of this key.
 */
const SELECTED_PROJECT_LS_KEY = "qontinui-selected-project-id";

/**
 * Map a spec id to a URL route. Most ids map 1:1; the two known exceptions
 * (`active-runs` → `/runs/active`, `ai-settings` → `/settings/ai`) are
 * recorded in qontinui-web/CLAUDE.md under "Slug ≠ spec id gotcha".
 *
 * For `<RequireProject>`-gated specs (see `GATED_SPECS`), when a seeded
 * fixture project id is available we append `?project=<id>` so the gate
 * clears deterministically on page load (no localStorage / provider race).
 */
function routeForSpec(
  specId: string,
  baseUrl: string,
  fixtureProjectId: string | null,
): string {
  const overrides: Record<string, string> = {
    "active-runs": "/runs/active",
    "ai-settings": "/settings/ai",
    // Unlock 2 write spec lives at /settings/general (slug != spec id).
    "settings-general": "/settings/general",
    // Unlock 2 create/delete-workflow write spec runs on /automation-builder
    // (with ?project=<fixture> appended because it is in GATED_SPECS).
    "automation-builder-workflow-crud": "/automation-builder",
    // Smoke-parity: NavigationTestGenerator route (slug != spec id). In
    // GATED_SPECS, so ?project=<fixture> is appended below.
    "navigation-test-generator": "/automation-builder/navigation-tests",
    // Smoke-parity: the demo detail page is a dynamic [id] route. We target a
    // fixed fake-but-valid-looking UUID (the same shape the smoke test uses,
    // demo.spec.ts:193) so the public API 404s and the page renders its
    // resolved Not-Found view. This is the harness's dynamic-route support:
    // the spec id `demo-detail` maps to a concrete /demo/<uuid> path here.
    "demo-detail": "/demo/a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  };
  const path = overrides[specId] ?? `/${specId}`;
  let url = `${baseUrl.replace(/\/$/, "")}${path}`;
  if (fixtureProjectId && GATED_SPECS.has(specId)) {
    url += `?project=${encodeURIComponent(fixtureProjectId)}`;
  }
  return url;
}

async function evaluateSpec(
  page: Page,
  spec: SpecEntry,
  baseUrl: string,
  includeDestructive: boolean,
  includeWrite: boolean,
  fixtureProjectId: string | null,
): Promise<SpecResult> {
  const route = routeForSpec(spec.id, baseUrl, fixtureProjectId);
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
    // Reset the persisted project SELECTION before navigating so each spec is
    // order-independent (see SELECTED_PROJECT_LS_KEY). Without this, a spec that
    // selects a project (automation-builder's loader on `?project=`) leaks the
    // selection via localStorage into every LATER <RequireProject> spec, which
    // then renders real content instead of its expected gate. Wrapped in a
    // try/catch because the page may not yet have a same-origin document on the
    // very first spec; the addInitScript + the goto below handle that case.
    await page
      .evaluate((key) => {
        try {
          window.localStorage.removeItem(key);
        } catch {
          /* localStorage unavailable — non-fatal */
        }
      }, SELECTED_PROJECT_LS_KEY)
      .catch(() => {
        /* no same-origin document yet — fine; cleared on next iteration */
      });

    // `domcontentloaded`, NOT `networkidle`: pages with a persistent
    // WebSocket / polling connection (runners, chat, …) NEVER reach networkidle,
    // so it would hang to the timeout and error the spec. domcontentloaded
    // fires reliably; a fixed settle then lets the in-memory-token re-auth
    // (is_authenticated flag + refresh cookie) and the data-driven content
    // render before the matcher snapshots the registry, dodging the load race.
    await page.goto(route, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2500 + extraSettleMs(spec.doc));
    result.navigatedOk = page.url().includes(route.split("?")[0].replace(baseUrl, "")) || true;

    // Substitute any `{{SECRET}}` placeholder (e.g. the login password) into a
    // throwaway clone of the spec doc just before it crosses into the page.
    // The original `spec.doc` (and so the report) keeps the placeholder, and
    // the substituted value is never written to a log. An unresolved secret is
    // a hard error — better than silently typing the literal placeholder.
    const subst = substituteSecrets(spec.doc);
    if (!subst.ok) {
      result.error = `unresolved secret(s): ${subst.missing.join(",")}`;
      result.durationMs = Date.now() - started;
      return result;
    }
    const injectedDoc = subst.doc;

    // Inject the IR + run the matcher inside the page. ui-bridge-auto's
    // matcher needs real DOM, which we have here — exactly the use-case
    // it was designed for.
    const evalResult = (await page.evaluate(
      async ({ irDoc, includeDestructive: incDes, includeWrite: incWrite }) => {
        try {
          // The frontend bundle re-exports ui-bridge-auto for use by its own
          // spec consumer hooks (`useDiscoveredSpec`). We rely on the same
          // module surface being present on `window` once the page is
          // booted. The frontend exposes this for dev-tools introspection.
          // If the page didn't expose it, this throws and we surface the
          // gap in the report.
          /* eslint-disable @typescript-eslint/no-explicit-any -- injected dev-only
             surface; the ui-bridge-auto runtime shapes are intentionally untyped
             here (this code runs inside page.evaluate, away from the bundle types). */
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
          /* eslint-enable @typescript-eslint/no-explicit-any */
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw IR shape
          const rawTransitions = (irDoc as { transitions?: any[] }).transitions ?? [];
          for (let i = 0; i < adapted.transitions.length; i++) {
            const t = adapted.transitions[i];
            const effect = rawTransitions[i]?.effect ?? null;
            // Gating (Unlock 2): `destructive` (irreversible) is gated by
            // --include-destructive; `write` (reversible, self-reverting) is
            // gated by --include-write. Both default OFF so a local run never
            // mutates the shared ci-bot account by accident; the on-PR
            // spec-ci.yml turns --include-write ON (writes are the gate's
            // point) and keeps --include-destructive OFF (nightly-only).
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
            if (effect === "write" && !incWrite) {
              transitionsOut.push({
                id: t.id,
                effect,
                executed: false,
                passed: false,
                durationMs: 0,
                error: "skipped: write",
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
      { irDoc: injectedDoc, includeDestructive, includeWrite },
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
  // Product-mode seed only — NO `is_authenticated` here (that is seeded
  // separately on the authed context below). Sharing this init lets us reuse
  // the same product-mode pin on the unauth lane without authenticating it.
  const productModeInit = (m: unknown) => {
    try {
      window.localStorage.setItem("qontinui-product-mode", m as string);
    } catch {
      /* localStorage unavailable — prefs intercept below still forces serverMode */
    }
  };
  const prefsIntercept = async (route: import("@playwright/test").Route) => {
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
  };
  await context.addInitScript(productModeInit, productMode);
  // Access tokens live in-memory (token-storage.ts) and are cleared on every
  // full navigation; the persistent `is_authenticated` flag is what the
  // client-side AuthProvider checks pre-mount to decide whether to
  // refresh-and-stay vs redirect to /login. Seed it on the AUTHED context only
  // so each goto re-auths via the refresh cookie instead of bouncing to /login.
  // (The UI login below establishes the refresh cookie.) The unauth lane
  // deliberately omits this so its pages render the /login screen.
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("is_authenticated", "true");
    } catch {
      /* localStorage unavailable */
    }
  });
  await context.route("**/users/me/preferences", prefsIntercept);
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

  // Seed the fixture project (Unlock 1) so `<RequireProject>`-gated pages
  // render their real content. Idempotent + non-fatal: if it fails, gated
  // specs fall back to their empty-state assertions (fixtureProjectId stays
  // null, so `routeForSpec` omits the `?project=` param). Use the same-origin
  // proxy (baseUrl) the auth login used, so the session cookie applies.
  const seed = await seedFixtureProject(context, args.baseUrl);
  const fixtureProjectId = seed.id;
  process.stderr.write(
    `[spec-ci] fixture-project: ${fixtureProjectId ? `${seed.reason} (id=${fixtureProjectId})` : `unavailable (${seed.reason})`}\n`,
  );

  // Idempotent pre-run baseline reset (Unlock 2): restore ci-bot's mutable
  // surface to a known clean baseline BEFORE any write spec runs, so a
  // crashed/aborted prior run self-heals and never dirties this run. Only
  // meaningful when write specs run (--include-write); harmless otherwise.
  if (args.includeWrite) {
    const reset = await baselineReset(context, args.baseUrl, fixtureProjectId);
    process.stderr.write(
      `[spec-ci] baseline-reset: ${reset.ok ? "ok" : "WARN"} (${reset.detail})\n`,
    );
  }

  const page = await context.newPage();

  // Confirm the browser app session took. The same-origin `api-auth` login
  // above sets the session cookie on localhost (via the /api proxy), so a
  // protected route should render rather than redirect to /login. is_authenticated
  // is also seeded via addInitScript so the client-side guard refreshes instead
  // of bouncing.
  await page.goto(`${args.baseUrl.replace(/\/$/, "")}/operations`, {
    waitUntil: "domcontentloaded",
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

  // Unauth lane (Unlock 3): specs tagged `metadata.requiresUnauthenticated`
  // run in a SEPARATE context that never logged in and never seeded
  // `is_authenticated`, so their pages render the /login screen. Each such
  // spec gets a FRESH context+page so a login transition that establishes a
  // session in one auth spec can't leak into the next (full isolation). The
  // product-mode pin is reused (it doesn't authenticate); the auth seed +
  // programmaticLogin are deliberately omitted. Non-auth specs stay on the
  // shared pre-authed `page` — the lane is purely additive.
  const runUnauthSpec = async (spec: SpecEntry): Promise<SpecResult> => {
    const unauthContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });
    await unauthContext.addInitScript(productModeInit, productMode);
    await unauthContext.route("**/users/me/preferences", prefsIntercept);
    const unauthPage = await unauthContext.newPage();
    try {
      return await evaluateSpec(
        unauthPage,
        spec,
        args.baseUrl,
        args.includeDestructive,
        args.includeWrite,
        // Auth pages aren't <RequireProject>-gated; no fixture selection needed.
        null,
      );
    } finally {
      await unauthContext.close();
    }
  };

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const unauth = requiresUnauthenticated(spec.doc);
    process.stderr.write(
      `[spec-ci] ${i + 1}/${specs.length} ${spec.id}${unauth ? " [unauth]" : ""} … `,
    );
    const r = unauth
      ? await runUnauthSpec(spec)
      : await evaluateSpec(page, spec, args.baseUrl, args.includeDestructive, args.includeWrite, fixtureProjectId);
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
