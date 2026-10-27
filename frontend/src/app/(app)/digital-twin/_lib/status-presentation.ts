/** Shared visual vocabulary for cell statuses — colors + human labels. */

import { UNKNOWN_AMBER } from "@/components/console/statusRow";
import type { AskVia, CellStatus, DoorShape, ResolvedSubspace } from "./types";

/** A reason as the start of a sentence: its first letter capitalised. */
export function upperFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface StatusStyle {
  label: string;
  /** Tailwind classes for the status dot / accent. */
  dot: string;
  /** Tailwind classes for the cell's left border accent. */
  border: string;
  /** One-line meaning, shown in tooltips / the detail drawer. */
  meaning: string;
}

/**
 * Coloured solid dots (emerald / amber / sky / red) are probe results — live
 * verdicts from this page's snapshot probe. The two built-but-unprobed
 * statuses — `interactive` and `unprobed` — are manifest claims, so they
 * render as hollow rings and never reuse the green / amber live vocabulary.
 * Solid neutral zinc marks a row with no verdict to show: the roadmap
 * (`planned`, `not-built`), a probe still in flight (`probing`) and an access
 * refusal (`restricted`). A solid violet dot is a live answer that is not a
 * verdict (`served`: coord answered with its own report), so it is neither the
 * healthy green nor the amber/red of a degraded or failed read. A hollow red
 * ring is drift between the manifest and coord (`not-served`): no probe ran,
 * so it never reuses the solid live vocabulary. `unknown` — the probe holds
 * no reading at all — sits on R3's ignorance floor (`UNKNOWN_AMBER`, the
 * console's own token): amber because nobody knows, never the red of a read
 * that failed nor a calm hue that would paint the ignorance as fine.
 */
export const STATUS_STYLES: Record<CellStatus, StatusStyle> = {
  implemented: {
    label: "Live",
    dot: "bg-emerald-500",
    border: "border-l-emerald-500",
    meaning: "Observer answering live with full coverage for this tenant.",
  },
  partial: {
    label: "Partial",
    dot: "bg-amber-500",
    border: "border-l-amber-500",
    // Two answers (`partialFinding`); a row's own says which.
    meaning:
      "Observer answering below full coverage, or with no coverage in its answer to grade.",
  },
  blind: {
    label: "Blind",
    dot: "bg-sky-500",
    border: "border-l-sky-500",
    meaning:
      "Observer exists but is disabled / unconfigured for this tenant — not the same as unbuilt.",
  },
  served: {
    label: "Served",
    dot: "bg-violet-500",
    border: "border-l-violet-500",
    // No "open the drawer for the report": the drawer shows the report only
    // in operator mode, and only once its own read of it has answered.
    meaning:
      "coord answered live, with its own report rather than a verdict — served, not graded: neither healthy nor broken.",
  },
  "not-served": {
    label: "Not served by coord",
    dot: "border border-red-500 bg-transparent",
    border: "border-l-red-300 dark:border-l-red-800",
    meaning:
      "This page's manifest expects a live probe here, but coord's catalog does not declare one — the manifest and coord have drifted. Nothing was probed.",
  },
  interactive: {
    label: "Built · ask it",
    dot: "border border-indigo-500 bg-transparent",
    border: "border-l-indigo-500",
    meaning:
      "Built — a coord tool answers it; ask it in Ask the Twin (Completeness tab). Not probed on this page.",
  },
  unprobed: {
    label: "Built · unprobed",
    dot: "border border-zinc-500 bg-transparent dark:border-zinc-400",
    border: "border-l-zinc-500 dark:border-l-zinc-400",
    meaning:
      "The manifest claims this observer is built; this page's twin probe does not cover it — a claim, not a live verdict.",
  },
  planned: {
    label: "Planned",
    dot: "bg-zinc-400",
    border: "border-l-zinc-400",
    meaning: "On the research roadmap; not yet implemented in coord.",
  },
  "not-built": {
    label: "Not built",
    dot: "bg-zinc-300 dark:bg-zinc-600",
    border: "border-l-zinc-300 dark:border-l-zinc-600",
    meaning: "Enumerated in the taxonomy but no observer exists yet.",
  },
  restricted: {
    label: "Restricted",
    dot: "bg-zinc-700 dark:bg-zinc-200",
    border: "border-l-zinc-700 dark:border-l-zinc-200",
    meaning:
      "coord refused this sub-space to you: it is Qontinui-internal (readable only by Qontinui's own operators), or, for the outbound budget, admin-only. Your other sub-spaces are unaffected.",
  },
  error: {
    label: "Error",
    dot: "bg-red-500",
    border: "border-l-red-500",
    // Two answers (`errorFinding`); a row's own says which.
    meaning:
      "Coord's live probe could not read this observer, or returned no reading of it — an honest error, never a fabricated ok.",
  },
  probing: {
    label: "Probing…",
    dot: "bg-zinc-400 animate-pulse",
    border: "border-l-zinc-300 dark:border-l-zinc-600",
    meaning: "Live probe in flight.",
  },
  unknown: {
    label: "UNKNOWN",
    dot: `border ${UNKNOWN_AMBER}`,
    // UNKNOWN_AMBER's own border tint, on the left edge only (R4).
    border: "border-l-amber-500/30",
    meaning:
      "No current reading: coord's live probe could not be made or read, so this observer's status is unknown — not a failure of the observer.",
  },
};

