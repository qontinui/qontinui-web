/** Shared visual vocabulary for cell statuses — colors + human labels. */

import type { CellStatus } from "./types";

export interface StatusStyle {
  label: string;
  /** Tailwind classes for the status dot / accent. */
  dot: string;
  /** Tailwind classes for the cell's left border accent. */
  border: string;
  /** One-line meaning, shown in tooltips / the detail drawer. */
  meaning: string;
}

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
    meaning: "Observer answering, but some dimensions are unconfigured (coverage < 1).",
  },
  blind: {
    label: "Blind",
    dot: "bg-sky-500",
    border: "border-l-sky-500",
    meaning: "Observer exists but is disabled / unconfigured for this tenant — not the same as unbuilt.",
  },
  interactive: {
    label: "Interactive",
    dot: "bg-indigo-500",
    border: "border-l-indigo-500",
    meaning: "Built, but a parameterized query — ask it a specific question in the explorer (Phase 2).",
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
  error: {
    label: "Error",
    dot: "bg-red-500",
    border: "border-l-red-500",
    meaning: "The observer was probed but the live read failed — honest error, never a fabricated ok.",
  },
  probing: {
    label: "Probing…",
    dot: "bg-zinc-400 animate-pulse",
    border: "border-l-zinc-300 dark:border-l-zinc-600",
    meaning: "Live probe in flight.",
  },
};

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
