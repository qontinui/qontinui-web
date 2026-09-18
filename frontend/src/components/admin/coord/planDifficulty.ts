/**
 * Plan difficulty — the plan library's rating, joined onto coord's work units.
 *
 * Plan `2026-09-18-plan-library-difficulty-field`. The rating lives on the
 * plan-library artifact (`agent.work_artifacts`, computed from the plan body
 * by the backend's `app.services.plan_difficulty`), NOT on the coord work
 * unit this console lists, so the page reads it from a second endpoint —
 * `GET /api/v1/plan-library/difficulty` — and joins by slug here.
 *
 * The three levels are a MODEL-ROUTING vocabulary: `high` → Fable 5.1,
 * `medium` → Opus 5, `low` → a fast tier. The backend serves that map
 * (`model_tiers`), so the copy here never names a model on its own.
 *
 * ## Three states a cell can be in, and they are not interchangeable
 *
 * - **rated** — the library holds a rating for this plan.
 * - **unrated** — the difficulty read ANSWERED and this plan is not in it.
 *   Usually the library holds no body for it; it may also still be queued
 *   for rating (`pending`) or its rating may have failed, and the hover text
 *   says which of those the answer can support. Never rendered as `low`.
 * - **unknown** — the difficulty read has not answered, or FAILED. Whether
 *   the plan is rated is not known (R6: absence is not zero).
 *
 * ## No hue
 *
 * The chip is deliberately neutral. R3 of the console style guide spends
 * colour on WHO MUST ACT, and a hard plan asks nothing of anyone. The level is
 * carried by the word and by a signal-bars glyph whose SHAPE differs per
 * level, which also keeps it legible to colourblind readers.
 */

export type DifficultyLevel = "low" | "medium" | "high";
export type DifficultySource = "declared" | "computed";

/** One row of `GET /plan-library/difficulty` (`PlanDifficultyItem`). */
export interface PlanDifficultyItem {
  id: string;
  slug: string;
  work_unit_slug?: string | null;
  source_repo?: string | null;
  difficulty: DifficultyLevel;
  difficulty_conceptual: DifficultyLevel;
  difficulty_implementation: DifficultyLevel;
  difficulty_source: DifficultySource;
  difficulty_rubric_version: number;
  difficulty_signals?: Record<string, unknown>;
}

/** `GET /plan-library/difficulty` (`PlanDifficultyResponse`). */
export interface PlanDifficultyResponse {
  items: PlanDifficultyItem[];
  count: number;
  rerated: number;
  /** Plans still to rate after this read's capped pass (null: pass failed). */
  rerate_pending?: number | null;
  rerate_failed_reason?: string | null;
  rubric_version: number;
  model_tiers: Record<string, string>;
}

/** What the page knows about ratings as a whole. */
export type DifficultyIndex =
  | { state: "pending" }
  | { state: "failed"; reason: string }
  | {
      state: "loaded";
      bySlug: ReadonlyMap<string, PlanDifficultyItem>;
      tiers: Readonly<Record<string, string>>;
      /** Set when the backend's re-rating pass failed — ratings may lag. */
      staleReason: string | null;
      /** Plans the backend has yet to rate (a post-deploy backlog). They are
       *  absent from `bySlug`, so an absent slug is not yet "unrated". */
      pending: number;
    };

/** What ONE row knows. */
export type DifficultyCell =
  | { kind: "rated"; item: PlanDifficultyItem; tier: string | null }
  | { kind: "unrated"; why: string }
  | { kind: "unknown"; reason: string };

export const DIFFICULTY_LEVELS: readonly DifficultyLevel[] = [
  "high",
  "medium",
  "low",
];

/**
 * Index the response by the key a coord work unit carries.
 *
 * `work_unit_slug` is the join key the scanner writes for a plan; the
 * artifact's own `slug` (identical for a scanned plan) is the fallback for a
 * hand-POSTed row with no `work_unit_slug`. Items arrive newest-written first,
 * so when two artifacts claim one slug (a fork across `source_repo`) the
 * first — most recently written — copy wins, and a fallback key never
 * displaces an explicit one.
 */
export function indexDifficulty(
  response: PlanDifficultyResponse
): DifficultyIndex {
  const bySlug = new Map<string, PlanDifficultyItem>();
  for (const item of response.items) {
    if (item.work_unit_slug && !bySlug.has(item.work_unit_slug)) {
      bySlug.set(item.work_unit_slug, item);
    }
  }
  for (const item of response.items) {
    if (!bySlug.has(item.slug)) bySlug.set(item.slug, item);
  }
  return {
    state: "loaded",
    bySlug,
    tiers: response.model_tiers ?? {},
    staleReason: response.rerate_failed_reason ?? null,
    pending: response.rerate_pending ?? 0,
  };
}

