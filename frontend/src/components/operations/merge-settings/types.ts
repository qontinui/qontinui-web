/**
 * Edit-field state for the Merge Orchestrator settings page
 * ({@link MergeOrchestrationSettings}). The wire types live with the client
 * (`@/lib/api/operations/prMerge`); this leaf module holds only the page's own
 * form shape.
 */

/** Edit-field values seeded from a stored raw override (`null` → blank / inherit). */
export interface RepoOverrideFields {
  confidence_threshold_override: string;
  auto_merge_label_budget: string;
  escalate_paths_extra: string;
  auto_fix_red_main: "inherit" | "true" | "false";
}
