/**
 * `/admin/coord/plans` — the three-way plan reconciliation, derived.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store`, Phases 1
 * and 2. The page reads `GET /api/v1/plan-library/reconciliation`, which joins
 * three writers of one fact — *is this plan done?* — per plan stem:
 *
 * | axis | what it is |
 * |---|---|
 * | **A** | coord's STORED `work_units.status` |
 * | **B** | the plan document's status stamp, **from the artifact store** |
 * | **C** | coord's DERIVED delivery verdict, forwarded verbatim |
 *
 * Everything here is pure (R8: derivation lives in a unit-tested module, never
 * inline in JSX), and it exists mostly to hold three readings the route's own
 * schema states and a renderer gets wrong by default.
 *
 * ## 1. `evidence_complete` is read BEFORE `shipped`
 *
 * `ReconciliationAxisC`'s docstring is explicit: *"When `evidence_complete` is
 * `False`, `shipped: false` means coord COULD NOT ESTABLISH delivery — UNKNOWN,
 * not 'undelivered'."* {@link describeAxisC} encodes that as an ordered
 * cascade, so the `not-delivered` arm is unreachable while the evidence read is
 * incomplete. `evidence_gaps` is carried VERBATIM as a list and never collapsed
 * to a count or a boolean — it is the only place two of coord's three modelled
 * gaps are visible at all.
 *
 * ## 2. `computed: false` is "delivery was not asked", not "not delivered"
 *
 * Axis C is computed for the RETURNED PAGE ONLY (`axis_c_scope: "page"`),
 * because coord's delivery door is per-unit at ~0.145 s and a corpus-wide pass
 * is ~4.5 minutes. With `limit` capped at 100 over ~1,991 stems, a row with
 * `computed: false` is the COMMON row, not an edge case, and rendering it as an
 * absent-therefore-negative delivery would mislabel most of the corpus.
 *
 * ## 3. The population state is read BEFORE any flag derived from the population
 *
 * This is the load-bearing one, and it is Finding 2 of the plan's Phase 0.
 * `document_axis_complete` is `document_missing_count == 0` computed over
 * **whatever population was read**. When coord's work-unit list arm fails, the
 * population collapses to the artifact store itself — so every row trivially
 * has a document and the flag is **vacuously true**. Measured 2026-09-20 over
 * eight live probes:
 *
 * | | `work_unit_population_state: "included"` (3/8) | `"unavailable"` (5/8) |
 * |---|---|---|
 * | `total` | 1991 | 1887 |
 * | `document_missing_count` | 104 | 0 |
 * | `document_axis_complete` | **false** | **true** |
 *
 * **The degraded read is the MORE OPTIMISTIC one**, and it was the majority
 * outcome. So {@link deriveDisclosure} refuses to publish
 * `document_axis_complete`, the counts derived from it, or the class histogram
 * on that arm: they are INADMISSIBLE — not "complete", not "empty", UNKNOWN
 * [policy: `verification-and-evidence` `silent-empty-is-unknown`]. What it
 * renders instead is `work_unit_population_reason` verbatim and
 * `facets.corpus_incomplete_reasons` verbatim, which are the fields that still
 * say something true when the booleans do not.
 *
 * An ABSENT `work_unit_population_state` (a backend predating the field) reads
 * the same way as `unavailable` for admissibility purposes — absence is
 * UNKNOWN, and a flag whose population we cannot characterise is not a
 * measurement.
 */

import {
  AUTHOR_RED,
  INERT,
  UNKNOWN_AMBER,
  type Attention,
  type AttentionMap,
  type RowStatus,
  type StatusPalette,
} from "@/components/console";
import type { DisclosureLevel, DisclosureLine } from "./disclosureLines";

// ---------------------------------------------------------------------------
// The wire shape. Mirrors `backend/app/schemas/plan_library.py`
// (`ReconciliationResponse` and friends). Every field the route declares
// REQUIRED is still optional here where reading it wrongly would manufacture a
// claim: an older backend that omits one must read UNKNOWN, never `false`.
// ---------------------------------------------------------------------------

/** `backend/app/schemas/plan_library.py` `DocumentState`. */
export type DocumentState = "present" | "unsynced" | "absent";

/** The three groups the twelve classes fall into. `unknown` is first-class. */
export type ReconciliationVerdict = "agree" | "disagree" | "unknown";

