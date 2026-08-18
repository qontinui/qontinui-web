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
 * ## Wire shape this module was coded against
 *
 * The runner route did not exist when this was written (the sibling Phase 2
 * runner change adds it), so the shape below is the plan's own specification —
 * `GET /agent-worktrees/reclaimable`'s shape, narrowed to cargo target roots:
 *
 * ```jsonc
 * {
 *   "device_id": "<uuid>|null",
 *   "items": [{
 *     "id": "d:/qontinui-root/foo/target",   // optional; falls back to `path`
 *     "path": "D:\\qontinui-root\\foo\\target",
 *     "class": "in-repo-canonical",           // see KNOWN_DISK_CLASSES
 *     "status": "reclaimable" | "blocked",
 *     "reason": "building" | null,
 *     "reason_detail": "a cargo build holds .cargo-lock" | null,
 *     "bytes": 12345678,
 *     "last_used_at": "2026-08-14T09:00:00Z" | null
 *   }],
 *   "summary": { "reclaimable_bytes": 12345678, ... },
 *   "census_status": "pending" | "fresh" | "stale",
 *   "census_age_secs": 42,
 *   "census_note": "..." | null
 * }
 * ```
 *
 * **Per-class bytes are aggregated HERE, from `items[]`** — deliberately not
 * read out of `summary`. Each item already carries `class`, `status` and
 * `bytes`, so the aggregate is derivable from the authoritative rows, and the
 * page therefore does not break if the runner spells its per-class summary
 * differently. `summary.reclaimable_bytes` (the fleet-wide total) IS read, and
 * only to cross-check the aggregate — see {@link surveyDisagreement}.
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
  /** RFC 3339, or `null`. */
  lastUsedAt: string | null;
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

/** Freshness of the census the survey was derived from. */
export type CensusStatus = "pending" | "fresh" | "stale" | "unknown";

/** A parsed survey. Every field is what the runner said, or an explicit gap. */
export interface DiskSurvey {
  deviceId: string | null;
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
 * `reapable` is accepted alongside `reclaimable` because the shape this is
 * modelled on (`GET /agent-worktrees/reclaimable`) spells it that way, and the
 * two routes are siblings written months apart. An unrecognised status is
 * `null` — the item is then counted as unreadable rather than silently
 * defaulted into either bucket, because guessing would put real bytes on the
 * wrong side of the "can I act on this?" line.
 */
export function toSurveyStatus(value: unknown): DiskSurveyStatus | null {
  if (value === "reclaimable" || value === "reapable") return "reclaimable";
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
    lastUsedAt: optionalString(raw.last_used_at),
  };
}

