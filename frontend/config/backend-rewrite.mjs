/**
 * Where next.config.mjs's proxy rewrites point — decided here, as a pure
 * function of the environment, so the decision is unit-tested
 * (`backend-rewrite.test.mjs`) rather than buried in the config.
 *
 * Two upstreams are proxied by rewrite: the backend (`/api/:path*` fallback,
 * from `BACKEND_URL`, else `NEXT_PUBLIC_API_URL`) and coord (`/coord-api/:path*`,
 * from `COORD_URL`). For each:
 *
 *   1. configured → proxy to it;
 *   2. unset on a PRODUCTION deploy build (`VERCEL_ENV=production`, or
 *      `QONTINUI_DEPLOY_BUILD=1`) → throw at config load, naming the
 *      variable: the deploy fails loudly instead of shipping a proxy to
 *      loopback. Vercel PREVIEW builds deliberately do not throw — the
 *      Preview env scope need not carry these variables — and fall through
 *      to arm 4, so a preview missing one serves the typed 503 there;
 *   3. unset under `NODE_ENV=development` → the local dev-stack default
 *      (the same defaults as `src/lib/errors/endpoint-unresolved.ts`,
 *      which owns the rule for runtime code — this file only mirrors it
 *      because a .mjs config cannot import the TS module);
 *   4. unset anywhere else (a Vercel preview, CI, a self-host
 *      `next start`) → an INTERNAL route,
 *      `/api/endpoint-unresolved/<name>`, which answers the structured 503
 *      `{code: "endpoint_unresolved", endpoint, env_var, error, next_action}`.
 *      Never loopback.
 *
 * These variables must be present at BUILD time as well as at runtime: the
 * rewrite table is computed when `next build` loads the config and is baked
 * into the build output, while the route handlers under `src/app/api/v1`
 * read `BACKEND_URL` / `NEXT_PUBLIC_API_URL` per request at runtime.
 */

/** Local dev-stack defaults, used ONLY under NODE_ENV=development. */
export const DEV_DEFAULTS = Object.freeze({
  backend: "http://localhost:8000",
  coord: "http://localhost:9870",
});

/** The internal route an unresolved upstream is rewritten to. */
export function unresolvedRoute(name) {
  return `/api/endpoint-unresolved/${name}`;
}

const SPECS = {
  backend: {
    vars: ["BACKEND_URL", "NEXT_PUBLIC_API_URL"],
    label: "backend API",
  },
  coord: { vars: ["COORD_URL"], label: "coord service" },
};

/** True for a build that is going to be served to users as PRODUCTION.
 * `VERCEL_ENV=preview` is intentionally not one (see arm 2 above). */
export function isDeployBuild(env) {
  return env.VERCEL_ENV === "production" || env.QONTINUI_DEPLOY_BUILD === "1";
}

/**
 * The resolution for one upstream: `{ kind: 'url', url }` to proxy to, or
 * `{ kind: 'unresolved', route }` to rewrite to the 503 route. Throws on a
 * deploy build with the upstream unset.
 */
export function resolveUpstream(name, env = process.env) {
  const spec = SPECS[name];
  if (!spec) throw new Error(`unknown upstream: ${name}`);
  for (const v of spec.vars) {
    const value = env[v]?.trim();
    if (value) return { kind: "url", url: value.replace(/\/+$/, "") };
  }
  const named = spec.vars.join(" (or ") + (spec.vars.length > 1 ? ")" : "");
  if (isDeployBuild(env)) {
    throw new Error(
      `This deployment is misconfigured — the ${spec.label} address is not set. ` +
        `Set ${named} to the base URL of the ${spec.label} for this deploy ` +
        `(it must be present at build time and at runtime).`
    );
  }
  if (env.NODE_ENV === "development") {
    return { kind: "url", url: DEV_DEFAULTS[name] };
  }
  return { kind: "unresolved", route: unresolvedRoute(name) };
}

/** Rewrite destination for `source` paths under `pathSuffix` (e.g. `/api/:path*`). */
export function rewriteDestination(resolution, pathSuffix) {
  return resolution.kind === "url"
    ? `${resolution.url}${pathSuffix}`
    : resolution.route;
}