/** Whether coord's work-unit list — the population's axis-A arm — was read. */
export type WorkUnitPopulationState = "included" | "unavailable";

export interface ReconciliationAxisA {
  readable: boolean;
  present: boolean;
  status?: string | null;
  unreadable_reason?: string | null;
}

export interface ReconciliationAxisB {
  source?: string;
  readable: boolean;
  present: boolean;
  status?: string | null;
  classification?: string | null;
  adapter_readable?: boolean | null;
  document_state: DocumentState;
  complete: boolean;
  unreadable_reason?: string | null;
  /** `>1` is a divergent document copy; the newest is the one compared. */
  variant_count?: number;
}

export interface ReconciliationAxisC {
  readable: boolean;
  present: boolean;
  shipped?: boolean | null;
  evidence_complete?: boolean | null;
  evidence_gaps?: string[];
  citation_count?: number | null;
  unreadable_reason?: string | null;
  /** Did THIS request ask coord about this row? `false` on every off-page row. */
  computed?: boolean;
}

export interface ReconciliationRowData {
  slug: string;
  title?: string | null;
  artifact_id?: string | null;
  source_repo?: string | null;
  source_path?: string | null;
  document_state: DocumentState;
  document_axis_complete: boolean;
  axis_a: ReconciliationAxisA;
  axis_b: ReconciliationAxisB;
  axis_c: ReconciliationAxisC;
  classification: string;
  verdict: ReconciliationVerdict;
  reason: string;
}

export interface ReconciliationFacets {
  denominator?: number;
  by_class?: Record<string, number>;
  by_verdict?: Record<string, number>;
  corpus_complete?: boolean;
  corpus_incomplete_reasons?: string[];
}

export interface ReconciliationResponse {
  items?: ReconciliationRowData[];
  total?: number;
  offset?: number;
  limit?: number;
  ordering?: string;
  document_axis_source?: string;
  document_axis_complete?: boolean;
  document_present_count?: number;
  document_missing_count?: number;
  coord_available?: boolean;
  work_unit_population_state?: WorkUnitPopulationState;
  work_unit_population_reason?: string | null;
  axis_c_scope?: string;
  axis_c_computed_count?: number;
  facets?: ReconciliationFacets;
}

// ---------------------------------------------------------------------------
// The verdict palette (R3/R4). Registered in
// `components/console/consoleSurfaces.ts`, which is what audits the invariant
// that red means "someone must act" and amber means "waiting / we do not know".
// ---------------------------------------------------------------------------

/**
 * `disagree` is RED: two writers of one fact hold different values and nothing
 * but a human reconciles them. `unknown` is AMBER by the style guide's stated
 * exception — *"an amber painted on ignorance is a statement about our
 * knowledge, not a promise about the row"* — and it is the single largest
 * bucket on this surface, because axis C is page-scoped. `agree` is inert.
 */
export const RECONCILIATION_ATTENTION_BY_VERDICT = {
  agree: "none",
  disagree: "author",
  unknown: "waiting",
} satisfies AttentionMap<ReconciliationVerdict>;

export const RECONCILIATION_BADGE_CLASS: Record<ReconciliationVerdict, string> =
  {
    agree: INERT,
    disagree: AUTHOR_RED,
    unknown: UNKNOWN_AMBER,
  };

export const RECONCILIATION_AUTHOR_GLYPH_VERDICTS: ReadonlySet<ReconciliationVerdict> =
  new Set<ReconciliationVerdict>(["disagree"]);

export const RECONCILIATION_PALETTE: StatusPalette<ReconciliationVerdict> = {
  badgeClass: RECONCILIATION_BADGE_CLASS,
  authorGlyphKinds: RECONCILIATION_AUTHOR_GLYPH_VERDICTS,
};

const VERDICT_LABEL: Record<ReconciliationVerdict, string> = {
  agree: "agree",
  disagree: "disagree",
  unknown: "unknown",
};

/** The row's badge — the route's own verdict, never re-derived here. */
export function describeVerdict(
  row: Pick<ReconciliationRowData, "verdict" | "classification">
): RowStatus<ReconciliationVerdict> {
  const verdict: ReconciliationVerdict =
    row.verdict in VERDICT_LABEL ? row.verdict : "unknown";
  return {
    kind: verdict,
    label: VERDICT_LABEL[verdict],
    // The twelve-member class is coord's internal vocabulary (R8), so it rides
    // the badge's title and the detail panel's raw slot — never the row text.
    reason: row.classification,
    attention: RECONCILIATION_ATTENTION_BY_VERDICT[verdict],
  };
}

