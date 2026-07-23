/**
 * Style-gate capture spec (Phase 1 of the CI style-gating plan).
 *
 * For EACH route in `routes.json`, in its own `test()`, this:
 *   1. navigates to the route and waits for it to settle (networkidle +
 *      the route's `settleMs`),
 *   2. captures a UI-Bridge element snapshot via a same-origin request to
 *      the relay proxy (`GET /api/ui-bridge/control/snapshot`), normalizes
 *      each element's bbox to the analyzer's `Region` shape, and writes the
 *      result to `.artifacts/snapshots/<id>.json`,
 *   3. captures a deterministic PNG screenshot to `.artifacts/frames/<id>.png`.
 *
 * The snapshot + frame pair is the Phase-1 deliverable. A later phase feeds
 * both to the `vision-audit` analyzer bin. `/control/snapshot` returns the
 * runner-native envelope `{ elements: [...] }` — one of the shapes the bin's
 * `parse_snapshot` accepts (`{elements:[...]}` / `{data:{elements:[...]}}` /
 * `{data:[...]}`) — but the SDK emits each bbox as `{x,y,width,height}` floats
 * whereas the Rust `Region` requires `{x,y,w,h}` u32. So the snapshot is NOT
 * byte-identical runner-native: a single bbox-normalization adapter
 * (`normalizeSnapshotForAnalyzer`) maps that one field before writing; every
 * other field passes through (the Rust `Element` has no `deny_unknown_fields`
 * and only `id` is required). See that function for the full rationale.
 *
 * AUTHED-ONLY: every seed route is authenticated (`public: false`). The relay
 * snapshot route requires the in-page `CommandRelayListener`, which never
 * mounts without a resolved `{userId, sessionId}` (provider.tsx's
 * `commandRelayRegistrationMetadata` returns null otherwise) — so a public
 * route can't be captured via the relay. This spec runs under the single
 * `style-gate` Playwright project (authed, setup-minted storageState). The
 * `public` field is still honored as a filter so a future relay-independent
 * public-capture path can coexist, but no public routes exist today.
 *
 * RELAY PREREQUISITE — three gates the `CommandRelayListener` (which makes
 * `/control/snapshot` return elements instead of `503 NO_BROWSER_CONNECTED`)
 * requires, all of which must be true:
 *   (1) env gate — dev server (NODE_ENV=development) OR a prod build with
 *       NEXT_PUBLIC_UI_BRIDGE_REMOTE_COMMANDS=1.  --> CI's responsibility
 *       (the `npm run dev` webServer in playwright.config.ts satisfies it).
 *   (2) per-user co-pilot preference `ui_bridge_co_pilot_enabled === true`.
 *       --> THIS SPEC enables it in `test.beforeAll` via the authed
 *       `request` context (the same storageState the page uses), hitting the
 *       real PUT /api/v1/users/me/preferences endpoint.
 *   (3) per-session consent === "granted".  --> THIS SPEC seeds it in an init
 *       script (`test.beforeEach`) so a fresh CI tab is pre-consented.
 * If after the settle window the relay still isn't attached, the test FAILS
 * LOUDLY with a clear message rather than writing an empty/misleading snapshot.
 */

import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { enrichElements, normalizeBboxes } from "./normalize";
import { STORAGE_STATE_PATH } from "../auth.constants";

/** A single gated route as declared in `routes.json`. */
interface StyleGateRoute {
  id: string;
  path: string;
  public: boolean;
  settleMs: number;
  description?: string;
}

interface RoutesManifest {
  routes: StyleGateRoute[];
}

const STYLE_GATE_DIR = __dirname;
const ARTIFACTS_DIR = join(STYLE_GATE_DIR, ".artifacts");
const SNAPSHOTS_DIR = join(ARTIFACTS_DIR, "snapshots");
const FRAMES_DIR = join(ARTIFACTS_DIR, "frames");
const DIAG_DIR = join(ARTIFACTS_DIR, "diagnostics");

/**
 * Deterministic viewport. Frames must be byte-reproducible run-to-run for the
 * downstream analyzers, so we fix the viewport explicitly in BOTH the project
 * config and here (defence in depth — a project that forgets to set it still
 * captures at a known size).
 */
const VIEWPORT = { width: 1280, height: 800 } as const;

/**
 * Per-session consent key + value the relay listener gates on (gate 3). Seeded
 * via an init script so the `CommandRelayListener` mounts on a fresh CI tab
 * without a human clicking the consent modal. Mirrors
 * `useCoPilotSessionConsent` (STORAGE_KEY = "qontinui_copilot_session_consent",
 * granted value = "granted").
 */
const CO_PILOT_CONSENT_KEY = "qontinui_copilot_session_consent";
const CO_PILOT_CONSENT_GRANTED = "granted";

/**
 * Per-user durable co-pilot preference (gate 2). The app reads/writes this at
 * `${API_BASE_URL}/api/v1/users/me/preferences` (a JSONB store); the setter in
 * `src/hooks/useCoPilotPreference.ts` (`persistPreference`) issues:
 *     PUT /api/v1/users/me/preferences
 *     Content-Type: application/json
 *     { "ui_bridge_co_pilot_enabled": true }
 * We replay that EXACT shape below via the authed request context.
 *
 * The endpoint base mirrors `ApiConfig.API_BASE_URL` (= `NEXT_PUBLIC_API_URL`
 * or `""`). We resolve it the same way the app does so the request lands on the
 * same backend the page talks to.
 */
