/**
 * UI Bridge Tabs API
 *
 * Returns the list of connected browser tab IDs.
 * Used by the inspector to identify which tab to target for navigation commands.
 */

import { NextResponse } from "next/server";
import { getConnectedTabs } from "@/lib/ui-bridge/handlers";

export async function GET() {
  const tabs = getConnectedTabs();
  return NextResponse.json({
    success: true,
    data: { tabs },
  });
}

export const dynamic = "force-dynamic";
