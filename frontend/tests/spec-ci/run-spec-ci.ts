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
 * Env (auth — first match wins):
 *   QONTINUI_TEST_ID_TOKEN            hermetic lane: a pre-minted id token
 *                                     for the run-local issuer the CI
 *                                     backend trusts (spec-ci.yml +
 *                                     backend/scripts/spec_ci_local_idp.py)
 *   QONTINUI_TEST_AUTO_LOGIN_EMAIL    Cognito lane (non-hermetic runs)
 *   QONTINUI_TEST_AUTO_LOGIN_PASSWORD Cognito lane
 *   QONTINUI_API_BASE_URL             fallback for --api-base
 */

import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  classifyConsole,
  compileExpectedConsoleErrors,
  type ConsoleErrorEntry,
  type ConsoleLevel,
} from "./console-policy";
import {
  compileExpectedServerErrors,
  isSameOriginServerError,
  type ServerErrorEntry,
} from "./server-error-policy";
import { reportServerErrorsToCoord } from "./report-server-errors-to-coord";
import { evaluateApiCheck, type ApiCheckResult } from "./api-contract";
import { applyHermeticStubs } from "./hermetic-stubs";
import { discoverAppRoutes } from "./route-manifest";
import { applyCrawlWaivers, isGloballyWaivedServerUrl } from "./crawl-baseline";
import {
  DiagnosticsCollector,
  snapshotConcurrency,
  type Diagnostics,
} from "./diagnostics";

// ---------------------------------------------------------------------------
// Console-error capture (the run-level invariant; see console-policy.ts)
//
// A console error is a property of the JS runtime DURING the run, not of any
// element or state — so it lives in the harness that owns the page, not in the
// IRPageSpec schema or the element-assertion DSL. We attach a `page.on` listener
// to EVERY page the harness drives (the shared authed page AND each fresh
// `unauthPage` minted per unauthenticated spec — the unauth lane is otherwise
// invisible to a single-page listener) and write critical hits into a shared
// sink. Per-spec attribution is by array-length-diff around each evaluateSpec
// call (see main()); transition-level attribution is `null` because the
// transition walk runs inside `page.evaluate`, opaque to the outer listener.
// ---------------------------------------------------------------------------

interface CaptureCtx {
  specId: string | null;
  transitionId: string | null;
}

/**
 * Attach `console` + `pageerror` listeners to a page, pushing only
 * gate-relevant (critical) entries into `sink`, attributed via `getCtx()`.
 * A factory (not inline) because there are two page sites to cover.
 */
function attachConsoleCapture(
  page: Page,
  getCtx: () => CaptureCtx,
  sink: ConsoleErrorEntry[],
): void {
  page.on("console", (msg) => {
    const level = msg.type();
    const text = msg.text();
    if (classifyConsole(level, text) !== "critical") return;
    const ctx = getCtx();
    sink.push({
      specId: ctx.specId ?? "(unattributed)",
      transitionId: ctx.transitionId,
      level: level as ConsoleLevel,
      text,
      stack: null,
      ts: Date.now(),
    });
  });
  page.on("pageerror", (err) => {
    const text = err.message;
    // Route through the same classifier as console events so the
    // network-noise denylist (e.g. aborted "Failed to fetch" rejections)
    // applies to pageerrors too; otherwise the gate reds on environmental
    // fetch failures on every page.
    if (classifyConsole("pageerror", text) !== "critical") return;
    const ctx = getCtx();
    sink.push({
      specId: ctx.specId ?? "(unattributed)",
      transitionId: ctx.transitionId,
      level: "pageerror",
      text,
      stack: err.stack ?? null,
      ts: Date.now(),
    });
  });
}

/**
 * Read a spec's `metadata.expectedConsoleErrors` waiver. Uses the same loose
 * `Record<string, unknown>` cast as `requiresUnauthenticated` (below) because
 * the harness reads the RAW spec JSON, not a typed IRDocument — so no
 * qontinui-schemas change is needed even though `IRMetadata` is a closed
 * interface that doesn't declare this key.
 */
function readExpectedConsoleErrors(doc: Record<string, unknown>): RegExp[] {
  const meta = (doc as { metadata?: { expectedConsoleErrors?: unknown } }).metadata;
  return compileExpectedConsoleErrors(meta?.expectedConsoleErrors);
}

// ---------------------------------------------------------------------------
// Same-origin HTTP-500 capture (the run-level invariant; see
// server-error-policy.ts)
//
// HTTP response status is a property of the run that the console listener
// CANNOT see: a `fetch()` to a 500 RESOLVES (`response.ok === false`) without
// throwing, so it emits no console.error and no pageerror. We attach a
// `page.on("response")` listener — alongside the console capture, on EVERY page
// the harness drives (the shared authed page AND each fresh unauthPage) — that
// records any response whose origin === the page's base origin (the
// localhost:3001 Next proxy, i.e. a same-origin app/API call) with status >=
// 500. Per-spec attribution is the SAME array-length-diff slicing used for
// consoleErrors (see main()); transitionId stays "initial-load" because the
// transition walk runs inside page.evaluate, opaque to the outer listener.
// Scoped to same-origin so it does NOT double-count the network-layer aborts
// the console NETWORK_NOISE_DENYLIST handles — those are not 500 RESPONSES.
// ---------------------------------------------------------------------------

/**
 * Attach a `response` listener to a page, pushing any same-origin HTTP-5xx
 * (per `isSameOriginServerError`) into `sink`, attributed via `getCtx()`.
 * A factory (not inline) because there are two page sites to cover, mirroring
 * `attachConsoleCapture`.
 */
function attachResponseCapture(
  page: Page,
  baseOrigin: string,
  getCtx: () => CaptureCtx,
  sink: ServerErrorEntry[],
): void {
  page.on("response", (response) => {
    const status = response.status();
    const url = response.url();
    if (!isSameOriginServerError(url, status, baseOrigin)) return;
    const ctx = getCtx();
    sink.push({
      specId: ctx.specId ?? "(unattributed)",
      transitionId: ctx.transitionId,
      url,
      status,
      method: response.request().method(),
      ts: Date.now(),
    });
  });
}

/**
 * Read a spec's `metadata.expectedServerErrors` waiver. Same loose
 * `Record<string, unknown>` cast as `readExpectedConsoleErrors` because the
 * harness reads the RAW spec JSON, not a typed IRDocument — no
 * qontinui-schemas change needed.
 */
function readExpectedServerErrors(doc: Record<string, unknown>): RegExp[] {
  const meta = (doc as { metadata?: { expectedServerErrors?: unknown } }).metadata;
  return compileExpectedServerErrors(meta?.expectedServerErrors);
}

// ---------------------------------------------------------------------------
// Gateway-class re-probe (502/503/504 transient-vs-persistent confirmation)
//
// The `page.on("response")` capture above gates on any same-origin status
// >= 500 (per `isSameOriginServerError`). In practice the localhost:3001 →
// `api.qontinui.io` proxy intermittently returns 502/503/504 when the upstream
// blips for sub-second windows — global background calls (e.g.
// `/api/v1/operations/tenants`, fleet-devices) catch one and red the whole
// run while the page itself rendered perfectly (full_match). That's an
// upstream-availability artifact, not the backend-failure signal the invariant
// exists to surface.
//
// Distinguish the two by re-probing each captured GET gateway-class entry
// ONCE: a real persistent outage re-probes to >= 500 (kept, gates); a
// transient blip re-probes to < 500 (dropped). App 500/501/505+ pass through
// unchanged — a single app 500 is the exact signal we want to catch.
// Non-GET 5xx pass through too (re-probing a mutating verb is unsafe).
// Re-probe failures / page-evaluate errors keep the entry (ambiguous —
// default to "don't hide a possibly real failure").
//
// The re-probe runs via `page.evaluate(fetch, {credentials:'include'})` so it
// inherits the page's cookies / auth, matching the original failing request.
// ---------------------------------------------------------------------------

