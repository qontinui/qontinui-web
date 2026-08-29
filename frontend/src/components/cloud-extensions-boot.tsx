"use client";

/**
 * Cloud-control registration boot module.
 *
 * `@qontinui/cloud-control` registers its services, components and context
 * providers into `@/lib/extension-slots` as an import side effect. Two
 * things have to be true for that registration to be observable, and until
 * this module existed neither was:
 *
 * 1. **It must be in webpack's graph.** The previous loader lived in
 *    `app/layout.tsx` as
 *    `import(/* webpackIgnore: true *\/ CLOUD_CONTROL_PKG).catch(() => {})`.
 *    `webpackIgnore` removes the specifier from the graph, so Node resolved
 *    it at runtime against the package's `main`
 *    (`./frontend/src/index.ts`) — a TypeScript file in a package with no
 *    build step, so `require` threw `ERR_UNKNOWN_FILE_EXTENSION` and the
 *    `.catch()` swallowed it. Opting out of webpack also opted out of the
 *    host's `@/*` alias, which the package's own entry point depends on.
 *    Here the import is a plain static specifier that webpack resolves —
 *    to the real package via `transpilePackages` when the composed-build
 *    overlay is installed, and to `@/cloud-absent` (a no-op) otherwise.
 *    See `next.config.mjs` and `docs/composed-cloud-build.md`.
 *
 * 2. **It must evaluate in the CLIENT graph.** `app/layout.tsx` is a Server
 *    Component, so a registration performed there lands in the server's
 *    module instance of `extension-slots.ts`. Every consumer is a client
 *    component — `components/navigation/sidebar/UnifiedSidebar.tsx` and
 *    `_components/SidebarHeader.tsx` call `getComponent`,
 *    `services/service-factory.ts` calls `getService` — and reads a
 *    separate browser instance that stayed empty forever. The
 *    `"use client"` directive above is what fixes that: this module is
 *    part of the browser bundle, so the import evaluates in the same
 *    module instance those consumers read.
 *
 * The import is deliberately **static**, not a `useEffect` dynamic import.
 * Registration must complete before React renders anything that reads a
 * slot; an effect-driven load would resolve after the first paint and make
 * `getComponent("organizationSwitcher")` transiently `undefined` — the
 * loader race that ruled out the runtime-registry route-mounting options.
 *
 * The component itself renders nothing. It exists only to give the root
 * layout a client child whose module — and therefore whose import side
 * effect — is guaranteed to be in the initial client bundle.
 */
import "@qontinui/cloud-control";

export function CloudExtensionsBoot(): null {
  return null;
}
