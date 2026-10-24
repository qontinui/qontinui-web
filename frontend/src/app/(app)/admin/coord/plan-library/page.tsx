import { redirect } from "next/navigation";

/**
 * /admin/coord/plan-library — retired as a page; a bookmark still resolves.
 *
 * Plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phase 1:
 * the corpus list, search and open-document affordance folded into
 * `/admin/coord/plans` (one page at one URL for every plan, from both
 * stores); the two policy dials moved to `/admin/coord/plan-library/settings`;
 * the scan-source and coverage panels collapsed into the `/plans`
 * corpus-health strip; the divergence panel was deleted in favour of
 * `/admin/coord/plan-forks`. This route redirects rather than 404s so an old
 * link lands on the page that replaced it.
 */
const PLAN_LIBRARY_REDIRECT_TARGET = "/admin/coord/plans";

export default function PlanLibraryPage() {
  redirect(PLAN_LIBRARY_REDIRECT_TARGET);
}
