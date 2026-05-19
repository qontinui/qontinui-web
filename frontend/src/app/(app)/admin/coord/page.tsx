"use client";

/**
 * /admin/coord — landing page.
 *
 * Redirects to /admin/coord/fleet. The layout already gates non-admins
 * and renders the nav, so this is purely a default-route convenience.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function CoordLandingPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/coord/fleet");
  }, [router]);

  return (
    <div
      data-testid="coord-landing"
      className="p-6 text-sm text-muted-foreground"
    >
      Loading operator console...
    </div>
  );
}
