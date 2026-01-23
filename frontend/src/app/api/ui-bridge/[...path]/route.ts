/**
 * UI Bridge API Routes
 *
 * Catch-all route handler for UI Bridge API endpoints.
 * Uses createNextRouteHandlers from ui-bridge-server to handle routing.
 */

import { createNextRouteHandlers } from "ui-bridge-server/nextjs";
import { uiBridgeHandlers } from "@/lib/ui-bridge/handlers";

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
export const { GET, POST, DELETE } = createNextRouteHandlers(uiBridgeHandlers, {
  // Enable verbose logging in development
  verbose: process.env.NODE_ENV === "development",
});

/**
 * Configure route segment
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
