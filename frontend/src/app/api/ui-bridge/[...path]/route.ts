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

async function wrapHandler(
  handler: (
    req: NextRequest,
    ctx: { params: Record<string, string> }
  ) => Promise<Response>,
  request: NextRequest,
  context: NextContext
): Promise<Response> {
  const params = await context.params;
  return handler(request, { params: { path: params.path.join("/") } });
}

export async function GET(
  request: NextRequest,
  context: NextContext
): Promise<Response> {
  return wrapHandler(routeHandlers.GET, request, context);
}

export async function POST(
  request: NextRequest,
  context: NextContext
): Promise<Response> {
  return wrapHandler(routeHandlers.POST, request, context);
}

export async function PUT(
  request: NextRequest,
  context: NextContext
): Promise<Response> {
  return wrapHandler(routeHandlers.PUT, request, context);
}

export async function DELETE(
  request: NextRequest,
  context: NextContext
): Promise<Response> {
  return wrapHandler(routeHandlers.DELETE, request, context);
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
