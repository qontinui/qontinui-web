/**
 * `/organizations/[id]/settings` — mounted from `@qontinui/cloud-control` at build time.
 *
 * `@cloud` resolves to the package's `frontend/src/` in the composed cloud
 * build and to `src/cloud-absent/` otherwise, so this one line is the whole
 * route: the cloud page in the cloud deployment, a `notFound()` stub for
 * self-hosters, and no runtime registry, client boundary or loader race in
 * either. See `docs/composed-cloud-build.md`.
 */
export { default } from "@cloud/routes/organizations/[id]/settings/page";
