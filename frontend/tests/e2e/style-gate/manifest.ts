/**
 * Style-gate routes-manifest contract (pure, unit-testable).
 *
 * Owns ONE decision: given a route entry from `routes.json`, which capture
 * path does the spec take?
 *
 *   `public: false` -> "relay"    — the AUTHED path. Navigate with the
 *                                   setup-minted storageState and read the
 *                                   snapshot through the same-origin relay
 *                                   proxy `GET /api/ui-bridge/control/snapshot`,
 *                                   which is served by the in-page
 *                                   `CommandRelayListener`. That listener needs
 *                                   a resolved `{userId, sessionId}`, so this
 *                                   path REQUIRES an authenticated tab.
 *
 *   `public: true`  -> "injected" — the RELAY-INDEPENDENT path. Navigate in a
 *                                   FRESH, UNAUTHENTICATED browser context and
 *                                   read the snapshot IN-PAGE from UI Bridge's
 *                                   shipped injected runtime
 *                                   (`@qontinui/ui-bridge/injected/bundle.global.js`,
 *                                   added as a pre-first-paint init script;
 *                                   `window.__uiBridgeInjected.execute(
 *                                   'getControlSnapshot', {})`). No relay, no
 *                                   listener, no session — so a page that ships
 *                                   ZERO UI Bridge code, or ships it but can't
 *                                   mount the listener because nobody is signed
 *                                   in, is still capturable.
 *
 * Both paths converge on the SAME artifact shapes (`.artifacts/snapshots/<id>.json`
 * + `.artifacts/frames/<id>.png`, normalized through `normalize.ts`), so the
 * downstream analyzer cannot tell them apart.
 *
 * Deliberately dependency-free (no Playwright import) so vitest can exercise
 * the contract directly — the same split `normalize.ts` uses.
 */

/** A single gated route as declared in `routes.json`. */
export interface StyleGateRoute {
  /** Filesystem-safe slug; also the artifact basename. */
  id: string;
  /** Route path passed to `page.goto()`. */
  path: string;
  /** true -> unauthenticated route captured via the injected runtime. */
  public: boolean;
  /** Extra wait after networkidle before capture (see routes.json). */
  settleMs: number;
  /** Human note on what the route is / proves. */
  description?: string;
}

/** Parsed `routes.json` envelope. */
export interface RoutesManifest {
  routes: StyleGateRoute[];
}

/**
 * Which snapshot mechanism a route's capture uses.
 *   - `relay`    — `GET /api/ui-bridge/control/snapshot` through the in-page
 *                  `CommandRelayListener` (authenticated tab required).
 *   - `injected` — UI Bridge's injected runtime, read in-page via
 *                  `window.__uiBridgeInjected.execute(...)` (no relay, no auth).
 */
export type CapturePath = "relay" | "injected";

/**
 * The single place the manifest's `public` field is interpreted.
 *
 * `public` is REQUIRED and must be a boolean. A missing/non-boolean value
 * throws rather than defaulting: silently treating an unreadable entry as
 * authed would either drop the route from the capture entirely (the old
 * `filter(r => r.public === false)` behaviour) or send an unauthenticated route
 * down the relay path, where it can only ever 503. A loud manifest error is
 * cheaper than either.
 */
export function capturePathFor(route: StyleGateRoute): CapturePath {
  if (typeof route.public !== "boolean") {
    throw new Error(
      `[style-gate] routes.json entry "${route.id ?? "<no id>"}" has ` +
        `public=${JSON.stringify(route.public)} — the field is REQUIRED and ` +
        `must be a boolean (false = authed/relay capture, true = ` +
        `unauthenticated/injected capture). See routes.json's $comment.`
    );
  }
  return route.public ? "injected" : "relay";
}

/**
 * Split a manifest's routes into the two capture lanes. The spec builds one
 * `test()` per entry of each lane; the lanes share nothing but the artifact
 * shapes they emit.
 */
export function partitionRoutesByCapturePath(routes: StyleGateRoute[]): {
  relay: StyleGateRoute[];
  injected: StyleGateRoute[];
} {
  const relay: StyleGateRoute[] = [];
  const injected: StyleGateRoute[] = [];
  for (const route of routes) {
    if (capturePathFor(route) === "injected") injected.push(route);
    else relay.push(route);
  }
  return { relay, injected };
}

/**
 * Parse + shape-guard the committed manifest text. Kept here (rather than in
 * the spec) so the unit test can validate the REAL `routes.json` bytes through
 * the same code the capture uses.
 */
export function parseRoutesManifest(raw: string): StyleGateRoute[] {
  const parsed = JSON.parse(raw) as RoutesManifest;
  if (!parsed || !Array.isArray(parsed.routes)) {
    throw new Error(
      `style-gate routes.json is malformed: expected { routes: [...] }`
    );
  }
  return parsed.routes;
}
