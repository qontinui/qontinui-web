/**
 * OSS stand-in for `@qontinui/cloud-control`.
 *
 * `next.config.mjs` aliases the package specifier `@qontinui/cloud-control`
 * to this file whenever the composed-build overlay is NOT installed (see
 * `docs/composed-cloud-build.md`). That lets
 * `src/components/cloud-extensions-boot.tsx` carry a plain, statically
 * resolvable side-effect import instead of the `webpackIgnore` dynamic
 * import it replaced — which could never load anything, and whose
 * `.catch(() => {})` hid that fact for the lifetime of the extension
 * surface.
 *
 * Registering nothing here is the whole point: an OSS-only build leaves
 * every slot in `@/lib/extension-slots` empty, and every consumer already
 * treats an empty slot as "not the cloud deployment" — `getService` and
 * `getComponent` return `undefined`, and `CloudProviders` renders its
 * children untouched. The module is intentionally side-effect-free and
 * value-free so webpack tree-shakes it to nothing and no cloud-control
 * chunk appears in the OSS client bundle.
 *
 * This file covers the PACKAGE specifier. The directory around it covers the
 * MODULE specifiers: it mirrors `qontinui-cloud-control/frontend/src/` path
 * for path, and `@cloud/*` resolves here in the OSS shape and into the real
 * package in the composed one (`next.config.mjs`, `vitest.config.ts`,
 * `tsconfig.typecheck.json`). Every mirrored route module default-exports a
 * component that calls `notFound()`, except the two paths OSS already served
 * — `routes/organizations/page.tsx` and `routes/admin/page.tsx` — which keep
 * their existing redirects. It also carries `nav-items.ts`, the empty
 * stand-in for the sidebar entries cloud-control contributes.
 * `cloud-route-shims.test.ts` holds the mirror and the `src/app/` shims to
 * cloud-control's route inventory — every `routes/<path>/page.tsx` it ships.
 */

export {};
