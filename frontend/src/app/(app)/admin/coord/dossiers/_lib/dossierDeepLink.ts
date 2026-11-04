/**
 * dossierDeepLink — the URL grammar `/admin/coord/dossiers` accepts, and the
 * one builder other surfaces use to link into it.
 *
 * Plan `2026-10-03-dossier-query-door-filters-sort-cursor`, Phase 5
 * follow-up. Without it the page always opened unfiltered, so nothing else in
 * the console could point at one dossier (the findings page's dossier heads
 * had no way in) and the "No plan yet" view could not be shared as a link.
 *
 * The page reads this ONCE on mount from `window.location` (not
 * `useSearchParams`, which would put the client page behind a Suspense
 * boundary for a one-shot read — the gates and findings pages make the same
 * call). The URL only SEEDS the filters; it is not kept in sync with them.
 *
 * Accepted keys:
 * - `slug=<dossier slug>` — exact, coord's `slug=` filter.
 * - `preset=no-plan` — `readiness=ready_for_pvi` + `remediation_state=none`,
 *   most recurrences first (the page's "No plan yet" button).
 * - `readiness=<value>` (repeatable) — passed through; coord owns the
 *   vocabulary and `none` selects a NULL readiness.
 * - `remediation_state=<value>` (repeatable) — only values this frontend
 *   knows (`REMEDIATION_STATES`); anything else is dropped rather than sent.
 * - `sort=<key>` / `order=asc|desc` — only known values.
 *
 * Explicit `readiness` / `remediation_state` / `sort` / `order` keys win over
 * the preset's, so `?preset=no-plan&sort=last_seen` means what it says.
 */

import type { DossierSort } from "@/lib/api/operations/coordDossiers";
import {
  REMEDIATION_STATES,
  type ServedRemediationState,
} from "./dossierStatus";

export const DOSSIERS_PATH = "/admin/coord/dossiers";

const SORTS: readonly DossierSort[] = [
  "last_seen",
  "first_seen",
  "updated",
  "recurrence_count",
  "slug",
];

export interface DossiersDeepLink {
  slug: string | null;
  readiness: string[] | null;
  remediation: ServedRemediationState[] | null;
  sort: DossierSort | null;
  order: "asc" | "desc" | null;
}

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

/** Parse a `location.search` string. `null` on a field = leave the default. */
export function parseDossiersDeepLink(search: string): DossiersDeepLink {
  const params = new URLSearchParams(search);
  const preset = params.get("preset") === "no-plan";

  const slug = (params.get("slug") ?? "").trim() || null;

  const readinessRaw = distinct(
    params
      .getAll("readiness")
      .map((r) => r.trim())
      .filter(Boolean)
  );
  const remediationRaw = distinct(
    params
      .getAll("remediation_state")
      .map((r) => r.trim())
      .filter((r): r is ServedRemediationState =>
        (REMEDIATION_STATES as readonly string[]).includes(r)
      )
  ) as ServedRemediationState[];

  const sortRaw = params.get("sort");
  const sort =
    sortRaw !== null && (SORTS as readonly string[]).includes(sortRaw)
      ? (sortRaw as DossierSort)
      : null;
  const orderRaw = params.get("order");
  const order = orderRaw === "asc" || orderRaw === "desc" ? orderRaw : null;

  return {
    slug,
    readiness:
      readinessRaw.length > 0
        ? readinessRaw
        : preset
          ? ["ready_for_pvi"]
          : null,
    remediation:
      remediationRaw.length > 0 ? remediationRaw : preset ? ["none"] : null,
    sort: sort ?? (preset ? "recurrence_count" : null),
    order: order ?? (preset ? "desc" : null),
  };
}

/** The link to one dossier on `/admin/coord/dossiers`. */
export function dossierHref(slug: string): string {
  return `${DOSSIERS_PATH}?slug=${encodeURIComponent(slug)}`;
}

/** The link to the "No plan yet" view. */
export const DOSSIERS_NO_PLAN_HREF = `${DOSSIERS_PATH}?preset=no-plan`;
