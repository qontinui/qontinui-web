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

import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
  if (body.data && Array.isArray((body.data as { elements?: unknown[] }).elements)) {
    return (body.data as { elements: unknown[] }).elements;
  }
  return null;
}

/**
 * Bbox-normalization adapter — the ONE shape transform between the web SDK's
 * snapshot and the Rust analyzer.
 *
 * WHY this exists:
 *   - The web UI-Bridge SDK emits each element's bbox as
 *     `{ x, y, width, height }` with FLOAT values
 *     (`ui-bridge/packages/ui-bridge/src/control/types.ts:454`).
 *   - The Rust analyzer's `Region`
 *     (`qontinui-schemas/rust-vision-core/src/frame.rs:63-67`) requires exactly
 *     `{ x, y, w, h }` as `u32` — no serde aliases, no rename. A verbatim bbox
 *     therefore fails deserialization with `missing field 'w'`.
 *   - The Rust `Element`
 *     (`qontinui-schemas/rust-vision-core/src/element_snapshot.rs:38-51`) has NO
 *     `deny_unknown_fields` and only `id` is required (every other field is
 *     `#[serde(default)]`/Option, and the SDK always supplies `id`). So the
 *     SDK's extra fields are harmlessly ignored and `bbox` is the ONLY shape
 *     that must be transformed — nothing else is touched.
 *
 * This corrects the original plan's "write the snapshot verbatim — it's a
 * byte-identical runner-native shape" assumption, which was wrong about the
 * bbox field names (`width`/`height` -> `w`/`h`) and value type (float -> u32).
 *
 * Transform: for each element that HAS a bbox (bbox is optional — bbox-less
 * elements are left untouched, matching `Region`'s `Option`), replace
 * `{ x, y, width, height }` (floats) with `{ x, y, w, h }` (rounded ints).
 * A malformed/partial bbox (missing any of x/y/width/height, or a non-finite
 * value) is DROPPED rather than written as NaN — `bbox: Option<Region>` accepts
 * absence, and a NaN/partial Region would crash the analyzer's deserialize.
 * Every other field is left exactly as-is.
 *
 * Mutates the elements in place (the caller re-serializes the same body).
 */
function normalizeBboxes(elements: unknown[]): void {
  for (const el of elements) {
    if (!el || typeof el !== "object") continue;
    const record = el as Record<string, unknown>;
    if (!("bbox" in record)) continue; // bbox is optional — leave as-is.

    const bbox = record.bbox;
    if (!bbox || typeof bbox !== "object") {
      // Present but not an object -> malformed; drop so it can't crash the
      // analyzer (an Option<Region> tolerates absence).
      delete record.bbox;
      continue;
    }

    const { x, y, width, height } = bbox as {
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
    };
    const vals = [x, y, width, height];
    const allFinite = vals.every(
      (v) => typeof v === "number" && Number.isFinite(v)
    );
    if (!allFinite) {
      // Missing or non-finite component -> drop rather than emit NaN.
      delete record.bbox;
      continue;
    }

    record.bbox = {
      x: Math.round(x as number),
      y: Math.round(y as number),
      w: Math.round(width as number),
      h: Math.round(height as number),
    };
  }
}

/**
 * Apply the bbox-normalization adapter to a parsed snapshot body and return the
 * re-serialized JSON ready to write. When no element array is found (shouldn't
 * happen — the caller's element-count guard fires first), the original raw text
 * is returned unchanged so we never silently drop a snapshot we couldn't parse.
 */
function normalizeSnapshotForAnalyzer(
  raw: string,
  body: SnapshotResponse
): string {
  const elements = locateElements(body);
  if (!elements) return raw;
  normalizeBboxes(elements);
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
    const prefs = (await verify
      .json()
      .catch(() => null)) as Record<string, unknown> | null;
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
 * Navigate + settle. Mirrors the existing specs: `domcontentloaded` first
 * (Next dev mode keeps HMR/WebSocket alive so `networkidle` can hang), then a
 * best-effort `networkidle` wait, then the route's explicit `settleMs`.
 */
async function navigateAndSettle(page: Page, route: StyleGateRoute) {
  await page.goto(route.path, { waitUntil: "domcontentloaded" });
  // Best-effort networkidle — Next dev mode may never reach it, so cap it and
  // don't fail the test if it times out (the explicit settleMs covers us).
  await page
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => undefined);
  await page.waitForTimeout(route.settleMs);
}

