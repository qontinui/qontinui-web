/**
 * Re-export shim. `CollapsiblePanel` MOVED to
 * `@/components/console/CollapsiblePanel` in plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 1 (D3) —
 * it is a presentation-only console primitive (R7), not merge-train feature
 * code.
 *
 * This file exists so the ~15 modules that import `./CollapsiblePanel`
 * relatively keep working without a repo-wide import churn inside a Phase-1
 * PR. **New code imports from `@/components/console`**; this shim is deleted
 * once the console migration (Phase 3) has rewritten the last caller.
 */

export { CollapsiblePanel } from "@/components/console/CollapsiblePanel";
