"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getStoredProductMode } from "@/contexts/product-mode-context";

export default function DashboardRedirect() {
  const router = useRouter();

  useEffect(() => {
    const mode = getStoredProductMode();
    router.replace(
      mode === "visual" ? "/tools/visual-automation" : "/build/workflows"
    );
  }, [router]);

  return null;
}