const CO_PILOT_PREFERENCE_KEY = "ui_bridge_co_pilot_enabled";
const PREFERENCES_PATH = "/api/v1/users/me/preferences";

/**
 * Resolve the API base the app uses, EXACTLY mirroring `ApiConfig.API_BASE_URL`
 * (`process.env.NEXT_PUBLIC_API_URL || ""`):
 *   - Set (e.g. https://api.qontinui.io) -> absolute cross-origin backend host.
 *   - Unset (the dev default) -> "" = SAME-ORIGIN. The app then hits the
 *     relative path through the Next dev-server proxy; for the Playwright
 *     `request` context a relative URL resolves against `use.baseURL`
 *     (http://localhost:3001), i.e. the same dev server the page uses.
 * Trailing slashes are trimmed so the joined path has exactly one separator.
 */
function resolveApiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL?.trim();
  const base = raw && raw.length > 0 ? raw : "";
  return base.replace(/\/+$/, "");
}

/** Load + parse the committed routes manifest. */
function loadRoutes(): StyleGateRoute[] {
  const raw = readFileSync(join(STYLE_GATE_DIR, "routes.json"), "utf8");
  const parsed = JSON.parse(raw) as RoutesManifest;
  if (!parsed || !Array.isArray(parsed.routes)) {
    throw new Error(
      `style-gate routes.json is malformed: expected { routes: [...] }`
    );
  }
  return parsed.routes;
}

const ALL_ROUTES = loadRoutes();

// Authed-only seed set (every route is `public: false`). The `public` filter is
// retained for a future relay-independent public-capture path; today it leaves
// the set unchanged.
const AUTHED_ROUTES = ALL_ROUTES.filter((r) => r.public === false);

/** Shape of the relay snapshot response we care about for validation. */
interface SnapshotResponse {
  // Runner-native shape: elements at the top level. Other accepted shapes
  // (`data.elements`, `data` array) are tolerated by the downstream bin; we
  // only need to confirm SOMETHING element-bearing came back, then write it
  // verbatim.
  success?: boolean;
  code?: string;
  elements?: unknown[];
  data?: { elements?: unknown[] } | unknown[];
}

/** Count elements across the three accepted snapshot shapes. */
function countElements(body: SnapshotResponse): number {
  if (Array.isArray(body.elements)) return body.elements.length;
  if (Array.isArray(body.data)) return body.data.length;
  if (body.data && Array.isArray(body.data.elements)) {
    return body.data.elements.length;
  }
  return 0;
}

/**
 * Locate the elements array inside whichever of the three accepted snapshot
 * envelopes the relay returned. Returns the live array reference (mutating its
 * elements in place is intentional — see `normalizeBboxes`), or null when no
 * recognized element-bearing shape is present.
 *
 * Accepted shapes (must mirror the downstream bin's `parse_snapshot`):
 *   - `{ elements: [...] }`        (runner-native, what /control/snapshot emits)
 *   - `{ data: { elements: [...] } }`
 *   - `{ data: [...] }`
 */
function locateElements(body: SnapshotResponse): unknown[] | null {
  if (Array.isArray(body.elements)) return body.elements;
  if (Array.isArray(body.data)) return body.data;
  if (
    body.data &&
    Array.isArray((body.data as { elements?: unknown[] }).elements)
  ) {
    return (body.data as { elements: unknown[] }).elements;
  }
  return null;
}

/**
 * Normalize a parsed snapshot body for the analyzer and return the
 * re-serialized JSON ready to write. Two transforms, in order:
 *   1. `normalizeBboxes` (tests/e2e/style-gate/normalize.ts) — map the SDK's
 *      `{x,y,width,height}` floats to the Rust `Region` `{x,y,w,h}`: signed
 *      i32 origin (true negatives preserved), unsigned u32 extent (the one
 *      geometry transform).
 *   2. `enrichElements` (tests/e2e/style-gate/normalize.ts) — derive the
 *      analyzer's visual/interactivity fields (`interactable`, `fg_color`,
 *      `bg_color`, `font_size_px`, `font_family`, `line_height_px`, `text`,
 *      `role`) from the SDK's `state.computedStyles` / actions / category, so
 *      the color, typography, and element-coverage analyzers have the inputs
 *      they need. Absent fields are OMITTED (the Rust `Element` defaults apply).
 *
 * When no element array is found (shouldn't happen — the caller's element-count
 * guard fires first), the original raw text is returned unchanged so we never
 * silently drop a snapshot we couldn't parse.
 */
function normalizeSnapshotForAnalyzer(
  raw: string,
  body: SnapshotResponse
): string {
  const elements = locateElements(body);
  if (!elements) return raw;
  normalizeBboxes(elements);
  enrichElements(elements);
  return JSON.stringify(body);
}

/**
 * Enable the per-user co-pilot preference (gate 2) for the test user via the
 * authed request context. `request` here is bound to the project's storageState
 * (cookies + the app's bearer storage are replayed), so this PUT authenticates
 * as the same ci-bot user the page renders as.
 *
 * Replays the exact method + body shape of `persistPreference` in
 * `src/hooks/useCoPilotPreference.ts`. Fails LOUDLY on a non-2xx response — a
 * silent miss here means the listener never mounts and every snapshot 503s, so
 * a clear preference-mutation failure is far cheaper to diagnose than a wall of
 * downstream relay timeouts.
 */
