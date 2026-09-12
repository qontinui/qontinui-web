import type {
  ClauseConflictChoice,
  ClauseMergeEntry,
  ClauseMergePreview,
  MergeClauseSide,
} from "../types";

/**
 * Pure helpers behind the `Merge clauses` panel (plan
 * `2026-09-04-cross-tenant-policy-publishing` Phase 7). No React, no fetch —
 * each is a function of the served preview and the operator's choices so far,
 * and each is what the panel's controls are gated on, so they are tested
 * rather than inlined.
 */

/**
 * One clause side as text, in the shape coord's clause compiler renders it
 * (`- **label:** value` per field, list fields one item per line). The panel
 * diffs two of these with the shared line differ, so the same clause on both
 * sides must render byte-identical — which it does, because both come from
 * coord's `ParsedClause` with the same field order.
 */
export function clauseText(side: MergeClauseSide | undefined): string {
  if (!side) return "";
  const lines: string[] = [];
  const scalar = (label: string, value: string | null) => {
    if (value != null && value !== "") lines.push(`- **${label}:** ${value}`);
  };
  const list = (label: string, values: string[]) => {
    if (values.length === 0) return;
    lines.push(`- **${label}:**`);
    for (const v of values) lines.push(`  - ${v}`);
  };
  scalar("category", side.category);
  scalar("status", side.status);
  scalar("tier", side.tier);
  scalar("trigger", side.trigger);
  scalar("action", side.action);
  scalar("bounds", side.bounds);
  scalar("escalate_if", side.escalate_if);
  list("anti_triggers", side.anti_triggers);
  list("depends_on", side.depends_on);
  list("links", side.links);
  return lines.join("\n");
}

/**
 * The side an entry will land as, given the plan's decision and — for a
 * conflict — the operator's choice. `undefined` when the clause ends up
 * REMOVED, or when a conflict is still unresolved.
 *
 * Mirrors coord's `ClauseMergePlan::resolve` arm for arm, so what the panel
 * previews as "after" is what coord will write. There is no default arm here
 * either: an unresolved conflict previews as nothing, not as one side.
 */
export function resultingSide(
  entry: ClauseMergeEntry,
  choice: ClauseConflictChoice | undefined
): MergeClauseSide | undefined {
  switch (entry.decision) {
    case "unchanged":
    case "take_upstream_edit":
    case "take_upstream_addition":
      return entry.upstream;
    case "keep_local_addition":
    case "keep_local_edit":
      return entry.local;
    case "take_upstream_removal":
    case "keep_local_removal":
      return undefined;
    case "conflict":
      if (choice === "local") return entry.local;
      if (choice === "upstream") return entry.upstream;
      return undefined;
  }
}

/**
 * The operator's choice for `clause`, or `undefined` when none was made.
 *
 * An OWN-property read, not an index: `resolutions` is a plain object keyed
 * on clause NAMES, and a clause may legally be called `constructor` or
 * `toString` — an index read would find the prototype's function and report
 * a choice nobody made.
 */
export function resolutionFor(
  resolutions: Record<string, ClauseConflictChoice>,
  clause: string
): ClauseConflictChoice | undefined {
  return Object.prototype.hasOwnProperty.call(resolutions, clause)
    ? resolutions[clause]
    : undefined;
}

/** The conflicted clause names the operator has not chosen a side for yet. */
export function unresolvedConflicts(
  preview: ClauseMergePreview,
  resolutions: Record<string, ClauseConflictChoice>
): string[] {
  if (preview.mode !== "clauses") return [];
  return preview.conflicts.filter(
    (name) => resolutionFor(resolutions, name) === undefined
  );
}

export interface MergeSummary {
  unchanged: number;
  /** Clauses that will take upstream's text (edit or addition) or its removal. */
  takingUpstream: number;
  /** Clauses that stay as this tenant has them (edit, addition, or removal). */
  keepingLocal: number;
  conflicts: number;
}

/** Counts for the panel header, from the plan's decisions alone. */
export function mergeSummary(preview: ClauseMergePreview): MergeSummary {
  const out: MergeSummary = {
    unchanged: 0,
    takingUpstream: 0,
    keepingLocal: 0,
    conflicts: 0,
  };
  if (preview.mode !== "clauses") return out;
  for (const entry of preview.entries) {
    switch (entry.decision) {
      case "unchanged":
        out.unchanged += 1;
        break;
      case "take_upstream_edit":
      case "take_upstream_addition":
      case "take_upstream_removal":
        out.takingUpstream += 1;
        break;
      case "keep_local_addition":
      case "keep_local_edit":
      case "keep_local_removal":
        out.keepingLocal += 1;
        break;
      case "conflict":
        out.conflicts += 1;
        break;
    }
  }
  return out;
}

/**
 * Whether the apply control may be offered: a clause-mode plan that would
 * change something, with every conflict chosen. Each arm that returns `false`
 * is a distinct sentence the panel shows instead of a dead button.
 */
export function canApplyMerge(
  preview: ClauseMergePreview | null,
  resolutions: Record<string, ClauseConflictChoice>
): boolean {
  if (!preview || preview.mode !== "clauses") return false;
  if (preview.noop) return false;
  return unresolvedConflicts(preview, resolutions).length === 0;
}