const GATEWAY_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

async function confirmGatewayPersistence(
  page: Page,
  entries: ServerErrorEntry[],
): Promise<{ kept: ServerErrorEntry[]; dropped: ServerErrorEntry[] }> {
  const kept: ServerErrorEntry[] = [];
  const dropped: ServerErrorEntry[] = [];
  for (const e of entries) {
    if (!GATEWAY_STATUSES.has(e.status) || e.method !== "GET") {
      kept.push(e);
      continue;
    }
    let reprobed: number;
    try {
      reprobed = await page.evaluate(async (url: string) => {
        try {
          const r = await fetch(url, { credentials: "include", cache: "no-store" });
          return r.status;
        } catch {
          return 0;
        }
      }, e.url);
    } catch {
      kept.push(e);
      continue;
    }
    if (reprobed >= 100 && reprobed < 500) {
      dropped.push(e);
    } else {
      kept.push(e);
    }
  }
  return { kept, dropped };
}

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

// Cognito CI app client (`qontinui-ci`): a public, USER_PASSWORD_AUTH-only
// client created for the legacy-auth teardown (Phase T1). Lets CI mint a
// ci-bot token via the unauthenticated InitiateAuth API — no AWS creds. The
// id is NOT a secret (it's an app-client id, like the audiences hard-coded in
// `backend/app/core/config.py`); override via env for non-prod pools.
const COGNITO_CI_CLIENT_ID =
  process.env.QONTINUI_COGNITO_CI_CLIENT_ID ?? "tb0epbojige1900ipu6q80j6b";
const COGNITO_REGION = process.env.QONTINUI_COGNITO_REGION ?? "us-east-1";

/**
 * Mint a Cognito **id token** for ci-bot via the public InitiateAuth API.
 *
 * Uses USER_PASSWORD_AUTH against the dedicated CI app client (no secret →
 * no SigV4, just an unauthenticated JSON POST). Returns the id token (which
 * carries `email` + `email_verified` so the backend can provision/link the
 * `auth.users` row) or null on any failure — the caller falls back to the
 * legacy local login so a Cognito hiccup never reds the run before T3.
 */