/** The cell for one work unit. */
export function difficultyCell(
  index: DifficultyIndex,
  slug: string
): DifficultyCell {
  if (index.state === "pending") {
    return {
      kind: "unknown",
      reason: "The difficulty ratings have not loaded yet.",
    };
  }
  if (index.state === "failed") {
    return {
      kind: "unknown",
      reason: `The difficulty ratings could not be read (${index.reason}) — whether this plan is rated is unknown.`,
    };
  }
  const item = index.bySlug.get(slug);
  if (!item) {
    // A slug missing from the answer is NOT proof there is no body: the
    // backend omits a plan whose rating is still pending or failed, and a slug
    // that does not join is missing too. Say what is known, no more.
    const why =
      index.pending > 0
        ? `The backend is still rating ${index.pending} plan${index.pending === 1 ? "" : "s"}; this one may be among them.`
        : index.staleReason
          ? `Re-rating failed (${index.staleReason}), so this plan may simply not have been rated.`
          : "Usually the plan library holds no body for this plan (the body sync has not captured it), so there is nothing to rate.";
    return { kind: "unrated", why };
  }
  return { kind: "rated", item, tier: index.tiers[item.difficulty] ?? null };
}

const LEVEL_WORD: Record<DifficultyLevel, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Short phrases for the signals worth showing an operator, in order. */
export function describeSignals(
  signals: Record<string, unknown> | undefined
): string[] {
  if (!signals) return [];
  const out: string[] = [];
  const num = (key: string) =>
    typeof signals[key] === "number" ? (signals[key] as number) : null;
  const phases = num("phases");
  if (phases !== null) out.push(`${phases} phase${phases === 1 ? "" : "s"}`);
  const repos = Array.isArray(signals.repos)
    ? (signals.repos as string[])
    : null;
  if (repos) {
    out.push(
      repos.length === 0
        ? "no repo named"
        : `${repos.length} repo${repos.length === 1 ? "" : "s"} (${repos.join(", ")})`
    );
  }
  const paths = num("file_paths");
  if (paths !== null) out.push(`${paths} file path${paths === 1 ? "" : "s"}`);
  const lines = num("lines");
  if (lines !== null) out.push(`${lines} lines`);
  const families = Array.isArray(signals.concept_families)
    ? (signals.concept_families as string[])
    : null;
  if (families && families.length > 0) {
    out.push(`concerns: ${families.join(", ")}`);
  }
  return out;
}

/** The chip's visible word and its hover text. */
export function describeDifficultyCell(cell: DifficultyCell): {
  label: string;
  title: string;
} {
  if (cell.kind === "unknown") return { label: "?", title: cell.reason };
  if (cell.kind === "unrated") {
    return {
      label: "unrated",
      title: `No difficulty rating found for this plan's slug. ${cell.why} Unrated is not low.`,
    };
  }
  const { item, tier } = cell;
  const route = tier ? ` — route to ${tier}` : "";
  const how =
    item.difficulty_source === "declared"
      ? `declared in the plan (the rubric computed ${String(
          item.difficulty_signals?.computed_level ?? "—"
        )})`
      : `computed (rubric v${item.difficulty_rubric_version})`;
  return {
    label: item.difficulty,
    title:
      `${LEVEL_WORD[item.difficulty]} difficulty${route}. ` +
      `Conceptual: ${item.difficulty_conceptual} · implementation: ` +
      `${item.difficulty_implementation} · ${how}.`,
  };
}

/**
 * The page's difficulty filter, applied client-side over the fetched window.
 *
 * An `unknown` cell matches no level and NOT `unrated` either — we do not know
 * which it is — so it shows only under `any`. The page therefore disables the
 * filter until the ratings have loaded, rather than render an empty list that
 * reads as "no plan is that hard".
 */
export type DifficultyFilter = "any" | DifficultyLevel | "unrated";

export const DIFFICULTY_FILTERS: readonly {
  value: DifficultyFilter;
  label: string;
}[] = [
  { value: "any", label: "Any difficulty" },
  { value: "high", label: "High difficulty" },
  { value: "medium", label: "Medium difficulty" },
  { value: "low", label: "Low difficulty" },
  { value: "unrated", label: "Unrated" },
];

export function matchesDifficulty(
  cell: DifficultyCell,
  filter: DifficultyFilter
): boolean {
  if (filter === "any") return true;
  if (cell.kind === "unknown") return false;
  if (filter === "unrated") return cell.kind === "unrated";
  return cell.kind === "rated" && cell.item.difficulty === filter;
}
