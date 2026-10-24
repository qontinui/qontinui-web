/** Shared visual vocabulary for cell statuses — colors + human labels. */

import type { AskVia, CellStatus, ResolvedSubspace } from "./types";

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
 * so it never reuses the solid live vocabulary.
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
    meaning:
      "Observer answering, but some dimensions are unconfigured (coverage < 1).",
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
    meaning:
      "coord answered live, with its own report rather than a verdict — served, not graded: neither healthy nor broken. Open the drawer for the report.",
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
    meaning:
      "The observer was probed but the live read failed — honest error, never a fabricated ok.",
  },
  probing: {
    label: "Probing…",
    dot: "bg-zinc-400 animate-pulse",
    border: "border-l-zinc-300 dark:border-l-zinc-600",
    meaning: "Live probe in flight.",
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

/** The presentation of one row's status (its cell status, refined by its door). */
export function presentStatus(
  row: Pick<ResolvedSubspace, "cellStatus" | "ask_via">
): StatusStyle {
  const style = STATUS_STYLES[row.cellStatus];
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

export function formatStaleness(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "live";
  if (seconds < 60) return `${seconds}s stale`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m stale`;
  return `${Math.round(seconds / 3600)}h stale`;
}

export function formatRatio(value: number | null | undefined): string {
  // Guard NaN too — a coord verdict can carry a non-numeric credibility (the
  // Auth observer did in prod), which would otherwise render as "NaN%".
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}
