/**
 * Runner-local disk-reclaim survey — the PURE parse + aggregate helpers behind
 * the Disk section of `/settings/storage`.
 *
 * Plan: `2026-08-07-product-disk-monitoring-and-cleanup.md` Phase 2 step 4
 * (web half). The survey is served by the RUNNER, on its loopback HTTP API
 * (`http://localhost:9876`), because the existing worktree cleanup panel chose
 * HTTP over Tauri IPC and the browser can only reach HTTP.
 *
 * ## Why this module exists
 *
 * The same rule Phase 1 shipped for free space, applied to cleanup candidates:
 * **a survey that could not be computed and a machine with genuinely nothing
 * to reclaim must never render the same** (plan D10,
 * `verification-and-evidence` `silent-empty-is-unknown`). Three distinct facts
 * that all look like "an empty list" if you are careless:
 *
 * - the runner does not serve this route yet (an older build) — UNKNOWN;
 * - the runner served it but has not finished a census walk since boot
 *   (`census_status: "pending"`) — NOT READY, explicitly not "nothing to
 *   clean";
 * - the walk completed and found no candidates — the only case that may say
 *   "nothing to reclaim".
 *
 * ## Byte honesty
 *
 * An item whose `bytes` did not arrive as a finite number contributes NOTHING
 * to a class total and is counted in {@link DiskClassTotals.unknownByteItems}
 * instead. Summing it as `0` would understate the total while looking exact —
 * the fabricated-zero failure this feature exists to remove. The renderer says
 * "at least X" whenever that count is non-zero.
 *
 * ## Wire shape this module is pinned to
 *
 * `GET :9876/disk/reclaimable` (query: `?refresh=1`, `?waitSecs=N` capped at
 * 10), whose Rust wire types are `DiskSurvey` / `DiskReclaimItem` /
 * `ClassSummary` in the runner's `agent_worktree/disk_survey.rs`; the route is
 * registered in `mcp/disk_reclaim.rs`. **This is the confirmed contract, not a
 * guess** -- an earlier draft carried speculative envelope tolerance, which is
 * precisely what produced Phase 1's fleet-wide false "nobody has reported"
 * claim, so it has been removed.
 *
 * ```jsonc
 * {
 *   "workspace_root": "D:\qontinui-root" | null,
 *   "items": [{
 *     "id": "d:/qontinui-root/foo/target",   // falls back to `path`
 *     "path": "D:\qontinui-root\foo\target",
 *     "class": "in-repo-canonical",           // see KNOWN_DISK_CLASSES
 *     "status": "reclaimable" | "blocked",
 *     "reason": "building" | null,
 *     "reason_detail": "a cargo build holds .cargo-lock" | null,
 *     "bytes": 12345678 | null,               // null = UNREADABLE, never 0
 *     "bytes_partial": false,                 // true => `bytes` is a floor
 *     "last_used_at": "2026-08-14T09:00:00Z" | null,
 *     "repo_root": "D:\qontinui-root\foo" | null,
 *     "verb": "orphan_target_reaper" | null   // null => NO v1 verb
 *   }],
 *   "summary": {
 *     "reclaimable_bytes": 12345678 | null,
 *     "report_only_bytes": 98765432 | null,
 *     "bytes_incomplete": false,
 *     "by_class": [{ "class": ..., "roots": 0, "bytes": null,
 *                    "reclaimable_roots": 0, "reclaimable_bytes": null,
 *                    "roots_with_unknown_bytes": 0, "verb": null,
 *                    "note": "..." }]
 *   },
 *   "census_status": "pending" | "fresh" | "stale" | "unavailable",
 *   "census_taken_at": "<rfc3339>" | null,
 *   "census_age_secs": 42,
 *   "census_build_ms": 40123,
 *   "census_refreshing": false,
 *   "census_note": "...",
 *   "scan": {                                  // null until a walk completed
 *     "dirs_visited": 12345,
 *     "truncated": false,                      // true => `items` is a PREFIX
 *     "read_errors": [{ "path": "...", "error": "..." }],
 *     "roots_with_unknown_bytes": 0,
 *     "roots_with_partial_bytes": 0
 *   }
 * }
 * ```
 *
 * ### Two different ways an answer can be short
 *
 * `scan.truncated` and `summary.bytes_incomplete` are NOT the same fact and are
 * not rendered as one:
 *
 * - `scan.truncated` — the walk hit its visit ceiling, so `items[]` is a PREFIX
 *   of the population. Roots that were never reached are missing ENTIRELY; they
 *   are unvisited, not absent.
 * - `summary.bytes_incomplete` — the roots that ARE listed include at least one
 *   whose size is a floor (an unreadable subtree, a root that could not be
 *   sized, or a directory read error).
 *
 * Collapsing them would tell an operator "these numbers are a bit low" when the
 * truth is "you are not looking at the whole list".
 *
 * ### The four states, which must never render the same string
 *
 * | State | Signal | Render |
 * |---|---|---|
 * | cold start | `census_status: "pending"`, totals `null` | explicit NOT READY |
 * | failed | `census_status: "unavailable"`, reason in `census_note` | the reason |
 * | measured empty | `fresh` + no items + totals `0` | "nothing to reclaim" |
 * | normal | `fresh` + items | the totals |
 *
 * The middle two are the pair that collapse if you are careless, and the whole
 * feature is the distinction between them. `null` totals mean the runner does
 * not KNOW; `0` means it MEASURED nothing -- see
 * {@link DiskSurvey.summaryHasReclaimableBytes}.
 *
 * ### Which half of the payload is authoritative
 *
 * - **Per-class BYTES are aggregated here, from `items[]`**, so every figure on
 *   the page comes from rows that are also listed on it. The runner's own
 *   totals (`reclaimable_bytes`, `report_only_bytes`) are cross-checks --
 *   {@link surveyDisagreement}, {@link reportOnlyDisagreement} -- and a
 *   divergence is reported rather than resolved by preferring one silently.
 * - **The VERB is read from the runner**, per item, falling back to the
 *   matching `by_class` row and only then to {@link KNOWN_DISK_CLASSES}. The
 *   runner is the thing that would execute the verb.
 * - **A measured zero needs positive evidence**: an explicit `0` total, or a
 *   fully-readable `by_class` reporting `roots: 0` for every class in the
 *   bucket. Presence of a rollup alone is not enough -- see
 *   {@link measuredZeroBuckets}.
 */

