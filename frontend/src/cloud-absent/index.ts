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
 * every slot in `@/lib/extension-slots` empty, and every consumer
 * (`getService` / `getComponent`) already treats an empty slot as "not the
 * cloud deployment". The module is intentionally side-effect-free and
 * value-free so webpack tree-shakes it to nothing and no cloud-control
 * chunk appears in the OSS client bundle.
 *
 * This directory mirrors `qontinui-cloud-control/frontend/src/` one file at
 * a time; Phase 1b of the route-mounting plan extends it with a `@cloud`
 * alias and per-route stubs that call `notFound()`.
 */

export {};