// ---------------------------------------------------------------------------
// Axis readings
// ---------------------------------------------------------------------------

export type AxisAKind = "unreadable" | "absent" | "status";

export interface AxisReading {
  kind: string;
  /** What reaches the screen. */
  label: string;
  /** The longer sentence, for a `title` or the detail panel. */
  detail: string;
  /** `true` when this reading is a statement of ignorance, not of state. */
  unknown: boolean;
}

/** Axis A — coord's STORED status. The value is OPAQUE and rendered verbatim. */
export function describeAxisA(axis: ReconciliationAxisA): AxisReading {
  if (!axis.readable) {
    return {
      kind: "unreadable",
      label: "unreadable",
      detail:
        axis.unreadable_reason ??
        "coord's work-unit record could not be read — unknown, not absent.",
      unknown: true,
    };
  }
  if (!axis.present) {
    return {
      kind: "absent",
      label: "no work unit",
      detail:
        "coord holds no work unit for this stem. The plan exists in the " +
        "document layer and nothing is tracking it operationally.",
      unknown: false,
    };
  }
  const status = axis.status ?? "";
  if (!status) {
    return {
      kind: "unreadable",
      label: "status empty",
      detail:
        "coord's work unit carries no status value, so its stored position is unknown.",
      unknown: true,
    };
  }
  return {
    kind: "status",
    label: status,
    detail: `coord's stored work-unit status is "${status}" (an opaque value — coord accepts words outside any vocabulary).`,
    unknown: false,
  };
}

export type AxisBKind = "unreadable" | "absent" | "unsynced" | "present";

/** Axis B — the document's status stamp, from the ARTIFACT STORE. */
export function describeAxisB(axis: ReconciliationAxisB): AxisReading {
  if (!axis.readable) {
    return {
      kind: "unreadable",
      label: "unreadable",
      detail:
        axis.unreadable_reason ??
        "the plan document could not be read — unknown, not absent.",
      unknown: true,
    };
  }
  if (axis.document_state === "absent" || !axis.present) {
    return {
      kind: "absent",
      label: "no document",
      detail:
        "the artifact store holds no plan body for this stem, so there is " +
        "nothing to compare on the document axis. The body sync is per-device " +
        "and opt-in, so this is 'not captured here', not 'never written'.",
      unknown: true,
    };
  }
  if (axis.document_state === "unsynced") {
    return {
      kind: "unsynced",
      label: "document unsynced",
      detail:
        "an artifact row exists but its body has not been captured, so its " +
        "status stamp cannot be read.",
      unknown: true,
    };
  }
  const status = axis.status ?? "";
  const classification = axis.classification ?? "";
  if (!status) {
    return {
      kind: "present",
      label:
        classification === "no_status_block" ? "no status block" : "no stamp",
      detail:
        "the document is captured but carries no status stamp the scanner " +
        "could parse.",
      unknown: true,
    };
  }
  return {
    kind: "present",
    label: status,
    detail:
      `the document's own status stamp reads "${status}"` +
      (classification ? ` (${classification})` : "") +
      ".",
    unknown: false,
  };
}

export type AxisCKind =
  | "not-asked"
  | "unreadable"
  | "absent"
  | "evidence-incomplete"
  | "delivered"
  | "not-delivered";

export interface AxisCReading extends AxisReading {
  kind: AxisCKind;
  /**
   * coord's `evidence_gaps`, VERBATIM. Never collapsed to a count or a
   * boolean — the schema says so, and two of coord's three modelled gaps are
   * visible nowhere else.
   */
  gaps: string[];
}

/**
 * Axis C — coord's DERIVED delivery verdict.
 *
 * **The order of these arms IS the contract**, and it is not a style choice:
 *
 * 1. `computed === false` — this request never asked coord about this row
 *    (axis C is page-scoped). "Not asked" is not "not delivered".
 * 2. unreadable / absent — coord was asked and could not answer.
 * 3. `evidence_complete !== true` — **before any read of `shipped`**. A
 *    `shipped: false` under an incomplete evidence read means coord COULD NOT
 *    ESTABLISH delivery. An absent `evidence_complete` lands here too: absence
 *    is UNKNOWN, and the one thing it may not become is "undelivered".
 * 4. only then, `shipped`.
 */
