/**
 * `GET /api/v1/plan-library/candidates` — unshipped plans with their ranking
 * INPUTS, derived.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store` Phase 4c.
 * The route has existed, schema'd and tested, with zero frontend consumers.
 *
 * ## The route emits no score, and neither does this module
 *
 * Design decision D6 on the route: *"There is no criticality score. A
 * hardcoded score would be a guess frozen into SQL; the read exposes the
 * evidence and the agent ranks."* So nothing here weights, sums or orders by
 * anything but the route's own declared `oldest_vetted_first`. The readiness
 * kind below is a statement about **dependencies**, which the payload
 * contains, not a priority.
 *
 * ## Three ways this payload is wrong by default
 *
 * 1. **An empty `unmet_depends_on` is UNKNOWN on a work-unit-only row.** The
 *    schema says so in as many words: *"Empty on a row with `document_state`
 *    other than `present` — there are no edges to walk, so that empty list is
 *    UNKNOWN, **not** 'this plan is unblocked'."* {@link describeReadiness}
 *    reads `document_state` BEFORE the dependency list, which is the whole
 *    reason it is an ordered cascade rather than a length check.
 * 2. **`coord: unavailable` is UNKNOWN, never "no PRs" / "no work unit".**
 *    `CoordLinkState` and `CoordPrState` each carry their own `unavailable`
 *    member precisely so a consumer cannot confuse it with a real zero — and
 *    `unlinked` on the PR side IS a real zero, because citations carry a hard
 *    FK. {@link describeCoordLink} keeps the three apart.
 * 3. **`work_unit_population_state: "unavailable"` collapses the
 *    POPULATION.** Same flag, same meaning and same trap as on
 *    `/reconciliation`: the union's coord arm did not run, so `total` counts
 *    the document layer alone — *"which on this fleet has been a ~2% view of
 *    the addressable corpus"*. It is UNKNOWN, never "coord has no work
 *    units", and it is deliberately separate from `coord_available` because a
 *    403 on the population door is coord ANSWERING.
 *
 * ## A ranking drawn from a frozen corpus ranks the corpus, not the work
 *
 * `corpus_health` rides this response for exactly that reason. It is
 * report-only on this route — *"a stale corpus is still the best available
 * answer, and nothing here refuses to serve it"* — and `null` with
 * `corpus_health_unavailable_reason` beside it is UNKNOWN, not healthy.
 * {@link describeCorpusHealth} has both arms and neither one guesses.
 */

import {
  INERT,
  UNKNOWN_AMBER,
  WAITING_AMBER,
  type Attention,
  type AttentionMap,
  type RowStatus,
  type StatusPalette,
} from "@/components/console";
import type { CaptureHealthResponse } from "@/components/admin/coord/captureHealthStatus";
import type { DisclosureLine } from "@/components/admin/coord/disclosureLines";

// ---------------------------------------------------------------------------
// The wire shape. Mirrors `backend/app/schemas/plan_library.py`
// (`PlanCandidateResponse` and friends).
// ---------------------------------------------------------------------------

export type DocumentState = "present" | "unsynced" | "absent";
export type CoordLinkState = "linked" | "dangling" | "unavailable" | "unlinked";
export type CoordPrState = "available" | "unavailable" | "unlinked";
export type WorkUnitPopulationState = "included" | "unavailable";

export interface CandidateLinkedPr {
  repo?: string | null;
  pr_number?: number | null;
  state?: "merged" | "unmerged" | "unknown";
  merged?: boolean | null;
  branch?: string | null;
}

export interface CandidateCoordLink {
  work_unit_slug?: string | null;
  work_unit_state?: CoordLinkState;
  work_unit_status?: string | null;
  work_unit_title?: string | null;
  linked_prs_state?: CoordPrState;
  linked_prs?: CandidateLinkedPr[];
  unavailable_reason?: string | null;
}

export interface CandidateDependency {
  id: string;
  kind: string;
  slug: string;
  title: string;
  status: string;
}

export interface CandidatePromptLink {
  id: string;
  kind: string;
  slug: string;
  title: string;
  relation: string;
  depth: number;
}

