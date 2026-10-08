/**
 * The one base every module of the typed `/operations` client builds its URLs
 * over — RELATIVE, i.e. same-origin.
 *
 * Plan `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`
 * D6 chose the relative form over `${ApiConfig.API_BASE_URL}/api/v1/operations`.
 * Production sets `NEXT_PUBLIC_API_URL`, so an absolute base is a CROSS-origin
 * request from `qontinui.io` to `api.qontinui.io`, while the relative form goes
 * same-origin through the `/api/:path*` rewrite in `next.config.mjs`. Relative
 * needs no CORS dependency and keeps the cookie path that a cross-origin fetch
 * with default credentials drops; `httpClient` attaches the bearer and
 * `X-Qontinui-Active-Tenant` on either form.
 *
 * The defect that settled it, measured against production on 2026-10-05: the
 * spawn modal's bare `fetch` to the absolute base carried neither a bearer nor
 * (cross-origin, default `credentials: "same-origin"`) a cookie, and the
 * identical unauthenticated `GET https://api.qontinui.io/api/v1/operations/fleet/health`
 * answers `401 not_authenticated`. The relative form through the Vercel
 * rewrite reaches the same backend.
 *
 * One caveat, so the word "same-origin" is not over-read: only
 * `httpClient.fetch` sends a relative URL as written. `httpClient.get` /
 * `post` / `put` / `patch` / `delete` prefix `ApiConfig.getBaseUrl()` onto
 * any URL that does not start with `http`, so a helper-method call over this
 * base is absolute (cross-origin) wherever `NEXT_PUBLIC_API_URL` is set. It
 * still carries the bearer and the tenant header, which is what this base
 * exists to guarantee; the hop is the helper's, not this constant's.
 *
 * Every client function inlines its URL as a template over this constant and
 * calls `httpClient` directly — never through a shared `request(path)` helper,
 * which `route-walker.test.ts` cannot resolve (it follows wrappers one level
 * deep only).
 */
export const OPERATIONS_BASE = "/api/v1/operations";