export function describeAxisC(axis: ReconciliationAxisC): AxisCReading {
  const gaps = axis.evidence_gaps ?? [];
  if (axis.computed !== true) {
    return {
      kind: "not-asked",
      label: "delivery not asked",
      detail:
        "coord's delivery door is per-unit, so this request asked it only " +
        "about the rows on this page. This row was not one of them — which is " +
        "not the same as coord answering 'not delivered'.",
      unknown: true,
      gaps,
    };
  }
  if (!axis.readable) {
    return {
      kind: "unreadable",
      label: "delivery unreadable",
      detail:
        axis.unreadable_reason ??
        "coord's delivery verdict could not be read — unknown, not undelivered.",
      unknown: true,
      gaps,
    };
  }
  if (!axis.present) {
    return {
      kind: "absent",
      label: "no delivery record",
      detail:
        "coord holds no delivery record for this stem, so whether it shipped " +
        "is unknown.",
      unknown: true,
      gaps,
    };
  }
  // READ BEFORE `shipped`. See the module docstring.
  if (axis.evidence_complete !== true) {
    return {
      kind: "evidence-incomplete",
      label: "evidence incomplete",
      detail:
        "coord's delivery evidence is incomplete, so whether this plan " +
        "shipped is UNKNOWN — not 'undelivered'. The gaps below are coord's " +
        "own words.",
      unknown: true,
      gaps,
    };
  }
  if (axis.shipped === true) {
    return {
      kind: "delivered",
      label: "delivered",
      detail:
        "coord derived delivery from complete evidence" +
        (typeof axis.citation_count === "number"
          ? ` (${axis.citation_count} citation${axis.citation_count === 1 ? "" : "s"})`
          : "") +
        ".",
      unknown: false,
      gaps,
    };
  }
  return {
    kind: "not-delivered",
    label: "not delivered",
    detail:
      "coord's evidence is complete and says this plan has not been " +
      "delivered. This is a measurement, not an absence.",
    unknown: false,
    gaps,
  };
}

/** `>1` artifact rows share this stem — a divergent copy, collapsed to the newest. */
export function variantCount(axis: ReconciliationAxisB): number {
  return typeof axis.variant_count === "number" ? axis.variant_count : 1;
}

export function isDivergent(row: ReconciliationRowData): boolean {
  return variantCount(row.axis_b) > 1;
}

// ---------------------------------------------------------------------------
// The window (Phase 2)
// ---------------------------------------------------------------------------

export interface WindowReading {
  /** `null` when the route served no total — UNKNOWN, never `items.length`. */
  total: number | null;
  offset: number;
  limit: number | null;
  shown: number;
  /** The route's DECLARED ordering, so a consumer can assert it. */
  ordering: string | null;
  firstStem: string | null;
  lastStem: string | null;
  /** Can the operator page further forward? UNKNOWN total ⇒ page-full test. */
  hasMore: boolean;
  /**
   * Is `total` a count of PLAN STEMS, or of whatever population this read
   * happened to reach?
   *
   * The same predicate, and the same trap, as
   * {@link documentAxisAdmissible} — which is why it is that function and not
   * a second spelling of it. On the degraded arm the population collapses to
   * the artifact store, so `total` is `1887` where the good arm says `1991`:
   * a smaller, MORE OPTIMISTIC number that still looks like a corpus size.
   * The health strip already dashes it; a window line that prints it anyway
   * republishes exactly what the strip refused.
   */
  totalAdmissible: boolean;
}

export function describeWindow(res: ReconciliationResponse): WindowReading {
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
    firstStem: items[0]?.slug ?? null,
    lastStem: items[items.length - 1]?.slug ?? null,
    hasMore:
      total !== null
        ? offset + items.length < total
        : limit !== null && items.length >= limit,
    totalAdmissible: documentAxisAdmissible(res),
  };
}

// ---------------------------------------------------------------------------
// The disclosure block (Phase 2) — the population state before any flag
// derived from the population.
// ---------------------------------------------------------------------------

/**
 * The line shape now lives in `disclosureLines.ts`, shared with
 * `/admin/coord/plan-candidates` — which owes the operator the same three
 * disclosures over a different route (Phase 4c). Re-exported here so every
 * existing importer keeps its spelling.
 */