/** Whether a guard currently refuses to touch a candidate. */
export type DiskSurveyStatus = "reclaimable" | "blocked";

/** One surveyed cargo target root, normalised from the wire. */
export interface DiskSurveyItem {
  /** Stable handle — the runner's `id`, falling back to `path`. */
  id: string;
  /** The path as it appears on disk, when the runner sent one. */
  path: string | null;
  /** The runner's `class` string, or `null` when it sent none. */
  classId: string | null;
  status: DiskSurveyStatus;
  /** Refusal token for a blocked item (`building`, `pinned`, ...). */
  reason: string | null;
  /** Operator-facing sentence for {@link reason}. */
  reasonDetail: string | null;
  /**
   * Bytes this candidate holds. `NaN` when the runner sent no usable number —
   * NEVER defaulted to 0, which would understate every total that includes it
   * while looking precise.
   */
  bytes: number;
  /**
   * `bytes` is a LOWER BOUND — some subtree under this root could not be read.
   * Rendered as "at least", never dropped: a partial sum presented as exact is
   * the same class of lie as a fabricated zero, just quieter.
   */
  bytesPartial: boolean;
  /** RFC 3339, or `null`. */
  lastUsedAt: string | null;
  /** Enclosing checkout / linked worktree, when the root lives inside one. */
  repoRoot: string | null;
  /**
   * `true` when the runner sent a `verb` key at all. Distinguishes "the runner
   * says no verb covers this class" (`verb: null`) from "this runner build
   * does not report verbs", which are different facts about actionability.
   */
  hasVerbField: boolean;
  /**
   * Which engine would remove this if the verb were armed, as the RUNNER
   * declares it. `null` with {@link hasVerbField} set ⇒ report-only in v1.
   */
  verb: string | null;
}

/**
 * Runner route this page consumes.
 *
 * `?refresh=1` mirrors `SurveyQuery` on `GET /agent-worktrees/reclaimable`:
 * kick a census walk in the BACKGROUND and answer from the cached snapshot
 * anyway. A runner that does not understand the parameter ignores it (serde
 * drops unknown query keys), so sending it is safe against both shapes.
 */
export const DISK_SURVEY_PATH = "/disk/reclaimable";

/** Whether the v1 cleanup verb covers a class (plan D6 + Phase 0 §0.2). */
export type DiskClassVerb = "v1" | "deferred-v2" | "unrecognised";

export interface DiskClassInfo {
  label: string;
  verb: DiskClassVerb;
  /** Why this class is in or out of the v1 verb — rendered, not a comment. */
  note: string;
}

/**
 * The four cargo-target classes Phase 0 measured, with their v1 disposition.
 *
 * `in-repo-canonical` is the one that matters for the UI: Phase 0 measured it
 * at **1,669.8 GB — 47 % of all target bytes on this box — and D6 puts its
 * verb in v2**. So the page shows a very large number the user cannot act on,
 * and that has to be legible rather than confusing.
 *
 * FOUR, and exactly four: `TargetClass::all()` in the runner's
 * `orphan_target_reaper.rs` emits `in-repo-canonical`, `sibling-worktree`,
 * `container`, `sibling-nongit` and nothing else. `owned-by-worktree-reclaim`
 * and `owned-by-build-pool` used to be listed here as classes; they are
 * `SkipReason::token()` values and arrive on `item.reason`, never on
 * `item.class`, so entries for them were dead weight that also implied a
 * class vocabulary the runner does not have.
 */
export const KNOWN_DISK_CLASSES: Record<string, DiskClassInfo> = {
  "in-repo-canonical": {
    label: "In-repo target dirs",
    verb: "deferred-v2",
    note:
      "Report-only in v1. Cleaning these means pruning INSIDE a target dir " +
      "a running build may be using, which needs its own guard design, so " +
      "no cleanup verb ships for this class yet (plan D6). Phase 0 measured " +
      "it as the LARGEST class by bytes -- these bytes are real, they are " +
      "just not actionable from here yet.",
  },
  "sibling-worktree": {
    label: "Worktree target dirs",
    verb: "v1",
    note:
      "Target dirs inside linked git worktrees (a `.git` FILE, not a " +
      "directory). Covered by the v1 cleanup verb.",
  },
  container: {
    label: "Container target dirs",
    verb: "v1",
    note:
      "Out-of-tree target roots under container dirs (`_wt`, `_targets`, " +
      "...). Covered by the v1 cleanup verb.",
  },
  "sibling-nongit": {
    label: "Non-git sibling target dirs",
    verb: "v1",
    note:
      "Target roots beside a checkout with no git metadata of their own. " +
      "Covered by the v1 cleanup verb.",
  },
};

/**
 * The runner's `SkipReason` token for "this class has no v1 verb".
 *
 * It is the reason EVERY `in-repo-canonical` root arrives blocked:
 * `boundary_verdict` returns `Err(SkipReason::ReportOnly)` unconditionally for
 * a class with no verb, and `disk_survey.rs` maps any `Err` to
 * `status: "blocked"`. So "blocked" for that class does not mean a guard is
 * holding anything — it means no verb exists, which is a different sentence.
 */
