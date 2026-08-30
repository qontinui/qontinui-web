/**
 * Tests for the `providers` extension slot and `<CloudProviders>`.
 *
 * The slot exists because the registry used to transport `components` and
 * `services` but no PROVIDERS, so a cloud component that read its own
 * package's React context could never find one. On 2026-08-26 that took down
 * every authenticated page on qontinui.io.
 *
 * Contract under test:
 *   - OSS-only (nothing registered): children render untouched
 *   - a registered provider is mounted around children
 *   - registration order decides nesting (first registered = outermost)
 *   - a provider registered LATE still reaches an already-mounted consumer
 *   - the snapshot is reference-stable, so useSyncExternalStore cannot loop
 *
 * A second `describe` at the bottom covers the MOUNT SITE — that
 * `app/(app)/layout.tsx` renders this component at all, and where. Those
 * read the layout as source rather than rendering it; see that block's own
 * header for why.
 */

import fs from "node:fs";
import path from "node:path";
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, act } from "@testing-library/react";

import { CloudProviders } from "./CloudProviders";
import {
  getProviders,
  registerCloudExtensions,
  type CloudProvider,
} from "@/lib/extension-slots";

// The registry is module-level singleton state and deliberately exposes no
// reset — production registers once and never unregisters. So these tests are
// written to ACCUMULATE rather than to isolate: each registers provider names
// unique to itself and asserts only on its own markers and on relative
// nesting, never on the registry being globally empty. The one test that does
// depend on emptiness (the OSS-only case) is first in the file.

function makeProvider(label: string): CloudProvider {
  return function Provider({ children }) {
    return (
      <div data-testid={`provider-${label}`}>
        <span>{label}</span>
        {children}
      </div>
    );
  };
}