/** Tooltip for the matrix gauge's "· N restricted" count — the plural of
 *  `STATUS_STYLES.restricted.meaning`. */
export const RESTRICTED_COUNT_MEANING =
  "coord refused these sub-spaces for this tenant — access decisions, not silent or failed observers. They are left out of the live denominator.";

/**
 * `STATUS_STYLES.interactive` sends the reader to Ask the Twin. That is only
 * true of a tool coord grants the device session Ask the Twin runs on; a row
 * with another door (or none) says so instead.
 */
const INTERACTIVE_ELSEWHERE: Record<
  Exclude<AskVia, "ask-the-twin">,
  Pick<StatusStyle, "label" | "meaning">
> = {
  "delivery-tab": {
    label: "Built · ask it",
    meaning:
      "Built — a coord tool answers it; look it up in the Delivery tab. Not probed on this page.",
  },
  "not-on-this-page": {
    label: "Built · not askable here",
    meaning:
      "Built — a coord tool answers it, but coord withholds that tool from the device session Ask the Twin runs on, so nothing on this page can ask it.",
  },
};

/**
 * `partial` is two answers to the backend (`digital_twin.py` `_classify`): a
 * coverage between none and full, or an answer carrying no coverage at all,
 * which it cannot grade. "Below 100%" is true only of the first. A predicate
 * of coord's live probe, in the past tense, so it reads the same after
 * "Coord's live probe" and after "it" (a last answer kept after a failed
 * refresh).
 */
export function partialFinding(
  row: Partial<Pick<ResolvedSubspace, "metrics">>
): string {
  return typeof row.metrics?.coverage === "number"
    ? "found this observer answering, but with some dimensions unconfigured (coverage below 100%)"
    : "found this observer answering, with no coverage in its answer to grade";
}

/**
 * What each token the backend gives a failed probe read means, in words
 * (`digital_twin.py` `_probe_subspace`). The token itself is engineering
 * detail; the sentence an evaluator reads names the cause.
 */
const PROBE_ERROR_CAUSE: Readonly<Record<string, string>> = {
  coord_timeout: "the read timed out",
  coord_unreachable: "coord could not be reached",
  coord_tool_failed: "coord's observer failed to answer",
  malformed_verdict: "coord's answer was malformed",
};

/**
 * What an `error` row's probe got, as a predicate of the probe (see
 * {@link partialFinding}). With a token, the probe made a read of the
 * observer and it failed. Without one, either coord's door for it answered
 * 404 (`no_snapshot_tool`) or the probe's answer carried no cell for it — the
 * row cannot tell which, so the sentence names both and claims neither.
 */
