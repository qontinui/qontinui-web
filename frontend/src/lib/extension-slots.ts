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
 * See: D:/qontinui-root/qontinui-cloud-control/  (private repo)
 *      D:/qontinui-root/tmp_cloud_control_carve_out.md  §4.1.
 */

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
 * Callers JSX-render the result conditionally:
 *
 * ```tsx
 * const Switcher = getComponent<SwitcherProps>("organizationSwitcher");
 * return Switcher ? <Switcher {...props} /> : null;
 * ```
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
