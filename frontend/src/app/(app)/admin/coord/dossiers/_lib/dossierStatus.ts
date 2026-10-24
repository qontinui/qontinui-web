/**
 * dossierStatus — everything `/admin/coord/dossiers` DERIVES, as pure
 * functions, plus R3's audited severity table for the surface.
 *
 * Plan `2026-10-03-dossier-query-door-filters-sort-cursor`, Phase 5. The door
 * is coord's `GET /coord/dossiers` (`findings::dossiers`, qontinui-coord#3421);
 * this module is the page's reading of its answer.
 *
 * Named `*Status.ts` so `attention.test.ts` discovers its attention table, and
 * registered in `components/console/consoleSurfaces.ts`.
 *
 * ## The badge is the LIVE remediation state, not the ledger's
 *
 * A dossier's ledger lists remediation plans with a free-text status written
 * by whoever last folded the head, and it lags the plan by construction. coord
 * joins each plan stem to its work unit and serves `remediation_state`, the
 * live roll-up (plan D6). That is the one this page paints. The ledger status
 * is shown in the row detail beside the live one, so a disagreement is
 * visible rather than resolved silently.
 *
 * ## UNKNOWN is never "none"
 *
 * `remediation_state: "unknown"` means coord could not resolve a plan the
 * ledger names. It is amber, never calm, and never folded into `none` ("no
 * plan yet"), which is the case an operator picks new work from. A
 * `readiness` or `recurrence_count` of `null` is the ledger declining to say,
 * and renders as "unknown", never as `accumulating` or `0`.
 */

import type { Attention } from "@/components/console/attention";
import type {
  HealthBadge,
  HealthStripLevel,
} from "@/components/console/HealthStrip";
import {
  UNKNOWN_COUNTS_DETAIL,
  staleDetail,
} from "@/components/console/readFailure";
import type { RowStatus, StatusPalette } from "@/components/console/statusRow";
import { INERT, UNKNOWN_AMBER } from "@/components/console/statusRow";
import type { FindingsBound } from "../../findings/_lib/findingStatus";

/** One ledger remediation, as coord serves it. */
export interface DossierRemediation {
  plan?: string | null;
  ledger_status?: string | null;
  /** The work unit's live `status`; `null` = no work unit in this tenant. */
  live_status?: string | null;
  held?: boolean | null;
}

/** One dossier head, as the proxy forwards it (`DossierSummary`). */
export interface CoordDossierRow {
  finding_id: string;
  slug?: string | null;
  title?: string | null;
  readiness?: string | null;
  recurrence_count?: number | null;
  first_seen?: string | null;
  last_seen?: string | null;
  updated_at?: string | null;
  remediations?: DossierRemediation[] | null;
  remediation_state?: string | null;
  has_open_remediation?: boolean | null;
  scope?: string | null;
}

/** Why the proxy degraded (`unavailable_kind`). */
export type DossiersUnavailableKind =
  | "not_deployed"
  | "unreachable"
  | "unprovisioned";

/** coord's envelope, defensively: nothing in it is assumed present. */
export interface DossiersResponse {
  available?: boolean;
  count?: number;
  dossiers?: CoordDossierRow[];
  facets?: {
    readiness?: Record<string, number> | null;
    remediation_state?: Record<string, number> | null;
  } | null;
  truncated?: boolean | null;
  bound_kind?: string | null;
  next_cursor?: string | null;
  total?: number | null;
  shown?: number | null;
  limit?: number | null;
  unavailable?: string;
  unavailable_kind?: DossiersUnavailableKind;
}

/**
 * The roll-up vocabulary (`REMEDIATION_STATES`), in coord's order, plus
 * `unrecognised` for a value newer than this frontend.
 */
export const REMEDIATION_STATES = [
  "none",
  "draft",
  "vetted",
  "in_progress",
  "shipped",
  "closed",
  "unknown",
] as const;

export type ServedRemediationState = (typeof REMEDIATION_STATES)[number];
export type RemediationKind = ServedRemediationState | "unrecognised";