async function enableCoPilotPreference(
  request: APIRequestContext
): Promise<void> {
  const url = `${resolveApiBase()}${PREFERENCES_PATH}`;
  const res = await request.put(url, {
    headers: { "Content-Type": "application/json" },
    data: { [CO_PILOT_PREFERENCE_KEY]: true },
  });
  if (!res.ok()) {
    const bodyText = await res.text().catch(() => "<unreadable body>");
    throw new Error(
      `[style-gate] Failed to enable the co-pilot preference (gate 2) for the ` +
        `test user: PUT ${url} returned ${res.status()} ${res.statusText()}.\n` +
        `Body: ${bodyText}\n` +
        `Without ui_bridge_co_pilot_enabled=true the CommandRelayListener ` +
        `never mounts and every /control/snapshot returns 503 — failing here ` +
        `rather than letting the capture tests time out. Check that the authed ` +
        `storageState is valid and NEXT_PUBLIC_API_URL points at the backend ` +
        `the page uses (see tests/e2e/style-gate/README.md).`
    );
  }

  // Cheap read-back so a backend that 200s but doesn't persist the flag is
  // caught here, not via a downstream 503. Best-effort: a non-2xx GET or a
  // missing flag is surfaced, but a malformed body is tolerated (the PUT 2xx
  // is the primary signal).
  const verify = await request.get(url, {
    headers: { Accept: "application/json" },
  });
  if (verify.ok()) {
    const prefs = (await verify.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (prefs && prefs[CO_PILOT_PREFERENCE_KEY] !== true) {
      throw new Error(
        `[style-gate] The co-pilot preference PUT returned ${res.status()} but ` +
          `the read-back GET ${url} still shows ` +
          `${CO_PILOT_PREFERENCE_KEY}=${JSON.stringify(
            prefs[CO_PILOT_PREFERENCE_KEY]
          )} (expected true). The backend did not persist the flag, so the ` +
          `relay listener will not mount. Check the preferences JSONB write path.`
      );
    }
  }
}

/**
 * The authed app shell's loading state (`(app)/layout.tsx` -> `AuthLoadingShell`)
 * renders a generic "Loading..." spinner while the CLIENT-SIDE auth context
 * (`contexts/auth-context.tsx`, `useAuth().loading`) resolves the user. CRUCIALLY,
 * while that shell is up the layout WITHHOLDS its children — which include the
 * entire UI-Bridge provider subtree (`UIBridgeWrapper` -> `CommandRelayListener`).
 * So no browser tab can register with the relay and `/control/snapshot` 503s
 * `NO_BROWSER_CONNECTED` until the shell resolves to the real authed app.
 *
 * We poll for this exact copy disappearing as a DETERMINISTIC readiness signal —
 * the relay can only attach AFTER it's gone — instead of hoping a fixed
 * `settleMs` outlasts the cold-start auth round-trip. The copy lives at
 * `(app)/layout.tsx`'s `AuthLoadingShell` (`<div class="text-lg ...">Loading...`).
 */
const AUTH_LOADING_SHELL_TEXT = "Loading...";

/**
 * The co-pilot page's own at-a-glance readiness badge (`CoPilotReadyStatus`,
 * `data-testid="co-pilot-ready-status"`). It is ALWAYS rendered in the page
 * header once the `(app)` layout has mounted the co-pilot route — across every
 * gate branch (loading / opt-in / consent / command surface) — so its presence
 * in the DOM is a deterministic, CO-PILOT-SPECIFIC "the authed route rendered"
 * signal, distinct from the generic shared `AuthLoadingShell`. It lives inside
 * the page's `data-bridge-invisible` wrapper, so it is NOT in the relay
 * snapshot, but it IS in the real DOM — a Playwright DOM locator sees it.
 */
const CO_PILOT_READY_BADGE_TESTID = "co-pilot-ready-status";

/**
 * Block until the authed app shell has resolved (the `AuthLoadingShell`
 * "Loading..." is gone), i.e. the `(app)` layout has mounted its children and
 * therefore the UI-Bridge `CommandRelayListener` exists and can attach a tab.
 * This is the single deterministic precondition the relay snapshot needs; the
 * relay poll that follows is then attaching-vs-attached, never racing auth.
 *
 * Best-effort: if the shell text never clears within budget we DON'T throw here
 * (the login guard + relay poll downstream produce the precise, actionable
 * failure). We just stop waiting so the real diagnostics run.
 *
 * `timeoutMs` is parameterized so the cold-start warmup (in `beforeAll`, with a
 * generous hook timeout) can wait longer than a per-route capture (inside the
 * 60s per-test budget, where over-waiting here starves the relay poll — the
 * exact failure mode the prior fix's fixed 45s wait caused for the cold-first
 * route).
 */
async function waitForAuthedShell(
  page: Page,
  timeoutMs = 20_000
): Promise<void> {
  const shell = page.getByText(AUTH_LOADING_SHELL_TEXT, { exact: true });
  await shell
    .waitFor({ state: "hidden", timeout: timeoutMs })
    .catch(() => undefined);
}

/**
 * Co-pilot-specific readiness: wait for the page's own `CoPilotReadyStatus`
 * badge to appear (the route rendered past the shared auth shell). Best-effort,
 * bounded; the relay poll downstream is the authoritative readiness check.
 */
async function waitForCoPilotReady(
  page: Page,
  timeoutMs = 20_000
): Promise<void> {
  await page
    .getByTestId(CO_PILOT_READY_BADGE_TESTID)
    .first()
    .waitFor({ state: "attached", timeout: timeoutMs })
    .catch(() => undefined);
}

/**
 * Navigate to the route. Lean by design: `domcontentloaded` (Next dev mode keeps
 * HMR/WebSocket alive so `networkidle` can hang), then a short best-effort
 * `networkidle`. The AUTHORITATIVE readiness check is the relay-attach poll in
 * `captureSnapshot` — it can only succeed AFTER the auth shell clears + the
 * provider subtree mounts, so it implicitly waits for auth WITHOUT a separate
 * budget-burning DOM wait.
 *
 * Why no pre-gate on `waitForAuthedShell`/`waitForCoPilotReady` here:
 * empirically (run 27001924332) the cold-first /co-pilot test's auth shell could
 * stall well past 40s in the FIRST per-test page context even on a warm dev
 * server, so those DOM waits just burned the per-test budget (2×20s) before the
 * relay poll ran. The relay poll now owns the budget and self-heals a stalled
 * first load with a one-shot reload (see `captureSnapshot`).
 */
async function navigateAndSettle(page: Page, route: StyleGateRoute) {
  await page.goto(route.path, { waitUntil: "domcontentloaded" });
  // Best-effort networkidle — Next dev mode may never reach it, so cap it short
  // and don't fail the test if it times out.
  await page
    .waitForLoadState("networkidle", { timeout: 5_000 })
    .catch(() => undefined);
}

/**
 * Auth/routing diagnostic — records, per route, whether the rendered page is
 * the intended authed surface or a redirect to the login page, plus the page's
 * own (cookie-bearing) view of `/api/v1/users/me`. Written to an uploaded
 * artifact so the burn-in can tell "authed app rendered" from "bounced to
 * login" without eyeballing every frame. Never throws — diagnostics must not
 * fail the capture.
 */
async function recordAuthDiagnostics(
  page: Page,
  route: StyleGateRoute
): Promise<void> {
  try {
    const finalUrl = page.url();
    // Status only — never persist the response BODY (user PII) or cookies/token
    // (the access_token JWT) into a committed artifact.
    const usersMeStatus = await page.evaluate(async () => {
      try {
        const res = await fetch("/api/v1/users/me", {
          headers: { Accept: "application/json" },
          credentials: "include",
        });
        return res.status;
      } catch {
        return -1;
      }
    });
    const looksLikeLogin =
      /\/(login|sign-?in)\b/i.test(finalUrl) ||
      usersMeStatus === 401 ||
      usersMeStatus === 403;
    const diag = {
      route: route.id,
      requestedPath: route.path,
      finalUrl,
      redirectedAwayFromRoute: !finalUrl.endsWith(route.path),
      looksLikeLogin,
      usersMeStatus,
    };
    mkdirSync(DIAG_DIR, { recursive: true });
    writeFileSync(
      join(DIAG_DIR, `${route.id}.json`),
      JSON.stringify(diag, null, 2),
      "utf8"
    );
    console.warn(
      `[style-gate diag] ${route.id}: finalUrl=${finalUrl} ` +
        `usersMe=${usersMeStatus} looksLikeLogin=${looksLikeLogin}`
    );
  } catch {
    // Diagnostics are best-effort; never break the capture.
  }
}

/** Snapshot relay path (same-origin proxy at app/api/ui-bridge/[...path]). */
const SNAPSHOT_PATH = "/api/ui-bridge/control/snapshot";

/**
 * LOGIN-SURFACE GUARD (P0).
 *
 * The whole point of the style gate is to audit the REAL authed app. If auth
 * silently fails, every "authed" route renders the sign-in screen and the gate
 * audits the wrong page byte-for-byte (the original P0 incident). After
 * navigation we assert the rendered surface is NOT the login screen; on a hit we
 * throw a LOUD, capture-unavailable-flavored failure so the run artifact/log
 * makes "we audited the login page" impossible to miss. The thrown test failure
 * yields no snapshot/frame for the route, which the workflow scores as
 * CAPTURE-UNAVAILABLE (green in SHADOW, but visible) — matching the plan's
 * shadow-soft semantics while never silently passing a login capture.
 *
 * Detection signals (any present => login surface). Kept deliberately broad +
 * cheap so a markup tweak doesn't silently defeat the guard:
 *   - the email input the Cognito-less local login form renders (`input#email`),
 *   - the canonical sign-in heading copy ("Sign in to Qontinui"),
 *   - a redirect that parked us on `/login`.
 */
const LOGIN_EMAIL_SELECTOR = "input#email";
const LOGIN_HEADING_TEXT = "Sign in to Qontinui";

async function assertNotLoginSurface(
  page: Page,
  route: StyleGateRoute
): Promise<void> {
  // 1. Parked on /login (route guard redirected an unauthenticated visit).
  const onLoginRoute = /\/login(\b|\/|\?|#|$)/.test(
    new URL(page.url()).pathname
  );

  // 2. The email field the sign-in form renders.
  const hasEmailInput =
    (await page
      .locator(LOGIN_EMAIL_SELECTOR)
      .count()
      .catch(() => 0)) > 0;

  // 3. The canonical sign-in heading copy (case-insensitive, substring).
  const hasSignInHeading =
    (await page
      .getByText(LOGIN_HEADING_TEXT, { exact: false })
      .count()
      .catch(() => 0)) > 0;

  if (onLoginRoute || hasEmailInput || hasSignInHeading) {
    const signals = [
      onLoginRoute ? `url=${page.url()} (on /login)` : null,
      hasEmailInput ? `${LOGIN_EMAIL_SELECTOR} present` : null,
      hasSignInHeading ? `"${LOGIN_HEADING_TEXT}" heading present` : null,
    ]
      .filter(Boolean)
      .join("; ");
    throw new Error(
      `[style-gate] CAPTURE-UNAVAILABLE — route "${route.id}" (${route.path}) ` +
        `rendered the LOGIN surface, not the authed app (${signals}).\n` +
        `Authentication did not take effect, so the gate would have audited the ` +
        `sign-in page instead of the real app (the P0 incident). NO snapshot/frame ` +
        `is written for this route -> the workflow scores it CAPTURE-UNAVAILABLE ` +
        `(green in SHADOW, but reported loudly here). Check the auth lane: the ` +
        `style-gate workflow mints a hermetic id token (QONTINUI_TEST_ID_TOKEN) ` +
        `that auth.setup.ts seeds; verify the run-local JWKS server is up, ` +
        `COGNITO_ISSUER/COGNITO_ALLOWED_AUDIENCES match the token, and the backend ` +
        `JIT-provisioned the ci-bot user. See tests/e2e/style-gate/README.md.`
    );
  }
}

/** Outcome of a relay-attach poll: the last response seen + whether attached. */
interface RelayPollResult {
  attached: boolean;
  raw: string;
  body: SnapshotResponse;
  status: number;
}

/**
 * Perform exactly ONE `/control/snapshot` fetch and classify it. Shared by
 * `pollRelayUntilAttached` (which loops this) and the post-attach sidebar-wait
 * re-fetch in `captureSnapshot` (which needs exactly one fresh read, not a
 * poll loop).
 */
async function fetchSnapshotOnce(page: Page): Promise<RelayPollResult> {
  const result = await page.evaluate(
    async ({ snapshotPath }) => {
      const res = await fetch(snapshotPath, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "include",
      });
      const text = await res.text();
      return { status: res.status, text };
    },
    { snapshotPath: SNAPSHOT_PATH }
  );

  let parsed: SnapshotResponse = {};
  try {
    parsed = JSON.parse(result.text) as SnapshotResponse;
  } catch {
    // Non-JSON body — leave parsed empty; treated as not-yet-ready below.
  }

  // 503 NO_BROWSER_CONNECTED -> relay client not attached yet; keep polling.
  const notConnected =
    result.status === 503 || parsed.code === "NO_BROWSER_CONNECTED";
  const attached = !notConnected && result.status >= 200 && result.status < 300;
  return { attached, raw: result.text, body: parsed, status: result.status };
}