export interface PlanCandidate {
  /** `null` for a candidate that exists only as a coord work unit. */
  id?: string | null;
  kind: string;
  slug: string;
  title: string;
  status: string;
  repos?: string[];
  source_repo?: string | null;
  source_path?: string | null;
  work_unit_slug?: string | null;
  authored_at?: string | null;
  created_at?: string;
  last_touched?: string;
  age_days?: number;
  unmet_depends_on?: CandidateDependency[];
  prompt_chain?: CandidatePromptLink[];
  coord?: CandidateCoordLink;
  document_state?: DocumentState;
  difficulty?: string | null;
}

export interface OpenFollowup {
  edge_id: string;
  from_id: string;
  from_kind: string;
  from_slug: string;
  from_title: string;
  /** The finding itself. Non-blank by construction — and the whole payload. */
  note: string;
  created_by?: string | null;
  created_at: string;
  age_days?: number;
}

export interface ScanRootSummary {
  state?: "reported" | "unknown";
  detail?: string | null;
  fresh_within_secs?: number;
  count?: number;
  fresh_count?: number;
}

export interface CorpusHealth {
  artifact_count?: number;
  plan_count?: number;
  newest_updated_at?: string | null;
  capture?: CaptureHealthResponse;
  scan_roots?: ScanRootSummary;
}

export interface PlanCandidateResponse {
  items?: PlanCandidate[];
  count?: number;
  total?: number;
  offset?: number;
  limit?: number;
  ordering?: string;
  coord_available?: boolean;
  work_unit_population_state?: WorkUnitPopulationState;
  work_unit_population_reason?: string | null;
  open_followups?: OpenFollowup[];
  open_followup_total?: number;
  corpus_health?: CorpusHealth | null;
  corpus_health_unavailable_reason?: string | null;
}

// ---------------------------------------------------------------------------
// The palette (R3/R4). Registered in `components/console/consoleSurfaces.ts`.
// ---------------------------------------------------------------------------

export type CandidateKind = "ready" | "blocked" | "unknown";

/**
 * No kind here is `author`, and that is a claim rather than an omission: this
 * page ranks nothing and escalates nothing. A candidate is work waiting to be
 * picked up (`ready`), work waiting on another plan (`blocked`), or work whose
 * blockedness this read could not establish (`unknown`). None of the three is
 * "a human must act NOW" — an unpicked candidate is the normal state of a
 * backlog, and painting one red would be exactly the trained-to-ignore-red
 * failure R3 exists to prevent.
 */
export const CANDIDATE_ATTENTION_BY_KIND = {
  ready: "none",
  blocked: "waiting",
  unknown: "waiting",
} satisfies AttentionMap<CandidateKind>;

export const CANDIDATE_KIND_CLASS: Record<CandidateKind, string> = {
  ready: INERT,
  blocked: WAITING_AMBER,
  unknown: UNKNOWN_AMBER,
};

export const CANDIDATE_AUTHOR_GLYPH_KINDS: ReadonlySet<CandidateKind> =
  new Set<CandidateKind>();

export const CANDIDATE_PALETTE: StatusPalette<CandidateKind> = {
  badgeClass: CANDIDATE_KIND_CLASS,
  authorGlyphKinds: CANDIDATE_AUTHOR_GLYPH_KINDS,
};

// ---------------------------------------------------------------------------
// Readings
// ---------------------------------------------------------------------------

/**
 * Can this candidate be picked up?
 *
 * **An ordered cascade, and the order is the contract.** `document_state` is
 * read FIRST: provenance and `depends_on` edges are document-layer data, so on
 * a work-unit-only row `unmet_depends_on` is empty because nothing was walked,
 * not because nothing blocks it. A length check alone would render every such
 * row "ready" — and on this fleet the document layer has been as little as a
 * 2% view of the corpus, so that is the majority reading, not an edge case.
 */
