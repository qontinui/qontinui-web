/**
 * Independent post-land verification metrics — the wire shape of coord's
 * `GET /coord/verification/metrics` (read through
 * `lib/api/operations/coordVerification.ts`) and the pure derivations
 * both of its readers share: the overview's "Can I trust 'done'?" tile and
 * the `/admin/coord/verification` drill-down.
 *
 * Plan `2026-09-20-trust-calibration-and-independent-verification-coverage-are-measured-continuously`,
 * Phase 5. The types mirror `metrics_response` / `degraded_metrics_body` /
 * `lane_block` / `trust_calibration_json` / `coverage_json` in
 * qontinui-coord `crates/coord/src/work_unit_verification.rs` (3088dc5d).
 *
 * ## Unknown is first-class
 *
 * Three different answers must never collapse into one:
 *
 * - **could not look** — coord's `degraded: true` body, or no answer at all
 *   (the door unreachable, refused, or a shape this page does not know). Every
 *   number is UNKNOWN; the reader shows the reason and the last good
 *   `generated_at`, never a stale figure and never a zero.
 * - **looked, nothing verified yet** — `trust_calibration.n === 0`, `value:
 *   null`. That is neither 0 % nor 100 %; it renders as words.
 * - **looked, verified** — the numbers, each with its interval and `n`.
 *
 * `null` from coord is carried as `null` all the way to the renderer, which
 * prints a word or a dash for it — nothing in here defaults a count to 0.
 */

import type {
  OperatorLabelResult,
  OperatorLabelTruth,
} from "@/lib/api/operations/coordVerification";

/** The window the tile reads. coord's default is also 28 days. */
export const DEFAULT_METRICS_WINDOW = "28d";

/** The findings topic coord posts a refutation under (`REFUTED_FINDING_TOPIC`). */
export const REFUTED_FINDING_TOPIC = "verification-refuted";

/** A lane with no verdict for longer than this is not keeping up (exit criterion 3). */
export const LANE_STALE_AFTER_HOURS = 48;

export interface TrustCalibration {
  /** `null` exactly when `n === 0` — with `reason` saying so. */
  value: number | null;
  ci95_low: number | null;
  ci95_high: number | null;
  survived: number;
  refuted: number;
  n: number;
  population: number;
  method: string;
  reason: string | null;
  /** Headline object only: what the counts are over. */
  counts?: string;
}

export interface VerificationCoverage {
  /** `null` exactly when the population is empty. */
  value: number | null;
  verified_disjoint: number;
  population: number;
  reason: string | null;
}

export interface ClaimsUnreadable {
  count: number;
  examined: number;
  /** How many pending claims there were to examine — `null` when unknown. */
  of: number | null;
  complete: boolean | null;
  first: string[];
}

export interface VerificationUnknowns {
  unverifiable_by_reason: Record<string, number>;
  independence_unproven: number;
  claims_unreadable: ClaimsUnreadable;
  /** `null` when no sample exists to be pending (no salt yet / store absent). */
  selected_not_yet_verified: number | null;
  selected_not_yet_verified_reason: string | null;
  oldest_unverified_age_secs: number | null;
  recheck_pending: number;
  recheck_unreadable: number;
}

export interface PreLandReview {
  units_with_reviewed_head_for_landed_sha: number;
  population: number;
  note: string;
}

export interface VerificationSampling {
  configured_rate_bp: number | null;
  /** `null` on a degraded body: the surge could not be evaluated. */
  effective_rate_bp: number | null;
  rate_source: string | null;
  surge_reason: string | null;
  calibration_floor_bp: number | null;
  floor_source: string | null;
}

export type LaneCycleOutcome =
  | "ok"
  | "queue_empty"
  | "could_not_look"
  | "running"
  | "unknown";

export type CanaryOutcome = "pass" | "fail" | "not_run" | "unknown";

export interface VerificationLane {
  last_verdict_at: string | null;
  last_cycle_outcome: LaneCycleOutcome | string;
  last_cycle_reason: string | null;
  last_cycle_at: string | null;
  canary: CanaryOutcome | string;
  canary_at: string | null;
  /**
   * coord serves `true` or `"unknown"` — never `false`, because it cannot see
   * a device's scheduler. `false` is typed only so a future coord that learns
   * to say it renders as "not installed" rather than crashing.
   */
  installed: boolean | "unknown";
  installed_basis: string;
  journal_finding_id: string | null;
}