/**
 * Poll `/control/snapshot` until the in-page `CommandRelayListener` has
 * registered a tab (a non-503 2xx, element-bearing response) or the budget
 * elapses. The ONE relay-readiness mechanism — used by BOTH the cold-start
 * warmup (`beforeAll`) and the per-route capture. Never throws: the caller
 * decides whether a non-attach is fatal (capture) or best-effort (warmup).
 *
 * `page.waitForTimeout` here is bounded by `budgetMs`, but it still counts
 * against the enclosing test/hook timeout — callers must size `budgetMs` to
 * leave room (the warmup runs in `beforeAll` with its own generous hook
 * timeout; the capture runs inside the 60s per-test budget AFTER the shell has
 * already cleared, so its handshake-only budget is small).
 */
async function pollRelayUntilAttached(
  page: Page,
  budgetMs: number
): Promise<RelayPollResult> {
  const deadline = Date.now() + budgetMs;
  let last: RelayPollResult = {
    attached: false,
    raw: "",
    body: {},
    status: -1,
  };

  while (Date.now() < deadline) {
    last = await fetchSnapshotOnce(page);
    if (last.attached) return last;

    await page.waitForTimeout(500);
  }

  return last;
}

/**
 * DOM anchor for the shared `(app)` layout's `UnifiedSidebar` shell (its root
 * `<aside data-sidebar="true">`, rendered unconditionally by every authed
 * route via `(app)/layout.tsx` — including `button-search-k`/`button-home-0`
 * and the rest of the left nav).
 *
 * The relay-attach signal above (`CommandRelayListener` responding 2xx) is
 * NECESSARY but NOT SUFFICIENT for a complete element registry: the sidebar
 * is loaded through its own `next/dynamic(..., { ssr: false })` import
 * wrapped in a separate `<Suspense>`, decoupled from whatever mounts the
 * relay listener higher in the provider tree. On a heavier route — e.g.
 * `/build/workflows`, whose own page bundle (AiGeneratePanel/WorkflowEditor:
 * several textareas, many buttons) is larger to parse/hydrate than
 * `/co-pilot` or `/library` — a loaded CI runner can finish the relay
 * handshake and return a real 2xx from `/control/snapshot` BEFORE the
 * sidebar's chunk has fetched, evaluated, mounted, and had `useAutoRegister`'s
 * MutationObserver (100ms debounce) register its elements. That produced a
 * snapshot with the page's own content fully present but ZERO sidebar
 * elements at all (not just `button-search-k` — confirmed via CI run
 * 28922868789's captured `build-workflows.json`: 22 elements, none of them
 * `button-home-0`/`button-settings`/etc. either). So this is a capture-race
 * across the WHOLE shared shell, not a `build-workflows`-specific product
 * regression or a search-button-specific gap — `contrast_meets_wcag` on
 * `button-search-k` just happens to be the one assertion in this route's
 * spec that depends on the sidebar.
 *
 * Waiting for this selector (present on every authed route by construction)
 * before treating a capture as final closes that race everywhere, instead of
 * bumping a per-route timer (the `settleMs` field in `routes.json` reads like
 * that knob but is intentionally unused — see the field's own doc comment:
 * "readiness is signal-driven, not timer-driven" — a fixed wait would be
 * exactly as flaky under variable CI load).
 */
