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
 *     "verb": "orphan-target-reaper" | null   // PER ITEM: who would remove
 *                                             // THIS root; null => nobody
 *                                             // here (another engine owns it,
 *                                             // or the class has no verb)
 *   }],
 *   "summary": {
 *     "reclaimable_bytes": 12345678 | null,
 *     "report_only_bytes": 98765432 | null,
 *     "bytes_incomplete": false,
 *     "roots_unknown": false,                  // true => the walk produced NO
 *                                              // population; every `roots`
 *                                              // below is a placeholder, and
 *                                              // a current runner sends
 *                                              // `by_class: []` as well
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
 *     "read_errors": [{ "path": "...", "error": "..." }],  // CAPPED sample
 *     "read_errors_total": 0,                  // the UNCAPPED count; absent
 *                                              // from a runner build that
 *                                              // predates the cap
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
 * not KNOW; `0` means it MEASURED nothing -- and only the second may license
 * the sentence, see {@link canClaimNothingToReclaim}.
 *
 * ### Which half of the payload is authoritative
 *
 * - **Per-class BYTES are aggregated here, from `items[]`**, so every figure on
 *   the page comes from rows that are also listed on it. The runner's own
 *   totals (`reclaimable_bytes`, `report_only_bytes`) are cross-checks --
 *   {@link surveyDisagreement}, {@link reportOnlyDisagreement} -- and a
 *   divergence is reported rather than resolved by preferring one silently.
 * - **The two VERB fields answer two different questions and are read
 *   separately.** `summary.by_class[].verb` is CLASS metadata (the runner's
 *   `TargetClass::has_verb()`), so it — falling back to
 *   {@link KNOWN_DISK_CLASSES} — is what {@link DiskClassTotals.verb} and the
 *   class badge are derived from. `items[].verb` is a PER-ITEM verdict: which
 *   engine would remove THIS root, `null` when the refusal says another engine
 *   owns the path (`render_item` in `disk_survey.rs` strips it for every
 *   `SkipReason::owned_elsewhere()`). A class therefore contains items that
 *   disagree about `verb` as a matter of course — `<wt>/target` (owned by the
 *   worktree reclaim engine, `verb: null`) beside `<wt>/target-<slug>`
 *   (`verb: "orphan-target-reaper"`) — and each item is bucketed on its own
 *   verdict by {@link bucketOfItem}.
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
   * says no verb would act on THIS root" (`verb: null`) from "this runner
   * build does not report verbs", which are different facts about
   * actionability.
   */
  hasVerbField: boolean;
  /**
   * Which engine would remove THIS ROOT if the verb were armed, as the RUNNER
   * declares it — a per-item VERDICT, not class metadata.
   *
   * `render_item` in the runner's `disk_survey.rs` derives it from the
   * verdict: `null` whenever the refusal is `SkipReason::owned_elsewhere()`
   * (`owned-by-worktree-reclaim`, `owned-by-build-pool`, `ownership-unknown`,
   * `report-only`), because the field names WHO would act and that is not this
   * engine. A refusal on the reaper's own guards (building, dirty, kept,
   * grace) KEEPS the verb.
   *
   * So two roots of the SAME class legitimately disagree about it, and reading
   * it as a statement about the class is a category error — see
   * {@link bucketOfItem}. {@link DiskSurveyItem.reason} says which of the two
   * `null` cases applies.
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
 * The runner's `SkipReason::owned_elsewhere()` tokens — the refusals that say
 * **another engine owns this path** (or that we could not tell which does).
 *
 * They are the reasons `render_item` strips `item.verb` for, so an item
 * carrying one arrives with `verb: null` beside siblings of the SAME class
 * that carry a verb. Listed here so the bucket router keys on the reason the
 * runner gave rather than on the absence it caused.
 *
 * `report-only` is deliberately NOT in this set even though the runner counts
 * it as owned-elsewhere: it is the only one that is a statement about the
 * CLASS having no verb, and it drives its own bucket ({@link bucketOfItem}).
 */
export const OWNED_ELSEWHERE_REASONS: ReadonlySet<string> = new Set([
  "owned-by-worktree-reclaim",
  "owned-by-build-pool",
  "ownership-unknown",
]);

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
   * report it has not told us the walk was complete — which is why
   * {@link canClaimNothingToReclaim} requires this to be `true` rather than
   * settling for `truncated !== true`, a test an absent key passes.
   */
  hasTruncatedField: boolean;
  /**
   * The failed reads the runner CHOSE TO LIST — a bounded sample, not the
   * population. Never count this array; read {@link readErrorsSeen}.
   */
  readErrors: DiskScanError[];
  /**
   * `scan.read_errors_total` — the runner's UNCAPPED count of failed reads, or
   * `null` from a build that predates the field.
   *
   * The runner caps `read_errors` at 100 entries because the walk records one
   * per unreadable directory across up to 200,000 of them and serialises the
   * lot into every response. `read_errors.length` therefore stopped being a
   * count the moment that cap landed: a machine with a permission-locked
   * subtree reports thousands and this page would have said exactly `100`.
   */
  readErrorsTotal: number | null;
  /**
   * `scan.depth_limited_dirs` — directories the walk did not descend into
   * because it hit its depth bound, or `null` from a build that predates the
   * field.
   *
   * The FIFTH way a walk can fall short, and the only one this page had no name
   * for. It is not folded into `truncated`, and — while items are present — the
   * runner deliberately keeps it out of `bytes_incomplete` too (the bound bites
   * on any deep tree, so folding it in would leave that flag permanently true).
   * So a walk can be short for this reason alone while every other counter
   * reads clean, and a UI that explains WHY without reading this asserts a
   * cause the payload does not carry.
   *
   * The runner's own `census_note` names the bound in that state; this field is
   * how the panel beside it can say the same thing.
   */
  depthLimitedDirs: number | null;
  rootsWithUnknownBytes: number | null;
  rootsWithPartialBytes: number | null;
}

