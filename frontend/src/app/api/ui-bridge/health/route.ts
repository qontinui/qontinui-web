/**
 * UI Bridge Health Check Endpoint
 *
 * Returns status information for UI Bridge SDK.
 * Used by external clients (e.g., qontinui-runner) to verify SDK is installed.
 */

import { NextResponse } from "next/server";
import { uiBridgeConfig } from "@/config/ui-bridge-config";
import { getTransportDiagnostics } from "@/lib/ui-bridge/handlers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    sdk: "@qontinui/ui-bridge",
    version: uiBridgeConfig.version,
    timestamp: Date.now(),
    uiBridge: uiBridgeConfig,
    transport: getTransportDiagnostics(),
  });
}