const APP_SHELL_SIDEBAR_SELECTOR = '[data-sidebar="true"]';

async function waitForAppShellSidebar(
  page: Page,
  timeoutMs = 8_000
): Promise<void> {
  await page
    .locator(APP_SHELL_SIDEBAR_SELECTOR)
    .first()
    .waitFor({ state: "attached", timeout: timeoutMs })
    .catch(() => undefined);
}

/**
 * Relay attach confirmed — but (see `waitForAppShellSidebar`) that alone
 * doesn't guarantee the shared sidebar shell has finished registering its
 * elements. Wait for it, then take ONE fresh snapshot fetch so a sidebar that
 * mounted AFTER the attaching response is reflected in what we write/return.
 * Falls back to the already-attached `attached` result if the re-fetch itself
 * doesn't come back 2xx (never regress below what we already had), and logs
 * loudly if the sidebar still never showed up — that would mean a genuine
 * app-shell regression, not just the capture race this function closes.
 */
async function finalizeSnapshotAfterAttach(
  page: Page,
  route: StyleGateRoute,
  attached: RelayPollResult,
  sidebarTimeoutMs = 8_000
): Promise<{ raw: string; body: SnapshotResponse }> {
  await waitForAppShellSidebar(page, sidebarTimeoutMs);
  const sidebarPresent =
    (await page
      .locator(APP_SHELL_SIDEBAR_SELECTOR)
      .count()
      .catch(() => 0)) > 0;
  if (!sidebarPresent) {
    console.warn(
      `[style-gate] Route "${route.id}": relay attached but the shared app-shell ` +
        `sidebar (${APP_SHELL_SIDEBAR_SELECTOR}) never appeared within budget. ` +
        `Proceeding with whatever the relay returned — the captured snapshot for ` +
        `this route likely lacks button-search-k/button-home-0/etc.`
    );
  }
  // Use `.attached` (not a raw status-range check) — it's the same
  // definition `fetchSnapshotOnce`/`pollRelayUntilAttached` use elsewhere,
  // which correctly excludes a 2xx response whose BODY still carries
  // `code: "NO_BROWSER_CONNECTED"` (e.g. the tab detached from the relay in
  // the moment between the sidebar wait and this re-fetch). A plain status
  // check would wrongly accept that disconnected/empty body as final.
  const refreshed = await fetchSnapshotOnce(page);
  if (refreshed.attached) {
    return { raw: refreshed.raw, body: refreshed.body };
  }
  return { raw: attached.raw, body: attached.body };
}