/**
 * How many reads failed, as this page must count them.
 *
 * Prefers the runner's uncapped total and falls back to the listed length only
 * for a build that sends no total — where the list IS the whole set, so the
 * fallback is exact rather than a guess. Takes the larger of the two so a
 * payload whose total contradicts its own list can never report FEWER errors
 * than it visibly carries.
 */
export function readErrorsSeen(scan: DiskScanStats | null): number {
  if (scan === null) return 0;
  const listed = scan.readErrors.length;
  return scan.readErrorsTotal === null
    ? listed
    : Math.max(scan.readErrorsTotal, listed);
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
   * total — which covers BOTH "the key was absent" and "the runner sent
   * `null`". Both are UNKNOWN and both are refused everywhere a measured zero
   * is required ({@link canClaimNothingToReclaim},
   * {@link measuredZeroBuckets}), so the two are deliberately not tracked
   * apart: a `summaryHasReclaimableBytes` flag lived here for one commit and
   * nothing ever read it.
   */
  summaryReclaimableBytes: number;
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
   * `summary.roots_unknown` — the runner saying its walk produced NO population
   * at all, so every count in the rollup is a placeholder rather than a
   * measurement.
   *
   * It exists because `ClassSummary.roots` is an unsigned integer on the wire
   * and cannot be nulled the way the byte totals are. A failed
   * `read_dir(workspace_root)` therefore emitted four rows of `roots: 0` that
   * are indistinguishable from a fully-read, genuinely-empty machine — and
   * {@link measuredZeroBuckets} read them as a certified `0 B`. This flag is
   * the runner's own contradiction of that reading, and it must be consulted
   * before any zero on this page is called measured.
   */
  summaryRootsUnknown: boolean;
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
 * same distinction one level down, for a `scan` object missing the key, and
 * {@link canClaimNothingToReclaim} consults BOTH — it is the one sentence on
 * the page that needs the walk to have reported itself complete.
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
    readErrorsTotal: count(raw.read_errors_total),
    depthLimitedDirs: count(raw.depth_limited_dirs),
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
      summaryReportOnlyBytes: toNumberOrNaN(summary?.report_only_bytes),
      byClass: rollup?.rows ?? null,
      byClassSkipped: rollup?.skipped ?? 0,
      bytesIncomplete: summary?.bytes_incomplete === true,
      summaryRootsUnknown: summary?.roots_unknown === true,
      scan: parseScanStats(payload.scan),
      skippedItems: skipped,
    },
  };
}