export type { DisclosureLevel, DisclosureLine };

export interface ReconciliationDisclosure {
  /**
   * Was coord's work-unit population actually read? `false` on `unavailable`
   * AND on a response that does not say — absence is UNKNOWN.
   */
  populationRead: boolean;
  /**
   * May the page state `document_axis_complete` / the present-missing counts as
   * a measurement? Equal to {@link populationRead}: the flag is
   * `document_missing_count == 0` over whatever population was read, and on the
   * degraded arm that population is the artifact store itself, which makes the
   * flag vacuously true.
   */
  documentAxisAdmissible: boolean;
  /** Same predicate, same reason, for `facets.by_class` / `by_verdict`. */
  facetsAdmissible: boolean;
  /** Ordered. The population line is always first. */
  lines: DisclosureLine[];
}

const VACUOUS_FLAG_WARNING =
  "So `document_axis_complete`, the document present/missing counts and the " +
  "class histogram are NOT measurements on this read and are suppressed: the " +
  "population collapses to the artifact store, every row trivially has a " +
  "document, and the completeness flag reads true without measuring anything. " +
  "The degraded read is the more optimistic one.";

export function deriveDisclosure(
  res: ReconciliationResponse
): ReconciliationDisclosure {
  const lines: DisclosureLine[] = [];
  const populationRead = res.work_unit_population_state === "included";

  // 1. THE POPULATION STATE — always first, and always rendered. Every flag
  //    below is derived from the population this line describes.
  if (populationRead) {
    lines.push({
      key: "population",
      level: "note",
      text:
        "coord's work-unit population was read, so axis A is a measurement " +
        "and the counts below describe the whole corpus.",
    });
  } else {
    const reason = res.work_unit_population_reason;
    lines.push({
      key: "population",
      level: "critical",
      text:
        (res.work_unit_population_state === "unavailable"
          ? "coord's work-unit list could not be read, so axis A is UNKNOWN for EVERY row on this page — never 'coord has no work units'. "
          : "This response does not say whether coord's work-unit population was read, so axis A is UNKNOWN for EVERY row on this page. ") +
        VACUOUS_FLAG_WARNING,
      items: reason ? [reason] : undefined,
    });
  }

  // 2. The page-wide coord circuit.
  if (res.coord_available === false) {
    lines.push({
      key: "coord-available",
      level: "caveat",
      text: "At least one coord read degraded on this page.",
    });
  }

  // 3. Axis C's denominator — a DIFFERENT denominator from the document one.
  const asked = res.axis_c_computed_count;
  if (typeof asked === "number") {
    const total = typeof res.total === "number" ? res.total : null;
    lines.push({
      key: "axis-c-scope",
      level: "caveat",
      text:
        `Delivery was asked for ${asked} of ${total ?? "an unknown number of"} rows` +
        (res.axis_c_scope ? ` (scope: ${res.axis_c_scope})` : "") +
        ". Every other row reads 'delivery not asked' and stays in the " +
        "denominator — it is not dropped, and it is not 'not delivered'.",
    });
  }

  // 4. The document axis — ONLY where the population makes it a measurement.
  if (documentAxisAdmissible(res)) {
    const source = res.document_axis_source ?? "artifact_store";
    const present = res.document_present_count;
    const missing = res.document_missing_count;
    const counted =
      typeof present === "number" && typeof missing === "number"
        ? `${present} of ${present + missing} stems carry a document; ${missing} do not.`
        : "The present/missing split was not served.";
    lines.push({
      key: "document-axis",
      level: res.document_axis_complete === true ? "note" : "caveat",
      text:
        (res.document_axis_complete === true
          ? "Every row in the denominator has a document behind it. "
          : "The document layer is INCOMPLETE, so a row without a document is UNKNOWN rather than disagreeing. ") +
        counted +
        ` Compared against the ${source === "artifact_store" ? "artifact store" : source} — not against origin/main.`,
    });
  } else {
    lines.push({
      key: "document-axis-suppressed",
      level: "caveat",
      text:
        "The document-layer completeness claim is SUPPRESSED on this read " +
        "(see above). Whether the artifact store holds a body for every stem " +
        "is unknown here" +
        (res.document_axis_source
          ? `; axis B compares against the ${res.document_axis_source === "artifact_store" ? "artifact store" : res.document_axis_source}, not origin/main.`
          : "."),
    });
  }

  // 5. The route's own plain-words blind spots, VERBATIM. The field that still
  //    says something true when the booleans do not.
  const reasons = res.facets?.corpus_incomplete_reasons ?? [];
  if (reasons.length > 0) {
    lines.push({
      key: "corpus-incomplete",
      level: "caveat",
      text: "The route names these blind spots in this read:",
      items: reasons,
    });
  } else if (res.facets?.corpus_complete === true && populationRead) {
    lines.push({
      key: "corpus-complete",
      level: "note",
      text: "The route reports no blind spot in this read.",
    });
  }

  return {
    populationRead,
    documentAxisAdmissible: documentAxisAdmissible(res),
    facetsAdmissible: populationRead,
    lines,
  };
}

