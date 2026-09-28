/**
 * The one place a service base URL is resolved from configuration — and the
 * one place a development default is allowed to exist.
 *
 * A published build never falls back to a dev-stack address: an unset base in
 * production is an {@link EndpointUnresolvedError} naming the variable to set,
 * not a request quietly sent to the visitor's (or this server's) own loopback
 * (plan
 * `2026-09-20-the-published-product-works-without-knowing-a-development-environment-exists`,
 * defect 5 / phase B5).
 *
 * The BROWSER's runner transport is deliberately NOT here: runner calls from
 * the page resolve a transport per request through `@/lib/runner`, which
 * already refuses rather than falls back. The `runner` entry below is only the
 * base SERVER-side code reaches: the `/api/vga/*` proxy routes and the UI
 * Bridge relay's screenshot fallback.
 *
 * Callers pass the VALUE, not the variable name: Next.js inlines
 * `process.env.NEXT_PUBLIC_*` only when the property is spelled literally at
 * the call site, so a dynamic lookup here would read `undefined` in the
 * browser bundle.
 *
 * `BACKEND_URL` (or `NEXT_PUBLIC_API_URL`) and `COORD_URL` must be present at
 * BUILD time as well as at runtime: `next.config.mjs` bakes its proxy
 * rewrites from them when the build loads the config (the same rule, mirrored
 * in `config/backend-rewrite.mjs`), while the route handlers read them per
 * request.
 */

/** The service bases this resolver knows. */
export type EndpointName =
  | "api"
  | "backend"
  | "coord"
  | "runner"
  | "llama_swap";

interface EndpointSpec {
  /** Environment variable that configures this base. */
  envVar: string;
  /** A second variable accepted in its place, named in the next action. */
  alternateEnvVar?: string;
  /** Human name used in the error sentence. */
  label: string;
  /** Used ONLY when `NODE_ENV === "development"`. */
  devDefault: string;
}

const ENDPOINTS: Record<EndpointName, EndpointSpec> = {
  api: {
    envVar: "NEXT_PUBLIC_API_URL",
    label: "backend API",
    devDefault: "http://localhost:8000",
  },
  backend: {
    envVar: "BACKEND_URL",
    alternateEnvVar: "NEXT_PUBLIC_API_URL",
    label: "backend API",
    devDefault: "http://localhost:8000",
  },
  coord: {
    envVar: "COORD_URL",
    label: "coord service",
    devDefault: "http://localhost:9870",
  },
  runner: {
    envVar: "QONTINUI_RUNNER_URL",
    label: "runner that server-side proxies reach",
    devDefault: "http://localhost:9876",
  },
  llama_swap: {
    envVar: "QONTINUI_LLAMA_SWAP_URL",
    label: "grounding model server (llama-swap)",
    devDefault: "http://localhost:8100",
  },
};

/** Stable machine-readable code carried by every unresolved-endpoint error. */
export const ENDPOINT_UNRESOLVED_CODE = "endpoint_unresolved";

/** The JSON body a server route returns in place of calling an unset base. */
export interface EndpointUnresolvedBody {
  code: typeof ENDPOINT_UNRESOLVED_CODE;
  endpoint: EndpointName;
  env_var: string;
  error: string;
  next_action: string;
}

export class EndpointUnresolvedError extends Error {
  readonly code = ENDPOINT_UNRESOLVED_CODE;
  readonly endpoint: EndpointName;
  readonly envVar: string;
  readonly nextAction: string;

  constructor(endpoint: EndpointName) {
    const spec = ENDPOINTS[endpoint];
    const vars = spec.alternateEnvVar
      ? `${spec.envVar} (or ${spec.alternateEnvVar})`
      : spec.envVar;
    const nextAction = `Set ${vars} to the base URL of the ${spec.label}.`;
    super(
      `This deployment is misconfigured — the ${spec.label} address is not set. ${nextAction}`
    );
    this.name = "EndpointUnresolvedError";
    this.endpoint = endpoint;
    this.envVar = spec.envVar;
    this.nextAction = nextAction;
  }

  /** Structured body for a server route's error response. */
  toBody(): EndpointUnresolvedBody {
    return {
      code: this.code,
      endpoint: this.endpoint,
      env_var: this.envVar,
      error: this.message,
      next_action: this.nextAction,
    };
  }
}

/** True for an {@link EndpointUnresolvedError}, including one from another
 * module instance (checked by `code`, not by prototype). */
export function isEndpointUnresolved(
  err: unknown
): err is EndpointUnresolvedError {
  return (
    err instanceof Error &&
    (err as { code?: unknown }).code === ENDPOINT_UNRESOLVED_CODE
  );
}

/**
 * Resolve a service base URL.
 *
 * - A configured (non-blank) value wins, trailing slashes trimmed.
 * - Unset in `development`: the dev-stack default.
 * - Unset anywhere else (production, test, a preview build):
 *   throws {@link EndpointUnresolvedError}.
 */
export function resolveEndpoint(
  endpoint: EndpointName,
  configured: string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV
): string {
  const value = configured?.trim();
  if (value) return value.replace(/\/+$/, "");
  if (nodeEnv === "development") return ENDPOINTS[endpoint].devDefault;
  throw new EndpointUnresolvedError(endpoint);
}

/**
 * The backend base a SERVER-SIDE route handler forwards to: `BACKEND_URL`,
 * then `NEXT_PUBLIC_API_URL` — the same precedence as the `next.config.mjs`
 * `/api/:path*` rewrite. Throws {@link EndpointUnresolvedError} when neither
 * is set outside development.
 */
export function resolveServerBackendUrl(): string {
  return resolveEndpoint(
    "backend",
    process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL
  );
}

/** Outcome of {@link tryResolveEndpoint}. */
export type EndpointResolution =
  | { ok: true; url: string }
  | { ok: false; error: EndpointUnresolvedError };

/**
 * Run a resolver and return its refusal as a VALUE, for a UI surface that
 * shows `error.message` (which already names the next action) and stops.
 * Any other error propagates.
 */
export function tryResolveEndpoint(resolve: () => string): EndpointResolution {
  try {
    return { ok: true, url: resolve() };
  } catch (err) {
    if (isEndpointUnresolved(err)) return { ok: false, error: err };
    throw err;
  }
}
