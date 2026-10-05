/**
 * One normalizer for coord's `/pr-merge/economics` body, shared by every page
 * that reads it through `/api/v1/operations/pr-merge/merge-economics`.
 *
 * Coord's HTTP twin (`pr_merge/economics.rs` `compute_merge_economics`, the
 * no-`?repo=` arm) answers `{window_hours, as_of, repo_count, repos: [ {repo,
 * ...}, ... ]}` — an ARRAY inside a wrapper. The web proxy degrades a coord
 * 404/502/503/504 to `{}`. Older shapes the frontend has tolerated: a bare
 * array, and an object keyed by `owner/name` (optionally under `repos`).
 *
 * The pipeline page's inline normalizer treated `{repos: [...]}` as the
 * keyed-object form (an array is `typeof "object"`), which keyed the map by
 * array INDEX — so `economicsByRepo["owner/name"]` was always undefined.
 * Every shape is handled here, once, and pinned by `mergeEconomics.test.ts`.
 *
 * `asOf` is coord's compose time when the body carried one; `null` otherwise
 * (the degraded `{}` included) — an UNKNOWN freshness, never "now".
 */

import type { MergeEconomics } from "./mergeTypes";

export interface NormalizedMergeEconomics {
  byRepo: Record<string, MergeEconomics>;
  asOf: string | null;
}

function fromArray(arr: unknown[]): Record<string, MergeEconomics> {
  const map: Record<string, MergeEconomics> = {};
  for (const e of arr) {
    if (
      e &&
      typeof e === "object" &&
      typeof (e as { repo?: unknown }).repo === "string"
    ) {
      map[(e as { repo: string }).repo] = e as MergeEconomics;
    }
  }
  return map;
}

/** Keys of a wrapper that are metadata, never a repo slug. */
const WRAPPER_KEYS = new Set(["as_of", "window_hours", "repo_count", "note"]);

export function normalizeMergeEconomics(
  body: unknown
): NormalizedMergeEconomics {
  if (Array.isArray(body)) return { byRepo: fromArray(body), asOf: null };
  if (!body || typeof body !== "object") return { byRepo: {}, asOf: null };
  const obj = body as Record<string, unknown>;
  const asOf = typeof obj.as_of === "string" ? obj.as_of : null;
  if ("repos" in obj) {
    const repos = obj.repos;
    if (Array.isArray(repos)) return { byRepo: fromArray(repos), asOf };
    if (repos && typeof repos === "object") {
      return { byRepo: repos as Record<string, MergeEconomics>, asOf };
    }
    return { byRepo: {}, asOf };
  }
  // Already keyed by repo — drop wrapper metadata keys if any rode along.
  const byRepo: Record<string, MergeEconomics> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (WRAPPER_KEYS.has(k)) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      byRepo[k] = v as MergeEconomics;
    }
  }
  return { byRepo, asOf };
}