/**
 * Which headline tile one root belongs to. The four PARTITION the item list —
 * see {@link bucketOfItem}.
 */
export type DiskBucketKind =
  | "actionable"
  | "report-only"
  | "unrecognised"
  | "blocked";

/** One bucket's share of a class. Every item lands in exactly one. */
export interface DiskBucketSlice {
  bytes: number;
  items: number;
  /** Items whose `bytes` were unreadable — EXCLUDED from {@link bytes}. */
  unknownByteItems: number;
  /** Items whose `bytes` arrived but is itself a floor (`bytes_partial`). */
  partialByteItems: number;
}

function emptySlice(): DiskBucketSlice {
  return { bytes: 0, items: 0, unknownByteItems: 0, partialByteItems: 0 };
}

/** Per-class aggregate, derived from `items[]`. */
export interface DiskClassTotals {
  /** The class string the runner sent, or `null` when it sent none. */
  classId: string | null;
  label: string;
  /**
   * CLASS metadata: whether the v1 cleanup verb reaches this class at all.
   *
   * Read from `summary.by_class[].verb` (the runner's own
   * `TargetClass::has_verb()`), falling back to {@link KNOWN_DISK_CLASSES}.
   * **Never derived from `items[].verb`**, which is a per-item verdict — doing
   * so made every mixed class (`<wt>/target` beside `<wt>/target-<slug>`)
   * render as `unrecognised` and hid the actionable tile behind a false "no
   * candidates". This drives the class BADGE and which tiles are shown at all;
   * which bucket each root's BYTES land in is {@link bucketOfItem}'s answer,
   * per item.
   */
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
   * This class's items split by the bucket each one's OWN verdict puts it in.
   *
   * A class is routinely split across buckets — that is the runner answering a
   * per-root question, not contradicting itself — so the split is carried here
   * rather than recomputed from a single class-level verb. {@link bucketTotals}
   * only sums these, which is what makes the four buckets a partition by
   * construction.
   */
  buckets: Record<DiskBucketKind, DiskBucketSlice>;
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
 * Which headline bucket ONE root belongs to, from its OWN verdict.
 *
 * The runner answers per root, so this must too. `item.verb` is stripped
 * whenever the refusal is `SkipReason::owned_elsewhere()`, which means a class
 * legitimately carries both shapes at once — on this machine `sibling-worktree`
 * holds `<wt>/target` (the basename the worktree reclaim engine owns ⇒
 * `verb: null`) beside `<wt>/target-<slug>` (⇒ `verb: "orphan-target-reaper"`),
 * and `sibling-nongit` holds `target-pool/slot-0` and `target-agent` the same
 * way. Treating that disagreement as a class-level contradiction is what hid
 * the actionable tile behind a false "no candidates".
 *
 * `classVerb` is consulted only where the ITEM said nothing — a runner build
 * that does not report `verb` at all.
 */
export function bucketOfItem(
  item: DiskSurveyItem,
  classVerb: DiskClassVerb
): DiskBucketKind {
  // 1. Report-only. This refusal says NO VERB EXISTS for the class, not that
  //    anything is holding the path, so both of its statuses belong here --
  //    which is also what the runner's own `summary.report_only_bytes` counts
  //    (`by_class[in-repo-canonical].bytes`, every status).
  if (item.reason === REPORT_ONLY_REASON || classVerb === "deferred-v2") {
    return "report-only";
  }
  // 2. Another engine owns this path, or we could not tell which does. Keyed
  //    on the REASON rather than on the stripped verb, so the item is placed
  //    by what the runner said and not by the absence that said it -- and so a
  //    contradictory row (owned elsewhere yet `reclaimable`) can never be
  //    offered as actionable.
  if (item.reason !== null && OWNED_ELSEWHERE_REASONS.has(item.reason)) {
    return "blocked";
  }
  // 3. Any other refusal is a HOLD on this root: a live build, a pin, a dirty
  //    worktree. It is the ITEM's verdict, so it stands whether or not this
  //    build recognises its class -- the runner's refusal is a fact about the
  //    root, and our not knowing the class does not soften it.
  if (item.status === "blocked") return "blocked";
  // 4. Reclaimable, with the runner naming the engine that would remove it:
  //    actionable, no matter what its siblings report. A reclaimable root the
  //    runner explicitly gave NO verb for is a shape the runner cannot emit
  //    today; if one ever arrives, this page cannot say what would act on it,
  //    so it is surfaced as unrecognised rather than offered as actionable.
  if (item.hasVerbField) {
    return item.verb !== null ? "actionable" : "unrecognised";
  }
  // 5. A build that sent no `verb` key told us nothing per item; the class's
  //    own disposition is all that is left to read.
  return classVerb === "v1" ? "actionable" : "unrecognised";
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
      // the thing that would run the verb — but the authority lives in
      // `summary.by_class[].verb`, which IS class metadata
      // (`TargetClass::has_verb()`). Reading it means a class the runner adds
      // later lands in the right bucket without a web release, and the
      // hardcoded table is the fallback for a runner that does not report it.
      //
      // `items[].verb` is deliberately NOT consulted here: it is a per-item
      // verdict, so deriving the class from it made a class with one
      // owned-elsewhere root report as `unrecognised` and hid its tile.
      const declaresVerb = declaredRow?.hasVerbField
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
        buckets: {
          actionable: emptySlice(),
          "report-only": emptySlice(),
          unrecognised: emptySlice(),
          blocked: emptySlice(),
        },
      };
      byClass.set(item.classId, entry);
    }
    const reclaimable = item.status === "reclaimable";
    if (reclaimable) entry.reclaimableCount++;
    else entry.blockedCount++;

    // Each root is routed on its OWN verdict, into exactly one slice. Siblings
    // of the same class disagreeing about `verb` is the runner answering a
    // per-root question, not a defect — see `bucketOfItem`.
    const slice = entry.buckets[bucketOfItem(item, entry.verb)];
    slice.items++;

    if (!Number.isFinite(item.bytes) || item.bytes < 0) {
      entry.unknownByteItems++;
      slice.unknownByteItems++;
      if (reclaimable) entry.reclaimableUnknownByteItems++;
      else entry.blockedUnknownByteItems++;
      continue;
    }
    if (item.bytesPartial) {
      entry.partialByteItems++;
      slice.partialByteItems++;
      if (reclaimable) entry.reclaimablePartialByteItems++;
      else entry.blockedPartialByteItems++;
    }
    slice.bytes += item.bytes;
    if (reclaimable) entry.reclaimableBytes += item.bytes;
    else entry.blockedBytes += item.bytes;
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
  /**
   * Roots the RUNNER says a cleanup verb would remove: `status: "reclaimable"`
   * with a `verb`. Per item, not per class — a root the runner would act on is
   * actionable even when a sibling of its class is owned by another engine.
   */
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
  /**
   * Roots this page cannot place: a reclaimable root of a class this build
   * does not recognise, from a runner that named no verb for it. Neither claim
   * — "you can clean this" nor "something holds it" — is supported, so they
   * get their own tile rather than being folded into one that is.
   */
  unrecognisedBytes: number;
  unrecognisedItems: number;
  unrecognisedUnknownByteItems: number;
  unrecognisedPartialByteItems: number;
  /**
   * Candidates the runner REFUSED for a reason other than "no verb exists" — a
   * live build, a pin, a dirty worktree, another engine that owns the path, or
   * a probe that could not establish that nothing does (`ownership-unknown`).
   *
   * Report-only roots are excluded: they arrive `blocked` because no verb
   * exists, not because anything is holding them, and counting them here both
   * double-counts the report-only bucket and describes 47 % of the bytes on
   * this box with a sentence that is false.
   *
   * A refusal on a class this build does not recognise DOES land here: the
   * verdict and its reason are the runner's, and our not recognising the class
   * says nothing about whether the root is held. Only the class's disposition
   * is unknown, and that is what the class table reports.
   */
  blockedBytes: number;
  blockedItems: number;
  blockedUnknownByteItems: number;
  blockedPartialByteItems: number;
}

