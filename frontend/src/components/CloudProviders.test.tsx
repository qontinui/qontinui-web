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
