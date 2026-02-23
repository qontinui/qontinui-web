/**
 * UI Bridge Tabs API
 *
 * Returns the list of connected browser tabs with page info (URL, title).
 * Used by Page Sweep and the inspector to identify which tab to target.
 */

import { NextResponse } from "next/server";
import { getConnectedTabs, getTabsWithInfo } from "@/lib/ui-bridge/handlers";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const detailed = searchParams.get("detailed") !== "false";

  if (detailed) {
    const tabsInfo = await getTabsWithInfo();
    return NextResponse.json({
      success: true,
      data: { tabs: tabsInfo.map((t) => t.tabId), tabsInfo },
    });
  }

  // Fast path: just IDs
  const tabs = getConnectedTabs();
  return NextResponse.json({
    success: true,
    data: { tabs },
  });
}

export const dynamic = "force-dynamic";
