/**
 * Slot-registration race regression tests.
 *
 * Plan `2026-08-08-beta-banner-and-subscription-badge-slots`, Verification #3.
 *
 * The cloud-control bundle is loaded with a fire-and-forget
 * `import(CLOUD_CONTROL_PKG).catch(() => {})` at module scope of
 * `app/layout.tsx`, so `registerCloudExtensions` routinely runs *after* a slot
 * consumer has already rendered. The assertion that matters is therefore not
 * "an empty slot doesn't throw" but: **a slot filled after its consumer's
 * first render must make that consumer re-render and show the component,
 * with no other state change.**
 *
 * The `getComponent` control case below is the falsifier — it is the
 * pre-change implementation, and it stays empty forever. If that test ever
 * starts passing, `getComponent` grew a subscription and these tests need
 * rewriting.
 */

import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { ComponentType } from "react";

type SlotsModule = typeof import("./extension-slots");

/**
 * The registry is module-level singleton state, so every test needs its own
 * module instance — otherwise a registration in one test leaks into the next
 * and the "empty before registration" precondition is silently false.
 */
async function freshSlots(): Promise<SlotsModule> {
  vi.resetModules();
  return await import("./extension-slots");
}

function CloudBanner() {
  return <div data-testid="cloud-banner">Beta!</div>;
}

describe("extension-slots — registration is observable", () => {
  it("re-renders a useSlotComponent consumer when the slot is filled after first render", async () => {
    const { registerCloudExtensions, useSlotComponent } = await freshSlots();

    function BannerSlot() {
      const Slot = useSlotComponent<Record<string, never>>("betaBanner");
      return Slot ? <Slot /> : null;
    }

    render(<BannerSlot />);

    // Precondition: OSS-only / bundle-not-yet-loaded renders nothing.
    expect(screen.queryByTestId("cloud-banner")).toBeNull();

    // The late registration — the ONLY thing that happens. No prop change,
    // no context update, no other state change that could cause a re-render.
    act(() => {
      registerCloudExtensions({
        components: { betaBanner: CloudBanner as ComponentType<unknown> },
      });
    });

    expect(screen.getByTestId("cloud-banner")).toBeInTheDocument();
  });

  it("leaves a bare getComponent consumer empty forever (the pre-change defect)", async () => {
    const { registerCloudExtensions, getComponent } = await freshSlots();

    function BannerSlot() {
      const Slot = getComponent<Record<string, never>>("betaBanner");
      return Slot ? <Slot /> : null;
    }

    render(<BannerSlot />);
    expect(screen.queryByTestId("cloud-banner")).toBeNull();

    act(() => {
      registerCloudExtensions({
        components: { betaBanner: CloudBanner as ComponentType<unknown> },
      });
    });

    // Registered, but nothing re-rendered the consumer — the silent failure
    // this change exists to remove.
    expect(getComponent("betaBanner")).toBeDefined();
    expect(screen.queryByTestId("cloud-banner")).toBeNull();
  });

  it("notifies subscribers once per registerCloudExtensions call, after all mutations", async () => {
    const { registerCloudExtensions, subscribeToSlots, getComponent, getService } =
      await freshSlots();

    let calls = 0;
    let sawBothComponents = false;
    let sawService = false;
    const unsubscribe = subscribeToSlots(() => {
      calls += 1;
      sawBothComponents =
        getComponent("betaBanner") !== undefined &&
        getComponent("organizationSwitcher") !== undefined;
      // The other slot kind, mutated in the same call: the point of the
      // notify-after-all-mutations rule is that a subscriber never observes
      // one half of a registration. (This read used to be `navItems`, which
      // phase 5 deleted along with the rest of the unreadable slots.)
      sawService = getService("billingService") !== undefined;
    });

    registerCloudExtensions({
      services: { billingService: { getSubscription: () => undefined } },
      components: {
        betaBanner: CloudBanner as ComponentType<unknown>,
        organizationSwitcher: CloudBanner as ComponentType<unknown>,
      },
    });

    expect(calls).toBe(1);
    expect(sawBothComponents).toBe(true);
    expect(sawService).toBe(true);

    unsubscribe();
    registerCloudExtensions({ components: {} });
    expect(calls).toBe(1);
  });

  it("unsubscribes on unmount", async () => {
    const { registerCloudExtensions, useSlotComponent } = await freshSlots();

    function BannerSlot() {
      const Slot = useSlotComponent<Record<string, never>>("betaBanner");
      return Slot ? <Slot /> : null;
    }

    const { unmount } = render(<BannerSlot />);
    unmount();

    // No "update on an unmounted component" warning / throw.
    expect(() =>
      registerCloudExtensions({
        components: { betaBanner: CloudBanner as ComponentType<unknown> },
      })
    ).not.toThrow();
  });

  it("renders nothing on the server even when the slot is filled (server snapshot)", async () => {
    const { registerCloudExtensions, useSlotComponent } = await freshSlots();

    function BannerSlot() {
      const Slot = useSlotComponent<Record<string, never>>("betaBanner");
      return Slot ? <Slot /> : null;
    }

    registerCloudExtensions({
      components: { betaBanner: CloudBanner as ComponentType<unknown> },
    });

    // `getServerSnapshot` must return `undefined` so SSR and OSS-only agree —
    // React 18+ throws on a server/client snapshot mismatch.
    expect(renderToString(<BannerSlot />)).toBe("");
  });
});
