/**
 * `/organizations` — mounted from `@qontinui/cloud-control` at build time.
 *
 * The docstring this replaced claimed "the cloud-control bundle owns
 * `/organizations/[id]/...` and overrides this path when loaded". That was
 * false in every deployment: the App Router is file-system routed and
 * resolved at build time, so a route descriptor pushed into a module-scoped
 * array at runtime could not shadow, replace or add a route (that array has
 * since been deleted outright), and the unconditional
 * `redirect("/settings/account")` that lived here ran in the cloud
 * deployment too.
 *
 * The override is real now, and it is a build-time swap rather than the
 * runtime shadowing that docstring imagined: `@cloud` resolves to
 * cloud-control's `frontend/src/` when the composed-build overlay is
 * installed, and to `src/cloud-absent/` when it is not. The redirect did not
 * disappear — it moved to `src/cloud-absent/routes/organizations/page.tsx`,
 * so self-hosters still land on `/settings/account`, where the OSS org
 * affordances actually live. See `docs/composed-cloud-build.md`.
 */
export { default } from "@cloud/routes/organizations/page";
