/**
 * `/admin` — mounted from `@qontinui/cloud-control` at build time.
 *
 * This path had no `page.tsx` at all; `next.config.mjs` redirected it to
 * `/admin/architecture` from `redirects()`, which is matched ahead of the
 * filesystem and so would shadow this file. That entry is gone, and its
 * behaviour moved to `src/cloud-absent/routes/admin/page.tsx` — the OSS
 * admin section (`architecture/`, `coord/**`, `datasets/`, …) still has
 * `/admin` as a working entry point, and the composed cloud build gets
 * cloud-control's admin dashboard there instead.
 *
 * `@cloud` resolves to cloud-control's `frontend/src/` in the composed build
 * and to `src/cloud-absent/` otherwise. See `docs/composed-cloud-build.md`.
 */
export { default } from "@cloud/routes/admin/page";