export const REPORT_ONLY_REASON = "report-only";

/**
 * Freshness of the census the survey was derived from.
 *
 * `unavailable` is the runner's own "the preview could not be computed, and
 * `census_note` says why" — a FAILURE, not a freshness question, and it must
 * not be rendered as an empty result. `unknown` is this parser's verdict on a
 * status string it does not recognise (or none at all), which must not collapse
 * into `fresh`.
 */
export type CensusStatus =
  | "pending"
  | "fresh"
  | "stale"
  | "unavailable"
  | "unknown";

/** One directory the walk could not read. A failed read, never a zero. */
export interface DiskScanError {
  path: string | null;
  error: string | null;
}

/**
 * `scan` — what the WALK managed to see, as opposed to what the roots it found
 * measured. `null` when the runner sent none (no snapshot yet, or a build that
 * does not report it), which is UNKNOWN and not "the walk was complete".
 */
export interface DiskScanStats {
  /** `null` when the runner sent no usable count. */
  dirsVisited: number | null;
  /**
   * The visit ceiling was hit: `items[]` is a PREFIX of the population, so a
   * root that is absent from the list may simply never have been reached.
   */
  truncated: boolean;
  /**
   * `true` when the runner sent a `truncated` key at all. A build that does not
   * report it has not told us the walk was complete.
   */
  hasTruncatedField: boolean;
  readErrors: DiskScanError[];
  rootsWithUnknownBytes: number | null;
  rootsWithPartialBytes: number | null;
}

/** A parsed survey. Every field is what the runner said, or an explicit gap. */
export interface DiskSurvey {
  /**
   * `unknown` when the runner sent a value this build does not recognise, or
   * none at all. It must NOT collapse into `fresh` — an unreadable freshness
   * is an unknown one, and rendering it as current would be a claim the
   * payload never made.
   */
  censusStatus: CensusStatus;
  /** The raw value, kept so an unrecognised status can be shown verbatim. */
  censusStatusRaw: string | null;
  censusAgeSecs: number | null;
  censusNote: string | null;
  /** `true` when the runner says a refresh walk is running right now. */
  censusRefreshing: boolean;
  items: DiskSurveyItem[];
  /**
   * `summary.reclaimable_bytes`, or `NaN` when the runner sent no usable
   * total. Used ONLY for the cross-check in {@link surveyDisagreement}.
   */
  summaryReclaimableBytes: number;
  /**
   * `true` when the runner sent a `summary.reclaimable_bytes` key at all.
   *
   * The runner's four states hinge on this: a `pending` census reports the
   * totals as `null` (it does not KNOW), while a completed one that found
   * nothing reports `0` (it MEASURED nothing). Absent and zero must not
   * collapse together, so the key's presence is recorded apart from its value.
   */
  summaryHasReclaimableBytes: boolean;
  /**
   * `summary.report_only_bytes` — the runner's own headline for the class it
   * deliberately ships no verb for. `NaN` when it sent none or sent `null`.
   */
  summaryReportOnlyBytes: number;
  /**
   * `summary.by_class`, or `null` when the runner sent none this parser could
   * read. `null` means the UI may NOT render a measured zero for a class with
   * no items — see {@link parseClassSummaries}.
   */
  byClass: ClassSummaryRow[] | null;
  /**
   * Rows of `summary.by_class` that could not be read. Non-zero disqualifies
   * the rollup from certifying a measured zero — see {@link measuredZeroBuckets},
   * which is the live path that consults it.
   */
  byClassSkipped: number;
  /**
   * `summary.bytes_incomplete` — the runner's own statement that at least one
   * byte total above is a lower bound (a truncated walk, an unreadable
   * subtree, a root it could not size).
   *
   * Distinct from {@link scan}`.truncated`, which says the LIST is short. This
   * one says the listed rows are under-sized.
   */
  bytesIncomplete: boolean;
  /**
   * `scan` — the walk's own report on itself, or `null` when the runner sent
   * none. See {@link DiskScanStats}.
   */
  scan: DiskScanStats | null;
  /**
   * Entries in `items[]` this parser could not read at all. Load-bearing, not
   * diagnostics: without it, a payload of ten unreadable items renders as
   * "nothing to reclaim".
   */
  skippedItems: number;
}

export type DiskSurveyParse =
  | { state: "parsed"; survey: DiskSurvey }
  | { state: "unparseable"; reason: string };

/** What the last survey request produced. `unavailable` carries the reason. */
export type DiskSurveyFetch =
  | { state: "ok"; survey: DiskSurvey }
  | { state: "unavailable"; reason: string };

