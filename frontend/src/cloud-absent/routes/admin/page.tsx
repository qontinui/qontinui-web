import { redirect } from "next/navigation";

/**
 * OSS stand-in for `@cloud/routes/admin/page` — the module the composed
 * cloud build renders at `/admin`.
 *
 * The second non-`notFound()` stub. `/admin` is not an empty path in OSS: it
 * is the parent of a live admin section (`architecture/`, `coord/**`,
 * `datasets/`, `agent-claims/`, `agent-sessions/`, `region-analysis/`) that
 * has no index page of its own, and `next.config.mjs` carried a
 * `redirects()` entry sending `/admin` to `/admin/architecture`. That
 * redirect had to go — `redirects()` is matched ahead of the filesystem, so
 * it shadowed the `page.tsx` this plan mounts — but the behaviour it
 * provided is worth keeping, and 404ing `/admin` for self-hosters would have
 * been a pure regression with nothing gained. So it lives here instead: same
 * destination, same non-permanent redirect, now conditional on the build
 * shape rather than unconditional.
 *
 * Two differences the move does introduce, neither worth reverting for:
 * `redirects()` forwards unmatched query params, so `/admin?tab=x` used to
 * land on `/admin/architecture?tab=x` and now loses the query; and the
 * redirect is answered by a page render inside the `(app)` tree rather than
 * before the filesystem is consulted, so it costs that segment's render. Only
 * the exact path `/admin` is affected either way — `redirects()` `source:
 * '/admin'` never matched `/admin/coord` and friends. See
 * `frontend/docs/composed-cloud-build.md`.
 */
export default function AdminAbsent(): never {
  redirect("/admin/architecture");
}