describe("CloudProviders", () => {
  it("renders children untouched when nothing is registered (OSS-only)", () => {
    render(
      <CloudProviders>
        <div data-testid="child">child</div>
      </CloudProviders>
    );

    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("mounts a registered provider around children", () => {
    registerCloudExtensions({
      providers: { orgProvider: makeProvider("org") },
    });

    render(
      <CloudProviders>
        <div data-testid="child">child</div>
      </CloudProviders>
    );

    const provider = screen.getByTestId("provider-org");
    expect(provider).toBeInTheDocument();
    // Containment is the whole point: the child must be INSIDE the provider.
    expect(provider).toContainElement(screen.getByTestId("child"));
  });

  it("nests in registration order, first registered outermost", () => {
    registerCloudExtensions({ providers: { aProvider: makeProvider("a") } });
    registerCloudExtensions({ providers: { bProvider: makeProvider("b") } });

    render(
      <CloudProviders>
        <div data-testid="child">child</div>
      </CloudProviders>
    );

    const outer = screen.getByTestId("provider-a");
    const inner = screen.getByTestId("provider-b");
    expect(outer).toContainElement(inner);
    expect(inner).toContainElement(screen.getByTestId("child"));
  });

  it("delivers a LATE registration to an already-mounted consumer", () => {
    render(
      <CloudProviders>
        <div data-testid="child">child</div>
      </CloudProviders>
    );
    expect(screen.queryByTestId("provider-late")).not.toBeInTheDocument();

    // cloud-control's registerCloudExtensions can land after the app shell
    // mounts; the subscription is what makes it reach this component.
    act(() => {
      registerCloudExtensions({
        providers: { lateProvider: makeProvider("late") },
      });
    });

    expect(screen.getByTestId("provider-late")).toBeInTheDocument();
  });

  it("REMOUNTS its children when a registration lands late", () => {
    // The cost of the line above, pinned. Adding a provider wraps the
    // innermost node in one more element, so the child at that position
    // changes type and React deletes that subtree and rebuilds it rather
    // than moving it, discarding all of its state. In the composed build
    // that subtree is the ENTIRE authenticated tree.
    //
    // Nothing here is a defect to fix: you cannot wrap a subtree in a
    // provider without changing its parent. Two unrelated properties keep
    // production off this path — the boot import is static, and
    // `AppAuthGate` keeps `CloudProviders` out of the hydration render
    // (`docs/composed-cloud-build.md`).
    //
    // This test does NOT guard either of those; it registers by hand and
    // never imports the boot module. It pins the CONSEQUENCE, so the cost of
    // losing one of them is a measured fact rather than a design note.
    let mounts = 0;
    function StatefulChild() {
      React.useEffect(() => {
        mounts += 1;
      }, []);
      return <div data-testid="stateful">child</div>;
    }

    render(
      <CloudProviders>
        <StatefulChild />
      </CloudProviders>
    );
    expect(mounts).toBe(1);

    act(() => {
      registerCloudExtensions({
        providers: { remountProvider: makeProvider("remount") },
      });
    });

    // A second mount, not a re-render: the child was torn down and rebuilt.
    expect(mounts).toBe(2);
    expect(screen.getByTestId("stateful")).toBeInTheDocument();
  });

  it("hands out a reference-stable snapshot between registrations", () => {
    registerCloudExtensions({ providers: { s1: makeProvider("s1") } });
    const first = getProviders();
    const second = getProviders();

    // useSyncExternalStore re-renders forever if the snapshot allocates a new
    // value per call. Identity, not deep-equality, is the requirement.
    expect(first).toBe(second);

    registerCloudExtensions({ providers: { s2: makeProvider("s2") } });
    expect(getProviders()).not.toBe(first);
    expect(getProviders()).toHaveLength(first.length + 1);
  });
});

/**
 * The mount site, guarded at the source.
 *
 * Everything above renders `<CloudProviders>` by hand, and
 * `cloud-extensions-boot.registration.test.tsx` only proves the registry
 * gets filled — it reaches the boot module by `await import(...)`, so it
 * never looks at a mount site either. Neither notices if
 * `app/(app)/layout.tsx` stops rendering `<CloudProviders>` at all:
 * cloud-control would keep registering `organizationProvider`, every test
 * would stay green, and the composed build would go straight back to the
 * 2026-08-26 configuration — a component slot filled with no provider
 * mounted behind it.
 *
 * That is the same ships-completely-inert failure class the loader-liveness
 * guard exists for, one layer up. The OTHER mount site in that class is
 * `<CloudExtensionsBoot />` in `app/layout.tsx`, which is what puts the
 * package in the client graph at all; it is guarded by the matching block in
 * `cloud-extensions-boot.registration.test.tsx`. The two are a pair — an
 * inert boot registers nothing, an absent `CloudProviders` mounts nothing —
 * and neither had a mount-site assertion before.
 *
 * Read as source rather than rendered because the layout is the app's real
 * client shell: importing it pulls a dozen context providers, `next/dynamic`
 * chunks and `useAuth`, and mocking all of that would leave the assertion
 * testing the mocks.
 *
 * KNOW WHAT THIS IS. It is a token-presence-and-ordering scan over one
 * file's text, not a structural check on the exported component. It is
 * satisfiable by dead code in that file, and extracting the provider stack
 * into a sibling module would red it while the app stayed correct. It buys
 * the case that actually happens — someone deletes or hoists a wrapper they
 * do not recognise as load-bearing — and it is deliberately worded so that
 * a benign refactor's failure reads as "confirm the invariant, then update
 * this scan" rather than as a bug report.
 */
describe("CloudProviders — mount site", () => {
  /**
   * Read per test, not once in the `describe` body: a collection-time throw
   * here would fail the six rendering cases above too, which have nothing to
   * do with the layout.
   *
   * Comments are stripped because that file's doc blocks name
   * `<CloudProviders>` and `AppAuthGate` in prose — including the block
   * explaining this very nesting, which sits ABOVE the JSX. Scanning raw
   * text reports the ordering backwards. Block comments go first, so a
   * future `// … /*` would swallow real code; if this scan ever fails while
   * the layout visibly still renders the component, suspect that before
   * suspecting the layout.
   */
  function layoutSource(): string {
    const file = path.resolve(process.cwd(), "src/app/(app)/layout.tsx");
    return fs
      .readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  }

  // Tag matchers allow attributes: `<CloudProviders>` gaining a prop is not
  // a regression, and a scan that reds on one trains people to delete it.
  const OPEN_PROVIDERS = /<CloudProviders[\s>]/;
  const OPEN_GATE = /<AppAuthGate[\s>]/;

  it("is imported and rendered by the authenticated layout", () => {
    const source = layoutSource();

    expect(source).toContain(
      'import { CloudProviders } from "@/components/CloudProviders";'
    );
    expect(
      source,
      "app/(app)/layout.tsx no longer renders <CloudProviders> - if that was deliberate, cloud-control's providers are now registered and never mounted"
    ).toMatch(OPEN_PROVIDERS);
    expect(source).toContain("</CloudProviders>");
  });

  it("renders CloudProviders INSIDE AppAuthGate, not around it", () => {
    // The nesting is the load-bearing part, not just the presence.
    // `AppAuthGate` withholds its children while `useAuth()` is loading —
    // which on the server is always — so a `CloudProviders` inside it never
    // takes part in the hydration render. Hoisted outside the gate it would,
    // and `useSlotProviders`' server snapshot is empty, so every composed
    // build page load would mount zero providers, swap to the real snapshot,
    // and remount the entire authenticated tree. See `CloudProviders.tsx`
    // and `AppAuthGate`'s own doc block.
    const source = layoutSource();
    const gateOpen = source.search(OPEN_GATE);
    const providersOpen = source.search(OPEN_PROVIDERS);
    const providersClose = source.indexOf("</CloudProviders>");
    const gateClose = source.indexOf("</AppAuthGate>");

    expect(gateOpen).toBeGreaterThanOrEqual(0);
    expect(providersOpen).toBeGreaterThan(gateOpen);
    expect(providersClose).toBeGreaterThan(providersOpen);
    expect(gateClose).toBeGreaterThan(providersClose);
  });

  it("keeps AppAuthGate withholding children while auth loads", () => {
    // The condition itself. If this early return goes away — an SSR cookie
    // read, a synchronous `localStorage` seed, an optimistic
    // `loading: false` — `CloudProviders` joins the hydration render and the
    // nesting assertion above stops being worth anything.
    const source = layoutSource();
    const start = source.indexOf("function AppAuthGate(");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = source.indexOf("\n}", start);

    // Bracket contents blanked FIRST: the redirect effect's dependency array
    // ends `[loading, user, ...]` immediately above the early return, so
    // scanning the raw text finds `loading` there and stays green on a gate
    // narrowed to `if (!user)` — the exact regression. (That is how the
    // first draft of this assertion failed to catch its own falsification.)
    const body = source.slice(start, end).replace(/\[[^\]]*\]/g, "[]");

    const returnAt = body.indexOf("return <AuthLoadingShell");
    expect(returnAt).toBeGreaterThan(0);

    // A window rather than a shape: `if (loading || !user)`,
    // `if (isBlocked(loading))` and a hoisted `const showShell = loading ||
    // !user` are all correct, and a regex pinning one of them reds on the
    // other two.
    const guard = body.slice(Math.max(0, returnAt - 120), returnAt);

    expect(
      guard,
      "AppAuthGate's early return is no longer keyed on `loading` - if you restructured it, confirm children are still withheld while useAuth() reports loading (see AppAuthGate's doc block), then update this scan"
    ).toMatch(/\bloading\b/);
  });
});
