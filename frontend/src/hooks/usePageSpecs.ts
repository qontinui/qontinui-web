/**
 * usePageSpecs
 *
 * Loads spec configs into the global SpecStore so they are discoverable
 * by the Chrome extension's `getSpecs` command. Unloads on unmount.
 *
 * Also exposes the store instance on window.__QONTINUI_SPEC_STORE__
 * so the Chrome extension inspector (MAIN world) can read it directly,
 * avoiding module singleton duplication issues in bundled apps.
 *
 * Usage:
 *   const discoveredSpec = useDiscoveredSpec('my-page');
 *   usePageSpecs(discoveredSpec ? { 'my-page': discoveredSpec.config } : {});
 */

import { useEffect, useMemo } from "react";
import { getGlobalSpecStore, type SpecConfig } from "@qontinui/ui-bridge/specs";

/**
 * Load one or more SpecConfig objects into the global SpecStore.
 * Unloads them when the component unmounts or when the spec set changes.
 *
 * The effect re-fires when the set of spec ids changes — this matters now
 * that callers feed runtime-fetched specs (Section 13.5): on first render
 * the runtime cache may be empty (`specs = {}`), then resolves on a later
 * render. The original `[]` deps caused those late arrivals to be dropped.
 *
 * @param specs - Map of specId → SpecConfig
 */
export function usePageSpecs(specs: Record<string, SpecConfig>): void {
  // Stable key over the SET of spec ids. Re-firing on identity alone would
  // thrash on every render; configs for a given id are stable post-resolution
  // so id-set is sufficient.
  const specsKey = useMemo(() => Object.keys(specs).sort().join("|"), [specs]);

  useEffect(() => {
    // Specs are a dev-only feature — skip registration in production
    if (process.env.NODE_ENV !== "development") return;

    const store = getGlobalSpecStore();
    const ids = Object.keys(specs);
    if (ids.length === 0) return;

    for (const [id, config] of Object.entries(specs)) {
      store.load(id, config);
    }

    // Expose the store instance directly on window for the Chrome extension
    // inspector script (runs in MAIN world and can access window globals).
    // This avoids module singleton duplication issues in bundled apps
    // where UIBridgeProvider and usePageSpecs get different store singletons.
    if (typeof window !== "undefined") {
      const w = window as unknown as Record<string, unknown>;
      w.__QONTINUI_SPEC_STORE__ = store;

      // Also update __UI_BRIDGE__.specs to point to this store instance,
      // since the UIBridgeProvider may have registered a different (empty) singleton.
      if (w.__UI_BRIDGE__ && typeof w.__UI_BRIDGE__ === "object") {
        (w.__UI_BRIDGE__ as Record<string, unknown>).specs = {
          getGlobalSpecStore: () => store,
        };
      }
    }

    return () => {
      for (const id of ids) {
        store.unload(id);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specsKey]);
}