/**
 * The audited kind → attention table (R3). TOTAL over {@link RemediationKind}:
 *
 * | kind | attention | why |
 * |---|---|---|
 * | `none` | `none` | No remediation plan yet. That is where new work comes from, but it is a reader's fact, not a demand on the operator: `/pvi` picks it up. |
 * | `draft` | `none` | A plan exists and is being written. |
 * | `vetted` | `none` | A plan exists and is ready to implement. |
 * | `in_progress` | `none` | A plan is being implemented. |
 * | `shipped` | `none` | The remediation shipped. |
 * | `closed` | `none` | The remediation was closed. |
 * | `unknown` | `waiting` | coord could not resolve a plan the ledger names, so whether work is in flight is unknown. R3's floor for not knowing is amber. |
 * | `unrecognised` | `waiting` | A state newer than this frontend: unknown to us, so amber for the same reason. |
 *
 * There is deliberately no `author` row: nothing on this reader is a demand.
 */
export const DOSSIER_ATTENTION_BY_REMEDIATION: Record<
  RemediationKind,
  Attention
> = {
  none: "none",
  draft: "none",
  vetted: "none",
  in_progress: "none",
  shipped: "none",
  closed: "none",
  unknown: "waiting",
  unrecognised: "waiting",
};

export const DOSSIER_REMEDIATION_CLASS: Record<RemediationKind, string> = {
  // "Nothing planned yet" stands out from the planned states without
  // borrowing a warning colour: it is the row an operator scans for.
  none: "bg-sky-500/10 text-sky-200 border-sky-500/25",
  draft: INERT,
  vetted: INERT,
  in_progress: "bg-violet-500/10 text-violet-200 border-violet-500/25",
  shipped: "bg-emerald-500/10 text-emerald-200 border-emerald-500/25",
  closed: "bg-transparent text-muted-foreground border-border border-dashed",
  unknown: UNKNOWN_AMBER,
  unrecognised: UNKNOWN_AMBER,
};

/** Red ⇔ `✕`: exactly the `author` kinds. There are none. */
export const DOSSIER_AUTHOR_GLYPH_REMEDIATIONS: ReadonlySet<RemediationKind> =
  new Set(
    (Object.keys(DOSSIER_ATTENTION_BY_REMEDIATION) as RemediationKind[]).filter(
      (k) => DOSSIER_ATTENTION_BY_REMEDIATION[k] === "author"
    )
  );

export const DOSSIER_STATUS_PALETTE: StatusPalette<RemediationKind> = {
  badgeClass: DOSSIER_REMEDIATION_CLASS,
  authorGlyphKinds: DOSSIER_AUTHOR_GLYPH_REMEDIATIONS,
};

const REMEDIATION_LABEL: Record<RemediationKind, string> = {
  none: "no plan yet",
  draft: "plan drafted",
  vetted: "plan vetted",
  in_progress: "plan in progress",
  shipped: "remediation shipped",
  closed: "remediation closed",
  unknown: "plan status unknown",
  unrecognised: "plan status unrecognised",
};

const REMEDIATION_REASON: Record<RemediationKind, string> = {
  none: "The dossier's ledger names no remediation plan.",
  draft: "The furthest-along remediation plan is a draft.",
  vetted: "The furthest-along remediation plan is vetted and not yet started.",
  in_progress: "A remediation plan is being implemented.",
  shipped: "A remediation plan shipped.",
  closed: "The remediation plans are closed.",
  unknown:
    "coord could not resolve a remediation plan the ledger names, so whether work is in flight is unknown — not none.",
  unrecognised:
    "coord served a remediation state this page does not know, so it is shown as unknown.",
};

/** Words for the filter chips (coord's wire values stay in the query). */
export const REMEDIATION_FILTER_LABEL: Record<ServedRemediationState, string> =
  {
    none: "no plan yet",
    draft: "draft",
    vetted: "vetted",
    in_progress: "in progress",
    shipped: "shipped",
    closed: "closed",
    unknown: "unknown",
  };

export function remediationKindOf(
  value: string | null | undefined
): RemediationKind {
  return (REMEDIATION_STATES as readonly string[]).includes(value ?? "")
    ? (value as ServedRemediationState)
    : "unrecognised";
}

/** The row's status badge: the LIVE remediation state, in words. */
export function deriveDossierStatus(
  row: Pick<CoordDossierRow, "remediation_state">
): RowStatus<RemediationKind> {
  const kind = remediationKindOf(row.remediation_state);
  return {
    kind,
    label: REMEDIATION_LABEL[kind],
    reason: REMEDIATION_REASON[kind],
    attention: DOSSIER_ATTENTION_BY_REMEDIATION[kind],
  };
}

/** A readiness value, in words. `null`/blank is UNKNOWN, never a default. */
export function readinessLabel(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return v === "" ? "readiness unknown" : v.replace(/_/g, " ");
}