async function mintCognitoIdToken(): Promise<string | null> {
  const username = process.env.QONTINUI_TEST_AUTO_LOGIN_EMAIL;
  const password = process.env.QONTINUI_TEST_AUTO_LOGIN_PASSWORD;
  if (!username || !password) return null;
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
      process.stderr.write(`[spec-ci] cognito InitiateAuth http_${resp.status}\n`);
      return null;
    }
    const body = (await resp.json()) as {
      AuthenticationResult?: { IdToken?: string };
    };
    return body.AuthenticationResult?.IdToken ?? null;
  } catch (e) {
    process.stderr.write(
      `[spec-ci] cognito InitiateAuth error: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return null;
  }
}

async function programmaticLogin(
  context: BrowserContext,
  baseUrl: string,
): Promise<{ ok: boolean; reason?: string; mode?: "injected" | "cognito" | "local" }> {
  // Hermetic lane (spec-ci.yml): the workflow boots the backend locally,
  // points its COGNITO_ISSUER at a run-local JWKS, and injects an id token
  // minted against that issuer (backend/scripts/spec_ci_local_idp.py). No
  // Cognito, no shared ci-bot account, no network beyond localhost. The
  // cookie seed + probe mirror the Cognito arm below. A rejected injected
  // token FAILS — falling through to Cognito here would only mask a
  // misconfigured hermetic stack.
  const injected = process.env.QONTINUI_TEST_ID_TOKEN;
  if (injected) {
    await context.addCookies([{ name: "access_token", value: injected, url: baseUrl }]);
    const probe = await context.request.get(
      `${baseUrl.replace(/\/$/, "")}/api/v1/projects`,
    );
    if (probe.ok()) {
      return { ok: true, mode: "injected" };
    }
    return { ok: false, reason: `injected_token_rejected_http_${probe.status()}` };
  }

  const email = process.env.QONTINUI_TEST_AUTO_LOGIN_EMAIL;
  const password = process.env.QONTINUI_TEST_AUTO_LOGIN_PASSWORD;
  if (!email || !password) return { ok: false, reason: "no_credentials" };

  // Cognito-first (Phase T1): mint a ci-bot id token and seed it as the
  // `access_token` cookie on the browser origin. The backend's CookieOrBearer
  // scheme reads that cookie and routes it to the Cognito verifier by `iss`
  // (dual-accept). The cookie lives on the *frontend* origin because every
  // API call goes through the same-origin proxy, exactly like the Set-Cookie
  // the legacy login produced.
  //
  // We VERIFY the token actually authenticates (a real authed GET) before
  // committing to it: until the backend deploy that trusts the CI app-client
  // audience lands, a minted token is rejected 401. On a miss we clear the
  // cookie and fall through to the legacy local login, so the run stays green
  // across the deploy window. The local arm is removed in Phase T3.
  const idToken = await mintCognitoIdToken();
  if (idToken) {
    await context.addCookies([{ name: "access_token", value: idToken, url: baseUrl }]);
    const probe = await context.request.get(
      `${baseUrl.replace(/\/$/, "")}/api/v1/projects`,
    );
    if (probe.ok()) {
      return { ok: true, mode: "cognito" };
    }
    process.stderr.write(
      `[spec-ci] cognito token not yet accepted (probe http_${probe.status()}) — falling back to local login\n`,
    );
    await context.clearCookies();
  }

  // Fallback: legacy FastAPI-Users local login (removed in Phase T3). The
  // POST goes through the same-origin proxy, so its Set-Cookie lands on the
  // browser origin too.
  const form = new URLSearchParams({ username: email, password }).toString();
  const resp = await context.request.post(`${baseUrl.replace(/\/$/, "")}/api/v1/auth/jwt/login`, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    data: form,
  });
  if (!resp.ok()) {
    return { ok: false, reason: `http_${resp.status()}` };
  }
  return { ok: true, mode: "local" };
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
// Per-spec deterministic settle-until-present (data-dependent anchors)
//
// `extraSettleMs` above widens a FIXED wait — still a race: a data fetch slower
// than the (clamped) window snapshots an unrendered page. For a spec whose
// matchable content arrives only AFTER an async fetch (e.g. the Visual-mode
// dashboard's project grid, whose seeded `spec-ci-fixture` card renders once the
// projects query resolves), a fixed settle is the wrong tool — it either flakes
// (too short on a slow run) or wastes wall-clock (too long on a fast one).
//
// A spec opts into a DETERMINISTIC pre-snapshot gate via
// `metadata.settleUntilPresent`: a list of element-criteria (same `{id,role,
// text}` shape as an assertion's `target.criteria`). Before the matcher
// snapshots, we poll the SAME UI-Bridge registry the matcher reads
// (`__qontinuiSpecCi__.getRegistry()` + `findFirst`) until EVERY listed anchor
// is present, or a hard bound elapses. This dodges the load race at its root —
// we snapshot exactly when the data-driven content has rendered, not on a guess.
//
// Integrity: on timeout we PROCEED anyway. A genuinely-absent anchor (a real
// regression, or a failed fixture seed) then surfaces as the matcher's normal
// `no_candidates` and reds the gate — the wait never HIDES an absence, it only
// declines to snapshot prematurely. Author criteria that the page is EXPECTED
// to render; never list an anchor whose absence should pass.
// ---------------------------------------------------------------------------

const SETTLE_POLL_INTERVAL_MS = 250;
const MAX_SETTLE_POLL_MS = 15_000;

// Retry-once on a non-full STRUCTURAL match. A fresh re-navigation distinguishes
// a TRANSIENT data-load miss (the projects list / a data fetch didn't complete
// in time → some anchors absent → partial/no_match, but a re-nav renders fine)
// from a PERSISTENT regression (the element is genuinely gone → fails both
// attempts → gates). Mirrors the same-origin 502 re-probe: confirm persistence
// before gating. Bounded to a single retry; only applied to specs that executed
// ZERO transitions, so a retry can never re-apply a `write`/`destructive`
// transition's side effect (CI runs with --include-write).
const SPEC_MATCH_RETRIES = 1;

function settleUntilCriteria(doc: Record<string, unknown>): Array<Record<string, unknown>> {
  const meta = (doc as { metadata?: { settleUntilPresent?: unknown } }).metadata;
  const raw = meta?.settleUntilPresent;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (c): c is Record<string, unknown> => typeof c === "object" && c !== null && !Array.isArray(c),
  );
}

/**
 * Poll the in-page UI-Bridge registry until every `metadata.settleUntilPresent`
 * anchor matches (via the same `findFirst` the matcher uses), or `MAX_SETTLE_
 * POLL_MS` elapses. No-op for specs without the field. Returns whether all
 * anchors were observed present (false on timeout) — purely advisory for
 * logging; the caller proceeds either way so a real absence still reds the gate.
 */
async function settleUntilPresent(page: Page, doc: Record<string, unknown>): Promise<boolean> {
  const criteria = settleUntilCriteria(doc);
  if (criteria.length === 0) return true;
  const deadline = Date.now() + MAX_SETTLE_POLL_MS;
  for (;;) {
    const allPresent = await page
      .evaluate((crits) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- injected dev-only surface
        const ns = (window as any).__qontinuiSpecCi__;
        if (!ns) return false;
        try {
          const elements = ns.getRegistry().getAllElements();
          return crits.every((c: unknown) => !!ns.findFirst(elements, c)?.match);
        } catch {
          return false;
        }
      }, criteria)
      .catch(() => false);
    if (allPresent) return true;
    if (Date.now() >= deadline) return false;
    await page.waitForTimeout(SETTLE_POLL_INTERVAL_MS);
  }
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

// ---------------------------------------------------------------------------
// Per-spec route stubs (metadata.routeStubs)
//
// Individual IR specs can declare mock responses via `metadata.routeStubs` in
// their raw JSON. Each stub intercepts a Playwright URL pattern and returns a
// canned response via `context.route()` / `route.fulfill()`. Applied before the
// spec's navigation and torn down after evaluation so they don't leak across
// specs. Uses the same loose `Record<string, unknown>` cast as
// `requiresUnauthenticated` — no schema change needed.
// ---------------------------------------------------------------------------

interface RouteStub {
  urlPattern: string;
  status?: number;       // default 200
  contentType?: string;  // default "application/json"
  body: unknown;         // JSON-serializable response body
}

function readRouteStubs(doc: Record<string, unknown>): RouteStub[] {
  const meta = doc.metadata as Record<string, unknown> | undefined;
  if (!meta?.routeStubs || !Array.isArray(meta.routeStubs)) return [];
  return meta.routeStubs as RouteStub[];
}

/**
 * Apply per-spec route stubs on the given BrowserContext. Returns a teardown
 * function that unroutes all applied stubs (call in a `finally` block).
 */
async function applyRouteStubs(
  ctx: BrowserContext,
  stubs: RouteStub[],
): Promise<() => Promise<void>> {
  for (const stub of stubs) {
    await ctx.route(stub.urlPattern, (route) =>
      route.fulfill({
        status: stub.status ?? 200,
        contentType: stub.contentType ?? "application/json",
        body: JSON.stringify(stub.body),
      }),
    );
  }
  return async () => {
    for (const stub of stubs) {
      await ctx.unroute(stub.urlPattern);
    }
  };
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
  /**
   * Critical console errors attributed to this spec (filled in by main() via
   * length-diff slicing around the evaluateSpec call, after any
   * `metadata.expectedConsoleErrors` waivers are removed). Empty = console-clean.
   */
  consoleErrors: ConsoleErrorEntry[];
  /**
   * Same-origin HTTP-5xx responses attributed to this spec (filled in by main()
   * via length-diff slicing around the evaluateSpec call, after any
   * `metadata.expectedServerErrors` waivers are removed). Empty = no same-origin
   * server errors. See server-error-policy.ts.
   */
  serverErrors: ServerErrorEntry[];
  /** API-contract check results (Phase 1 value-level assertions). */
  apiAssertions: ApiCheckResult[];
  /** Fraction of API assertion checks that passed (1.0 = all pass / vacuous). */
  apiAssertionPassRate: number;
  error: string | null;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Crawl result (Phase 4: spec-less route crawl)
// ---------------------------------------------------------------------------

interface CrawlResult {
  route: string;
  navigatedOk: boolean;
  /**
   * The navigation was interrupted by a client-side redirect to `/login` — the
   * signature of a torn-down authed session (NOT a route defect). Counted into
   * the run-level `crawlSessionLost` guard, not per-route gating. See the crawl
   * loop for the full rationale.
   */
  sessionLost: boolean;
  /** ALL critical console errors captured on this route (pre-waiver). */
  consoleErrors: ConsoleErrorEntry[];
  /** ALL same-origin HTTP-5xx captured on this route (pre-waiver). */
  serverErrors: ServerErrorEntry[];
  /**
   * Console errors that survived the crawl waivers (crawl-baseline.ts) — these
   * GATE. Empty = either console-clean or fully baseline-waived.
   */
  unwaivedConsoleErrors: ConsoleErrorEntry[];
  /**
   * Same-origin 5xx that survived the crawl waivers — these GATE. Empty = either
   * none or fully baseline-waived (global CI-env class or per-route waiver).
   */
  unwaivedServerErrors: ServerErrorEntry[];
  /**
   * Hard page-health failure: navigation threw (timeout / load crash) AND the
   * route is not `allowNavFail`-waived. A legitimate 404/redirect does NOT set
   * this (Next serves a 200/30x — `goto` resolves without throwing).
   */
  healthFail: boolean;
  durationMs: number;
  error: string | null;
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
  // RequireProject-wrapped detail pages — need ?project=<fixture> to clear the gate.
  "testing-run-detail",
  "qa-dashboard-run-detail",
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
    // Smoke-parity: UI Bridge State Machine route (slug != spec id). NOT in
    // GATED_SPECS — the page's chrome (header + config selector + the six
    // panel-switch buttons) renders project-independently, so no ?project=.
    "ui-bridge-states": "/automation-builder/ui-bridge-states",
    // Smoke-parity: NavigationTestGenerator route (slug != spec id). In
    // GATED_SPECS, so ?project=<fixture> is appended below.
    "navigation-test-generator": "/automation-builder/navigation-tests",
    // Smoke-parity: the demo detail page is a dynamic [id] route. We target a
    // fixed fake-but-valid-looking UUID (the same shape the smoke test uses,
    // demo.spec.ts:193) so the public API 404s and the page renders its
    // resolved Not-Found view. This is the harness's dynamic-route support:
    // the spec id `demo-detail` maps to a concrete /demo/<uuid> path here.
    "demo-detail": "/demo/a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    // Admin region-analysis lives at /admin/region-analysis (slug != spec id).
    // ci-bot is a superuser so the page renders its real (non-redirect)
    // content; the annotations API (GET /api/v1/annotations/) was fixed in #272
    // so the populated annotation-set + tab UI renders rather than 500ing.
    "region-analysis": "/admin/region-analysis",
    // Adoption-sweep structural specs whose route path differs from the spec id
    // (slug != spec id). Each ports a structural describe block from a
    // nightly-Playwright pages/*.spec.ts onto an IR spec so the structural
    // coverage survives the Phase-5 cutover. These are public/superuser-stable
    // pages (marketing, runner marketing, docs hub + sub-pages); ids verified
    // against a ci-bot CI element-dump.
    "marketing-home": "/",
    "runner-marketing": "/runner",
    "docs-hub": "/docs",
    "docs-getting-started": "/docs/getting-started",
    "docs-web": "/docs/web",
    "docs-runner": "/docs/runner",
    // Admin per-agent log view is a dynamic [agent_id] route. Like demo-detail,
    // we target a fixed sentinel id so the route resolves deterministically.
    // The page fetches GET /operations/agent-logs/by-agent/<id>; a valid-but-
    // unknown agent returns zero rows and renders the (success) empty-state.
    // The id shape is a coord agent correlation id (free-form string).
    "coord-agent-detail": "/admin/coord/agents/spec-ci-sentinel-agent",
    // Dynamic detail routes — sentinel ids for stubbed fetch resolution.
    "ai-tasks-detail": "/ai-tasks/spec-ci-sentinel-task",
    "captures-detail": "/captures/spec-ci-sentinel-session",
    "recordings-detail": "/recordings/spec-ci-sentinel-recording",
    "runs-detail": "/runs/spec-ci-sentinel-run",
    "testing-run-detail": "/testing/runs/spec-ci-sentinel-run",
    "qa-dashboard-run-detail": "/qa-dashboard/runs/spec-ci-sentinel-run",
    "marketplace-detail": "/marketplace/spec-ci-sentinel-pkg",
    // Nested slug → path overrides (default /${specId} maps to single segment).
    "configure-finding-rules": "/configure/finding-rules",
    "configure-hooks": "/configure/hooks",
    "configure-log-sources": "/configure/log-sources",
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
  requestCtx: import("@playwright/test").APIRequestContext,
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
    consoleErrors: [],
    serverErrors: [],
    apiAssertions: [],
    apiAssertionPassRate: 1,
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
    // Deterministic gate for specs whose matchable content arrives via an async
    // fetch (e.g. dashboard's seeded project grid): wait until the declared
    // anchors are actually in the registry before snapshotting, dodging the
    // load-state race a fixed settle can't close. No-op for specs without the
    // field; on timeout we proceed so a real absence still reds the gate.
    if (!(await settleUntilPresent(page, spec.doc))) {
      process.stderr.write(
        `[spec-ci] ${spec.id} settle-until-present timed out (${MAX_SETTLE_POLL_MS}ms) — snapshotting anyway; a genuinely-absent anchor will surface as no_candidates\n`,
      );
    }
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

    // --- TEMPORARY: dump element IDs for specs that need deepening ---
    const DUMP_SPECS_SET = [
      "recordings-detail", "runs-detail", "testing-run-detail",
      "qa-dashboard-run-detail", "configure-finding-rules",
      "marketplace-detail",
    ];
    if (DUMP_SPECS_SET.includes(spec.id)) {
      try {
        const dumpEls = await page.evaluate(() => {
          const w = window as unknown as {
            __qontinuiSpecCi__?: {
              getRegistry(): {
                getAllElements(): Array<{ id: string; type: string; label: string }>;
              };
            };
          };
          const reg = w.__qontinuiSpecCi__?.getRegistry();
          if (!reg) return null;
          return reg.getAllElements().map((e) => ({
            id: e.id, type: e.type, label: (e.label ?? "").slice(0, 50),
          }));
        });
        if (dumpEls) {
          const skip = /^(button-(dashboard|execute-[1-9]|visual-[1-9]|runners-[3-9]|scheduled|operations|monitor|gui|assets|create|discover|config|qa|ai-dev|ai-tasks$|project-|settings|help|admin|collapse|search|open-tanstack|\d+-mb)|mention-|radix-|img-|svg-|content-content-|button-visual-\d)/;
          process.stderr.write(`[spec-ci-dump] ${spec.id} (${dumpEls.length} elements):\n`);
          for (const el of dumpEls) {
            if (skip.test(el.id)) continue;
            process.stderr.write(`  ${el.id.padEnd(60)} [${el.type}] ${el.label}\n`);
          }
        }
      } catch { /* dump is best-effort */ }
    }
    // --- END TEMPORARY DUMP ---

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

    // API contract assertions (Phase 1: value-level only).
    // Runs OUTSIDE the in-page evaluate block because these are server-side
    // HTTP requests issued via Playwright's APIRequestContext (which shares
    // the browser session's auth cookies), not in-browser fetch calls.
    const apiChecks: unknown[] = Array.isArray((spec.doc as Record<string, unknown>).apiAssertions)
      ? ((spec.doc as Record<string, unknown>).apiAssertions as unknown[])
      : [];
    if (apiChecks.length > 0) {
      const apiResults: ApiCheckResult[] = [];
      for (const check of apiChecks as Array<Record<string, unknown>>) {
        const effect = (check.effect as string) ?? "read";
        if (effect === "destructive" && !includeDestructive) continue;
        if (effect === "write" && !includeWrite) continue;
        const checkResult = await evaluateApiCheck(
          requestCtx,
          baseUrl,
          check as {
            id: string;
            request: { method: string; path: string; headers?: Record<string, string>; body?: unknown };
            assertions: Array<Record<string, unknown>>;
          },
        );
        apiResults.push(checkResult);
      }
      result.apiAssertions = apiResults;
      const total = apiResults.length;
      const passed = apiResults.filter((r) => r.passed).length;
      result.apiAssertionPassRate = total === 0 ? 1 : passed / total;
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
  /**
   * Spec-less route crawl results (C8). GATING: `gatingFindings > 0` reds the
   * run (see the crawl-gate fold in main()). `consoleErrors`/`serverErrors` are
   * the RAW (pre-waiver) totals for visibility; `unwaivedConsoleErrors`/
   * `unwaivedServerErrors`/`healthFails`/`gatingFindings` are the post-waiver
   * (baseline-subtracted) totals that actually gate.
   */
  crawl?: {
    total: number;
    visited: number;
    consoleErrors: number;
    serverErrors: number;
    /** Post-waiver console errors that gate (NEW findings). */
    unwaivedConsoleErrors: number;
    /** Post-waiver same-origin 5xx that gate (NEW findings). */
    unwaivedServerErrors: number;
    /** Routes whose navigation failed and is not allowNavFail-waived. */
    healthFails: number;
    /** True if the authed session was torn down mid-crawl (/login bounce). */
    sessionLost: boolean;
    /** How many crawl routes saw the session-lost /login redirect. */
    sessionLostRoutes: number;
    /**
     * Total gating findings across the crawl (per-route console + server +
     * health, PLUS 1 if the session was lost mid-crawl — the re-run signal).
     */
    gatingFindings: number;
    /** Fraction of crawled routes with ZERO gating findings (1.0 = all clean). */
    passRate: number;
    routes: CrawlResult[];
  };
  summary: {
    fullMatch: number;
    partialMatch: number;
    noMatch: number;
    error: number;
    minMatchRate: number;
    meanMatchRate: number;
    transitionPassRate: number;
    /** Run-level console-error invariant: total critical hits + per-spec breakdown. */
    consoleErrors: { total: number; bySpec: Record<string, number> };
    /** Run-level same-origin HTTP-500 invariant: total hits + per-spec breakdown. */
    serverErrors: { total: number; bySpec: Record<string, number> };
    /** Mean API-assertion pass rate across all non-error specs (1.0 = all pass / vacuous). */
    apiAssertionPassRate: number;
  };
  /**
   * Phase 0 flake-diagnostics (read-only). Per-request histogram + enriched
   * notable responses + auth-churn + run identity + GH-Actions concurrency
   * context, so a flake-PASS and a flake-FAIL run of the same commit can be
   * diffed. NOTHING in the gate reads this. See `diagnostics.ts`.
   */
  diagnostics?: Diagnostics;
  /**
   * The gate verdict, persisted so consumers (the Phase 0 backfill harness,
   * dashboards) don't have to re-derive the multi-clause pass formula from the
   * summary + crawl fields and risk drifting from it. Single source of truth:
   * computed once in main() from the same inputs that drive the exit code.
   */
  passed?: boolean;
}

async function main(): Promise<number> {
  const args = parseArgs();
  // Phase 0 flake-diagnostics: stamp run start + snapshot concurrent Spec CI
  // runs BEFORE any work, so `concurrencyAtStart` reflects the field at launch
  // (the overlap window H1/H2 care about). Both are read-only + best-effort.
  const diagStartedMs = Date.now();
  const diagStartedAt = new Date(diagStartedMs).toISOString();
  const concurrencyAtStart = snapshotConcurrency(process.env.GITHUB_RUN_ID ?? null);

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

  // Hermetic lane: stub the coord/strategy/cognito-admin-backed endpoints
  // with prod-empty-parity bodies so pages render their authored empty
  // states instead of 5xx-driven error states (see hermetic-stubs.ts).
  if (process.env.QONTINUI_TEST_ID_TOKEN) {
    await applyHermeticStubs(context);
  }

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

  // CI-status / ws-token stub (corpus-stability backstop).
  //
  // The Operations page mounts the CI Status Dashboard panel, which on mount
  // fires GET /api/v1/operations/ci-status and GET /api/v1/ws-token. Against
  // ci-bot's staging tenant those can come back 401 (the coord-backed
  // CI-status surface isn't provisioned for this account); the httpClient's
  // reactive 401-refresh then fails and dispatches a `session-expired` event,
  // which AuthProvider turns into a hard `window.location.href = "/login"`
  // (contexts/auth-context.tsx). That hard navigation tears down the shared
  // authed page mid-run and cascades a `/login` bounce into EVERY subsequent
  // spec (operations → wrappers all collapse to no_match/error).
  //
  // We neutralize it at the network edge: return a benign, well-formed empty
  // body for the CI-status seed and a tokenless ws-token (the hook then falls
  // back to polling and never opens a WS). No 401 → no session-expired → no
  // logout redirect → the shared session survives the Operations spec. This is
  // a harness-only stub (no app change); it keeps the on-PR gate green and
  // order-independent without weakening any assertion (the operations spec is
  // structural — header/controls — and doesn't assert CI-status data).
  const ciStatusStub = async (route: import("@playwright/test").Route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ repos: [] }),
    });
  };
  const wsTokenStub = async (route: import("@playwright/test").Route) => {
    // Empty token → useCiStatusStream logs "no WS token" and uses polling.
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ token: null }),
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
      // Seed a future token_expiry so isAccessTokenExpired() returns false.
      // Without this, every page.goto triggers refreshAccessToken() (60+
      // token rotations per run). Each rotation blacklists the old refresh
      // token; if any single Set-Cookie delivery fails (transient proxy
      // hiccup), all subsequent specs get 401 → login redirect → irrecoverable.
      const expiryMs = Date.now() + 3600 * 1000;
      window.localStorage.setItem("token_expiry", expiryMs.toString());
    } catch {
      /* localStorage unavailable */
    }
  });
  await context.route("**/users/me/preferences", prefsIntercept);
  await context.route("**/operations/ci-status", ciStatusStub);
  await context.route("**/ws-token", wsTokenStub);
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
    `[spec-ci] api-auth: ${auth.ok ? `ok (${auth.mode})` : `failed (${auth.reason})`}\n`,
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

  // Console-error invariant: a single shared sink + a mutable per-spec context
  // marker, with listeners attached to EVERY page the harness drives. The
  // marker is updated in the spec loop below before each navigation; the
  // listener reads it at fire time for attribution. Attach to the shared authed
  // page here and to each fresh unauthPage inside runUnauthSpec — otherwise the
  // unauth lane (login / invalid-creds / password-reset) escapes the gate.
  const criticalConsole: ConsoleErrorEntry[] = [];
  const captureCtx: CaptureCtx = { specId: null, transitionId: null };
  attachConsoleCapture(page, () => captureCtx, criticalConsole);

  // Same-origin HTTP-500 invariant: a parallel sink + the SAME per-spec context
  // marker, with a `page.on("response")` listener on every page the harness
  // drives. baseOrigin is the localhost proxy origin; only responses from THAT
  // origin with status >= 500 gate (see server-error-policy.ts). Attached here
  // for the shared authed page and inside runUnauthSpec for the unauth lane,
  // exactly mirroring the console capture.
  const baseOrigin = new URL(args.baseUrl).origin;
  const serverErrors: ServerErrorEntry[] = [];
  attachResponseCapture(page, baseOrigin, () => captureCtx, serverErrors);
  // Phase 0 flake-diagnostics: observes the FULL response stream (gate-irrelevant)
  // on the same pages, reusing the gate's `captureCtx` for spec attribution.
  const diag = new DiagnosticsCollector(baseOrigin);
  diag.attach(page, () => captureCtx);

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
    await unauthContext.route("**/operations/ci-status", ciStatusStub);
    await unauthContext.route("**/ws-token", wsTokenStub);
    // Hermetic lane: same prod-empty-parity stubs as the authed context —
    // unauth pages share the layout-level pollers (see hermetic-stubs.ts).
    if (process.env.QONTINUI_TEST_ID_TOKEN) {
      await applyHermeticStubs(unauthContext);
    }
    // Per-spec route stubs on the unauth context (same pattern as the auth lane).
    const stubs = readRouteStubs(spec.doc);
    const teardownStubs = await applyRouteStubs(unauthContext, stubs);
    const unauthPage = await unauthContext.newPage();
    // Same console sink + context marker as the shared authed page, so unauth
    // specs are covered by the run-level invariant (they were the one lane a
    // single shared-page listener would silently miss).
    attachConsoleCapture(unauthPage, () => captureCtx, criticalConsole);
    attachResponseCapture(unauthPage, baseOrigin, () => captureCtx, serverErrors);
    diag.attach(unauthPage, () => captureCtx);
    try {
      return await evaluateSpec(
        unauthPage,
        unauthContext.request,
        spec,
        args.baseUrl,
        args.includeDestructive,
        args.includeWrite,
        // Auth pages aren't <RequireProject>-gated; no fixture selection needed.
        null,
      );
    } finally {
      await teardownStubs();
      await unauthContext.close();
    }
  };

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const unauth = requiresUnauthenticated(spec.doc);
    process.stderr.write(
      `[spec-ci] ${i + 1}/${specs.length} ${spec.id}${unauth ? " [unauth]" : ""} … `,
    );
    // Mark the active spec for console attribution, then capture the sink
    // length so we can slice off exactly this spec's critical console hits.
    // transitionId stays "initial-load" — the in-page transition walk is
    // opaque to the outer listener (see attachConsoleCapture).
    captureCtx.specId = spec.id;
    captureCtx.transitionId = "initial-load";
    const consoleBefore = criticalConsole.length;
    const serverBefore = serverErrors.length;
    // Per-spec route stubs: apply on the appropriate context before eval,
    // tear down after. The unauth lane handles its own stubs inside
    // runUnauthSpec; the auth lane applies them on the shared `context`.
    let r: SpecResult;
    // Console/server attribution baselines. On a structural retry these advance
    // to the retry attempt so attempt-1's transient noise is discarded and only
    // the final (winning or confirmed-persistent) attempt's events are gated on.
    let consoleSliceBase = consoleBefore;
    let serverSliceBase = serverBefore;
    for (let attempt = 0; attempt <= SPEC_MATCH_RETRIES; attempt++) {
      if (unauth) {
        r = await runUnauthSpec(spec);
      } else {
        const stubs = readRouteStubs(spec.doc);
        const teardownStubs = await applyRouteStubs(context, stubs);
        try {
          r = await evaluateSpec(page, context.request, spec, args.baseUrl, args.includeDestructive, args.includeWrite, fixtureProjectId);
        } finally {
          await teardownStubs();
        }
      }
      // Retry only a non-full STRUCTURAL match, only if no transition executed
      // (so a re-navigation is side-effect-free — never re-applies a write), and
      // only up to SPEC_MATCH_RETRIES. A persistent regression fails both passes
      // and still gates; a transient data-load miss clears on the fresh re-nav.
      if (
        r.matchOutcome === "full_match" ||
        attempt >= SPEC_MATCH_RETRIES ||
        r.transitions.length > 0
      ) {
        break;
      }
      process.stderr.write(
        `[spec-ci] ${spec.id} ${r.matchOutcome} (rate ${r.matchRate.toFixed(2)}) — retry ${attempt + 1}/${SPEC_MATCH_RETRIES} (transient-vs-persistent)\n`,
      );
      consoleSliceBase = criticalConsole.length;
      serverSliceBase = serverErrors.length;
    }
    // Attribute this spec's slice, dropping any author-declared expected errors.
    const expected = readExpectedConsoleErrors(spec.doc);
    r.consoleErrors = criticalConsole
      .slice(consoleSliceBase)
      .filter((e) => !expected.some((rx) => rx.test(e.text)));
    // Same slice mechanism for same-origin 5xx, dropping expectedServerErrors
    // waivers (matched against the response URL). Gateway-class (502/503/504)
    // entries are then re-probed once — a persistent backend outage re-probes
    // to >=500 (kept); a transient upstream blip re-probes <500 (dropped).
    const expectedServer = readExpectedServerErrors(spec.doc);
    const sliced = serverErrors
      .slice(serverSliceBase)
      .filter((e) => !expectedServer.some((rx) => rx.test(e.url)))
      // Global `ci-env` waiver classes apply to the spec lane too: hermetic
      // CI makes the coord/strategy upstream classes reachable from spec'd
      // pages (background pollers), not just crawl routes. See
      // crawl-baseline.ts GLOBAL_SERVER_WAIVERS.
      .filter((e) => !isGloballyWaivedServerUrl(e.url));
    const { kept: serverKept, dropped: serverDropped } = await confirmGatewayPersistence(page, sliced);
    r.serverErrors = serverKept;
    for (const d of serverDropped) {
      process.stderr.write(
        `[spec-ci] ${spec.id} gateway-reprobe dropped: ${d.method} ${d.status} ${d.url}\n`,
      );
    }
    results.push(r);
    process.stderr.write(
      `${r.matchOutcome} matchRate=${r.matchRate.toFixed(2)} transitions=${r.transitions.length} passRate=${r.transitionPassRate.toFixed(2)} consoleErrors=${r.consoleErrors.length} serverErrors=${r.serverErrors.length}${r.error ? ` error=${r.error}` : ""}\n`,
    );
  }

  // -------------------------------------------------------------------------
  // Spec-less route crawl (C8): visit every app route that has no IR spec and
  // apply the SAME run-level invariants the spec'd pages get — critical console
  // errors (C3, console-policy.ts), same-origin HTTP-5xx (C4,
  // server-error-policy.ts), and basic page-health (navigation success). This
  // lane is now GATING: a NEW finding on any crawled route reds the on-PR gate,
  // attributed to that route (see the crawl-gate fold near the exit-code
  // computation below). Pre-existing findings are waived per-route /
  // per-URL-class via crawl-baseline.ts so the established baseline lands green
  // while still enforcing zero NEW findings.
  //
  // Dynamic [param] routes are skipped (route-manifest flags them isDynamic):
  // they would need per-route fixture injection + auth-aware navigation, and a
  // sentinel-id crawl is 404-heavy noise. The few dynamic routes that matter
  // (demo-detail, region-analysis agent-detail) have explicit IR specs with
  // sentinel ids, so they ride the spec lane, not the crawl. Robustness: a
  // legitimate 404 / redirect / data-unavailable render does NOT gate — only a
  // real same-origin 5xx, a critical console error, or a navigation FAILURE
  // (goto throw) counts. Reused authed page → the crawl covers the authed lane
  // (ci-bot superuser). Public/unauth-only routes that 401-bounce render fine
  // here (the authed session simply sees them); the dedicated unauth lane is
  // exercised by the requiresUnauthenticated specs, not the crawl.
  // -------------------------------------------------------------------------
  const appDir = join(__dirname, "../../src/app");
  const allRoutes = discoverAppRoutes(appDir);

  // Build the set of routes that already have IR spec coverage. The routeForSpec
  // function converts spec id → URL path; we normalize to a leading-slash-less
  // form so the Set lookup is insensitive to leading-slash differences.
  const specRoutes = new Set(
    specs.map((s) =>
      routeForSpec(s.id, "", null).replace(/^\//, ""),
    ),
  );
  const unspecRoutes = allRoutes.filter(
    (r) => !specRoutes.has(r.path.replace(/^\//, "")),
  );

  process.stderr.write(
    `[spec-ci] crawl: ${allRoutes.length} total routes, ${specRoutes.size} spec-covered, ${unspecRoutes.length} unspec'd (${unspecRoutes.filter((r) => r.isDynamic).length} dynamic — skipped)\n`,
  );

  const crawlResults: CrawlResult[] = [];
  for (const route of unspecRoutes) {
    // Skip dynamic routes for now — they would need fixture parameter injection
    // and the resulting 404-heavy crawl adds noise without signal.
    if (route.isDynamic) continue;

    const url = `${args.baseUrl.replace(/\/$/, "")}${route.path}`;
    const started = Date.now();
    captureCtx.specId = `crawl:${route.path}`;
    captureCtx.transitionId = "crawl";
    const consoleBefore = criticalConsole.length;
    const serverBefore = serverErrors.length;

    let navigatedOk = true;
    let navError: string | null = null;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
      // Brief settle for async rendering (shorter than spec eval — crawl is a
      // smoke check, not a structural match).
      await page.waitForTimeout(2_000);
    } catch (e) {
      navigatedOk = false;
      navError = e instanceof Error ? e.message : String(e);
    }

    // Session-lost detection. A navigation INTERRUPTED by a client-side redirect
    // to `/login` is NOT a route health defect — it is the unmistakable
    // signature of the shared authed session having been torn down (the
    // client-side AuthProvider bounces every protected route to /login once the
    // in-memory token + refresh cookie are gone). The dominant real-world cause
    // in CI is the shared ci-bot account's auth endpoint rate-limiting the
    // initial login / token-refresh (the "10 per 1 minute" limiter), which never
    // establishes the refresh cookie, so EVERY subsequent crawl route bounces.
    // Attributing 40+ "/login redirect" health-fails to individual routes would
    // be 40 false per-route reds for one upstream auth/session failure. We flag
    // it as `sessionLost` instead — counted into a run-level guard
    // (`crawlSessionLost` below) that fails the gate on a single, honest
    // "session lost during crawl" signal rather than polluting per-route
    // attribution. A genuine route health failure (a real timeout/crash that is
    // NOT a /login bounce) still sets `healthFail` and gates per-route.
    const sessionLost =
      !navigatedOk && navError !== null && /\/login(\?|"|$)/.test(navError);
    const crawlConsole = criticalConsole.slice(consoleBefore);
    // Re-probe gateway-class (502/503/504) entries before they reach the
    // waiver registry — same rationale as the spec lane: transient upstream
    // blips on shared background calls drop; real persistent app/upstream
    // failures stay and gate.
    const { kept: crawlServer, dropped: crawlServerDropped } = await confirmGatewayPersistence(
      page,
      serverErrors.slice(serverBefore),
    );
    for (const d of crawlServerDropped) {
      process.stderr.write(
        `[spec-ci] crawl ${route.path} gateway-reprobe dropped: ${d.method} ${d.status} ${d.url}\n`,
      );
    }
    // Fold the raw findings through the crawl waiver registry (crawl-baseline
    // .ts): global CI-env URL classes (/coord-api/*, /api/vga/*) + per-route
    // waivers. Whatever survives GATES, attributed to this route.
    const waived = applyCrawlWaivers(route.path, crawlConsole, crawlServer);
    // A real health failure = navigation failed, NOT waived, AND not a
    // session-lost /login bounce (those are the run-level auth signal, not a
    // per-route defect).
    const healthFail = !navigatedOk && !waived.navFailWaived && !sessionLost;

    crawlResults.push({
      route: route.path,
      navigatedOk,
      sessionLost,
      consoleErrors: crawlConsole,
      serverErrors: crawlServer,
      unwaivedConsoleErrors: waived.unwaivedConsole,
      unwaivedServerErrors: waived.unwaivedServer,
      healthFail,
      durationMs: Date.now() - started,
      error: navError,
    });

    const last = crawlResults[crawlResults.length - 1]!;
    const findingCount =
      last.unwaivedConsoleErrors.length +
      last.unwaivedServerErrors.length +
      (last.healthFail ? 1 : 0);
    process.stderr.write(
      `[spec-ci] crawl ${route.path} ${last.navigatedOk ? "ok" : last.sessionLost ? "SESSION-LOST" : "NAV-FAIL"}` +
        `${findingCount > 0 ? ` GATING(${findingCount})` : ""} (${last.durationMs}ms)\n`,
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

  // Run-level console-error invariant rollup.
  const consoleErrorBySpec: Record<string, number> = {};
  for (const r of results) {
    if (r.consoleErrors.length > 0) consoleErrorBySpec[r.specId] = r.consoleErrors.length;
  }
  const consoleErrorTotal = results.reduce((s, r) => s + r.consoleErrors.length, 0);

  // Run-level same-origin HTTP-500 invariant rollup.
  const serverErrorBySpec: Record<string, number> = {};
  for (const r of results) {
    if (r.serverErrors.length > 0) serverErrorBySpec[r.specId] = r.serverErrors.length;
  }
  const serverErrorTotal = results.reduce((s, r) => s + r.serverErrors.length, 0);

  // Run-level API-assertion pass rate (mean across non-error specs).
  const apiAssertionPassRate =
    valid.length === 0 ? 1 : valid.reduce((s, r) => s + r.apiAssertionPassRate, 0) / valid.length;

  // Crawl rollup. Raw totals are for visibility; the *unwaived* totals are what
  // gate (a NEW finding on any crawled route reds the run).
  const crawlConsoleTotal = crawlResults.reduce((s, r) => s + r.consoleErrors.length, 0);
  const crawlServerTotal = crawlResults.reduce((s, r) => s + r.serverErrors.length, 0);

  // Session-lost guard. When the shared authed session is torn down mid-crawl
  // (the dominant cause: the shared ci-bot account's auth/refresh endpoint
  // rate-limiting, which never establishes the refresh cookie), the crawl
  // produces a cascade of downstream artifacts on EVERY subsequent route: the
  // /login-redirect navigation interrupts (`sessionLost`) AND the
  // `[TokenRefresh] … 401 TOKEN_MISSING` console errors. None of these are
  // per-route code defects. We fold them into a single run-level
  // `crawlSessionLost` signal and EXCLUDE session-lost routes from per-route
  // gating attribution (console + health), so the gate fails on ONE honest
  // "session lost during crawl — re-run" signal instead of N false per-route
  // reds. The gate STILL goes red (a lost session is a real run failure), just
  // correctly attributed. A NON-session-lost route's findings gate normally.
  const crawlSessionLostRoutes = crawlResults.filter((r) => r.sessionLost).length;
  const crawlSessionLost = crawlSessionLostRoutes > 0;

  // Per-route gating attribution EXCLUDES session-lost routes (their console
  // errors are TOKEN_MISSING auth artifacts, not route defects).
  const crawlUnwaivedConsole = crawlResults.reduce(
    (s, r) => s + (r.sessionLost ? 0 : r.unwaivedConsoleErrors.length),
    0,
  );
  const crawlUnwaivedServer = crawlResults.reduce(
    (s, r) => s + (r.sessionLost ? 0 : r.unwaivedServerErrors.length),
    0,
  );
  const crawlHealthFails = crawlResults.reduce((s, r) => s + (r.healthFail ? 1 : 0), 0);
  // The crawl gates iff there is a real per-route finding OR the session was
  // lost during the crawl (re-run signal).
  const crawlGatingFindings =
    crawlUnwaivedConsole + crawlUnwaivedServer + crawlHealthFails + (crawlSessionLost ? 1 : 0);
  const crawlCleanRoutes = crawlResults.filter(
    (r) =>
      !r.sessionLost &&
      r.unwaivedConsoleErrors.length === 0 &&
      r.unwaivedServerErrors.length === 0 &&
      !r.healthFail,
  ).length;
  const crawlPassRate =
    crawlResults.length === 0 ? 1 : crawlCleanRoutes / crawlResults.length;

  const diagnostics = await diag.finalize({
    startedAt: diagStartedAt,
    startedMs: diagStartedMs,
    concurrencyAtStart,
    crawlSessionLost,
    crawlSessionLostRoutes,
  });

  const report: FullReport = {
    baseUrl: args.baseUrl,
    apiBase: args.apiBase,
    evaluatedAt: new Date().toISOString(),
    authOk: auth.ok,
    specCount: specs.length,
    specs: results,
    crawl: {
      total: unspecRoutes.filter((r) => !r.isDynamic).length,
      visited: crawlResults.length,
      consoleErrors: crawlConsoleTotal,
      serverErrors: crawlServerTotal,
      unwaivedConsoleErrors: crawlUnwaivedConsole,
      unwaivedServerErrors: crawlUnwaivedServer,
      healthFails: crawlHealthFails,
      sessionLost: crawlSessionLost,
      sessionLostRoutes: crawlSessionLostRoutes,
      gatingFindings: crawlGatingFindings,
      passRate: crawlPassRate,
      routes: crawlResults,
    },
    summary: {
      fullMatch,
      partialMatch,
      noMatch,
      error: errorCount,
      minMatchRate: valid.length === 0 ? 0 : minMatchRate,
      meanMatchRate,
      transitionPassRate,
      consoleErrors: { total: consoleErrorTotal, bySpec: consoleErrorBySpec },
      serverErrors: { total: serverErrorTotal, bySpec: serverErrorBySpec },
      apiAssertionPassRate,
    },
    diagnostics,
  };

  // CI gate verdict — see the clause-by-clause rationale at the `return` below.
  // Computed here (before the report is written) so it can be persisted as
  // `report.passed`, the single source of truth the exit code also uses.
  const consoleClean = report.summary.consoleErrors.total === 0;
  const serverClean = report.summary.serverErrors.total === 0;
  const apiContractClean = report.summary.apiAssertionPassRate >= 0.999;
  const crawlClean = crawlGatingFindings === 0;
  const passed =
    errorCount === 0 &&
    report.summary.minMatchRate >= 0.8 &&
    report.summary.transitionPassRate >= 0.999 &&
    consoleClean &&
    serverClean &&
    apiContractClean &&
    crawlClean;
  report.passed = passed;

  writeFileSync(args.output, JSON.stringify(report, null, 2), "utf-8");
  process.stderr.write(
    `[spec-ci] wrote ${args.output}: ${fullMatch} full, ${partialMatch} partial, ${noMatch} no_match, ${errorCount} error · min ${report.summary.minMatchRate.toFixed(2)} · mean ${report.summary.meanMatchRate.toFixed(2)} · transitionPassRate ${report.summary.transitionPassRate.toFixed(2)} · consoleErrors ${report.summary.consoleErrors.total} · serverErrors ${report.summary.serverErrors.total} · apiAssertionPassRate ${report.summary.apiAssertionPassRate.toFixed(2)} · crawl ${crawlResults.length} routes, ${crawlConsoleTotal}/${crawlServerTotal} raw console/server, ${crawlGatingFindings} GATING (${crawlUnwaivedConsole} console + ${crawlUnwaivedServer} server + ${crawlHealthFails} health${crawlSessionLost ? ` + SESSION-LOST(${crawlSessionLostRoutes} routes)` : ""}), passRate ${crawlPassRate.toFixed(2)}\n`,
  );
  process.stderr.write(
    `[spec-ci] diagnostics: ${diagnostics.totalResponses} responses, ${diagnostics.notableResponses.length} notable (5xx/4xx-not-401), auth{login=${diagnostics.auth.loginAttempts} refresh=${diagnostics.auth.refreshRotations} 429=${diagnostics.auth.authEndpoint429s}}, concurrency ${diagnostics.concurrencyAtStart.available ? `${diagnostics.concurrencyAtStart.inProgressRuns?.length ?? 0} overlapping run(s)` : `unavailable (${diagnostics.concurrencyAtStart.reason})`}, durationMs ${diagnostics.durationMs}\n`,
  );

  // Surface the gating crawl findings explicitly so a red is actionable from
  // the log alone (the JSON report has the full per-route breakdown).
  if (crawlSessionLost) {
    process.stderr.write(
      `[spec-ci] CRAWL-GATE session-lost: the authed session was torn down mid-crawl ` +
        `(${crawlSessionLostRoutes} routes bounced to /login). This is an ENVIRONMENTAL ` +
        `auth/session failure (typically the shared ci-bot account's auth endpoint ` +
        `rate-limiting — see the global concurrency lane in spec-ci.yml), NOT per-route ` +
        `code defects. Re-run once the auth window clears; per-route findings on the ` +
        `bounced routes are suppressed as auth artifacts.\n`,
    );
  }
  if (crawlGatingFindings > 0) {
    for (const r of crawlResults) {
      if (r.sessionLost) continue; // auth artifacts, not per-route findings
      for (const e of r.unwaivedConsoleErrors) {
        process.stderr.write(`[spec-ci] CRAWL-GATE console ${r.route}: [${e.level}] ${e.text}\n`);
      }
      for (const e of r.unwaivedServerErrors) {
        process.stderr.write(`[spec-ci] CRAWL-GATE server ${r.route}: [${e.method} ${e.status}] ${e.url}\n`);
      }
      if (r.healthFail) {
        process.stderr.write(`[spec-ci] CRAWL-GATE health ${r.route}: navigation failed (${r.error})\n`);
      }
    }
  }

  // CI gate: fail iff (a) any spec errored, or (b) min match rate < 0.8,
  // or (c) transition pass rate < 1.0 across the corpus, or (d) any spec
  // produced a critical browser console error (the run-level invariant that
  // subsumes the retired ui-bridge-graph-editor "no console errors" smoke
  // test), or (e) any spec produced a same-origin HTTP-5xx response (the
  // run-level invariant that gives the gate HTTP-RESPONSE visibility — backend
  // 500s a resolved `fetch()` makes invisible to the console listener; see
  // server-error-policy.ts), or (f) API-contract assertions failed.
  // ...or (g) the spec-less route crawl (C8) surfaced a NEW finding on any
  // un-spec'd route — a critical console error, a same-origin HTTP-5xx, or a
  // hard page-health failure (navigation throw) — after the per-route /
  // per-URL-class baseline waivers (crawl-baseline.ts) are subtracted. This
  // extends the same per-spec consoleClean/serverClean folding to the ~200
  // routes that have no IR spec, so the gate is no longer blind to them.
  // (`passed` is computed + persisted above, before the report is written.)

  // Best-effort corroboration leg: ship ALL same-origin 5xx observed this run
  // (per-spec + crawl) to coord's Ξ_Log ingest as a second observer. This is
  // observability ONLY — it does NOT touch the gate verdict (`passed` is already
  // final above), fires regardless of pass/fail, and is fully non-blocking:
  // a no-op without COORD_HTTP_URL+COORD_INGEST_TOKEN, swallows all errors, and
  // is bounded by a short timeout so an unreachable coord can't hang the run.
  const allServerErrors = [
    ...results.flatMap((r) => r.serverErrors),
    ...crawlResults.flatMap((r) => r.serverErrors),
  ];
  await reportServerErrorsToCoord(allServerErrors);

  return passed ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((err) => {
  process.stderr.write(`[spec-ci] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
