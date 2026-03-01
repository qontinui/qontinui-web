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
 *   import pageSpec from './my-page.spec.uibridge.json';
 *   usePageSpecs({ 'my-page': pageSpec });
 */

import { useEffect } from "react";
import { getGlobalSpecStore, type SpecConfig } from "@qontinui/ui-bridge/specs";

/**
 * Load one or more SpecConfig objects into the global SpecStore.
 * Unloads them when the component unmounts.
 *
 * @param specs - Map of specId → SpecConfig
 */
export function usePageSpecs(specs: Record<string, SpecConfig>): void {
  useEffect(() => {
    const store = getGlobalSpecStore();
    const ids = Object.keys(specs);

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
    // Only run on mount/unmount — specs object identity is stable (module-level import)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
