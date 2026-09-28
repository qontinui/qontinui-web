/**
 * The one place a service base URL is resolved from configuration — and the
 * one place a development default is allowed to exist.
 *
 * A published build never falls back to a dev-stack address: an unset base in
 * production is an {@link EndpointUnresolvedError} naming the variable to set,
 * not a request quietly sent to the visitor's own loopback (plan
 * `2026-09-20-the-published-product-works-without-knowing-a-development-environment-exists`,
 * defect 5 / phase B5).
 *
 * The runner base is deliberately NOT here: runner calls resolve a transport
 * per request through `@/lib/runner`, which already refuses rather than falls
 * back. This module covers the other service bases.
 *
 * Callers pass the VALUE, not the variable name: Next.js inlines
 * `process.env.NEXT_PUBLIC_*` only when the property is spelled literally at
 * the call site, so a dynamic lookup here would read `undefined` in the
 * browser bundle.
 */

/** The service bases this resolver knows. */
export type EndpointName = "api" | "runner" | "llama_swap" | "mcp";

interface EndpointSpec {
  /** Environment variable that configures this base. */
  envVar: string;
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
  runner: {
    envVar: "QONTINUI_RUNNER_URL",
    label: "runner (server-side proxy)",
    devDefault: "http://localhost:9876",
  },
  llama_swap: {
    envVar: "QONTINUI_LLAMA_SWAP_URL",
    label: "grounding model server (llama-swap)",
    devDefault: "http://localhost:8100",
  },
  mcp: {
    envVar: "NEXT_PUBLIC_MCP_URL",
    label: "MCP server",
    devDefault: "http://localhost:3000/mcp",
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
    const nextAction = `Set ${spec.envVar} to the ${spec.label} base URL for this deployment.`;
    super(`The ${spec.label} address is not configured. ${nextAction}`);
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