/** Snapshot relay path (same-origin proxy at app/api/ui-bridge/[...path]). */
const SNAPSHOT_PATH = "/api/ui-bridge/control/snapshot";

/**
 * Poll the relay until a browser tab is registered, then fetch the snapshot.
 * Returns the parsed body once a non-503 element-bearing snapshot is obtained.
 * Throws with an actionable message if the relay never attaches within budget.
 */
async function captureSnapshot(
  page: Page,
  route: StyleGateRoute
): Promise<{ raw: string; body: SnapshotResponse }> {
  const deadline = Date.now() + 20_000;
  let last: { status: number; raw: string; body: SnapshotResponse } | null =
    null;

  while (Date.now() < deadline) {
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
    last = { status: result.status, raw: result.text, body: parsed };

    // 503 NO_BROWSER_CONNECTED -> relay client not attached yet; keep polling.
    const notConnected =
      result.status === 503 || parsed.code === "NO_BROWSER_CONNECTED";
    if (!notConnected && result.status >= 200 && result.status < 300) {
      return { raw: result.text, body: parsed };
    }

    await page.waitForTimeout(500);
  }

  // Budget exhausted — surface a precise, actionable failure. A loud failure
  // beats a captured-but-empty snapshot.
  const detail = last
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
test.beforeAll(async ({ request }) => {
  await enableCoPilotPreference(request);
});

// Gate 3: seed per-session consent so the relay listener mounts on a fresh tab.
// Runs before any page script on every navigation in this file.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, value }) => {
      try {
        window.sessionStorage.setItem(key, value);
      } catch {
        // sessionStorage can throw in some privacy modes — best effort.
      }
    },
    { key: CO_PILOT_CONSENT_KEY, value: CO_PILOT_CONSENT_GRANTED }
  );
});

// One test per authed route. (Gate 1, the env gate, is the CI environment's
// responsibility — the dev webServer satisfies it.)
for (const route of AUTHED_ROUTES) {
  test(`capture ${route.id} (${route.path})`, async ({ page }) => {
    mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    mkdirSync(FRAMES_DIR, { recursive: true });

    await page.setViewportSize(VIEWPORT);
    await navigateAndSettle(page, route);

    // Snapshot first (fail loudly if the relay never attached), then frame.
    const { raw, body } = await captureSnapshot(page, route);

    const elementCount = countElements(body);
    expect(
      elementCount,
      `[style-gate] Route "${route.id}" returned a snapshot with 0 elements — ` +
        `an empty snapshot is worse than a loud failure. The page may not have ` +
        `finished mounting (raise settleMs) or the AutoRegisterProvider registry ` +
        `is empty for this surface.`
    ).toBeGreaterThan(0);

    // Normalize bbox before writing: map the SDK's `{x,y,width,height}` floats
    // to the Rust analyzer's `{x,y,w,h}` u32 Region (the ONLY shape transform
    // required — see `normalizeSnapshotForAnalyzer`). All other fields pass
    // through unchanged (the Rust `Element` has no `deny_unknown_fields`).
    const snapshotToWrite = normalizeSnapshotForAnalyzer(raw, body);
    writeFileSync(join(SNAPSHOTS_DIR, `${route.id}.json`), snapshotToWrite, "utf8");

    // Deterministic frame: fixed viewport, fullPage:false (viewport-clipped so
    // height is stable run-to-run regardless of scroll content).
    await page.screenshot({
      path: join(FRAMES_DIR, `${route.id}.png`),
      fullPage: false,
    });
  });
}
