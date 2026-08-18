/**
 * Cloud-control extension slots.
 *
 * OSS-only builds register nothing here; the slots stay empty and the app
 * runs as a single-tenant install.
 *
 * The proprietary `@qontinui/cloud-control` package side-effect-registers
 * its routes, components, services, and contexts at module-load time by
 * calling `registerCloudExtensions(...)` from its `src/index.ts`.
 *
 * **The registry is observable.** That registration arrives asynchronously —
 * `app/layout.tsx` loads the package with a fire-and-forget
 * `import(CLOUD_CONTROL_PKG).catch(() => {})` — so it routinely lands *after*
 * a consumer has already rendered. `registerCloudExtensions` therefore
 * notifies every listener registered through `subscribeToSlots` once all its
 * mutations are applied.
 *
 * **React consumers must use `useSlotComponent`, never `getComponent`.**
 * A bare `getComponent(name)` read during render returns `undefined` until
 * the dynamic import resolves and nothing re-renders the consumer afterwards,
 * so the slot renders nothing *forever* — a silent failure indistinguishable
 * from a correct OSS-only deploy. `useSlotComponent` subscribes, so a slot
 * filled after first render re-renders its consumer. `getComponent` /
 * `getService` / `getSlots` remain the right API for non-React callers
 * (e.g. `services/service-factory.ts`'s Proxy, which re-reads on every
 * property access and so has no staleness problem).
 *
 * This module imports React hooks, which are absent from React's
 * `react-server` build. Verified 2026-08-18 by walking the app-router server
 * graph from all 78 non-`"use client"` entry points: `extension-slots.ts` is
 * not reachable without crossing a `"use client"` boundary, and all four
 * component-slot consumers are client components.
 *
 * See: D:/qontinui-root/qontinui-cloud-control/  (private repo)
 *      D:/qontinui-root/tmp_cloud_control_carve_out.md  §4.1.
 */

import { useCallback, useSyncExternalStore } from "react";
import type { ComponentType, LazyExoticComponent } from "react";

export interface NavItem {
  href: string;
  label: string;
  icon?: ComponentType;
  superuserOnly?: boolean;
}

export interface RouteSlot {
  /** App-router path, e.g. "/billing/success". */
  path: string;
  /**
   * Lazy-loaded component. Critical that this is a `lazy(() => import(...))`
   * so the OSS bundle never imports cloud-control code statically — the
   * bundler must be free to treeshake the dynamic import when the
   * cloud-control package is not linked.
   */
  Component: LazyExoticComponent<ComponentType<unknown>>;
}

export interface ProfilePanel {
  /** Stable id, e.g. "billing". Used for tab routing and active state. */
  id: string;
  label: string;
  Component: LazyExoticComponent<ComponentType<unknown>>;
}

export interface ExtensionSlots {
  appRoutes: RouteSlot[];
  marketingRoutes: RouteSlot[];
  navItems: NavItem[];
  profilePanels: ProfilePanel[];
  /**
   * Service overrides keyed by name (e.g. "billingService",
   * "organizationService"). OSS calls `getService<T>(name)`; returns
   * `undefined` when no override is registered.
   */
  services: Map<string, unknown>;
  /**
   * Inline component overrides keyed by name (e.g. "organizationSwitcher",
   * "createOrganizationDialog"). OSS calls `getComponent<P>(name)`;
   * returns `undefined` when no override is registered, in which case
   * the OSS shell is expected to render nothing in that slot. Cloud-
   * control's `registerCloudExtensions({ components: { ... } })`
   * attaches the real React components.
   *
   * Distinct from `services` because components are React-renderable
   * factories with a props contract — consumers JSX-render
   * `<Slot {...props} />` rather than calling methods.
   */
  components: Map<string, ComponentType<unknown>>;
}

const slots: ExtensionSlots = {
  appRoutes: [],
  marketingRoutes: [],
  navItems: [],
  profilePanels: [],
  services: new Map(),
  components: new Map(),
};

/**
 * Listeners notified after every `registerCloudExtensions` call. Module-level
 * (not per-slot) because registration is coarse — one `index.ts` call attaches
 * everything cloud-control ships — so a single notification per call is both
 * sufficient and cheaper than per-slot bookkeeping.
 */
const slotListeners = new Set<() => void>();

/**
 * Subscribe to slot-registration events. Returns the unsubscribe function.
 *
 * This is exactly the `useSyncExternalStore` subscribe contract, and
 * `useSlotComponent` below is built on it. Exported in its own right so
 * non-component code (and future hooks over `appRoutes` / `navItems` /
 * `profilePanels`) can react to a late registration too.
 */
export function subscribeToSlots(listener: () => void): () => void {
  slotListeners.add(listener);
  return () => {
    slotListeners.delete(listener);
  };
}