export interface SeriesWeek {
  week_start: string;
  week_end: string;
  /** Units whose FIRST-EVER ship falls in this week. */
  throughput: number;
  trust_calibration: TrustCalibration;
  independent_verification_coverage: VerificationCoverage;
  n: number;
}

export interface MetricsWindow {
  days: number;
  from: string;
  to: string;
}

/** Rows are the label's truth, columns the verifier's verdict. */
export type JudgeMatrix = Record<
  "holds" | "fails" | "cannot_tell",
  Record<"survived" | "refuted" | "unverifiable", number>
>;

/**
 * One label source's agreement with the verifier (`seeded` or `operator`).
 * `kappa` is Cohen's kappa on the binary sub-table (truth holds/fails ×
 * verdict survived/refuted), `null` with `reason: "n<20"` below 20 binary
 * cases and `reason: "undefined"` when the expected agreement is 1.
 */
export interface JudgeAgreementSource {
  n: number;
  binary_n: number;
  kappa: number | null;
  reason: "n<20" | "undefined" | null | string;
  matrix: JudgeMatrix;
}

/** coord's `judge_agreement` — per label source, never pooled. */
export interface JudgeAgreement {
  seeded: JudgeAgreementSource;
  operator: JudgeAgreementSource;
  /** A one-sided false-`survived` signal; never put into kappa. */
  consequence: { false_survived_count: number };
}

interface MetricsCommon {
  generated_at: string;
  window: MetricsWindow;
  population_query_id: string;
  sampling: VerificationSampling;
  lane: VerificationLane;
  /**
   * Absent on a coord build that predates the judge-case table; `null` with
   * `judge_agreement_error` when coord could not read it. Neither is zero.
   */
  judge_agreement?: JudgeAgreement | null;
  judge_agreement_error?: string;
}

export interface PopulatedMetrics extends MetricsCommon {
  degraded: false;
  population: number;
  trust_calibration: TrustCalibration;
  independent_verification_coverage: VerificationCoverage;
  unknowns: VerificationUnknowns;
  pre_land_review: PreLandReview;
  series: SeriesWeek[];
}

export interface DegradedMetrics extends MetricsCommon {
  degraded: true;
  reason: string;
  population: null;
  trust_calibration: null;
  independent_verification_coverage: null;
  unknowns: null;
  pre_land_review: null;
  series: null;
  note?: string;
}

export type VerificationMetrics = PopulatedMetrics | DegradedMetrics;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Accept coord's body only when it carries what the readers render. A body
 * that does not is a "could not look" with a reason — never a half-read whose
 * missing pieces render as zeros.
 */
export function parseVerificationMetrics(raw: unknown): VerificationMetrics {
  if (!isObject(raw) || typeof raw.degraded !== "boolean") {
    throw new Error(
      "coord answered in a shape this page does not recognise (no `degraded` flag)"
    );
  }
  if (typeof raw.generated_at !== "string" || !isObject(raw.lane)) {
    throw new Error(
      "coord answered without `generated_at` or `lane`, so the answer cannot be dated"
    );
  }
  if (
    !isObject(raw.window) ||
    typeof raw.window.days !== "number" ||
    typeof raw.window.from !== "string"
  ) {
    throw new Error(
      "coord answered without a readable `window` (days, from), so the numbers cannot be placed in time"
    );
  }
  if (raw.degraded) {
    return raw as unknown as DegradedMetrics;
  }
  if (
    !isObject(raw.trust_calibration) ||
    !isObject(raw.independent_verification_coverage) ||
    !isObject(raw.unknowns) ||
    !Array.isArray(raw.series) ||
    typeof raw.population !== "number"
  ) {
    throw new Error(
      "coord's answer is missing a block this page renders (calibration, coverage, unknowns, series or population)"
    );
  }
  return raw as unknown as PopulatedMetrics;
}

