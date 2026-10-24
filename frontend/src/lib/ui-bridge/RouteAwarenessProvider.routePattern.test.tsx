/**
 * RouteAwarenessProvider must report a route TEMPLATE, never a concrete path.
 *
 * The runner's journey ledger stores `RouteInfo.pattern` as `pathnameTemplate`,
 * which must never carry user input. Live acceptance on 2026-10-09 found
 * `/search/<sentinel>` stored verbatim: the provider reported `usePathname()`
 * as the pattern, and `/search/*` is a 404 (Next renders the not-found
 * boundary inside the root layout, where `useParams()` is `{}`).
 *
 * These tests run the REAL SDK (`UIBridgeProvider`, `useRouteAwareness`, the
 * pattern helper and the not-found signal) and the REAL `app/not-found.tsx`,
 * and spy on the navigation tracker's `setRouteInfo`. Every assertion about
 * the sentinel is over EVERY call, not only the last: an intermediate report
 * of the concrete path is exactly the leak, even if a later call corrects it.
 *
 * Plan: 2026-10-09-journey-ledger-stores-a-concrete-url-path-as-a-route-pattern
 * (Phase 3).
 */

import React, { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

type Params = Record<string, string | string[]>;

/** What the mocked `next/navigation` hooks return; mutated per test. */
const nav: { pathname: string; params: Params; search: string } = {
  pathname: "/",
  params: {},
  search: "",
};

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useParams: () => nav.params,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: vi.fn() }),
}));

import {
  UIBridgeProvider,
  useUIBridgeOptional,
} from "@qontinui/ui-bridge/react";
import { RouteAwarenessProvider } from "./RouteAwarenessProvider";
import NotFound from "@/app/not-found";

type SetRouteInfo = (info: unknown) => void;

const SENTINEL = "JP2SENTINELw4r8mv";

let setRouteInfo: ReturnType<typeof vi.fn<SetRouteInfo>> | null = null;

/**
 * Installs the spy on the provider's real navigation tracker in a LAYOUT
 * effect. Every layout effect of a commit runs before any passive effect, and
 * `useRouteAwareness` reports from a passive effect, so the spy is in place
 * before the first report.
 */
function TrackerSpy() {
  const bridge = useUIBridgeOptional();
  useLayoutEffect(() => {
    if (!bridge || setRouteInfo) return;
    const tracker = bridge.navigationTracker as unknown as {
      setRouteInfo: SetRouteInfo;
    };
    const original = tracker.setRouteInfo.bind(tracker);
    const spy = vi.fn<SetRouteInfo>((info) => original(info));
    tracker.setRouteInfo = spy;
    setRouteInfo = spy;
  }, [bridge]);
  return null;
}

function App({ children }: { children: React.ReactNode }) {
  return (
    <UIBridgeProvider>
      <TrackerSpy />
      <RouteAwarenessProvider>{children}</RouteAwarenessProvider>
    </UIBridgeProvider>
  );
}

function Page() {
  return <p>page</p>;
}

type Reported = { pattern?: string | null; patternSource?: string } | undefined;

function reported(): Reported[] {
  expect(setRouteInfo).not.toBeNull();
  return (setRouteInfo?.mock.calls ?? []).map((c) => c[0] as Reported);
}

function lastReported(): Reported {
  const calls = reported();
  return calls[calls.length - 1];
}

/** No report, in any field, ever carried the sentinel. */
function expectSentinelNeverReported(): void {
  const calls = reported();
  expect(calls.length).toBeGreaterThan(0);
  for (const info of calls) {
    expect(JSON.stringify(info ?? null)).not.toContain(SENTINEL);
  }
}

/** No report's PATTERN ever carried the sentinel. */
function expectSentinelNeverInPattern(): void {
  const calls = reported();
  expect(calls.length).toBeGreaterThan(0);
  for (const info of calls) {
    expect(info?.pattern ?? "").not.toContain(SENTINEL);
  }
}

