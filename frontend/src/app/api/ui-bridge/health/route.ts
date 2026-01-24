/**
 * UI Bridge Health Check Endpoint
 *
 * Returns status information for UI Bridge SDK.
 * Used by external clients (e.g., qontinui-runner) to verify SDK is installed.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    sdk: "@qontinui/ui-bridge",
    version: "0.1.0",
    timestamp: Date.now(),
  });
}