export function errorFinding(token: string | undefined): string {
  if (token === undefined) {
    return "returned no reading of this observer: coord's door for it did not answer, or the probe's answer had no result for it — an honest error, never a fabricated ok";
  }
  const cause = PROBE_ERROR_CAUSE[token];
  return `could not read this observer${cause ? ` (${cause})` : ""} — an honest error, never a fabricated ok`;
}

/**
 * The presentation of one row's status (its cell status, refined by its door,
 * by which of its two answers a `partial` or an `error` is, or — for an
 * `unknown` row — by why there is no reading, so the tooltip and the drawer
 * name the outage rather than a generic one).
 */
export function presentStatus(
  row: Pick<ResolvedSubspace, "cellStatus" | "ask_via" | "unknownReason"> &
    Partial<Pick<ResolvedSubspace, "error" | "metrics">>
): StatusStyle {
  const style = STATUS_STYLES[row.cellStatus];
  if (row.cellStatus === "unknown" && row.unknownReason) {
    return {
      ...style,
      meaning: `${upperFirst(row.unknownReason)}, so there is no current reading of this observer — its status is unknown, not a failure of the observer.`,
    };
  }
  // Each is two answers, and only the row's own is true of it: the same
  // findings the drawer's Status says (`drawer-status.ts`).
  if (row.cellStatus === "partial") {
    return { ...style, meaning: `Coord's live probe ${partialFinding(row)}.` };
  }
  if (row.cellStatus === "error") {
    return {
      ...style,
      meaning: `Coord's live probe ${errorFinding(row.error)}.`,
    };
  }
  if (
    row.cellStatus !== "interactive" ||
    row.ask_via === undefined ||
    row.ask_via === "ask-the-twin"
  ) {
    return style;
  }
  return { ...style, ...INTERACTIVE_ELSEWHERE[row.ask_via] };
}

/**
 * How this page can read a row: what its `query_kind`, refined by `ask_via`,
 * means here (the detail drawer's "On this page" field). The raw `query_kind`
 * would mislead — `parameterized` means "a coord tool answers it, but this
 * page does not probe it", even for a tool coord's own catalog lists as kind
 * `snapshot` (twin_fidelity, cost).
 *
 * A resolved row's `liveProbed` (coord's declaration, joined in `resolve.ts`)
 * outranks the manifest's `query_kind` when present: a row coord declares is
 * live-probed whatever the manifest says, and a manifest `snapshot` row coord
 * does not declare is not.
 */
export function pageAccessLabel(
  row: Pick<ResolvedSubspace, "query_kind" | "ask_via"> & {
    liveProbed?: boolean;
  }
): string {
  if (row.liveProbed === true) return "Live-probed";
  if (row.liveProbed === false && row.query_kind === "snapshot") {
    return "Not served by coord";
  }
  switch (row.query_kind) {
    case "snapshot":
      return "Live-probed";
    case "none":
      return "Manifest claim (no coord tool)";
    case "parameterized":
      switch (row.ask_via) {
        case "delivery-tab":
          return "Delivery tab";
        case "not-on-this-page":
          return "Not askable here";
        default:
          return "Ask the Twin (Completeness tab)";
      }
  }
}

/**
 * Fills for the bars and gauges that COUNT rows. A count of probe answers uses
 * the live green; a count of manifest claims uses the claim indigo (the hue of
 * the `interactive` ring), never a live colour.
 */
export const COUNT_FILLS = {
  live: "bg-emerald-500",
  claim: "bg-indigo-300 dark:bg-indigo-700",
} as const;

