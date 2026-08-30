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
 * gets filled. Neither notices if `app/(app)/layout.tsx` stops rendering
 * `<CloudProviders>` at all — cloud-control would keep registering
 * `organizationProvider`, every test would stay green, and the composed
 * build would go straight back to the 2026-08-26 configuration: a component
 * slot filled with no provider mounted behind it. That is the same
 * ships-completely-inert failure class the loader-liveness guard exists for,
 * one layer up, and it was the one layer with no guard.
 *
 * Read as source rather than rendered because the layout is the app's real
 * client shell: importing it pulls a dozen context providers, `next/dynamic`
 * chunks and `useAuth`, and mocking all of that would leave the assertion
 * testing the mocks. The structural facts here are exactly the ones a
 * refactor can drop silently, and they are cheap to read literally.
 */
describe("CloudProviders — mount site", () => {
  const LAYOUT = path.resolve(process.cwd(), "src/app/(app)/layout.tsx");
  const raw = fs.readFileSync(LAYOUT, "utf8");

  /**
   * Comments stripped, because the doc blocks in that file name
   * `<CloudProviders>` and `AppAuthGate` in prose — including the block that
   * explains this very nesting. Scanning the raw text would match the
   * explanation instead of the code and report the ordering backwards.
   */
  const source = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("is imported and rendered by the authenticated layout", () => {
    expect(source).toContain(
      'import { CloudProviders } from "@/components/CloudProviders";'
    );
    expect(
      source,
      "app/(app)/layout.tsx must render <CloudProviders>, or cloud-control's providers are registered and never mounted"
    ).toMatch(/<CloudProviders>/);
    expect(source).toMatch(/<\/CloudProviders>/);
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
    const gateOpen = source.indexOf("<AppAuthGate>");
    const providersOpen = source.indexOf("<CloudProviders>");
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
    const start = source.indexOf("function AppAuthGate(");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = source.indexOf("\n}", start);
    const body = source.slice(start, end);

    // Read the condition guarding the early return, not merely "the word
    // `loading` appears somewhere in the function" — it also appears in the
    // redirect effect, so a looser match stays green when the gate is
    // narrowed to `if (!user)` and children start rendering during load.
    const returnAt = body.indexOf("return <AuthLoadingShell");
    expect(returnAt).toBeGreaterThan(0);
    const guard = body.slice(Math.max(0, returnAt - 120), returnAt);

    expect(
      guard,
      "AppAuthGate's early return must still be keyed on `loading`, or CloudProviders joins the hydration render - see its doc block"
    ).toMatch(/if\s*\([^)]*\bloading\b[^)]*\)\s*\{\s*$/);
  });
});