/**
 * Poll the relay until a browser tab is registered, then return the snapshot.
 * Throws with an actionable message if the relay never attaches within budget.
 *
 * This is the AUTHORITATIVE readiness check: the relay can only attach AFTER the
 * client-side auth context resolves and the `(app)` layout mounts the provider
 * subtree (CommandRelayListener), so polling it implicitly waits for auth + the
 * cold first-compile WITHOUT a separate DOM-wait that would burn the budget.
 *
 * SELF-HEAL on a stalled FIRST load: empirically (run 27001924332) the cold-
 * first /co-pilot page context can land in a state where the SHARED
 * `AuthLoadingShell` never clears within the whole 60s budget — `useAuth()`
 * never resolves the user on that particular first navigation — even though the
 * dev server is warm (the `beforeAll` warmup attached the relay in ~12s) and the
 * SECOND-rendered routes (build-workflows, library) clear in ~20s. A single
 * `page.reload()` re-runs the client auth bootstrap from scratch, which clears
 * the stuck shell (the same way the later routes' fresh navigations do). We
 * therefore split the budget: poll, and if the relay hasn't attached AND the
 * auth shell is still up partway through, reload ONCE and keep polling. No
 * timeout inflation (still inside the 60s per-test budget) and no extra
 * mechanism — it reuses `pollRelayUntilAttached`.
 *
 * Once attached (either attempt), `finalizeSnapshotAfterAttach` additionally
 * waits for the shared sidebar shell before treating the snapshot as final —
 * see that function + `waitForAppShellSidebar` for why relay-attach alone is
 * not a sufficient readiness signal.
 */
