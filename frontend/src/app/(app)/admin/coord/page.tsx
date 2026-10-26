"use client";

/**
 * /admin/coord — landing page.
 *
 * Redirects to /admin/coord/pipeline. The layout already gates non-admins
 * and renders the nav, so this is purely a default-route convenience.
 *
 * It is where a signed-in user is sent from `/`, `/login` and `/dashboard`,
 * so it must work in presentation mode too (plan
 * `2026-10-23-console-presentation-spaces`): a page that is never mounted
 * never redirects, and every presenting tab would land on "Shown in the
 * operator view only" with no way on but the sidebar. It renders one
 * sentence and nothing else, so it is registered presentation-ready
 * (`presentationReadiness.ts`, proven by `page.test.tsx`), and the redirect
 * keeps the URL's query, so a `?present=1` arrival lands presenting.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Where the console lands. */
const COORD_LANDING_TARGET = "/admin/coord/pipeline";

/**
 * The landing target, carrying the query the console was opened with. Not
 * exported: a page module may export only what Next.js reads from it.
 */
function landingHref(search: string): string {
  return search && search !== "?"
    ? `${COORD_LANDING_TARGET}${search.startsWith("?") ? search : `?${search}`}`
    : COORD_LANDING_TARGET;
}

export default function CoordLandingPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(landingHref(window.location.search));
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
