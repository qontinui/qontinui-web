/**
 * Slot-registration race regression tests.
 *
 * Plan `2026-08-08-beta-banner-and-subscription-badge-slots`, Verification #3.
 *
 * Written when the cloud-control bundle was loaded by a fire-and-forget
 * `import(CLOUD_CONTROL_PKG).catch(() => {})` at module scope of
 * `app/layout.tsx`, which put `registerCloudExtensions` routinely *after* a
 * slot consumer's first render. That loader is gone — it never resolved at
 * all, and `components/cloud-extensions-boot.tsx` replaced it with a static
 * import — but the property it forced is still required and still tested
 * here: a server render sees empty slots either way, because the boot module
 * lives in the client graph. So the assertion that matters is not "an empty
 * slot doesn't throw" but: **a slot filled after its consumer's first render
 * must make that consumer re-render and show the component, with no other
 * state change.**
 *
 * The `getComponent` control case below is the falsifier — it is the
 * pre-change implementation, and it stays empty forever. If that test ever
 * starts passing, `getComponent` grew a subscription and these tests need
 * rewriting.
 *
 * The `providers` slot (added 2026-08-26) is covered in its own `describe`
 * at the bottom. `CloudProviders.test.tsx` owns the mounting contract; what
 * lives here is the registry-level half — the by-name read, the Map/array
 * coherence at notify time, and the server snapshot — because those are
 * where `useSlotProviders` differs from `useSlotComponent` and the
 * difference is the one that can remount the whole authenticated tree.
 */

import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { ComponentType, ReactNode } from "react";

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

/**
 * The provider slot's registry-level contract.
 *
 * `CloudProviders.test.tsx` covers what mounting a provider does. These
 * cover the three places `useSlotProviders` is not just `useSlotComponent`
 * with a different Map:
 *
 * - it hands out an ARRAY, rebuilt in a separate statement from the Map
 *   write, so the two can disagree at the moment subscribers are notified;
 * - its snapshot is a fresh object rather than a value, so server/client
 *   agreement is identity, not `undefined === undefined`;
 * - a disagreement there does not leave one leaf slot empty, it remounts
 *   every child of `CloudProviders`.
 *
 * `cloud-extensions-boot.registration.test.tsx` also reads `getProvider` /
 * `getProviders`, but each of its cases is skipped in one build shape, so
 * neither runs in both. These run unconditionally.
 */
describe("extension-slots — the providers slot", () => {
  function Passthrough({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }

  it("reads a registered provider back by name", async () => {
    const { registerCloudExtensions, getProvider } = await freshSlots();

    expect(getProvider("organizationProvider")).toBeUndefined();

    registerCloudExtensions({
      providers: { organizationProvider: Passthrough },
    });

    expect(getProvider("organizationProvider")).toBe(Passthrough);
    // A name that was never registered stays `undefined` rather than
    // resolving to some other slot's entry — this is what makes the by-name
    // assertions in the loader-liveness guard mean anything.
    expect(getProvider("someOtherProvider")).toBeUndefined();
  });

  it("has the providers ARRAY rebuilt before subscribers are notified", async () => {
    const {
      registerCloudExtensions,
      subscribeToSlots,
      getProvider,
      getProviders,
    } = await freshSlots();

    // The hazard the registration test names but only checks in the composed
    // job: `registerCloudExtensions` sets the Map and rebuilds the array in
    // two separate statements, and the rebuild can be reordered relative to
    // the notify loop. A subscriber that re-reads on notification — which is
    // every `useSyncExternalStore` consumer, i.e. `CloudProviders` — must
    // already see BOTH.
    let byNameAtNotify: unknown;
    let arrayAtNotify: readonly unknown[] = [];
    const unsubscribe = subscribeToSlots(() => {
      byNameAtNotify = getProvider("organizationProvider");
      arrayAtNotify = getProviders();
    });

    registerCloudExtensions({
      providers: { organizationProvider: Passthrough },
    });
    unsubscribe();

    expect(byNameAtNotify).toBe(Passthrough);
    expect(arrayAtNotify).toHaveLength(1);
    expect(arrayAtNotify[0]).toBe(Passthrough);
  });

  it("hands hydration the SAME empty array the client starts with", async () => {
    const { useSlotProviders } = await freshSlots();

    // React compares the snapshot it hydrated with (`getServerSnapshot`)
    // against `getSnapshot()` afterwards by identity (`Object.is`). Two
    // empty-but-distinct frozen arrays pass every length check here and
    // still count as a change, scheduling a re-render for a value that did
    // not move. Nothing hydrates a `CloudProviders` today — `AppAuthGate`
    // withholds it — so this is the cheap half of the pair: it costs one
    // shared constant instead of a design commitment.
    let fromServer: readonly unknown[] | undefined;
    let fromClient: readonly unknown[] | undefined;
    function Probe({ sink }: { sink: (v: readonly unknown[]) => void }) {
      sink(useSlotProviders());
      return null;
    }

    renderToString(<Probe sink={(v) => (fromServer = v)} />);
    render(<Probe sink={(v) => (fromClient = v)} />);

    expect(fromServer).toHaveLength(0);
    expect(fromServer).toBe(fromClient);
  });

  it("keeps that identity through a registration that adds no provider", async () => {
    const { registerCloudExtensions, getProviders, useSlotProviders } =
      await freshSlots();

    const before = getProviders();

    // `{ providers: {} }` still enters the rebuild branch — a composed build
    // whose cloud-control ships no provider this release is exactly this
    // call. Allocating a fresh `Object.freeze([])` there would leave the
    // client snapshot empty but no longer identical to the server's, which
    // is the single state the shared constant exists to prevent, reached by
    // the one path that looks like a no-op.
    registerCloudExtensions({ providers: {} });

    expect(getProviders()).toHaveLength(0);
    expect(getProviders()).toBe(before);

    let fromServer: readonly unknown[] | undefined;
    function Probe({ sink }: { sink: (v: readonly unknown[]) => void }) {
      sink(useSlotProviders());
      return null;
    }
    renderToString(<Probe sink={(v) => (fromServer = v)} />);
    expect(fromServer).toBe(getProviders());
  });

  it("mounts nothing on the server even when a provider is registered", async () => {
    const { registerCloudExtensions, useSlotProviders } = await freshSlots();

    registerCloudExtensions({
      providers: { organizationProvider: Passthrough },
    });

    // The property `app/(app)/layout.tsx`'s `AppAuthGate` exists to keep out
    // of reach in the composed build, asserted directly at the hook: the
    // server snapshot is empty regardless of what the client registry holds.
    // Returning `providersSnapshot` here instead — the "obvious
    // simplification" — is what would make SSR and hydration disagree.
    let serverCount = -1;
    function CountProbe() {
      serverCount = useSlotProviders().length;
      return null;
    }

    renderToString(<CountProbe />);
    expect(serverCount).toBe(0);
  });
});