/** The pre-first-request state — deliberately `unavailable`, not an empty ok. */
export const SURVEY_NOT_YET_READ: DiskSurveyFetch = {
  state: "unavailable",
  reason:
    "The disk survey has not been requested yet. Press Preview to ask the " +
    "runner what it can reclaim.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Normalise an item's `status`.
 *
 * Pinned to the runner's ACTUAL contract — `reclaimable` | `blocked` — and
 * nothing else. An earlier draft also accepted the worktree route's `reapable`
 * on the guess that the two sibling routes might spell it differently; that
 * guess is exactly the class of speculative envelope-tolerance that produced
 * Phase 1's fleet-wide false "nobody has reported" claim, so it is gone.
 *
 * An unrecognised status is `null` — the item is counted as unreadable rather
 * than defaulted into either bucket, because guessing would put real bytes on
 * the wrong side of the "can I act on this?" line.
 */
export function toSurveyStatus(value: unknown): DiskSurveyStatus | null {
  if (value === "reclaimable") return "reclaimable";
  if (value === "blocked") return "blocked";
  return null;
}

/**
 * Coerce one wire row into a {@link DiskSurveyItem}, or `null` when it carries
 * no usable status.
 *
 * A non-numeric `bytes` survives as `NaN` on purpose: the aggregator excludes
 * it from totals and counts it separately, so an unmeasured item can never
 * masquerade as a zero-byte one.
 */
export function toSurveyItem(raw: unknown): DiskSurveyItem | null {
  if (!isRecord(raw)) return null;
  const status = toSurveyStatus(raw.status);
  if (status === null) return null;
  const path = optionalString(raw.path);
  const id = optionalString(raw.id) ?? path;
  if (id === null) return null;
  const bytes = raw.bytes;
  return {
    id,
    path,
    classId: optionalString(raw.class),
    status,
    reason: optionalString(raw.reason),
    reasonDetail: optionalString(raw.reason_detail),
    bytes: typeof bytes === "number" ? bytes : Number.NaN,
    bytesPartial: raw.bytes_partial === true,
    lastUsedAt: optionalString(raw.last_used_at),
    repoRoot: optionalString(raw.repo_root),
    // `verb: null` is the runner SAYING "no v1 verb covers this class", which
    // is a different fact from a runner that never sent the field. Only the
    // former may drive the report-only bucket, so the presence of the key is
    // recorded separately from its value.
    hasVerbField: Object.hasOwn(raw, "verb"),
    verb: optionalString(raw.verb),
  };
}

function toCensusStatus(raw: string | null): CensusStatus {
  if (
    raw === "pending" ||
    raw === "fresh" ||
    raw === "stale" ||
    raw === "unavailable"
  ) {
    return raw;
  }
  return "unknown";
}

/**
 * One row of `summary.by_class`.
 *
 * The runner emits a row for EVERY class it knows, including classes with zero
 * roots — so a zero here is a measured zero, unlike the absence of items in a
 * class, which proves nothing. That distinction is what lets the UI render a
 * genuine `0 B` for a class instead of refusing to.
 */
export interface ClassSummaryRow {
  classId: string;
  roots: number;
  /** `NaN` when the runner could size none of this class's roots. */
  bytes: number;
  reclaimableRoots: number;
  reclaimableBytes: number;
  rootsWithUnknownBytes: number;
  /** `null` ⇒ the runner says no v1 verb covers this class. */
  verb: string | null;
  hasVerbField: boolean;
  note: string | null;
}

function toNumberOrNaN(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

/**
 * A count, or `NaN` when the runner sent nothing usable.
 *
 * Deliberately NOT defaulted to `0`. This rollup's entire job is to license
 * the UI to render a measured zero, so a count that defaulted to zero would
 * manufacture the exact authority it is being consulted for.
 */
function toCountOrNaN(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : Number.NaN;
}

/** What {@link parseClassSummaries} made of `summary.by_class`. */
export interface ClassRollup {
  rows: ClassSummaryRow[];
  /**
   * Rows of the rollup that could not be read. NON-ZERO MEANS THE ROLLUP IS
   * NOT AUTHORITATIVE: a partly-read rollup cannot certify that a class with
   * no items was measured as empty, because the row saying otherwise may be
   * one of the ones that was dropped.
   */
  skipped: number;
}

/**
 * Parse `summary.by_class`, or `null` when the runner sent no readable one.
 *
 * `null` is load-bearing: without a per-class rollup the UI cannot tell a class
 * the runner measured as empty from a class it never surveyed, and it says so
 * rather than rendering a `0 B` it cannot support.
 */
export function parseClassSummaries(raw: unknown): ClassRollup | null {
  if (!Array.isArray(raw)) return null;
  const rows: ClassSummaryRow[] = [];
  let skipped = 0;
  for (const entry of raw) {
    if (!isRecord(entry)) {
      skipped++;
      continue;
    }
    const classId = optionalString(entry.class);
    if (classId === null) {
      skipped++;
      continue;
    }
    rows.push({
      classId,
      roots: toCountOrNaN(entry.roots),
      bytes: toNumberOrNaN(entry.bytes),
      reclaimableRoots: toCountOrNaN(entry.reclaimable_roots),
      reclaimableBytes: toNumberOrNaN(entry.reclaimable_bytes),
      rootsWithUnknownBytes: toCountOrNaN(entry.roots_with_unknown_bytes),
      verb: optionalString(entry.verb),
      hasVerbField: Object.hasOwn(entry, "verb"),
      note: optionalString(entry.note),
    });
  }
  // An array that yielded no readable row is unreadable, not empty.
  if (rows.length === 0 && raw.length > 0) return null;
  return { rows, skipped };
}

/**
 * Parse `scan`, or `null` when the runner sent nothing readable.
 *
 * `null` is UNKNOWN, not "the walk was complete": a build that does not report
 * `scan` has told us nothing about whether `items[]` is the whole population,
 * and defaulting `truncated` to `false` would manufacture a completeness claim
 * the payload never made. {@link DiskScanStats.hasTruncatedField} keeps the
 * same distinction one level down, for a `scan` object missing the key.
 */
export function parseScanStats(raw: unknown): DiskScanStats | null {
  if (!isRecord(raw)) return null;
  const errorsRaw = Array.isArray(raw.read_errors) ? raw.read_errors : [];
  const readErrors: DiskScanError[] = errorsRaw.map((entry) =>
    isRecord(entry)
      ? { path: optionalString(entry.path), error: optionalString(entry.error) }
      : { path: null, error: null }
  );
  const count = (value: unknown): number | null => {
    const n = toCountOrNaN(value);
    return Number.isFinite(n) ? n : null;
  };
  return {
    dirsVisited: count(raw.dirs_visited),
    truncated: raw.truncated === true,
    hasTruncatedField: Object.hasOwn(raw, "truncated"),
    readErrors,
    rootsWithUnknownBytes: count(raw.roots_with_unknown_bytes),
    rootsWithPartialBytes: count(raw.roots_with_partial_bytes),
  };
}

/**
 * Classes the rollup names whose `roots` this build could not read, or which
 * report more roots than `items[]` carries — i.e. the rollup and the item list
 * describe different populations.
 *
 * A non-empty result means no total on the page may be presented as complete:
 * the runner told us about roots it did not itemise.
 */
export function rollupDisagreement(survey: DiskSurvey): string | null {
  const rollup = survey.byClass;
  if (rollup === null) return null;
  const itemsPerClass = new Map<string, number>();
  for (const item of survey.items) {
    if (item.classId === null) continue;
    itemsPerClass.set(item.classId, (itemsPerClass.get(item.classId) ?? 0) + 1);
  }
  const short: string[] = [];
  const unreadable: string[] = [];
  for (const row of rollup) {
    if (!Number.isFinite(row.roots)) {
      unreadable.push(row.classId);
      continue;
    }
    const listed = itemsPerClass.get(row.classId) ?? 0;
    if (row.roots > listed)
      short.push(`${row.classId} (${row.roots} vs ${listed})`);
  }
  if (short.length === 0 && unreadable.length === 0) return null;
  const parts: string[] = [];
  if (short.length > 0) {
    parts.push(
      `the runner's per-class rollup names MORE roots than it itemised for ` +
        `${short.join(", ")}`
    );
  }
  if (unreadable.length > 0) {
    parts.push(`its root count could not be read for ${unreadable.join(", ")}`);
  }
  return (
    `The survey's two halves describe different populations: ${parts.join(
      "; and "
    )}. Every byte total below is therefore a LOWER BOUND drawn from the ` +
    `items that were listed, not a measurement of the class.`
  );
}

/**
 * Normalise the survey payload.
 *
 * `unparseable` is returned — with the reason — whenever the response is not a
 * record or carries no `items` array. Both cases mean "we could not read the
 * answer", which is a different fact from "there is nothing to reclaim", and
 * the caller renders them differently.
 */
export function parseDiskSurvey(payload: unknown): DiskSurveyParse {
  if (!isRecord(payload)) {
    return {
      state: "unparseable",
      reason:
        "The runner's disk-survey response was not a JSON object, so nothing " +
        "in it could be read.",
    };
  }
  if (!Array.isArray(payload.items)) {
    return {
      state: "unparseable",
      reason:
        "The runner's disk-survey response carried no `items` array. This is " +
        "an unreadable answer, NOT an empty one -- it says nothing about " +
        "whether there is anything to reclaim.",
    };
  }
  const rows = payload.items as unknown[];
  const items: DiskSurveyItem[] = [];
  let skipped = 0;
  for (const row of rows) {
    const item = toSurveyItem(row);
    if (item === null) {
      skipped++;
      continue;
    }
    items.push(item);
  }

  const summary = isRecord(payload.summary) ? payload.summary : null;
  const rollup = parseClassSummaries(summary?.by_class);
  const summaryBytes = summary?.reclaimable_bytes;
  const censusStatusRaw = optionalString(payload.census_status);
  const ageRaw = payload.census_age_secs;

  return {
    state: "parsed",
    survey: {
      censusStatus: toCensusStatus(censusStatusRaw),
      censusStatusRaw,
      censusAgeSecs:
        typeof ageRaw === "number" && Number.isFinite(ageRaw) && ageRaw >= 0
          ? ageRaw
          : null,
      censusNote: optionalString(payload.census_note),
      censusRefreshing: payload.census_refreshing === true,
      items,
      summaryReclaimableBytes:
        typeof summaryBytes === "number" ? summaryBytes : Number.NaN,
      summaryHasReclaimableBytes:
        summary !== null && Object.hasOwn(summary, "reclaimable_bytes"),
      summaryReportOnlyBytes: toNumberOrNaN(summary?.report_only_bytes),
      byClass: rollup?.rows ?? null,
      byClassSkipped: rollup?.skipped ?? 0,
      bytesIncomplete: summary?.bytes_incomplete === true,
      scan: parseScanStats(payload.scan),
      skippedItems: skipped,
    },
  };
}

/** Per-class aggregate, derived from `items[]`. */
export interface DiskClassTotals {
  /** The class string the runner sent, or `null` when it sent none. */
  classId: string | null;
  label: string;
  verb: DiskClassVerb;
  note: string;
  /** `true` when {@link KNOWN_DISK_CLASSES} has an entry for `classId`. */
  known: boolean;
  reclaimableBytes: number;
  blockedBytes: number;
  reclaimableCount: number;
  blockedCount: number;
  /**
   * Items in this class whose `bytes` were unreadable. They are EXCLUDED from
   * the byte totals above, which are therefore lower bounds whenever this is
   * non-zero — the renderer says "at least".
   */
  unknownByteItems: number;
  /**
   * Items whose `bytes` WAS readable but is itself a lower bound
   * (`bytes_partial`). Counted apart from {@link unknownByteItems} because
   * they contribute to the total — the total is just not the whole truth.
   */
  partialByteItems: number;
  /**
   * The same two counts, split by STATUS.
   *
   * The split is not cosmetic: `reclaimableBytes` and `blockedBytes` are
   * rendered in different columns, and a combined count puts the "at least"
   * qualifier on whichever column happens to be rendered — claiming a total is
   * a floor when it is exact, and claiming an exact figure for the total that
   * actually is a floor. Each column carries its own count.
   */
  reclaimableUnknownByteItems: number;
  reclaimablePartialByteItems: number;
  blockedUnknownByteItems: number;
  blockedPartialByteItems: number;
  /**
   * Items of this class that disagreed with each other about `verb`. Non-zero
   * forces {@link verb} to `unrecognised`: the runner gave two answers about
   * whether a cleanup verb covers this class, and picking whichever arrived
   * first would decide actionability by array order.
   */
  verbConflicts: number;
}

const UNCLASSIFIED: DiskClassInfo = {
  label: "Class not reported",
  verb: "unrecognised",
  note:
    "The runner returned these candidates without naming a class, so this " +
    "page cannot say whether the v1 cleanup verb would cover them. They are " +
    "shown rather than dropped: their bytes are real.",
};

/**
 * Own-property lookup only. A plain index would resolve a runner class named
 * `constructor` or `toString` to something off `Object.prototype` and report
 * an unrecognised class as known.
 */
function isKnownClass(classId: string | null): classId is string {
  return classId !== null && Object.hasOwn(KNOWN_DISK_CLASSES, classId);
}

function classInfo(classId: string | null): DiskClassInfo {
  if (classId === null) return UNCLASSIFIED;
  const known = isKnownClass(classId) ? KNOWN_DISK_CLASSES[classId] : undefined;
  if (known) return known;
  return {
    label: classId,
    verb: "unrecognised",
    note:
      `This build of the web UI does not recognise the class "${classId}", ` +
      `so it cannot say whether the v1 cleanup verb covers it. The bytes are ` +
      `shown anyway -- an unrecognised class is not an empty one.`,
  };
}

/**
 * Aggregate a survey's items by class, biggest reclaimable total first.
 *
 * Classes with no items do NOT appear: a class the runner never mentioned has
 * not been measured as empty, and rendering it as `0 B` would be exactly the
 * fabricated zero this module exists to prevent.
 */
export function aggregateByClass(survey: DiskSurvey): DiskClassTotals[] {
  const byClass = new Map<string | null, DiskClassTotals>();
  // The runner's own per-class rollup, indexed for the verb + note lookup.
  const declared = new Map<string, ClassSummaryRow>();
  for (const row of survey.byClass ?? []) declared.set(row.classId, row);

  for (const item of survey.items) {
    let entry = byClass.get(item.classId);
    if (!entry) {
      const info = classInfo(item.classId);
      const declaredRow =
        item.classId === null ? undefined : declared.get(item.classId);
      // The RUNNER is the authority on whether a verb covers a class — it is
      // the thing that would run the verb. Reading its declaration means a
      // class it adds later lands in the right bucket without a web release,
      // and the hardcoded table below is only the fallback for a runner that
      // does not report verbs at all.
      const declaresVerb = item.hasVerbField
        ? { has: true, verb: item.verb }
        : declaredRow?.hasVerbField
          ? { has: true, verb: declaredRow.verb }
          : { has: false, verb: null };
      const verb: DiskClassVerb = declaresVerb.has
        ? declaresVerb.verb !== null
          ? "v1"
          : "deferred-v2"
        : info.verb;
      entry = {
        classId: item.classId,
        label: info.label,
        verb,
        // Note precedence: the runner's own sentence, then a composed one when
        // the runner's verb CONTRADICTS this build's table (both facts are
        // shown — overriding one with the other would leave a "cleanup verb"
        // badge beside a note saying no verb exists), then the table's.
        note:
          declaredRow?.note ??
          (declaresVerb.has && verb !== info.verb
            ? `The runner reports ${
                declaresVerb.verb !== null
                  ? `a cleanup verb ("${declaresVerb.verb}")`
                  : "NO cleanup verb"
              } for this class, which is not what this build of the web UI ` +
              `expects. The runner's answer is used, because it is the thing ` +
              `that would run the verb. For reference, this build's own note ` +
              `reads: ${info.note}`
            : info.note),
        known: isKnownClass(item.classId),
        reclaimableBytes: 0,
        blockedBytes: 0,
        reclaimableCount: 0,
        blockedCount: 0,
        unknownByteItems: 0,
        partialByteItems: 0,
        reclaimableUnknownByteItems: 0,
        reclaimablePartialByteItems: 0,
        blockedUnknownByteItems: 0,
        blockedPartialByteItems: 0,
        verbConflicts: 0,
      };
      byClass.set(item.classId, entry);
    }
    const reclaimable = item.status === "reclaimable";
    if (reclaimable) entry.reclaimableCount++;
    else entry.blockedCount++;

    // A later item of the same class that disagrees about the verb is a
    // conflict, not a refinement — recorded rather than resolved by position.
    if (item.hasVerbField) {
      const declared = item.verb !== null;
      const expected = entry.verb === "v1";
      if (entry.verb !== "unrecognised" && declared !== expected) {
        entry.verbConflicts++;
      }
    }

    if (!Number.isFinite(item.bytes) || item.bytes < 0) {
      entry.unknownByteItems++;
      if (reclaimable) entry.reclaimableUnknownByteItems++;
      else entry.blockedUnknownByteItems++;
      continue;
    }
    if (item.bytesPartial) {
      entry.partialByteItems++;
      if (reclaimable) entry.reclaimablePartialByteItems++;
      else entry.blockedPartialByteItems++;
    }
    if (reclaimable) entry.reclaimableBytes += item.bytes;
    else entry.blockedBytes += item.bytes;
  }
  for (const entry of byClass.values()) {
    if (entry.verbConflicts > 0) {
      entry.verb = "unrecognised";
      entry.note =
        `The runner gave conflicting answers about this class: ` +
        `${entry.verbConflicts} of its ${entry.reclaimableCount + entry.blockedCount} ` +
        `roots disagreed with the others about whether a cleanup verb covers ` +
        `it. Rather than let payload order decide, this page reports the ` +
        `class as unresolved -- the bytes are real, the actionability is not ` +
        `established.`;
    }
  }
  return Array.from(byClass.values()).sort(
    (a, b) =>
      b.reclaimableBytes +
      b.blockedBytes -
      (a.reclaimableBytes + a.blockedBytes)
  );
}

/**
 * The two headline numbers, split by whether v1 can ever act on them.
 *
 * This split IS the UI requirement: Phase 0 measured the largest class by
 * bytes as the one whose verb is deferred, so a single "reclaimable" total
 * would either overstate what the product can do or hide 47 % of the bytes.
 */
export interface DiskBuckets {
  /** Classes the v1 cleanup verb covers. */
  actionableBytes: number;
  actionableItems: number;
  actionableUnknownByteItems: number;
  actionablePartialByteItems: number;
  /**
   * `in-repo-canonical` and anything else whose verb is deferred — the WHOLE
   * class, both statuses. See {@link bucketTotals} for why the status split
   * does not apply to this bucket.
   */
  reportOnlyBytes: number;
  reportOnlyItems: number;
  reportOnlyUnknownByteItems: number;
  reportOnlyPartialByteItems: number;
  /** Classes this build does not recognise — neither claim applies to them. */
  unrecognisedBytes: number;
  unrecognisedItems: number;
  unrecognisedUnknownByteItems: number;
  unrecognisedPartialByteItems: number;
  /**
   * Candidates something actually HOLDS right now — a live build, a pin, a
   * dirty worktree, another engine that owns the path.
   *
   * Report-only classes are excluded: their roots arrive `blocked` because no
   * verb exists, not because anything is holding them, and counting them here
   * both double-counts the report-only bucket and describes 47 % of the bytes
   * on this box with a sentence that is false.
   */
  blockedBytes: number;
  blockedItems: number;
  blockedUnknownByteItems: number;
  blockedPartialByteItems: number;
}

/**
 * Split the per-class aggregate into the actionable / report-only buckets.
 *
 * The four buckets PARTITION the items — every root lands in exactly one — so
 * that an operator adding the tiles up gets the survey's own total rather than
 * a number inflated by roots counted twice.
 *
 * The report-only bucket takes the whole class, `blocked` rows included. That
 * is not a convenience: the runner **never** emits an `in-repo-canonical` row
 * with `status: "reclaimable"` — `boundary_verdict` returns
 * `Err(SkipReason::ReportOnly)` unconditionally for a verbless class and
 * `disk_survey.rs` maps every `Err` to `blocked` — so a report-only bucket
 * sourced from `reclaimableBytes` alone is ALWAYS `0`, and the tile renders a
 * bare `0 B` over the largest class on the machine. Taking the class total is
 * also exactly what the runner's own `summary.report_only_bytes` means: it is
 * `by_class[in-repo-canonical].bytes`, every status.
 */
export function bucketTotals(totals: DiskClassTotals[]): DiskBuckets {
  const out: DiskBuckets = {
    actionableBytes: 0,
    actionableItems: 0,
    actionableUnknownByteItems: 0,
    actionablePartialByteItems: 0,
    reportOnlyBytes: 0,
    reportOnlyItems: 0,
    reportOnlyUnknownByteItems: 0,
    reportOnlyPartialByteItems: 0,
    unrecognisedBytes: 0,
    unrecognisedItems: 0,
    unrecognisedUnknownByteItems: 0,
    unrecognisedPartialByteItems: 0,
    blockedBytes: 0,
    blockedItems: 0,
    blockedUnknownByteItems: 0,
    blockedPartialByteItems: 0,
  };
  for (const t of totals) {
    if (t.verb === "deferred-v2") {
      // The WHOLE class, both statuses — see the docstring above. Its blocked
      // rows are deliberately NOT added to `blocked*`: nothing is holding them.
      out.reportOnlyBytes += t.reclaimableBytes + t.blockedBytes;
      out.reportOnlyItems += t.reclaimableCount + t.blockedCount;
      out.reportOnlyUnknownByteItems +=
        t.reclaimableUnknownByteItems + t.blockedUnknownByteItems;
      out.reportOnlyPartialByteItems +=
        t.reclaimablePartialByteItems + t.blockedPartialByteItems;
      continue;
    }
    out.blockedBytes += t.blockedBytes;
    out.blockedItems += t.blockedCount;
    out.blockedUnknownByteItems += t.blockedUnknownByteItems;
    out.blockedPartialByteItems += t.blockedPartialByteItems;
    if (t.verb === "v1") {
      out.actionableBytes += t.reclaimableBytes;
      out.actionableItems += t.reclaimableCount;
      out.actionableUnknownByteItems += t.reclaimableUnknownByteItems;
      out.actionablePartialByteItems += t.reclaimablePartialByteItems;
    } else {
      out.unrecognisedBytes += t.reclaimableBytes;
      out.unrecognisedItems += t.reclaimableCount;
      out.unrecognisedUnknownByteItems += t.reclaimableUnknownByteItems;
      out.unrecognisedPartialByteItems += t.reclaimablePartialByteItems;
    }
  }
  return out;
}

/**
 * Which headline buckets may render a MEASURED `0 B` rather than being hidden.
 *
 * A bucket qualifies only when the runner's rollup is fully readable, names at
 * least one class that falls in that bucket, and reports `roots: 0` for every
 * such class. Anything weaker — a missing rollup, a partly-read one, or a row
 * naming roots the item list does not carry — leaves the bucket hidden and the
 * caller says ABSENT instead of `0 B`.
 */
export function measuredZeroBuckets(survey: DiskSurvey): {
  actionable: boolean;
  reportOnly: boolean;
} {
  // The runner's own headline totals are the FIRST authority: a completed
  // census that found nothing reports `0`, while a cold one reports `null`.
  // An explicit zero is a measurement and licenses a `0 B` tile on its own.
  const summarySaysZero = (n: number) => Number.isFinite(n) && n === 0;
  const fromSummary = {
    actionable: summarySaysZero(survey.summaryReclaimableBytes),
    reportOnly: summarySaysZero(survey.summaryReportOnlyBytes),
  };

  const rollup = survey.byClass;
  if (rollup === null || survey.byClassSkipped > 0) return fromSummary;
  const verbOf = (row: ClassSummaryRow): DiskClassVerb => {
    if (row.hasVerbField) return row.verb !== null ? "v1" : "deferred-v2";
    return classInfo(row.classId).verb;
  };
  const forBucket = (want: DiskClassVerb) => {
    const rows = rollup.filter((r) => verbOf(r) === want);
    if (rows.length === 0) return false;
    return rows.every((r) => r.roots === 0);
  };
  return {
    actionable: fromSummary.actionable || forBucket("v1"),
    reportOnly: fromSummary.reportOnly || forBucket("deferred-v2"),
  };
}

/**
 * A sentence describing a survey that contradicts itself, or `null`.
 *
 * Deliberately NARROW. The exact semantics of `summary.reclaimable_bytes` are
 * the runner's, and a cross-check that fires on every ordinary difference
 * (blocked bytes folded into the summary, roots the runner counted but did not
 * itemise, a paging limit) would put a red warning on every successful load and
 * train the operator to ignore the honesty banners — which costs more than the
 * check buys. So only the two differences that CANNOT be an accounting
 * convention are reported:
 *
 * - an EMPTY item list against a summary claiming bytes — rendering "nothing to
 *   reclaim" there would repeat a number the payload itself disputes;
 * - items summing to MORE than the summary, which no amount of unlisted roots
 *   can explain.
 *
 * A shortfall in the other direction is expected and already surfaced as a
 * lower bound (unreadable/partial sizes, {@link rollupDisagreement}).
 *
 * The byte predicate matches {@link aggregateByClass} exactly — finite AND
 * non-negative — so a negative `bytes` cannot be counted here while being
 * excluded there.
 */
export function surveyDisagreement(survey: DiskSurvey): string | null {
  const summary = survey.summaryReclaimableBytes;
  if (!Number.isFinite(summary)) return null;
  const usable = (n: number) => Number.isFinite(n) && n >= 0;
  const derived = survey.items
    .filter((i) => i.status === "reclaimable" && usable(i.bytes))
    .reduce((sum, i) => sum + i.bytes, 0);
  const emptyButClaimed = survey.items.length === 0 && summary > 0;
  const overshoot = derived > summary;
  if (!emptyButClaimed && !overshoot) return null;
  return (
    `The runner's own summary reports ${summary} reclaimable byte` +
    `${summary === 1 ? "" : "s"} while its item list adds up to ${derived}. ` +
    `The two halves of this answer disagree, so neither total is presented ` +
    `as settled -- the per-item list below is what was actually returned.`
  );
}

/**
 * The runner's `report_only_bytes` headline against the item-derived
 * report-only total, or `null` when they agree (or it sent none).
 *
 * The tiles are computed from `items[]` so that every figure on the page comes
 * from the rows also listed on it. That consistency is worth keeping — but it
 * means the runner's own headline for the class it will not act on can differ
 * silently, and that class is ~47 % of the bytes. So a divergence is REPORTED
 * rather than resolved by quietly preferring one source.
 */
export function reportOnlyDisagreement(
  survey: DiskSurvey,
  derivedReportOnlyBytes: number
): string | null {
  const headline = survey.summaryReportOnlyBytes;
  if (!Number.isFinite(headline)) return null;
  if (headline === derivedReportOnlyBytes) return null;
  return (
    `The runner's own report-only headline is ${headline} bytes, while the ` +
    `items it listed for those classes add up to ${derivedReportOnlyBytes}. ` +
    `The tile shows the item-derived figure, because that is the one the ` +
    `table below can be checked against -- but the runner is counting ` +
    `something this page did not receive, so treat the larger of the two as ` +
    `the floor.`
  );
}

/**
 * Is this survey allowed to say "nothing to reclaim"?
 *
 * Only when the census actually completed, the runner MEASURED a zero, the walk
 * itself was complete, every item was readable, and the runner's own per-class
 * rollup (when it sent one) does not name roots the item list omitted. Each
 * clause exists because some empty list is not an empty population:
 *
 * - a `pending` census has an empty list because the runner does not KNOW yet;
 * - a survey whose rows were all unreadable has one because we could not read
 *   them;
 * - a rollup reporting 40 roots against an empty item list is the runner
 *   telling us the list is short;
 * - a walk that hit its 200k visit ceiling, or that could not read some subtree
 *   before it found any root, reports `bytes_incomplete` — the list is a
 *   PREFIX, and "we stopped looking" is not "there is nothing there";
 * - a runner that sent NO `summary.reclaimable_bytes` at all told us nothing
 *   about the total. Absence is UNKNOWN, and this is the function whose whole
 *   job is refusing to turn an unknown into a measured zero, so treating a
 *   missing key as `0` was the exact inversion of its own docstring. Note the
 *   present-but-`null` case is separate and already handled: the key's
 *   presence is recorded by `Object.hasOwn`, its value survives as `NaN`, and
 *   `NaN` fails the finite test below.
 */
export function canClaimNothingToReclaim(survey: DiskSurvey): boolean {
  // The runner must have sent an explicit ZERO. `null` there is the runner
  // saying it does not know (the cold-census state), and an ABSENT key is this
  // build not having been told — neither may support this sentence.
  const totalIsMeasuredZero =
    Number.isFinite(survey.summaryReclaimableBytes) &&
    survey.summaryReclaimableBytes === 0;
  return (
    survey.items.length === 0 &&
    survey.skippedItems === 0 &&
    (survey.censusStatus === "fresh" || survey.censusStatus === "stale") &&
    totalIsMeasuredZero &&
    !survey.bytesIncomplete &&
    survey.scan?.truncated !== true &&
    rollupDisagreement(survey) === null &&
    surveyDisagreement(survey) === null
  );
}
