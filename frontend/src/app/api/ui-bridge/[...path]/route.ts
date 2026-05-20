/**
 * UI Bridge API Routes
 *
 * Catch-all route handler for all UI Bridge API endpoints.
 * Uses the SDK's CommandRelay for browser-server communication.
 *
 * Relay routes (handled before normal routing):
 * - GET  /commands/stream — SSE command delivery to browser
 * - POST /commands        — browser sends command responses
 * - POST /heartbeat       — browser heartbeat
 * - GET  /health          — transport diagnostics
 * - GET  /tabs            — connected tab info
 *
 * All other routes are handled by the SDK's route matcher.
 *
 * Local pre/post-processing (this module):
 * - Paths the SDK route matcher would 404 on but that callers commonly hit
 *   (`/ai/idle-status`, `/control/tabs`, `/control/page-health`,
 *   `/sdk/network-requests`) are rewritten to HTTP 503 with a structured
 *   `NO_BROWSER_CONNECTED` body rather than a bare 404. This avoids
 *   misleading 404s from probes that are really "no browser attached"
 *   conditions.
 * - For `/control/snapshot`, when the SDK returns `success:true` but the
 *   snapshot is stale AND empty (no browser actually attached, just a
 *   cached empty payload), the response is rewritten to
 *   `{success:false, code:"NO_BROWSER", ...}` so callers don't confuse
 *   "no browser" with "page has no elements".
 */

import {
  createNextRouteHandlers,
  SSEManager,
} from "@qontinui/ui-bridge/server";
import { handlers, relay } from "@/lib/ui-bridge/relay";
import { NextRequest } from "next/server";

const sseManager = new SSEManager();

const routeHandlers = createNextRouteHandlers(handlers, {
  relay,
  sseManager,
  appInfo: {
    appId: "qontinui-web",
    appName: "Qontinui Web",
    appType: "web",
    framework: "nextjs",
  },
});

// Wrap handlers to adapt from Next.js 15 async params to the expected sync params
type NextContext = { params: Promise<{ path: string[] }> };

/**
 * Paths the underlying SDK route matcher does not define but that callers
 * (page-health probes, multi-tab debug UI, runner SDK shims) regularly hit.
 * When we see one of these, we short-circuit the SDK and return either:
 *   - HTTP 503 with `{success:false, code:"NO_BROWSER_CONNECTED", ...}`
 *     when no browser SDK client is attached to the relay, OR
 *   - HTTP 503 with the same shape when a client IS attached (the route
 *     still doesn't exist in the SDK, so we cannot forward), with the
 *     message specialized to the path.
 * In both cases the response shape is structured JSON, never a bare 404.
 *
 * These four paths are matched exactly (no prefix matching) — adding new
 * entries is a deliberate one-line change.
 */
const MISSING_BRIDGE_PATHS: ReadonlySet<string> = new Set([
  "/ai/idle-status",
  "/control/tabs",
  "/control/page-health",
  "/sdk/network-requests",
]);

function noBrowserResponse(path: string): Response {
  return new Response(
    JSON.stringify({
      success: false,
      code: "NO_BROWSER_CONNECTED",
      message: `${path} requires a browser SDK client`,
    }),
    {
      status: 503,
      headers: { "Content-Type": "application/json" },
    }
  );
}

/**
 * Rewrites a successful snapshot response into a `NO_BROWSER` failure when
 * the snapshot is stale AND empty. Other successful responses pass through
 * unchanged. Returns the original `response` if no rewrite applies.
 *
 * Reads the body as text first and re-emits, so we don't lose unknown
 * fields (timestamp, _meta, etc.).
 */
async function rewriteStaleEmptySnapshot(response: Response): Promise<Response> {
  if (response.status !== 200) return response;
  const ct = response.headers.get("Content-Type") ?? "";
  if (!ct.includes("application/json")) return response;

  // Cloning is cheap and lets us fall back to the original if parsing fails.
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }

  if (
    body === null ||
    typeof body !== "object" ||
    (body as { success?: unknown }).success !== true
  ) {
    return response;
  }

  const obj = body as {
    success: true;
    data?: { elements?: unknown[] };
    _meta?: { stale?: boolean };
  };

  const isStale = obj._meta?.stale === true;
  const elements = Array.isArray(obj.data?.elements) ? obj.data!.elements : null;
  const isEmpty = elements !== null && elements.length === 0;

  if (!isStale || !isEmpty) return response;

  const rewritten = {
    success: false as const,
    code: "NO_BROWSER",
    message: "snapshot stale — no browser session",
    data: { elements: [] as unknown[] },
  };

  return new Response(JSON.stringify(rewritten), {
    // Keep 200 so existing callers that branch only on `success` boolean
    // continue to read the body; the `code` field is the canonical signal.
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function resolvePath(params: { path: string[] }): string {
  return "/" + params.path.join("/");
}

async function wrapHandler(
  handler: (
    req: NextRequest,
    ctx: { params: Record<string, string> }
  ) => Promise<Response>,
  request: NextRequest,
  context: NextContext,
  method: "GET" | "POST" | "PUT" | "DELETE"
): Promise<Response> {
  const params = await context.params;
  const path = resolvePath(params);

  // Pre-process: short-circuit known-missing routes regardless of method.
  if (MISSING_BRIDGE_PATHS.has(path)) {
    return noBrowserResponse(path);
  }

  const response = await handler(request, { params: { path: params.path.join("/") } });

  // Post-process: rewrite stale+empty snapshots.
  if (method === "GET" && path === "/control/snapshot") {
    return rewriteStaleEmptySnapshot(response);
  }

  return response;
}

export async function GET(
  request: NextRequest,
  context: NextContext
): Promise<Response> {
  return wrapHandler(routeHandlers.GET, request, context, "GET");
}

export async function POST(
  request: NextRequest,
  context: NextContext
): Promise<Response> {
  return wrapHandler(routeHandlers.POST, request, context, "POST");
}

export async function PUT(
  request: NextRequest,
  context: NextContext
): Promise<Response> {
  return wrapHandler(routeHandlers.PUT, request, context, "PUT");
}

export async function DELETE(
  request: NextRequest,
  context: NextContext
): Promise<Response> {
  return wrapHandler(routeHandlers.DELETE, request, context, "DELETE");
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