export function describeReadiness(
  candidate: PlanCandidate
): RowStatus<CandidateKind> {
  const documentState = candidate.document_state ?? "present";
  if (documentState !== "present") {
    return {
      kind: "unknown",
      label: "blockers not looked at",
      reason:
        documentState === "unsynced"
          ? "This candidate is a coord work unit whose plan body has not been " +
            "captured, so its depends_on edges could not be walked. Whether " +
            "anything blocks it is UNKNOWN — not 'nothing does'."
          : "This candidate is a coord work unit with no document anywhere, " +
            "so there are no depends_on edges to walk. Whether anything " +
            "blocks it is UNKNOWN — not 'nothing does'.",
      attention: CANDIDATE_ATTENTION_BY_KIND.unknown,
    };
  }
  const unmet = candidate.unmet_depends_on ?? [];
  if (unmet.length > 0) {
    return {
      kind: "blocked",
      label:
        unmet.length === 1
          ? "blocked on 1 plan"
          : `blocked on ${unmet.length} plans`,
      reason:
        "Every plan it depends on that is not yet in a terminal state is " +
        "listed below. Nobody has to act here — it clears when they land.",
      attention: CANDIDATE_ATTENTION_BY_KIND.blocked,
    };
  }
  return {
    kind: "ready",
    label: "no unmet dependency",
    reason:
      "Its depends_on edges were walked and every target is terminal. That " +
      "is a measurement of the document layer's edges — coord's own " +
      "metadata.depends_on is deliberately not folded in.",
    attention: CANDIDATE_ATTENTION_BY_KIND.ready,
  };
}

export interface CoordLinkReading {
  /** What reaches the screen. */
  label: string;
  detail: string;
  /** `true` when this is a statement of ignorance rather than of state. */
  unknown: boolean;
  /** Merged/unmerged/unknown PR citations, when they are a real answer. */
  prs: CandidateLinkedPr[];
  prLabel: string;
  prUnknown: boolean;
}

/**
 * coord's half of the row, with `unavailable` kept distinct from a real zero
 * in BOTH halves — they fail independently, and the schema says so.
 *
 * The PR side is the subtler one: `unlinked` really is zero citations (they
 * carry a hard FK to the work unit), while `unavailable` is UNKNOWN. Merging
 * the two would turn "coord is down" into "this plan has no PRs".
 */
export function describeCoordLink(
  link: CandidateCoordLink | undefined
): CoordLinkReading {
  const state = link?.work_unit_state ?? "unlinked";
  const prState = link?.linked_prs_state ?? "unlinked";
  const prs = link?.linked_prs ?? [];

  const unit: Pick<CoordLinkReading, "label" | "detail" | "unknown"> =
    state === "linked"
      ? {
          label: link?.work_unit_status
            ? `unit ${link.work_unit_status}`
            : "unit linked",
          detail: `coord returned the work unit${link?.work_unit_slug ? ` ${link.work_unit_slug}` : ""}.`,
          unknown: false,
        }
      : state === "dangling"
        ? {
            label: "unit dangling",
            detail:
              "coord answered and knows no such work unit. The link is " +
              "FK-less by design and MAY dangle — a normal result, never a " +
              "404 on this read.",
            unknown: false,
          }
        : state === "unavailable"
          ? {
              label: "unit unreadable",
              detail:
                link?.unavailable_reason ??
                "coord could not be read for this row. UNKNOWN — never 'no work unit'.",
              unknown: true,
            }
          : {
              label: "no unit link",
              detail:
                "This candidate carries no work_unit_slug at all. The link " +
                "is optional and most artifacts have none.",
              unknown: false,
            };

  const pr =
    prState === "available"
      ? {
          prLabel:
            prs.length === 0
              ? "no PR cited"
              : `${prs.length} PR${prs.length === 1 ? "" : "s"}`,
          prUnknown: false,
        }
      : prState === "unlinked"
        ? {
            prLabel: "no PR cited",
            prUnknown: false,
          }
        : {
            prLabel: "PRs unreadable",
            prUnknown: true,
          };

  return { ...unit, prs, ...pr };
}

/**
 * A citation's merged state, with `unknown` carried rather than flattened.
 *
 * `unknown` covers two cases the schema names: coord returned no merged state,
 * and coord flagged `merged_degraded_reason` — under which its predicate runs
 * without the durable `merge_commit_sha` arm, so **every ff-landed PR reads
 * `merged: false`**. A `false` under that flag is UNKNOWN, not an observation.
 */