/**
 * The predicate on its own, because two callers need it and respelling it is
 * how the page and the strip drift apart (the same reasoning as
 * `console/readFailure.ts` `readIsUnknown`).
 */
export function documentAxisAdmissible(res: ReconciliationResponse): boolean {
  return res.work_unit_population_state === "included";
}

// ---------------------------------------------------------------------------
// The route's 500 refusal — a read state of its own
// ---------------------------------------------------------------------------

export const CONTRACT_VIOLATION_ERROR = "reconciliation_contract_violated";

/**
 * Did this error come from the route REFUSING to emit a facet block it cannot
 * stand behind?
 *
 * It is neither an unknown read (transport) nor a stale one: the route checked
 * its own output, found the facets no longer meant what they say, and raised
 * 500 with the violations rather than returning a degraded body. The
 * violations text is the only description of what broke, so it is carried
 * verbatim.
 *
 * Recovered from the message `httpClient` formats
 * (`GET <url> failed: <status> - <body>`), which is the only place the status
 * and body survive the throw — the same coupling, and the same reasoning, as
 * `console/readFailure.ts` `isNotFoundError`.
 *
 * @returns the violations (possibly empty) for a contract refusal, else `null`.
 */
export function parseContractViolation(err: unknown): string[] | null {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const match = /\sfailed:\s500\s-\s([\s\S]*)$/.exec(message);
  if (!match) return null;
  let detail: unknown;
  try {
    detail = (JSON.parse(match[1] ?? "") as { detail?: unknown }).detail;
  } catch {
    return null;
  }
  // FastAPI serves `detail` as the object the handler raised; a proxy that
  // re-encodes it as a string is handled too, because getting this wrong turns
  // a named refusal back into an anonymous 500.
  if (typeof detail === "string") {
    try {
      detail = JSON.parse(detail);
    } catch {
      return null;
    }
  }
  if (typeof detail !== "object" || detail === null) return null;
  const body = detail as { error?: unknown; violations?: unknown };
  if (body.error !== CONTRACT_VIOLATION_ERROR) return null;
  return Array.isArray(body.violations)
    ? body.violations.map((v) => String(v))
    : [];
}

// ---------------------------------------------------------------------------
// The health strip (R1) — derived from the response the page already has
// ---------------------------------------------------------------------------