beforeEach(() => {
  setRouteInfo = null;
  nav.pathname = "/";
  nav.params = {};
  nav.search = "";
});

afterEach(() => {
  cleanup();
});

describe("RouteAwarenessProvider route pattern", () => {
  it("a 404 (/search/<sentinel>) never reports the concrete path, on any call", () => {
    nav.pathname = `/search/${SENTINEL}`;
    nav.params = {};

    const { getByText } = render(
      <App>
        <NotFound />
      </App>
    );

    expect(getByText("Page not found")).toBeTruthy();
    expectSentinelNeverReported();
    expect(lastReported()).toMatchObject({
      pattern: null,
      patternSource: "router",
    });
  });

  it("a client navigation from a matched page to a 404 never reports the concrete path", () => {
    nav.pathname = "/marketplace/widget";
    nav.params = { slug: "widget" };
    const { rerender } = render(
      <App>
        <Page />
      </App>
    );
    expect(lastReported()).toMatchObject({
      pattern: "/marketplace/[slug]",
      patternSource: "router",
    });

    nav.pathname = `/search/${SENTINEL}`;
    nav.params = {};
    rerender(
      <App>
        <NotFound />
      </App>
    );

    expectSentinelNeverReported();
    expect(lastReported()).toMatchObject({
      pattern: null,
      patternSource: "router",
    });
  });

  it("leaving a 404 for a matched page reports the new template", () => {
    nav.pathname = `/search/${SENTINEL}`;
    nav.params = {};
    const { rerender } = render(
      <App>
        <NotFound />
      </App>
    );

    nav.pathname = "/marketplace/widget";
    nav.params = { slug: "widget" };
    rerender(
      <App>
        <Page />
      </App>
    );

    expectSentinelNeverReported();
    expect(lastReported()).toMatchObject({
      pattern: "/marketplace/[slug]",
      patternSource: "router",
    });
  });

  it("a dynamic route (/marketplace/[slug]) reports its [param] template", () => {
    nav.pathname = `/marketplace/${SENTINEL}`;
    nav.params = { slug: SENTINEL };

    render(
      <App>
        <Page />
      </App>
    );

    expectSentinelNeverInPattern();
    expect(lastReported()).toMatchObject({
      pattern: "/marketplace/[slug]",
      patternSource: "router",
    });
  });

  it("a nested dynamic route templates every param", () => {
    nav.pathname = `/projects/${SENTINEL}/testing/runs/run42`;
    nav.params = { projectId: SENTINEL, runId: "run42" };

    render(
      <App>
        <Page />
      </App>
    );

    expectSentinelNeverInPattern();
    expect(lastReported()).toMatchObject({
      pattern: "/projects/[projectId]/testing/runs/[runId]",
      patternSource: "router",
    });
  });

  it("passes useParams() raw, so a catch-all array templates as [...name]", () => {
    nav.pathname = `/docs/guides/${SENTINEL}`;
    nav.params = { slug: ["guides", SENTINEL] };

    render(
      <App>
        <Page />
      </App>
    );

    expectSentinelNeverInPattern();
    expect(lastReported()).toMatchObject({
      pattern: "/docs/[...slug]",
      patternSource: "router",
    });
  });

  it("passes useParams() raw, so a ONE-segment catch-all templates as [...name], not [name]", () => {
    // Flattened, `["x"]` becomes the string "x" and templates as `[slug]`;
    // only the raw array distinguishes a catch-all from a plain param.
    nav.pathname = `/docs/${SENTINEL}`;
    nav.params = { slug: [SENTINEL] };

    render(
      <App>
        <Page />
      </App>
    );

    expectSentinelNeverInPattern();
    expect(lastReported()).toMatchObject({
      pattern: "/docs/[...slug]",
      patternSource: "router",
    });
  });

  it("a static route reports itself", () => {
    nav.pathname = "/login";
    nav.params = {};

    render(
      <App>
        <Page />
      </App>
    );

    expect(lastReported()).toMatchObject({
      pattern: "/login",
      patternSource: "router",
    });
  });
});