/**
 * The words for a read that did not land. `httpClient` formats a non-2xx as
 * `GET <url> failed: <status> - <body>`; the body is FastAPI's
 * `{"detail": …}` (the proxy's own 502/504, or coord's refusal passed through),
 * whose detail is itself often coord's `{"error", "message"}`.
 */
export function couldNotLookReason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const m = /\sfailed:\s(\d{3})\s-\s([\s\S]*)$/.exec(message);
  if (!m) return message || "the read failed with no message";
  const status = m[1];
  let detail = (m[2] ?? "").trim();
  try {
    const body: unknown = JSON.parse(detail);
    if (isObject(body) && body.detail != null) {
      detail =
        typeof body.detail === "string"
          ? body.detail
          : JSON.stringify(body.detail);
    }
  } catch {
    // Not JSON — keep the text as sent.
  }
  try {
    const inner: unknown = JSON.parse(detail);
    if (isObject(inner) && typeof inner.message === "string") {
      detail =
        typeof inner.error === "string"
          ? `${inner.error}: ${inner.message}`
          : inner.message;
    }
  } catch {
    // Not coord's `{error, message}` — keep it.
  }
  if (status === "404") {
    return `the metrics door is not answering (HTTP 404) — the deployed coord or web backend may predate it${detail ? ` (${detail})` : ""}`;
  }
  return detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** `0.912` → `91%`. Only ever called on a non-null value. */
export function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/**
 * A calibration rate, rounded without lying at the ends: `100%` only when
 * nothing was refuted and `0%` only when nothing survived. 0.996 with a
 * refutation reads `≥99%`; 0.004 with a survivor reads `≤1%`.
 */
export function ratePct(
  v: number,
  c: Pick<TrustCalibration, "survived" | "refuted">
): string {
  const r = Math.round(v * 100);
  if (r >= 100 && c.refuted > 0) return "≥99%";
  if (r <= 0 && c.survived > 0) return "≤1%";
  return `${r}%`;
}

/** `(84–95)` — the Wilson+fpc 95 % interval, in whole percent. */
export function interval(
  c: Pick<TrustCalibration, "ci95_low" | "ci95_high" | "survived" | "refuted">
): string | null {
  if (c.ci95_low == null || c.ci95_high == null) return null;
  // Same end-guard as `ratePct`: a bound rounds to 100 only with nothing
  // refuted, and to 0 only with nothing survived.
  let lo = Math.round(c.ci95_low * 100);
  let hi = Math.round(c.ci95_high * 100);
  if (c.refuted > 0) hi = Math.min(hi, 99);
  if (c.survived > 0) lo = Math.max(lo, 1);
  lo = Math.min(lo, hi);
  return `(${lo}–${hi})`;
}