/**
 * How old a reading was when it was read: seconds stale; `"live"`; or `null`
 * — UNKNOWN, because no age was served for it.
 *
 * `"live"` is coord's meaning for a missing `staleness_seconds` on a
 * DriftVerdict, and only there: the verdict carries it "when the answer came
 * from a cached fallback", and omits it "on a fresh live answer"
 * (`twin_verdict.rs`). Every door shape but one is read as the backend reads
 * it, as a DriftVerdict.
 *
 * An `envelope` door's answer is NOT a DriftVerdict. The admin outbound door
 * (`OutboundBudgetResponse`, `outbound_budget_read.rs`) has no answer-level
 * age: each bucket carries its own, coord sorts the buckets worst-first, and
 * the answer's drift class is the first bucket's. The web backend serves
 * that bucket's age as the reading's `staleness_seconds`
 * (`digital_twin.py` `_class_bucket_age`), so an envelope door's age dates
 * its worst bucket — the one its class comes from — and not the rest of the
 * answer, and every sentence about it names that bucket
 * ({@link datesWorstBucket}). A missing one means no age was served: no
 * bucket was observed, or a backend that predates carrying it. It is UNKNOWN,
 * never live (`verification-and-evidence`
 * `unknown-must-not-render-as-a-default`).
 *
 * A number that is not finite is no age either; JSON cannot carry one.
 */
export type ReadingAge = number | "live" | null;

/** A reading's {@link ReadingAge}, from what its door is and what it carried. */
export function readingAge(
  stalenessSeconds: number | null | undefined,
  doorShape: DoorShape | null | undefined
): ReadingAge {
  if (stalenessSeconds === null || stalenessSeconds === undefined) {
    return doorShape === "envelope" ? null : "live";
  }
  return Number.isFinite(stalenessSeconds) ? stalenessSeconds : null;
}

/**
 * Why a reading's age is UNKNOWN, as the sentences about it say. True
 * whichever half deploys first: a backend that predates carrying the
 * envelope door's age serves none, and so does one over an answer with no
 * bucket.
 */
export const UNSERVED_AGE = "no age was served for this reading";

/**
 * Whether `age` dates only the worst bucket of an envelope door's answer —
 * the bucket its drift class comes from — rather than the reading as a whole
 * ({@link readingAge}). Every sentence that shows such an age names that
 * bucket ({@link WORST_BUCKET}).
 */
export function datesWorstBucket(
  age: ReadingAge,
  doorShape: DoorShape | null | undefined
): boolean {
  return doorShape === "envelope" && typeof age === "number";
}

/** How a sentence names the bucket an envelope door's age dates. */
export const WORST_BUCKET = "worst bucket";

/** A {@link ReadingAge} in words: "45s stale", "live" or "UNKNOWN". */
export function formatReadingAge(age: ReadingAge): string {
  if (age === null) return "UNKNOWN";
  if (age === "live") return "live";
  if (age < 60) return `${age}s stale`;
  if (age < 3600) return `${Math.round(age / 60)}m stale`;
  return `${Math.round(age / 3600)}h stale`;
}

/**
 * A {@link ReadingAge} as of when it was read: "45s stale when read", "live
 * when read", or "UNKNOWN".
 *
 * A reading's own staleness is its age at the moment it was read, never its
 * age now. Every reading on this page is shown some time after that moment.
 * The backend caches its twin-door probes for up to 30 s (the operator-gated
 * outbound door is probed on every request). React-query holds the probe's
 * answer between refetches and keeps it after a failed one, and a delivery
 * verdict stays on screen until the next lookup. So "45s stale" alone would
 * claim an age the reading no longer has. The time since the read is what its
 * as-of says.
 */
export function formatAgeWhenRead(age: ReadingAge): string {
  return age === null ? "UNKNOWN" : `${formatReadingAge(age)} when read`;
}

/**
 * A DriftVerdict's own staleness as of when it was read, where a missing one
 * is "live when read" (coord's contract, {@link readingAge}). A reading whose
 * door may not answer with a DriftVerdict goes through {@link readingAge}.
 */
export function formatStalenessWhenRead(
  seconds: number | null | undefined
): string {
  return formatAgeWhenRead(readingAge(seconds, "verdict_wrapper"));
}

export function formatRatio(value: number | null | undefined): string {
  // Guard NaN too — a coord verdict can carry a non-numeric credibility (the
  // Auth observer did in prod), which would otherwise render as "NaN%".
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}