export interface ReconciliationHealth {
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
 * The strip, and the one thing it must never do: publish a verdict histogram
 * the population state says is not a measurement.
 *
 * On the degraded arm the counts are dashed rather than shown. `by_verdict`
 * there reads `unknown: 1887` against a real corpus of 1991 — a number that
 * looks measured, over a denominator that silently moved. R6's rule applies
 * unchanged: an unfetched count renders `–`, never a number that means
 * something else.
 *
 * The same rule governs the HEADLINE, which is the larger claim and was the
 * easier one to get wrong: an ABSENT `by_verdict` is UNKNOWN, so the strip
 * takes its own amber arm rather than "No plan record disagrees with reality"
 * — a negative nothing on this read measured. The badge was already honest
 * (`disagree –`); the headline is the text an operator actually reads.
 */
export function deriveReconciliationHealth(
  res: ReconciliationResponse | null,
  loaded: boolean,
  readFailed: boolean,
  contractViolations: string[] | null = null
): ReconciliationHealth {
  if (contractViolations !== null) {
    return {
      level: "red",
      headline: "The reconciliation route refused this read",
      detail:
        "It checked its own facet block, found it no longer meant what it " +
        "says, and returned nothing rather than a number that measured " +
        "nothing.",
      badges: [
        { key: "plans", label: `plans ${DASH}`, tone: "muted" },
        { key: "disagree", label: `disagree ${DASH}`, tone: "muted" },
        { key: "unknown", label: `unknown ${DASH}`, tone: "muted" },
      ],
    };
  }
  if (readFailed && !loaded) {
    return {
      level: "amber",
      headline: "Could not read the reconciliation — unknown, not empty",
      detail: "coord did not answer; these counts are a dash, not a zero",
      badges: [
        { key: "plans", label: `plans ${DASH}`, tone: "muted" },
        { key: "disagree", label: `disagree ${DASH}`, tone: "muted" },
        { key: "unknown", label: `unknown ${DASH}`, tone: "muted" },
      ],
    };
  }
  if (!loaded || res === null) {
    return {
      level: "amber",
      headline: "Waiting for the plan corpus…",
      detail: "counts appear once the reconciliation arrives",
      badges: [
        { key: "plans", label: `plans ${DASH}`, tone: "muted" },
        { key: "disagree", label: `disagree ${DASH}`, tone: "muted" },
        { key: "unknown", label: `unknown ${DASH}`, tone: "muted" },
      ],
    };
  }

  const admissible = documentAxisAdmissible(res);
  // NOT `?? {}`. A response with no facet block has not said "zero
  // disagreements" — it has said nothing, and the collapse is what let the
  // headline below assert a negative nobody measured.
  const byVerdict = res.facets?.by_verdict;
  const disagree = byVerdict?.disagree;
  const unknown = byVerdict?.unknown;
  const total = res.total;

  if (!admissible) {
    return {
      level: "amber",
      headline:
        "coord's work-unit population was not read — axis A is unknown for every row",
      detail:
        (res.work_unit_population_reason ??
          "the response does not say whether the population was read") +
        ". The verdict counts and the document-completeness flag are not " +
        "measurements on this read.",
      badges: [
        {
          key: "plans",
          label: `plans ${DASH}`,
          tone: "muted",
          title:
            "The denominator collapsed to the artifact store on this read, so it is not the corpus size.",
        },
        { key: "disagree", label: `disagree ${DASH}`, tone: "muted" },
        { key: "unknown", label: `unknown ${DASH}`, tone: "muted" },
      ],
    };
  }

  // ORDERED, and the middle arm is the one a `?? {}` used to swallow. An
  // absent `by_verdict` is not a measured zero, so the green headline — the
  // largest text on the page — may not assert the negative it could not
  // measure [policy: `verification-and-evidence` `silent-empty-is-unknown`].
  const disagreeMeasured = typeof disagree === "number";
  const level: ReconciliationHealth["level"] =
    disagreeMeasured && disagree > 0
      ? "red"
      : !disagreeMeasured
        ? "amber"
        : readFailed
          ? "amber"
          : "green";
  const headline =
    disagreeMeasured && disagree > 0
      ? disagree === 1
        ? "One plan's record disagrees with reality"
        : `${disagree} plans' records disagree with reality`
      : !disagreeMeasured
        ? "The route served no verdict histogram — whether any record disagrees is unknown"
        : readFailed
          ? "Last refresh failed — these counts are not current"
          : "No plan record disagrees with reality";
  return {
    level,
    headline,
    detail: !disagreeMeasured
      ? "The rows below are real; the disagreement count behind this headline " +
        "was never served, so nothing here is a measured zero." +
        (readFailed ? " The last refresh also failed." : "")
      : readFailed
        ? "Last refresh failed — these counts are stale."
        : undefined,
    badges: [
      {
        key: "plans",
        label: `plans ${typeof total === "number" ? total : DASH}`,
        tone: "muted",
        title: "Every plan stem in the corpus, not just this page.",
      },
      {
        key: "disagree",
        label: `disagree ${typeof disagree === "number" ? disagree : DASH}`,
        tone:
          typeof disagree === "number" && disagree > 0 ? "attention" : "muted",
        title:
          "Stems where two writers of the same fact hold different values.",
      },
      {
        key: "unknown",
        label: `unknown ${typeof unknown === "number" ? unknown : DASH}`,
        tone: "default",
        title:
          "Stems an axis could not be read for — mostly 'delivery not asked', since axis C is page-scoped.",
      },
    ],
  };
}

/** Re-exported so the page and its tests share one spelling. */
export type { Attention };