/**
 * Sum the per-class bucket slices into the four headline tiles.
 *
 * The four buckets PARTITION the items — every root lands in exactly one — so
 * that an operator adding the tiles up gets the survey's own total rather than
 * a number inflated by roots counted twice. That property is now structural:
 * {@link aggregateByClass} increments exactly one slice per item and this
 * function only adds slices up, so no class can be dropped and none counted
 * twice.
 *
 * Routing is PER ITEM ({@link bucketOfItem}), not per class. A class is not a
 * homogeneous population: `sibling-worktree` carries roots this reaper would
 * remove alongside roots another engine owns, and the earlier class-level
 * routing had to pick one answer for both — which it did by taking the first
 * item's, then declaring the rest a contradiction and hiding the tile.
 *
 * The report-only bucket still takes the whole class, `blocked` rows included.
 * That is not a convenience: the runner **never** emits an `in-repo-canonical`
 * row with `status: "reclaimable"` — `boundary_verdict` returns
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
    const a = t.buckets.actionable;
    out.actionableBytes += a.bytes;
    out.actionableItems += a.items;
    out.actionableUnknownByteItems += a.unknownByteItems;
    out.actionablePartialByteItems += a.partialByteItems;

    const r = t.buckets["report-only"];
    out.reportOnlyBytes += r.bytes;
    out.reportOnlyItems += r.items;
    out.reportOnlyUnknownByteItems += r.unknownByteItems;
    out.reportOnlyPartialByteItems += r.partialByteItems;

    const u = t.buckets.unrecognised;
    out.unrecognisedBytes += u.bytes;
    out.unrecognisedItems += u.items;
    out.unrecognisedUnknownByteItems += u.unknownByteItems;
    out.unrecognisedPartialByteItems += u.partialByteItems;

    const b = t.buckets.blocked;
    out.blockedBytes += b.bytes;
    out.blockedItems += b.items;
    out.blockedUnknownByteItems += b.unknownByteItems;
    out.blockedPartialByteItems += b.partialByteItems;
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
  // The runner's own veto, read FIRST because it contradicts every other
  // signal on this path. `roots_unknown` means the walk produced no population,
  // so the rollup's `roots: 0` rows are placeholders and the byte totals it
  // nulled would arrive as NaN — but a runner build that emits an EMPTY rollup
  // and one that emits four zeroed rows both reach here, and only this flag
  // separates either of them from a genuinely empty machine.
  if (survey.summaryRootsUnknown)
    return { actionable: false, reportOnly: false };

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
 * - a runner that sent NO `scan` block, or a `scan` without a `truncated` key,
 *   has not told us the walk was complete. `truncated !== true` passes for both
 *   of those absences, so the walk must POSITIVELY report itself complete:
 *   `scan` present, carrying the key, and reading `false`. The real runner
 *   always sends `scan` alongside a `fresh`/`stale` census (`disk_survey.rs`
 *   omits it only for `pending` and `unavailable`, both already refused
 *   above), so this rejects only a build that cannot support the sentence;
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
  // The walk must SAY it was complete, not merely fail to say it was short.
  const walkSaysComplete =
    survey.scan !== null &&
    survey.scan.hasTruncatedField &&
    !survey.scan.truncated;
  return (
    survey.items.length === 0 &&
    survey.skippedItems === 0 &&
    (survey.censusStatus === "fresh" || survey.censusStatus === "stale") &&
    totalIsMeasuredZero &&
    !survey.bytesIncomplete &&
    walkSaysComplete &&
    rollupDisagreement(survey) === null &&
    surveyDisagreement(survey) === null
  );
}