/** A recurrence count, in words. `null` is UNKNOWN, never `0`. */
export function recurrenceLabel(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value))
    return "recurrences unknown";
  return value === 1 ? "1 recurrence" : `${value} recurrences`;
}

/**
 * The work-unit page for a remediation plan, or `null` when coord resolved no
 * work unit for it (a link would open a page that says "not found").
 */
export function remediationHref(r: DossierRemediation): string | null {
  const plan = (r.plan ?? "").trim();
  if (plan === "" || !r.live_status) return null;
  return `/admin/coord/work-units/${encodeURIComponent(plan)}`;
}

/**
 * The readiness filter options: the facet coord counted for this query, in
 * descending count order, with every SELECTED value kept even when the facet
 * no longer lists it (a filter that hides what it is filtering on is a
 * defect). A missing facet yields only the selected values — the vocabulary
 * is unknown, not empty.
 */
export function readinessOptions(
  facet: Record<string, number> | null | undefined,
  selected: readonly string[]
): { value: string; count: number | null }[] {
  const out: { value: string; count: number | null }[] = [];
  const seen = new Set<string>();
  if (facet && typeof facet === "object") {
    const entries = Object.entries(facet).filter(
      ([, n]) => typeof n === "number"
    );
    entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    for (const [value, count] of entries) {
      out.push({ value, count });
      seen.add(value);
    }
  }
  for (const value of selected) {
    if (!seen.has(value)) out.push({ value, count: facet ? 0 : null });
  }
  return out;
}

/** A facet count for one remediation state: `null` when no facet was served. */
export function remediationFacetCount(
  facet: Record<string, number> | null | undefined,
  state: ServedRemediationState
): number | null {
  if (!facet || typeof facet !== "object") return null;
  const n = facet[state];
  return typeof n === "number" ? n : null;
}

/**
 * The page's health strip. R6: a count nobody read is a dash, and every shape
 * of not-knowing — including not knowing whether the list is whole — is amber.
 */
export function deriveDossiersHealth(input: {
  bound: FindingsBound | null;
  loaded: boolean;
  failed: boolean;
  unavailable: string | null;
}): {
  level: HealthStripLevel;
  headline: string;
  detail: string;
  badges: HealthBadge[];
} {
  const readIsCurrent =
    input.loaded && !input.failed && input.unavailable === null;
  const bound = input.bound;
  const countBadge: HealthBadge = {
    key: "shown",
    label: readIsCurrent && bound !== null ? bound.label : "– shown",
    tone: readIsCurrent ? "default" : "muted",
    "data-testid": "coord-dossiers-count",
  };
  const badges: HealthBadge[] =
    readIsCurrent && bound !== null && bound.total !== null
      ? [
          countBadge,
          {
            key: "total",
            label: `${bound.total} match`,
            tone: "default",
            "data-testid": "coord-dossiers-total",
          },
        ]
      : [countBadge];

  if (input.unavailable !== null) {
    return {
      level: "amber",
      headline: "Dossiers could not be read",
      detail: input.unavailable,
      badges,
    };
  }
  if (input.failed && !input.loaded) {
    return {
      level: "amber",
      headline: "Could not read the dossiers",
      detail: UNKNOWN_COUNTS_DETAIL,
      badges,
    };
  }
  if (input.failed) {
    return {
      level: "amber",
      headline: "These results stopped updating",
      detail: staleDetail("Showing dossiers from the last read that landed."),
      badges,
    };
  }
  if (!input.loaded || bound === null) {
    return {
      level: "amber",
      headline: "Reading the dossiers…",
      detail:
        "Nothing has answered yet, so the count is a dash rather than a zero.",
      badges,
    };
  }
  const calm =
    "A dossier is the durable file for a defect that keeps recurring. Nothing here is waiting on you.";
  if (bound.kind === "complete") {
    return {
      level: "green",
      headline: `${bound.shown} dossiers match`,
      detail: calm,
      badges,
    };
  }
  if (bound.kind === "at_least") {
    return {
      level: "green",
      headline: `${bound.shown}+ dossiers match — more exist than are loaded`,
      detail: `${calm} Load more to see the rest.`,
      badges,
    };
  }
  return {
    level: "amber",
    headline: `${bound.shown} dossiers loaded — whether more exist is unknown`,
    detail:
      "coord did not say whether this list is complete, so do not read it as every dossier.",
    badges,
  };
}
