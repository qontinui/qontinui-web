/**
 * UI Bridge Heartbeat Endpoint
 *
 * Receives heartbeat POSTs from the browser to signal app responsiveness.
 * The server tracks the last heartbeat timestamp for health detection.
 */

import { NextResponse } from "next/server";
import { uiBridgeHandlers } from "@/lib/ui-bridge/handlers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const result = await uiBridgeHandlers.receiveHeartbeat();
  return NextResponse.json(result);
}
