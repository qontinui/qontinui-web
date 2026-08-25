"use client";

/**
 * /operations — retired. Its cross-machine fleet view + operations panels
 * were merged into the Coord Console so there is one fleet view instead of
 * two. This route redirects to the console's Pipeline tab
 * (`/admin/coord/pipeline`, the old `/admin/coord/fleet`); kept as a redirect
 * (not deleted) so existing bookmarks / deep-links keep working.
 *
 * The panels that came with it have since been re-homed by plan
 * `2026-08-25-coord-console-intent-and-devops-sections` Phase 4 — machine
 * health, resources and CI capacity to `/admin/coord/devops`, the migration
 * queue and test targets to their own Dev Ops routes, gates to
 * `/admin/coord/gates` — and the demo "landed features" iframes were deleted
 * outright. The Pipeline tab is still the right landing spot: it is what a
 * developer opening `/operations` was looking for.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function OperationsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/coord/pipeline");
  }, [router]);

  return null;
}