function toCensusStatus(raw: string | null): CensusStatus {
  if (raw === "pending" || raw === "fresh" || raw === "stale") return raw;
  return "unknown";
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
  const summaryBytes = summary?.reclaimable_bytes;
  const censusStatusRaw = optionalString(payload.census_status);
  const ageRaw = payload.census_age_secs;

  return {
    state: "parsed",
    survey: {
      deviceId: optionalString(payload.device_id),
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
  for (const item of survey.items) {
    let entry = byClass.get(item.classId);
    if (!entry) {
      const info = classInfo(item.classId);
      entry = {
        classId: item.classId,
        label: info.label,
        verb: info.verb,
        note: info.note,
        known: isKnownClass(item.classId),
        reclaimableBytes: 0,
        blockedBytes: 0,
        reclaimableCount: 0,
        blockedCount: 0,
        unknownByteItems: 0,
      };
      byClass.set(item.classId, entry);
    }
    if (item.status === "reclaimable") entry.reclaimableCount++;
    else entry.blockedCount++;
    if (!Number.isFinite(item.bytes) || item.bytes < 0) {
      entry.unknownByteItems++;
      continue;
    }
    if (item.status === "reclaimable") entry.reclaimableBytes += item.bytes;
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
  /** Classes the v1 cleanup verb covers. */
  actionableBytes: number;
  actionableItems: number;
  actionableUnknownByteItems: number;
  /** `in-repo-canonical` and anything else whose verb is deferred. */
  reportOnlyBytes: number;
  reportOnlyItems: number;
  reportOnlyUnknownByteItems: number;
  /** Classes this build does not recognise — neither claim applies to them. */
  unrecognisedBytes: number;
  unrecognisedItems: number;
  unrecognisedUnknownByteItems: number;
  /** Candidates a guard refuses to touch right now, across every class. */
  blockedBytes: number;
  blockedItems: number;
}

/** Split the per-class aggregate into the actionable / report-only buckets. */
export function bucketTotals(totals: DiskClassTotals[]): DiskBuckets {
  const out: DiskBuckets = {
    actionableBytes: 0,
    actionableItems: 0,
    actionableUnknownByteItems: 0,
    reportOnlyBytes: 0,
    reportOnlyItems: 0,
    reportOnlyUnknownByteItems: 0,
    unrecognisedBytes: 0,
    unrecognisedItems: 0,
    unrecognisedUnknownByteItems: 0,
    blockedBytes: 0,
    blockedItems: 0,
  };
  for (const t of totals) {
    out.blockedBytes += t.blockedBytes;
    out.blockedItems += t.blockedCount;
    if (t.verb === "v1") {
      out.actionableBytes += t.reclaimableBytes;
      out.actionableItems += t.reclaimableCount;
      out.actionableUnknownByteItems += t.unknownByteItems;
    } else if (t.verb === "deferred-v2") {
      out.reportOnlyBytes += t.reclaimableBytes;
      out.reportOnlyItems += t.reclaimableCount;
      out.reportOnlyUnknownByteItems += t.unknownByteItems;
    } else {
      out.unrecognisedBytes += t.reclaimableBytes;
      out.unrecognisedItems += t.reclaimableCount;
      out.unrecognisedUnknownByteItems += t.unknownByteItems;
    }
  }
  return out;
}

/**
 * A sentence describing a survey that contradicts itself, or `null`.
 *
 * The case that matters: an EMPTY `items[]` alongside a `summary` claiming
 * reclaimable bytes. Rendering "nothing to reclaim" there would repeat a
 * number the payload itself disputes, so the caller shows this instead. The
 * reverse (items summing to more than the summary) is reported too — either
 * way the two halves of the answer disagree and neither may be presented as
 * settled fact.
 */
export function surveyDisagreement(survey: DiskSurvey): string | null {
  const summary = survey.summaryReclaimableBytes;
  if (!Number.isFinite(summary)) return null;
  const derived = survey.items
    .filter((i) => i.status === "reclaimable" && Number.isFinite(i.bytes))
    .reduce((sum, i) => sum + i.bytes, 0);
  if (derived === summary) return null;
  // Items with unreadable byte counts explain a shortfall honestly; that is
  // not a contradiction, it is the lower bound this module already declares.
  const unreadable = survey.items.some(
    (i) => i.status === "reclaimable" && !Number.isFinite(i.bytes)
  );
  if (unreadable && derived < summary) return null;
  return (
    `The runner's own summary reports ${summary} reclaimable byte` +
    `${summary === 1 ? "" : "s"} while its item list adds up to ${derived}. ` +
    `The two halves of this answer disagree, so neither total is presented ` +
    `as settled -- the per-item list below is what was actually returned.`
  );
}

/**
 * Is this survey allowed to say "nothing to reclaim"?
 *
 * Only when the census actually completed AND every item was readable. A
 * `pending` census has an empty list because the runner does not KNOW yet, and
 * a survey whose rows were all unreadable has an empty list because we could
 * not read them. Neither is evidence of an empty population.
 */
export function canClaimNothingToReclaim(survey: DiskSurvey): boolean {
  return (
    survey.items.length === 0 &&
    survey.skippedItems === 0 &&
    (survey.censusStatus === "fresh" || survey.censusStatus === "stale")
  );
}
