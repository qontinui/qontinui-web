/**
 * UI Bridge API Routes
 *
 * Catch-all route handler for UI Bridge API endpoints.
 * Uses createNextRouteHandlers from ui-bridge-server to handle routing.
 */

import {
  createNextRouteHandlers,
  type UIBridgeServerHandlers,
} from "@qontinui/ui-bridge/server";
import { uiBridgeHandlers } from "@/lib/ui-bridge/handlers";
import { NextRequest } from "next/server";

/**
 * Export route handlers created by ui-bridge-server.
 * This sets up GET, POST, and DELETE handlers for all UI Bridge routes:
 *
 * Render Log:
 * - GET /api/ui-bridge/render-log - Get render log entries
 * - DELETE /api/ui-bridge/render-log - Clear render log
 * - POST /api/ui-bridge/render-log/snapshot - Capture snapshot
 *
 * Control:
 * - GET /api/ui-bridge/control/elements - List elements
 * - GET /api/ui-bridge/control/element/:id - Get element
 * - POST /api/ui-bridge/control/element/:id/action - Execute action
 * - GET /api/ui-bridge/control/components - List components
 * - GET /api/ui-bridge/control/component/:id - Get component
 * - POST /api/ui-bridge/control/discover - Discover elements
 * - GET /api/ui-bridge/control/snapshot - Get control snapshot
 *
 * Workflows:
 * - GET /api/ui-bridge/control/workflows - List workflows
 * - POST /api/ui-bridge/control/workflow/:id/run - Run workflow
 *
 * Debug:
 * - GET /api/ui-bridge/debug/action-history - Get action history
 * - GET /api/ui-bridge/debug/metrics - Get metrics
 * - POST /api/ui-bridge/debug/highlight/:id - Highlight element
 */
// Cast: uiBridgeHandlers implements a subset of UIBridgeServerHandlers.
// Unimplemented methods return 501 at runtime (nextjs.ts checks handler existence).
const handlers = createNextRouteHandlers(
  uiBridgeHandlers as unknown as UIBridgeServerHandlers,
  {}
);

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
  return wrapHandler(handlers.GET, request, context);
}

export async function POST(
  request: NextRequest,
  context: NextContext
): Promise<Response> {
  return wrapHandler(handlers.POST, request, context);
}

export async function DELETE(
  request: NextRequest,
  context: NextContext
): Promise<Response> {
  return wrapHandler(handlers.DELETE, request, context);
}

/**
 * Configure route segment
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