export function describePrState(pr: CandidateLinkedPr): string {
  switch (pr.state ?? "unknown") {
    case "merged":
      return "merged";
    case "unmerged":
      return "not merged";
    default:
      return "merge state unknown";
  }
}

// ---------------------------------------------------------------------------
// The disclosures (the honesty block this page owes)
// ---------------------------------------------------------------------------

/**
 * The disclosure vocabulary is SHARED with `/admin/coord/plans`
 * (`components/admin/coord/disclosureLines.ts`), because the two surfaces owe
 * the operator the same three disclosures over two different routes — a
 * population state whose `unavailable` arm silently narrows the denominator, a
 * page-wide coord circuit, and a corpus block whose `null` means UNKNOWN. One
 * contract, one vocabulary.
 */
export type {
  DisclosureLevel,
  DisclosureLine,
} from "@/components/admin/coord/disclosureLines";

/**
 * The corpus these candidates were drawn from — the block, or the reason there
 * is none.
 *
 * *A ranking drawn from a frozen corpus is a ranking of the corpus, not of the
 * work.* So the block is rendered whenever it is there, and when it is not,
 * what is rendered is `corpus_health_unavailable_reason` — verbatim, because
 * it is the only description of what failed. A null block is UNKNOWN, never
 * healthy; the route is explicit that it is report-only and never refuses to
 * serve candidates over it.
 */
export function describeCorpusHealth(
  res: PlanCandidateResponse
): DisclosureLine {
  const health = res.corpus_health ?? null;
  if (health === null) {
    return {
      key: "corpus-health",
      level: "caveat",
      text:
        "The corpus-health block could not be read on this request, so " +
        "whether these candidates were drawn from a current corpus or a " +
        "frozen one is UNKNOWN — it is not 'healthy'. The route reports it " +
        "rather than refusing, so the candidates above are unaffected.",
      items: res.corpus_health_unavailable_reason
        ? [res.corpus_health_unavailable_reason]
        : ["The response named no reason, so what failed is unknown too."],
    };
  }
  const plans = health.plan_count;
  const artifacts = health.artifact_count;
  const roots = health.scan_roots;
  const rootText =
    roots?.state === "reported"
      ? `${roots.fresh_count ?? "an unstated number of"} of ${roots.count ?? "?"} feeding devices reported within the freshness window.`
      : `No device has reported a scan source${roots?.detail ? ` (${roots.detail})` : ""} — which is UNKNOWN, not "every feeder is current".`;
  return {
    key: "corpus-health",
    level: roots?.state === "reported" ? "note" : "caveat",
    text:
      `Drawn from a corpus holding ${plans ?? "an unstated number of"} plans` +
      (typeof artifacts === "number"
        ? ` (${artifacts} artifacts of every kind)`
        : "") +
      ". " +
      rootText +
      " A ranking drawn from a frozen corpus ranks the corpus, not the work.",
  };
}

/**
 * The population line — read BEFORE `total` means anything.
 *
 * Same flag and same trap as `/reconciliation`: on `unavailable` the union's
 * coord arm never ran and `total` counts the document layer alone.
 */
export function describePopulation(res: PlanCandidateResponse): DisclosureLine {
  const state = res.work_unit_population_state;
  if (state === "included") {
    return {
      key: "population",
      level: "note",
      text:
        "coord's work-unit arm ran, so this population is the union of both " +
        "corpus layers and the total below counts it.",
    };
  }
  return {
    key: "population",
    level: "critical",
    text:
      (state === "unavailable"
        ? "coord's work-unit arm did NOT run, so the population fell back to " +
          "the document layer alone — on this fleet that has been as little " +
          "as a 2% view of the addressable corpus. "
        : "This response does not say whether coord's work-unit arm ran, so " +
          "what population the total counts is unknown. ") +
      "The total below is therefore UNKNOWN as a corpus figure — it is never " +
      "“coord has no work units”. This flag is separate from " +
      "coord_available on purpose: a 403 on the population door is coord " +
      "answering, so it never trips the page-wide circuit.",
    items: res.work_unit_population_reason
      ? [res.work_unit_population_reason]
      : undefined,
  };
}

