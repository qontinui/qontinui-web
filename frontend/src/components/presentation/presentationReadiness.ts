/**
 * presentationReadiness — where the presentation lens applies, and which of
 * its pages may render in presentation mode (plan
 * `2026-10-23-console-presentation-spaces` D3: "redaction fails CLOSED, by
 * construction").
 *
 * ## The lens trees
 *
 * {@link LENS_TREES} are the route trees whose layouts mount
 * `PresentationLens`: every page under them is a lens surface, and so is the
 * app shell around them (the sidebar), which `PresentationShell` puts in the
 * same mode. `presentationReadiness.test.ts` fails when this list and the
 * layouts that mount the lens disagree, in either direction.
 *
 * ## Readiness — a page is withheld until it is proven safe
 *
 * The lens primitives (`OperatorOnly`, `RedactedText`, `MachineName`,
 * `CostFigure`) protect only what a page routes through them. A page nobody
 * has converted renders its operator view verbatim — its drain levers, its
 * hostnames, its foreign titles — and a toggle that says "controls hidden"
 * above it would be the lie `ux-priorities`
 * `a-status-signal-must-observe-the-state-it-names` forbids. So presentation
 * mode does not trust a page by default: `PresentationPage` renders a lens
 * page's own body only when its route is in
 * {@link PRESENTATION_READY_ROUTES}; every other page under a lens tree
 * renders a withheld placeholder (its surface caption, and that the page is
 * shown in the operator view only).
 *
 * **To present a page, register it here IN THE SAME CHANGE as the page test
 * that proves it**: a presentation-mode render of the page that passes
 * `expectPresentationSafe` (`src/test/presentation.tsx`). `provenBy` names
 * that test file. What makes it a proof is read from the RUN, not from the
 * test's source (`src/test/readinessEvidence.ts`). A run armed by the
 * readiness test — `presentationReadiness.test.ts` declares the arming on
 * itself when the file is collected, so `npm run test`, and so CI, is armed
 * wherever that file lives, and skipping that test does not disarm it — fails
 * unless that same run also ran the proof, and in it:
 *
 * - a test that FINISHED passed (so not skipped at run time, from wherever,
 *   nor failed, nor concurrent) ran the page check over a render in which
 *   this route's page module's own default export was mounted under a
 *   presenting lens, rendered something and all of it inside the element the
 *   check read, with check (b) reading that render's own UI Bridge registry,
 *   and the last such check over that render found nothing;
 * - and no render of the page, in any test of the proof however it ended,
 *   settled with its last such check finding a violation.
 *
 * So a route cannot be declared ready on a promise, on a proof that did not
 * run, on one whose check did not read the page — another component, a page
 * unmounted or portaled out of what the check read, a view assembled from two
 * renders, a registry the page does not register with — or on a clean check
 * the run's own record of a violation contradicts. A run no test armed (one
 * that leaves the readiness test out by file, or a `-t` filter that skips it)
 * claims nothing either way. Out of
 * reach: a proof that writes that evidence itself, or mocks or edits the
 * checker's own modules, the reporter, the readiness test (deleting its arming
 * test included), the setup file or
 * the vitest config; a proof that mocks a module the page renders (a child
 * component, a lens primitive), so the render is not production's — mock
 * data sources only; and the state the proof checks the page in, which is
 * the proof's choice. Over-withholding costs a placeholder instead of a page,
 * which D3 accepts; a page shown before it is safe costs a write control, a
 * hostname or a client's name in front of an evaluator.
 */

/** A lens page that renders in presentation mode, and the test proving it may. */
export interface PresentationReadyRoute {
  /**
   * The app route, without the `(app)` group. A `[param]` segment matches any
   * one segment (`/admin/coord/work-units/[slug]`).
   */
  readonly route: string;
  /**
   * The page test, relative to `src/`, whose presentation-mode render of this
   * route's page passes `expectPresentationSafe`.
   */
  readonly provenBy: string;
}

/** The route trees whose layouts mount `PresentationLens`. */
export const LENS_TREES: readonly string[] = ["/admin/coord", "/digital-twin"];

/**
 * The lens pages proven safe to render in presentation mode. Phase 1 builds
 * the lens and converts no surface: every lens surface is withheld until the
 * phase that adopts it (plan Phases 2 and 4–8) registers it here with its
 * test. The one page Phase 1 registers is the console's landing redirect,
 * which shows one sentence: withheld, it would never mount and so never
 * redirect, and every presenting tab sent to `/admin/coord` would stop there.
 */
export const PRESENTATION_READY_ROUTES: readonly PresentationReadyRoute[] = [
  { route: "/admin/coord", provenBy: "app/(app)/admin/coord/page.test.tsx" },
  // Dev Ops (plan Phase 7): the page's presentation-mode render, over a
  // fixture feeding every free-text carrier it can show.
  {
    route: "/admin/coord/devops",
    provenBy: "app/(app)/admin/coord/devops/page.presentation.test.tsx",
  },
];

/** `pathname` without its query, hash and trailing slash. */
export function normalizePath(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0] ?? "";
  return path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
}

function segments(path: string): string[] {
  return normalizePath(path).split("/").filter(Boolean);
}

/** Whether `pathname` is `pattern`, a `[param]` segment matching any one segment. */
export function routeMatches(pattern: string, pathname: string): boolean {
  const want = segments(pattern);
  const got = segments(pathname);
  if (want.length !== got.length) return false;
  return want.every(
    (segment, i) => /^\[[^\]/]+\]$/.test(segment) || segment === got[i]
  );
}

/** Whether `pathname` is in a lens tree — the tree's root or below it. */
export function isLensTreePath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return LENS_TREES.some(
    (tree) => path === tree || path.startsWith(`${tree}/`)
  );
}

/** Whether the page at `pathname` may render in presentation mode. */
export function isPresentationReady(
  pathname: string,
  routes: readonly PresentationReadyRoute[] = PRESENTATION_READY_ROUTES
): boolean {
  return routes.some((entry) => routeMatches(entry.route, pathname));
}