/**
 * Cloud-control's `index.ts` calls this at module-load time with the
 * subset of slots it wants to attach.
 *
 * Semantics:
 *
 * - `appRoutes` / `marketingRoutes` / `navItems` / `profilePanels`:
 *   **additive** (push). Calling twice with overlapping paths produces
 *   duplicate routes — let the router complain.
 * - `services`: **last-write-wins** (Map.set overwrites). Lets hot-reload
 *   swap a `BillingService` cleanly without a stale instance hanging
 *   around. Production: do not call multiple times. Hot-reload:
 *   explicitly supported.
 *
 * Every `subscribeToSlots` listener is notified once, after all mutations
 * above have been applied — never per-slot, so subscribers never observe a
 * half-registered registry.
 */
export function registerCloudExtensions(
  partial: Partial<{
    appRoutes: RouteSlot[];
    marketingRoutes: RouteSlot[];
    navItems: NavItem[];
    profilePanels: ProfilePanel[];
    services: Record<string, unknown>;
    components: Record<string, ComponentType<unknown>>;
  }>
): void {
  if (partial.appRoutes) slots.appRoutes.push(...partial.appRoutes);
  if (partial.marketingRoutes)
    slots.marketingRoutes.push(...partial.marketingRoutes);
  if (partial.navItems) slots.navItems.push(...partial.navItems);
  if (partial.profilePanels) slots.profilePanels.push(...partial.profilePanels);
  if (partial.services) {
    for (const [k, v] of Object.entries(partial.services)) {
      slots.services.set(k, v);
    }
  }
  if (partial.components) {
    for (const [k, v] of Object.entries(partial.components)) {
      slots.components.set(k, v);
    }
  }

  // Notify AFTER every mutation: subscribers re-read the registry, so a
  // mid-loop notification would let them snapshot a partial registration.
  // Iterate a copy so a listener that unsubscribes (or subscribes) while
  // being notified cannot perturb this pass.
  for (const listener of [...slotListeners]) {
    listener();
  }
}

/** Read-only snapshot of all registered slots. */
export function getSlots(): Readonly<ExtensionSlots> {
  return slots;
}

/**
 * Look up a service slot by name. Returns `undefined` when no
 * cloud-control override has been registered (the OSS-only case).
 *
 * Callers must handle `undefined` (e.g. don't render a billing button
 * when `getService("billingService") === undefined`).
 */
export function getService<T>(name: string): T | undefined {
  return slots.services.get(name) as T | undefined;
}

/**
 * Look up a component slot by name. Returns `undefined` when no
 * cloud-control override has been registered (the OSS-only case).
 *
 * **Not for React consumers — use `useSlotComponent` instead.** This is a
 * one-shot read with no subscription: called during render before the
 * cloud-control bundle's dynamic `import()` resolves, it returns `undefined`
 * and nothing ever re-renders the consumer, so the slot stays empty for the
 * lifetime of the page. Kept exported for non-React callers that re-read on
 * demand (and for tests).
 *
 * The generic parameter `P` carries the props contract; the slot's
 * stored component is typed `ComponentType<unknown>` (registered by
 * cloud-control without OSS knowing the exact shape) and is cast on
 * read. If cloud-control's actual component shape diverges from the
 * caller's expectation, the runtime will surface a React prop
 * warning — same as any other component-prop mismatch.
 */
export function getComponent<P>(name: string): ComponentType<P> | undefined {
  return slots.components.get(name) as ComponentType<P> | undefined;
}

/**
 * Subscribed React read of a component slot. Returns `undefined` when no
 * cloud-control override is registered (the OSS-only case, and the composed
 * case before the cloud-control bundle has loaded) — and re-renders the
 * caller when one is registered later.
 *
 * This is the API every React consumer of a component slot must use:
 *
 * ```tsx
 * function OrganizationSwitcherSlot(props: OrganizationSwitcherProps) {
 *   const Slot = useSlotComponent<OrganizationSwitcherProps>("organizationSwitcher");
 *   return Slot ? <Slot {...props} /> : null;
 * }
 * ```
 *
 * Implementation notes for anyone touching this:
 *
 * - The client snapshot is a `Map.get` — a stable component reference between
 *   notifications, which is what `useSyncExternalStore` requires (a snapshot
 *   that allocates a fresh value each call makes React loop forever).
 * - The snapshot closures are memoised on `name` for the same reason: an
 *   unmemoised closure re-subscribes on every render.
 * - The server snapshot is `undefined` so SSR and OSS-only agree. React 18+
 *   throws on a server/client snapshot mismatch, and the registry is empty on
 *   the server by construction (the cloud-control bundle only loads in the
 *   browser).
 */
export function useSlotComponent<P>(
  name: string
): ComponentType<P> | undefined {
  const getSnapshot = useCallback(
    () => slots.components.get(name) as ComponentType<P> | undefined,
    [name]
  );
  const getServerSnapshot = useCallback(
    (): ComponentType<P> | undefined => undefined,
    []
  );
  return useSyncExternalStore(subscribeToSlots, getSnapshot, getServerSnapshot);
}