export function deriveCandidateDisclosure(
  res: PlanCandidateResponse
): DisclosureLine[] {
  const lines: DisclosureLine[] = [describePopulation(res)];
  if (res.coord_available === false) {
    lines.push({
      key: "coord-available",
      level: "caveat",
      text:
        "At least one coord read degraded on this page, so a row's coord " +
        "block may read 'unreadable' — which is UNKNOWN, not empty.",
    });
  }
  lines.push(describeCorpusHealth(res));
  return lines;
}

// ---------------------------------------------------------------------------
// The window and the strip
// ---------------------------------------------------------------------------

export interface CandidateWindow {
  total: number | null;
  offset: number;
  limit: number | null;
  shown: number;
  ordering: string | null;
  hasMore: boolean;
  /** `total` is a corpus figure only when the population arm ran. */
  totalAdmissible: boolean;
}

export function describeCandidateWindow(
  res: PlanCandidateResponse
): CandidateWindow {
  const items = res.items ?? [];
  const total = typeof res.total === "number" ? res.total : null;
  const offset = typeof res.offset === "number" ? res.offset : 0;
  const limit = typeof res.limit === "number" ? res.limit : null;
  return {
    total,
    offset,
    limit,
    shown: items.length,
    ordering: typeof res.ordering === "string" ? res.ordering : null,
    hasMore:
      total !== null
        ? offset + items.length < total
        : limit !== null && items.length >= limit,
    totalAdmissible: res.work_unit_population_state === "included",
  };
}

export interface CandidateHealth {
  level: "green" | "amber" | "red";
  headline: string;
  detail?: string;
  badges: {
    key: string;
    label: string;
    tone: "default" | "muted" | "attention";
    title?: string;
  }[];
}

const DASH = "–";

/**
 * The strip. `total` is DASHED whenever the population arm did not run — the
 * same R6 rule the reconciliation strip applies to its verdict histogram, and
 * for the same reason: a number over a denominator that silently moved looks
 * measured and is not.
 */
export function deriveCandidateHealth(
  res: PlanCandidateResponse | null,
  loaded: boolean,
  readFailed: boolean
): CandidateHealth {
  const dashes = [
    { key: "candidates", label: `candidates ${DASH}`, tone: "muted" as const },
    { key: "followups", label: `follow-ups ${DASH}`, tone: "muted" as const },
  ];
  if (!loaded || res === null) {
    return {
      level: "amber",
      headline: readFailed
        ? "Could not read the candidates — unknown, not empty"
        : "Reading the candidate list…",
      detail: readFailed
        ? "coord did not answer; these counts are a dash, not a zero"
        : "counts appear once the route answers",
      badges: dashes,
    };
  }
  const admissible = res.work_unit_population_state === "included";
  const total = res.total;
  const followups = res.open_followup_total;
  return {
    level: admissible ? "green" : "amber",
    headline: admissible
      ? typeof total === "number"
        ? total === 0
          ? "Nothing unshipped in either corpus layer"
          : `${total} unshipped plans, ranked by nothing — the inputs are yours`
        : "Candidates read; the route served no total"
      : "coord's work-unit arm did not run — this is the document layer alone",
    detail: admissible
      ? readFailed
        ? "Last refresh failed — these counts are stale."
        : undefined
      : (res.work_unit_population_reason ??
        "the response does not say whether the population arm ran"),
    badges: [
      {
        key: "candidates",
        label: `candidates ${admissible && typeof total === "number" ? total : DASH}`,
        tone: "muted",
        title: admissible
          ? "Every unshipped plan in the union of both corpus layers."
          : "The population arm did not run, so this total is not a corpus figure.",
      },
      {
        key: "followups",
        label: `follow-ups ${typeof followups === "number" ? followups : DASH}`,
        tone: "default",
        title:
          "Work a plan surfaced and nobody owns. Unpaged total — the list " +
          "below this page is bounded by the same limit the candidates use.",
      },
    ],
  };
}

/** Re-exported so the page and its tests share one spelling. */
export type { Attention };
