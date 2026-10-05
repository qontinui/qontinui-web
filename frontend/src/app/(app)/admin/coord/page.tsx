"use client";

/**
 * /admin/coord — landing page.
 *
 * Redirects to /admin/coord/home, the operator's one screen (plan
 * `2026-09-20-what-is-the-state-of-my-projects-and-what-needs-me-is-answerable-from-one-screen`
 * Phase 4): what needs them, what is degrading, what is on track, and what the
 * view does not know. It used to land on /admin/coord/pipeline — the merge
 * train, one of the four altitudes and not the operator's. The layout already
 * gates non-admins and renders the nav, so this is purely a default-route
 * convenience.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function CoordLandingPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/coord/home");
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
