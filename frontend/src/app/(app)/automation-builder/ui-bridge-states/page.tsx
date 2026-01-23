"use client";

/**
 * UI Bridge States Page - Redirect
 *
 * This page has been merged into the unified Discover page.
 * Redirects to /automation-builder/extraction with the ui-bridge method.
 */

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function UIBridgeStatesRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    // Preserve any existing query params (like project)
    const params = new URLSearchParams(searchParams.toString());
    params.set("method", "ui-bridge");
    router.replace(`/automation-builder/extraction?${params.toString()}`);
  }, [router, searchParams]);

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-brand-primary" />
        <p className="text-sm text-text-muted">
          Redirecting to the unified Discover page...
        </p>
      </div>
    </div>
  );
}
