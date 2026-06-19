"use client";

/**
 * /operations — retired. Its cross-machine fleet view + operations panels
 * (merge train, dependency graph, CI status, gates, migration queue, landed
 * features) were merged into the Coord Console's Fleet tab so there is one
 * fleet view instead of two. This route now redirects there; kept as a
 * redirect (not deleted) so existing bookmarks / deep-links keep working.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function OperationsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/coord/fleet");
  }, [router]);

  return null;
}
