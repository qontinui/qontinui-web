/**
 * The public pages must ship their body in the FIRST response.
 *
 * Regression guard for the defect that broke 20 assertions on shard 3 of run
 * 34039419789. `(marketing)/layout.tsx` wrapped `{children}` in a
 * `<Suspense fallback={null}>`, and `RenderLogWrapper` wrapped the entire app
 * tree in another one. Neither supplied any fallback UI; what they did supply
 * was permission for React's streaming SSR to defer the whole document body
 * OUT OF ORDER. The served HTML then carried an empty `<main>` and parked the
 * real page in a `<div hidden id="S:n">` staging container, which React moves
 * into place later via its `$RC`/`$RV` reveal — a `requestAnimationFrame`-
 * and ~300 ms-throttled client callback.
 *
 * That cost two things:
 *
 *  1. Users, crawlers and social scrapers got an empty `<main>` in the HTML
 *     for `/`, `/docs/**` and `/runner/**` — the public pages that most need
 *     server-rendered content.
 *  2. For the length of the reveal window the page was in the DOM TWICE (the
 *     client-rendered copy plus the still-hidden staged copy). Playwright
 *     locators match hidden elements, so `getByText(...)` resolved to 2
 *     elements and any assertion whose first poll landed in that window died
 *     with `strict mode violation`. The window exists under `next dev` too;
 *     the production build only made it reachable, because the page is served
 *     in ~2 s instead of after a first-hit compile.
 *
 * These assertions read the raw HTTP response — no browser, no JavaScript —
 * so they fail the moment the body goes back behind a streaming boundary.
 */

import { test, expect } from "@playwright/test";

/** Routes whose body must be in the initial HTML, and a string proving it. */
const PUBLIC_ROUTES: Array<{ path: string; marker: string }> = [
  { path: "/", marker: "Verifies Its Own Work" },
  { path: "/docs", marker: "Qontinui Documentation" },
  { path: "/docs/getting-started", marker: "3 simple steps" },
  { path: "/docs/web", marker: "Model-Based Automation" },
  { path: "/docs/runner", marker: "Visual Execution Monitoring" },
  { path: "/runner", marker: "Ready to get started?" },
];

/**
 * A staging container React has NOT yet emptied, i.e. `<div hidden id="S:n">`
 * with something inside it. The same tag with an immediate `</div>` is the
 * spent husk React leaves behind and is harmless.
 */
const NON_EMPTY_STAGED = /<div hidden id="S:\d+"[^>]*>(?!<\/div>)/;

for (const { path, marker } of PUBLIC_ROUTES) {
  test(`${path} serves its body in the initial HTML`, async ({ request }) => {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    const html = await response.text();

    // The page's own content, not just the layout chrome.
    expect(html).toContain(marker);

    // ...and it is not parked in a streaming staging container waiting for a
    // client-side reveal. This is the assertion that actually pins the fix:
    // the marker above would still be found INSIDE `<div hidden id="S:n">`.
    expect(
      NON_EMPTY_STAGED.test(html),
      `${path} deferred its body into a React streaming staging container ` +
        `(<div hidden id="S:n">). Something re-introduced a Suspense boundary ` +
        `around the page body — see the header of this file.`
    ).toBe(false);
  });
}