/** `4000` basis points → `40%`. */
export function bpPct(bp: number | null | undefined): string {
  if (bp == null) return "unknown";
  const v = bp / 100;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Human age for a number of seconds: `3h`, `2d`. */
export function ageFromSecs(secs: number | null | undefined): string {
  if (secs == null) return "unknown";
  if (secs < 3600) return `${Math.max(1, Math.round(secs / 60))}m`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h`;
  return `${Math.round(secs / 86400)}d`;
}

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

export function unverifiableTotal(u: VerificationUnknowns): number {
  return Object.values(u.unverifiable_by_reason ?? {}).reduce(
    (a, b) => a + (typeof b === "number" ? b : 0),
    0
  );
}

/**
 * `12 unverifiable · 3 author unknown · 9 waiting`. A `null` pending count is
 * "waiting: unknown", never "0 waiting".
 */
export function unknownsLine(u: VerificationUnknowns): string {
  const waiting =
    u.selected_not_yet_verified == null
      ? "waiting: unknown"
      : `${u.selected_not_yet_verified} waiting`;
  return [
    `${unverifiableTotal(u)} unverifiable`,
    `${u.independence_unproven} author unknown`,
    waiting,
  ].join(" · ");
}

const CYCLE_WORDS: Record<string, string> = {
  ok: "ok",
  queue_empty: "queue empty",
  could_not_look: "could not look",
  running: "running",
  unknown: "unknown",
};

const CANARY_WORDS: Record<string, string> = {
  pass: "passed",
  fail: "FAILED",
  not_run: "not run",
  unknown: "unknown",
};

export interface LaneView {
  /** The always-visible freshness sentence. */
  line: string;
  /**
   * True when the lane is not demonstrably keeping up: no verdict within
   * {@link LANE_STALE_AFTER_HOURS}, a cycle that could not look, a failed
   * canary, or anything unknown. Painted amber — "we do not know / waiting",
   * never red and never calm.
   */
  attention: boolean;
}

function ageOf(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, (now - t) / 1000) : null;
}

export function laneView(
  lane: VerificationLane | null | undefined,
  now = Date.now()
): LaneView {
  if (!lane) {
    return {
      line: "Checker: unknown — no answer to read its freshness from",
      attention: true,
    };
  }
  const verdictAge = ageOf(lane.last_verdict_at, now);
  const cycle = CYCLE_WORDS[lane.last_cycle_outcome] ?? "unknown";
  const canary = CANARY_WORDS[lane.canary] ?? "unknown";
  const verdictPart =
    verdictAge == null
      ? "no verdict yet"
      : `last verdict ${ageFromSecs(verdictAge)} ago`;
  const installedPart =
    lane.installed === true
      ? ""
      : lane.installed === false
        ? " · not installed"
        : " · installed: unknown";
  const cycleHealthy = ["ok", "queue_empty", "running"].includes(
    lane.last_cycle_outcome
  );
  const attention =
    verdictAge == null ||
    verdictAge > LANE_STALE_AFTER_HOURS * 3600 ||
    !cycleHealthy ||
    lane.canary === "fail" ||
    lane.canary === "unknown" ||
    lane.installed !== true;
  return {
    line: `Checker: ${verdictPart} · last cycle ${cycle} · canary ${canary}${installedPart}`,
    attention,
  };
}

/**
 * The tile's model — one of four states, each rendering distinct text. The
 * renderer does no arithmetic of its own.
 */
export type TrustView =
  | { state: "loading" }
  | {
      state: "could_not_look";
      reason: string;
      /** The last `generated_at` this browser saw on a non-degraded answer. */
      lastGood: string | null;
      lane: LaneView;
    }
  | {
      state: "no_verifications";
      throughputLine: string;
      coverageLine: string | null;
      unknownsLine: string;
      refuted: number;
      windowDays: number;
      windowFrom: string;
      lane: LaneView;
      generatedAt: string;
    }
  | {
      state: "populated";
      throughputLine: string;
      calibrationLine: string;
      coverageLine: string | null;
      unknownsLine: string;
      refuted: number;
      windowDays: number;
      windowFrom: string;
      lane: LaneView;
      generatedAt: string;
    };

export const NO_VERIFICATIONS_TEXT = "no verifications yet in this window";

export function coverageLine(c: VerificationCoverage): string | null {
  if (c.value == null) return null;
  return `${pct(c.value)} of ${plural(c.population, "landed unit")} independently checked`;
}

export function deriveTrustView(
  read:
    | { status: "loading" }
    | { status: "error"; reason: string }
    | { status: "ok"; metrics: VerificationMetrics },
  lastGood: string | null,
  now = Date.now()
): TrustView {
  if (read.status === "loading") return { state: "loading" };
  if (read.status === "error") {
    return {
      state: "could_not_look",
      reason: read.reason,
      lastGood,
      lane: laneView(null, now),
    };
  }
  const m = read.metrics;
  if (m.degraded) {
    return {
      state: "could_not_look",
      reason:
        m.reason || "coord reported it could not look, and gave no reason",
      lastGood,
      lane: laneView(m.lane, now),
    };
  }
  const tc = m.trust_calibration;
  const landed = `${m.population} landed`;
  const common = {
    coverageLine: coverageLine(m.independent_verification_coverage),
    unknownsLine: unknownsLine(m.unknowns),
    refuted: tc.refuted,
    windowDays: m.window.days,
    windowFrom: m.window.from,
    lane: laneView(m.lane, now),
    generatedAt: m.generated_at,
  };
  if (tc.value == null || tc.n === 0) {
    return {
      state: "no_verifications",
      throughputLine: `${landed} · ${NO_VERIFICATIONS_TEXT}`,
      ...common,
    };
  }
  const iv = interval(tc);
  return {
    state: "populated",
    throughputLine: `${landed} · ${ratePct(tc.value, tc)} held up${iv ? ` ${iv}` : ""}, n=${tc.n}`,
    calibrationLine: `${ratePct(tc.value, tc)}${iv ? ` ${iv}` : ""} of ${plural(tc.n, "independently checked unit")} held up (${tc.survived} held, ${tc.refuted} refuted)`,
    ...common,
  };
}

// ---------------------------------------------------------------------------
// Verifier agreement — one line under calibration, on the tile and the page
// ---------------------------------------------------------------------------

/**
 * The verifier-agreement line. Plan
 * `2026-10-11-reverify-verdicts-are-source-bound-tree-checked-and-judge-agreement-is-measured`,
 * Phase 4: `verifier agreement κ 0.71 (seeded n=24) · operator n=6`.
 *
 * - `populated` — a seeded kappa, with the seeded binary n and the operator n;
 * - `insufficient` — fewer than 20 seeded binary cases: words, never a number;
 * - `undefined` — enough cases, but kappa has no value (expected agreement 1);
 * - `unknown` — the door did not answer, coord could not read the cases, or
 *   this coord build does not serve them. Never a number and never zero.
 */
export type AgreementView =
  | { state: "loading"; text: "" }
  | {
      state: "populated" | "insufficient" | "undefined" | "unknown";
      text: string;
    };

export const AGREEMENT_INSUFFICIENT_TEXT = "not enough labelled cases yet";

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function readAgreementSource(
  v: unknown
): Pick<JudgeAgreementSource, "n" | "binary_n" | "kappa" | "reason"> | null {
  if (!isObject(v) || !isCount(v.n) || !isCount(v.binary_n)) return null;
  const kappa =
    typeof v.kappa === "number" && Number.isFinite(v.kappa) ? v.kappa : null;
  if (kappa === null && v.kappa !== null) return null;
  const reason = typeof v.reason === "string" ? v.reason : null;
  return { n: v.n, binary_n: v.binary_n, kappa, reason };
}

function unknownAgreement(why: string): AgreementView {
  return { state: "unknown", text: `verifier agreement unknown — ${why}` };
}

export function deriveVerifierAgreement(
  read:
    | { status: "loading" }
    | { status: "error"; reason: string }
    | { status: "ok"; metrics: VerificationMetrics }
): AgreementView {
  if (read.status === "loading") return { state: "loading", text: "" };
  if (read.status === "error") {
    return unknownAgreement("the metrics door did not answer");
  }
  const m = read.metrics;
  if (typeof m.judge_agreement_error === "string") {
    return unknownAgreement(
      `coord could not read the labelled cases (${m.judge_agreement_error})`
    );
  }
  if (m.judge_agreement == null) {
    return unknownAgreement(
      m.degraded ? "coord could not look" : "this coord build does not serve it"
    );
  }
  const raw: unknown = m.judge_agreement;
  const seeded = isObject(raw) ? readAgreementSource(raw.seeded) : null;
  if (!seeded) {
    return unknownAgreement(
      "coord served it in a shape this page does not recognise"
    );
  }
  const operator = isObject(raw) ? readAgreementSource(raw.operator) : null;
  const operatorPart = operator
    ? `operator n=${operator.n}`
    : "operator n unknown";
  if (seeded.kappa !== null) {
    return {
      state: "populated",
      text: `verifier agreement κ ${seeded.kappa.toFixed(2)} (seeded n=${seeded.binary_n}) · ${operatorPart}`,
    };
  }
  if (seeded.reason === "n<20") {
    return {
      state: "insufficient",
      text: `verifier agreement: ${AGREEMENT_INSUFFICIENT_TEXT} (seeded n=${seeded.binary_n}) · ${operatorPart}`,
    };
  }
  if (seeded.reason === "undefined") {
    return {
      state: "undefined",
      text: `verifier agreement undefined (n=${seeded.binary_n}) · ${operatorPart}`,
    };
  }
  return unknownAgreement(
    `coord served no kappa and no reason this page recognises (${seeded.reason ?? "none"})`
  );
}

// ---------------------------------------------------------------------------
// The operator's one-click label — which verdicts carry it this week
// ---------------------------------------------------------------------------

/** At most this many verdicts per ISO week carry the label control. */
export const OPERATOR_LABELS_PER_WEEK = 3;

/** The UTC ISO-8601 week of `at`, e.g. `2026-W44`. */
export function isoWeekKey(at: number | Date): string {
  const t = typeof at === "number" ? new Date(at) : at;
  const d = new Date(
    Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())
  );
  // The ISO week belongs to the year of its Thursday.
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** 32-bit FNV-1a — a stable, dependency-free hash for the weekly draw. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The verdicts that carry "Did this hold up?" this week: the
 * {@link OPERATOR_LABELS_PER_WEEK} lowest by a hash of `<week>:<id>`. The draw
 * is a pure function of the week and the ids, so a reload does not reshuffle
 * it and nothing about it is stored. Duplicates are drawn once.
 */
export function sampleForOperatorLabel(
  verificationIds: readonly string[],
  weekKey: string,
  max: number = OPERATOR_LABELS_PER_WEEK
): string[] {
  return [...new Set(verificationIds)]
    .map((id) => ({ id, h: fnv1a(`${weekKey}:${id}`) }))
    .sort((a, b) => a.h - b.h || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, max))
    .map((x) => x.id);
}

/** The three answers, in the order the control shows them. */
export const OPERATOR_LABEL_CHOICES: ReadonlyArray<{
  truth: OperatorLabelTruth;
  label: string;
}> = [
  { truth: "holds", label: "Yes" },
  { truth: "fails", label: "No" },
  { truth: "cannot_tell", label: "Can't tell" },
];

const TRUTH_WORDS: Record<OperatorLabelTruth, string> = {
  holds: "held up",
  fails: "did not hold up",
  cannot_tell: "can't tell",
};

/**
 * What the control says after a click. `recorded` quotes the row coord wrote
 * back; `already_labelled` is not an error — the verdict was labelled before.
 * `attention` marks the answers where the label is NOT known to be stored.
 */
export function operatorLabelOutcome(r: OperatorLabelResult): {
  text: string;
  attention: boolean;
} {
  switch (r.kind) {
    case "recorded":
      return {
        text: `Recorded: ${TRUTH_WORDS[r.record.truth] ?? r.record.truth} (verifier said ${r.record.verifier_verdict})`,
        attention: false,
      };
    case "already_labelled":
      return {
        text: "Already labelled — this verdict carries an operator label",
        attention: false,
      };
    case "refused":
      return {
        text: `Not recorded — coord refused it${r.code ? ` (${r.code})` : ""}: ${r.message}`,
        attention: true,
      };
    case "not_found":
      return {
        text:
          r.code === "verification_not_found"
            ? "Not recorded — coord has no such verdict in this project"
            : `Not recorded — the label door is not answering (HTTP 404): ${r.message}`,
        attention: true,
      };
    case "failed":
      return {
        text: `Not known to be recorded — ${r.status === null ? r.message : `HTTP ${r.status}: ${r.message}`}`,
        attention: true,
      };
  }
}

// ---------------------------------------------------------------------------
// Refuted units — read from the findings store, where each refutation posts
// ---------------------------------------------------------------------------

export interface RefutedUnit {
  findingId: string;
  /** The plan title when the finding carries one, else the unit slug. */
  label: string;
  slug: string | null;
  createdAt: string | null;
  /** The refuting verdict's row id, when the finding names it. */
  verificationId: string | null;
}

interface FindingLike {
  finding_id: string;
  title?: string | null;
  body?: string | null;
  created_at?: string | null;
  topic?: string | null;
  artifact_refs?: unknown;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The verdict a refutation finding names: coord writes it into the finding's
 * `artifact_refs.verification_id` and into its body as `Verification: <id>`.
 */
export function verificationIdOf(f: FindingLike): string | null {
  const ref = isObject(f.artifact_refs)
    ? f.artifact_refs.verification_id
    : undefined;
  if (typeof ref === "string" && UUID_RE.test(ref)) return ref.toLowerCase();
  const m = /^Verification: (\S+)$/m.exec(f.body ?? "");
  const id = m?.[1];
  return id && UUID_RE.test(id) ? id.toLowerCase() : null;
}

/**
 * coord's refutation finding names the unit in its title
 * (`… REFUTED shipped unit <slug> — N unmet criterion(s)`) and the plan title
 * in its body (``work unit `<slug>` ("<title>")``). Prefer the plan title —
 * that is what the operator recognises — and fall back to the slug, then to
 * the finding's own title.
 */
export function refutedUnitFromFinding(f: FindingLike): RefutedUnit {
  const bodyMatch = /work unit `([^`]+)` \("([^"]+)"\)/.exec(f.body ?? "");
  const titleSlug =
    /REFUTED shipped unit (\S+)/.exec(f.title ?? "")?.[1] ?? null;
  const slug = bodyMatch?.[1] ?? titleSlug;
  return {
    findingId: f.finding_id,
    label: bodyMatch?.[2] ?? slug ?? f.title ?? f.finding_id,
    slug,
    createdAt: f.created_at ?? null,
    verificationId: verificationIdOf(f),
  };
}

/** Refutation findings posted inside the window, newest first. */
export function refutedUnitsInWindow(
  findings: FindingLike[],
  windowFrom: string
): RefutedUnit[] {
  const from = Date.parse(windowFrom);
  return findings
    .filter((f) => f.topic === REFUTED_FINDING_TOPIC)
    .filter((f) => {
      if (!Number.isFinite(from)) return true;
      const t = Date.parse(f.created_at ?? "");
      return Number.isFinite(t) && t >= from;
    })
    .map(refutedUnitFromFinding)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

export function findingHref(findingId: string): string {
  return `/admin/coord/findings?id=${encodeURIComponent(findingId)}`;
}

// ---------------------------------------------------------------------------
// Last good read — a per-viewer convenience, never a source of numbers
// ---------------------------------------------------------------------------

function lastGoodKey(tenantId: string | null): string {
  return `qontinui.verification-metrics.last-good.${tenantId ?? "none"}`;
}

/**
 * The `generated_at` of the last non-degraded answer this browser received.
 * Only the STAMP is kept — the numbers are never replayed, so a failed read
 * cannot render a stale green. Storage can be absent or throw (private
 * windows, blocked site data); both read as "none".
 */
export function readLastGood(tenantId: string | null): string | null {
  try {
    return window.localStorage.getItem(lastGoodKey(tenantId));
  } catch {
    return null;
  }
}

export function writeLastGood(
  tenantId: string | null,
  generatedAt: string
): void {
  try {
    window.localStorage.setItem(lastGoodKey(tenantId), generatedAt);
  } catch {
    // Storage unavailable — the stamp is a convenience, not state.
  }
}

// ---------------------------------------------------------------------------
// The drill-down's health strip (R1) — derived from the one read, never a
// second fetch.
// ---------------------------------------------------------------------------

export interface VerificationHealth {
  level: "green" | "amber" | "red";
  headline: string;
  detail: string;
}

/**
 * Green only when coord looked, something was verified, and the checker is
 * demonstrably keeping up. Everything else is amber — "waiting, or we do not
 * know" (style guide R3's two amber cases). Never red: a refutation is an
 * INFORM to the operator, and the fix is an agent's to make.
 */
export function deriveVerificationHealth(view: TrustView): VerificationHealth {
  switch (view.state) {
    case "loading":
      return {
        level: "amber",
        headline: "Reading the verification metrics…",
        detail: "",
      };
    case "could_not_look":
      return {
        level: "amber",
        headline: "Could not look",
        detail: `${view.reason} — last good ${view.lastGood ? absoluteStamp(view.lastGood) : "never, in this browser"}. These are not zeros.`,
      };
    case "no_verifications":
      return {
        level: "amber",
        headline: `${view.throughputLine}`,
        detail: view.lane.line,
      };
    case "populated":
      return {
        level: view.lane.attention ? "amber" : "green",
        headline: view.throughputLine,
        detail: view.lane.line,
      };
  }
}

function absoluteStamp(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t)
    ? new Date(t).toISOString().replace("T", " ").slice(0, 16) + " UTC"
    : iso;
}
