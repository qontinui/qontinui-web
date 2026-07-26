"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getStoredProductMode } from "@/contexts/product-mode-context";

/**
 * `/dashboard` — legacy alias kept for the marketing header's "Dashboard"
 * button and old bookmarks.
 *
 * "The dashboard" is the Coord Console (`/admin/coord` → Fleet tab), which is
 * the product's authenticated home. The non-visual arm used to point at
 * `/build/workflows`; that is the workflow-authoring surface, which is hidden
 * from the sidebar unless "show advanced automation features" is on — so it
 * landed users on a page the nav doesn't even offer. Visual-mode users still
 * get the visual-automation home.
 */
export default function DashboardRedirect() {
  const router = useRouter();

  useEffect(() => {
    const mode = getStoredProductMode();
    router.replace(
      mode === "visual" ? "/tools/visual-automation" : "/admin/coord"
    );
  }, [router]);

  return null;
}