async function captureSnapshot(
  page: Page,
  route: StyleGateRoute
): Promise<{ raw: string; body: SnapshotResponse }> {
  // First attempt: give the relay poll the bulk of the budget.
  let last = await pollRelayUntilAttached(page, 32_000);
  if (last.attached) {
    return finalizeSnapshotAfterAttach(page, route, last);
  }

  // Stalled. If the shared auth shell is still up, the client auth bootstrap got
  // stuck on this first navigation — reload once to re-run it, then poll the
  // remaining budget. Cheap probe; never throws.
  const shellStillUp =
    (await page
      .getByText(AUTH_LOADING_SHELL_TEXT, { exact: true })
      .count()
      .catch(() => 0)) > 0;
  console.warn(
    `[style-gate] Route "${route.id}": relay not attached after first poll ` +
      `(last status ${last.status}, code=${last.body.code ?? "n/a"}, ` +
      `authShellStillUp=${shellStillUp}). Reloading once to re-run auth bootstrap.`
  );
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
  await page
    .waitForLoadState("networkidle", { timeout: 5_000 })
    .catch(() => undefined);
  // Budget trimmed from the pre-sidebar-wait 18_000 to 12_000, and the
  // post-attach sidebar wait below capped to 3_000 (vs. the first attempt's
  // default 8_000) — this fallback branch is already the tight one (32s first
  // poll + 5s reload settle + this poll, all inside the single 60s per-test
  // timeout in playwright.config.ts); adding the new sidebar wait at its full
  // default here would risk pushing an already-marginal recovery path over
  // the wall. Net budget for this branch is unchanged from before this fix
  // (18_000 -> 12_000 + 3_000 wait + a fast re-fetch ≈ the same envelope).
  last = await pollRelayUntilAttached(page, 12_000);
  if (last.attached) {
    return finalizeSnapshotAfterAttach(page, route, last, 3_000);
  }

  // Budget exhausted — surface a precise, actionable failure. A loud failure
  // beats a captured-but-empty snapshot.
  const detail =
    last.status >= 0
      ? `last status ${last.status}, code=${last.body.code ?? "n/a"}`
      : "no response captured";
  throw new Error(
    `[style-gate] Route "${route.id}" (${route.path}): UI-Bridge relay never ` +
      `attached, so ${SNAPSHOT_PATH} could not return a snapshot (${detail}).\n` +
      `The CommandRelayListener mounts only when the env gate ` +
      `(dev OR NEXT_PUBLIC_UI_BRIDGE_REMOTE_COMMANDS=1) AND the per-user ` +
      `co-pilot preference AND per-session consent are all on. This spec ` +
      `enables the preference (beforeAll) and seeds per-session consent ` +
      `(beforeEach); ensure CI runs with the env gate enabled (the dev ` +
      `webServer does). See tests/e2e/style-gate/README.md.`
  );
}

// Gate 2: enable the per-user co-pilot preference once for the whole file via
// the authed request context (carries this project's storageState). Done in
// beforeAll so a single PUT covers every route's test.
//
// WARMUP (cold-start de-flake): a fresh Next dev server compiles the `(app)`
// layout + provider tree + each route + the `/api/ui-bridge/control/snapshot`
// relay-proxy route ON FIRST HIT. Whichever route renders FIRST pays that
// one-time dev-compile cost ON TOP OF the cold client-side auth round-trip AND
// the relay-attach handshake. That sum reliably exceeds the 60s per-test budget,
// so the first route (co-pilot, first in routes.json) flaked to CAPTURE-
// UNAVAILABLE — the failure-time snapshot showed the SHARED `AuthLoadingShell`
// ("Loading...") still up at 60s while the warm routes after it captured in
// ~20s. The prior warmup only waited for the auth shell to clear (and silently
// swallowed the cold-start failure when it didn't), so it never actually drove
// the relay to attach — it left the heavy client-auth + relay-attach work to be
// re-paid cold inside the first per-test budget.
//
// This warmup instead runs the FULL readiness dance — navigate -> auth shell
// clears -> co-pilot ready badge -> RELAY ATTACHES — and BLOCKS on the relay
// actually attaching, in `beforeAll` where there is no 60s per-test cap (we give
// the hook a generous timeout below). That forces the cold compile of every
// module the capture needs (layout, route, AND the relay proxy) plus the client
// auth + relay handshake to complete ONCE, before any per-test budget starts —
// so the first real test runs as warm as the others. One mechanism: the same
// `pollRelayUntilAttached` the capture uses.
//
// Best-effort on the OUTCOME: a warmup miss must not fail the suite (the per-
// route capture + login guard still produce the precise, actionable failure),
// but we log loudly whether the warmup attached so a regression is diagnosable
// from the run log rather than silently swallowed.
test.beforeAll(async ({ request, browser }) => {
  // Generous hook budget: the cold dev-server first-compile of the (app)
  // layout + co-pilot route + relay proxy, the cold auth round-trip, and the
  // relay-attach handshake must all fit here ONCE. This is the wall-clock the
  // prior fixed 45s per-test `waitForAuthedShell` could not afford without
  // starving the relay poll.
  test.setTimeout(180_000);

  await enableCoPilotPreference(request);

  const context = await browser.newContext({
    storageState: STORAGE_STATE_PATH,
    viewport: VIEWPORT,
  });
  let attached = false;
  let lastStatus = -1;
  try {
    const page = await context.newPage();
    await seedAuthAndConsentInitScript(page);
    // Warm the historically-cold path end to end. /co-pilot is first in
    // routes.json, so warming IT specifically retires the exact path that flaked.
    await page.goto("/co-pilot", { waitUntil: "domcontentloaded" });
    await page
      .waitForLoadState("networkidle", { timeout: 10_000 })
      .catch(() => undefined);
    // Long shell wait here (no per-test cap) — pay the cold auth + compile.
    await waitForAuthedShell(page, 120_000);
    await waitForCoPilotReady(page, 30_000);
    // Block until the relay genuinely attaches (compiles the proxy route + runs
    // the listener handshake). 60s covers the post-mount handshake on a server
    // that just compiled the route synchronously above.
    const result = await pollRelayUntilAttached(page, 60_000);
    attached = result.attached;
    lastStatus = result.status;
  } catch (err) {
    console.warn(
      `[style-gate] warmup threw before the relay attached: ${String(err)}`
    );
  } finally {
    await context.close();
  }

  if (attached) {
    console.warn(
      "[style-gate] warmup: relay attached on /co-pilot — dev server is warm " +
        "(layout + co-pilot route + relay proxy compiled, auth + handshake done)."
    );
  } else {
    console.warn(
      `[style-gate] warmup: relay did NOT attach on /co-pilot within budget ` +
        `(last status ${lastStatus}). The per-route capture will still try and ` +
        `fail loudly if the cold path can't complete in the per-test budget.`
    );
  }
});

