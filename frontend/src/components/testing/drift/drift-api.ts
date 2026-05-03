"use client";

/**
 * Drift API client — fetches `DriftReport` and individual `DriftEntry`
 * records for a given run from the qontinui-web backend.
 *
 * NOTE: as of Phase D2 the backend endpoints documented below DO NOT YET
 * EXIST. They are a follow-up. The exported fetchers below issue requests
 * to those paths, but pages calling them will see a network error until
 * the backend wiring lands.
 *
 * Expected backend contract:
 *   GET /api/v1/runs/:runId/drift                  -> DriftReport-like list
 *     Returns { entries: VisualDriftEntryView[] | DriftEntryView[] }
 *     where each entry carries enough metadata for routing + summary cards.
 *
 *   GET /api/v1/runs/:runId/drift/:entryId         -> DriftEntryView
 *     Returns one drift entry with kind-specific fields:
 *       - kind: "visual-drift" carries baselineUrl, screenshotUrl, diffUrl,
 *         diffRegion, diffPercentage, diffPixelCount, totalPixels, baselineKey.
 *       - kind: "missing-in-runtime" | "missing-in-ir" | "shape-mismatch"
 *         carries the structural fields (id, kind, detail, sourceFile?).
 *
 * The view types below are a superset of `DriftEntry` from
 * `@qontinui/ui-bridge-auto/drift` so the dispatcher can branch on `kind`
 * directly while still having the fields the renderers need.
 */

import { httpClient } from "@/services/service-factory";
import type { DriftEntry } from "@qontinui/ui-bridge-auto/drift";

// ---------------------------------------------------------------------------
// View types — backend response shape (superset of DriftEntry)
// ---------------------------------------------------------------------------

/** Bounding rect of the diff region within the captured screenshot. */
export interface DiffRegionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Visual-drift entry as returned from the backend. Combines the
 * `DriftEntry` discriminator + the parallel `VisualDriftDetail` numeric
 * fields + image URLs the backend resolves from baseline/storage.
 */
export interface VisualDriftEntryView {
  id: string;
  kind: "visual-drift";
  detail: string;
  /** Percentage of pixels that differed (0..100). */
  diffPercentage: number;
  /** Absolute count of differing pixels. */
  diffPixelCount: number;
  /** Total pixels compared. */
  totalPixels: number;
  /** Bounding rect of the diff region, when available. */
  diffRegion?: DiffRegionRect;
  /** Baseline storage key used. */
  baselineKey?: string;
  /** Public URL for the baseline image. */
  baselineUrl?: string | null;
  /** Public URL for the runtime screenshot. */
  screenshotUrl?: string | null;
  /** Public URL for a precomputed diff overlay, when available. */
  diffUrl?: string | null;
  /** Comparison threshold used (0..1). */
  threshold?: number;
}

/** Structural (semantic) drift entry from the IR comparator. */
export interface SpecDriftEntryView {
  id: string;
  kind: "missing-in-runtime" | "missing-in-ir" | "shape-mismatch";
  detail: string;
  /** Optional source file pointer for the IR-side definition. */
  sourceFile?: string;
  /** Optional source predicate / field name (for shape-mismatch). */
  sourcePredicate?: string;
  /** IR-side serialized fragment (when relevant). */
  expected?: unknown;
  /** Runtime-side observed fragment (when relevant). */
  observed?: unknown;
}

/** Forward-compat: anything we don't recognise yet. */
export interface UnknownDriftEntryView {
  id: string;
  kind: string;
  detail?: string;
  [extra: string]: unknown;
}

export type DriftEntryView =
  | VisualDriftEntryView
  | SpecDriftEntryView
  | UnknownDriftEntryView;

/** Listing payload for `GET /api/v1/runs/:runId/drift`. */
export interface DriftReportView {
  runId: string;
  entries: DriftEntryView[];
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isVisualDrift(
  entry: DriftEntryView,
): entry is VisualDriftEntryView {
  return entry.kind === "visual-drift";
}

const SPEC_KINDS = new Set([
  "missing-in-runtime",
  "missing-in-ir",
  "shape-mismatch",
]);

export function isSpecDrift(
  entry: DriftEntryView,
): entry is SpecDriftEntryView {
  return SPEC_KINDS.has(entry.kind);
}

/**
 * Narrow helper that's useful for the dispatcher — reuses the upstream
 * `DriftEntry.kind` discriminator from `@qontinui/ui-bridge-auto/drift`.
 */
export function asUiBridgeKind(entry: DriftEntryView): DriftEntry["kind"] | null {
  switch (entry.kind) {
    case "visual-drift":
    case "missing-in-runtime":
    case "missing-in-ir":
    case "shape-mismatch":
      return entry.kind;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

export async function fetchDriftReport(runId: string): Promise<DriftReportView> {
  return httpClient.get<DriftReportView>(`/api/v1/runs/${runId}/drift`);
}

export async function fetchDriftEntry(
  runId: string,
  entryId: string,
): Promise<DriftEntryView> {
  return httpClient.get<DriftEntryView>(
    `/api/v1/runs/${runId}/drift/${entryId}`,
  );
}