// Gate 0 (client-side auth) + Gate 3 (relay consent), both seeded via a single
// init script that runs before any page script on every navigation.
//
// Gate 0 — why this is needed: the diagnostic proved the routes bounce to
// `/login` CLIENT-SIDE (the `(app)` route guard's `useAuth()` had no user), NOT
// at the middleware (the `access_token` cookie is present and well-scoped, and
// `/users/me` is 200 via it). The client-side AuthProvider
// (`contexts/auth-context.tsx`): when `is_authenticated` is set it checks
// `isAccessTokenExpired()` and, if expired, tries `refreshAccessToken()` — which
// fails here (no refresh cookie) → `logout()` → redirect. The fix is the SAME
// proven recipe Spec CI uses for same-origin authed crawling
// (`tests/spec-ci/run-spec-ci.ts:1506-1519`): seed `is_authenticated=true` AND a
// FUTURE `token_expiry`, so `isAccessTokenExpired()` returns false, the refresh
// branch is skipped, and `getCurrentUser()` (cookie-backed) populates the user.
// The `access_token` cookie (from `auth.setup`) covers both the middleware gate
// and `getCurrentUser`; no Bearer or marker cookie is needed.
const IS_AUTHENTICATED_KEY = "is_authenticated";
const TOKEN_EXPIRY_KEY = "token_expiry";
const TOKEN_EXPIRY_WINDOW_MS = 3600 * 1000;

/**
 * Seed gate-0 (client-side auth fast-path) + gate-3 (relay consent) via a single
 * init script that runs before any page script on every navigation. Extracted so
 * BOTH the per-test `beforeEach` AND the `beforeAll` warmup seed identically —
 * the warmup must hit the SAME authed/consented path the real captures do, or it
 * wouldn't warm the provider subtree the relay needs.
 */
async function seedAuthAndConsentInitScript(page: Page): Promise<void> {
  await page.addInitScript(
    ({ consentKey, consentValue, authedKey, expiryKey, expiryWindowMs }) => {
      try {
        window.localStorage.setItem(authedKey, "true");
        // Date.now() here runs in the BROWSER at navigation time (page JS), not
        // in the workflow — a future expiry so isAccessTokenExpired() is false.
        window.localStorage.setItem(
          expiryKey,
          (Date.now() + expiryWindowMs).toString()
        );
        window.sessionStorage.setItem(consentKey, consentValue);
      } catch {
        // best effort — privacy modes can throw on storage access.
      }
    },
    {
      consentKey: CO_PILOT_CONSENT_KEY,
      consentValue: CO_PILOT_CONSENT_GRANTED,
      authedKey: IS_AUTHENTICATED_KEY,
      expiryKey: TOKEN_EXPIRY_KEY,
      expiryWindowMs: TOKEN_EXPIRY_WINDOW_MS,
    }
  );
}

test.beforeEach(async ({ page }) => {
  await seedAuthAndConsentInitScript(page);
});

// One test per authed route. (Gate 1, the env gate, is the CI environment's
// responsibility — the dev webServer satisfies it.)
for (const route of AUTHED_ROUTES) {
  test(`capture ${route.id} (${route.path})`, async ({ page }) => {
    mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    mkdirSync(FRAMES_DIR, { recursive: true });

    await page.setViewportSize(VIEWPORT);
    await navigateAndSettle(page, route);

    // Auth/routing diagnostic BEFORE the snapshot — records whether the page
    // landed on the authed surface or bounced to login (to an uploaded
    // artifact), even if a later step fails. Best-effort, never throws.
    await recordAuthDiagnostics(page, route);

    // P0 GUARD: refuse to capture the login surface. If auth silently failed
    // this throws a loud CAPTURE-UNAVAILABLE failure (no snapshot/frame written)
    // instead of auditing the sign-in page byte-for-byte. Runs AFTER the
    // diagnostic so the diagnostic artifact still records the bounce.
    await assertNotLoginSurface(page, route);

    // Snapshot first (fail loudly if the relay never attached), then frame.
    const { raw, body } = await captureSnapshot(page, route);

    const elementCount = countElements(body);
    expect(
      elementCount,
      `[style-gate] Route "${route.id}" returned a snapshot with 0 elements — ` +
        `an empty snapshot is worse than a loud failure. The page (or the ` +
        `shared sidebar shell — see waitForAppShellSidebar) may not have ` +
        `finished mounting, or the AutoRegisterProvider registry is empty for ` +
        `this surface.`
    ).toBeGreaterThan(0);

    // Normalize bbox before writing: map the SDK's `{x,y,width,height}` floats
    // to the Rust analyzer's `{x,y,w,h}` u32 Region (the ONLY shape transform
    // required — see `normalizeSnapshotForAnalyzer`). All other fields pass
    // through unchanged (the Rust `Element` has no `deny_unknown_fields`).
    const snapshotToWrite = normalizeSnapshotForAnalyzer(raw, body);
    writeFileSync(
      join(SNAPSHOTS_DIR, `${route.id}.json`),
      snapshotToWrite,
      "utf8"
    );

    // Deterministic frame: fixed viewport, fullPage:false (viewport-clipped so
    // height is stable run-to-run regardless of scroll content).
    await page.screenshot({
      path: join(FRAMES_DIR, `${route.id}.png`),
      fullPage: false,
    });
  });
}
