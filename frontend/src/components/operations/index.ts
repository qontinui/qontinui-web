// ----------------------------------------------------------------------------
// Re-exports of primitives that MOVED to `@/components/console` in plan
// `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 1 (D3).
// They are presentation-only console primitives, not merge-train feature code.
// Kept here so no existing import breaks in that PR; NEW code imports from
// `@/components/console`.
// ----------------------------------------------------------------------------
export { CollapsiblePanel } from "@/components/console/CollapsiblePanel";
export {
  AUTHOR_GLYPH_KINDS,
  AUTHOR_RED,
  CI_YELLOW,
  INERT,
  RowTime,
  STATUS_BADGE_CLASS,
  StatusBadge,
  WAITING_AMBER,
  absoluteTime,
  rowAccentClass,
} from "@/components/console/statusRow";
export type {
  RowStatus,
  RowTimeProps,
  StatusPalette,
} from "@/components/console/statusRow";

export { CiStatusPanel } from "./CiStatusPanel";
export { GatesPanel } from "./GatesPanel";
export { FleetOverview } from "./FleetOverview";
export { FleetResourcesSection } from "./FleetResourcesSection";
export { FleetTestTargetsPanel } from "./FleetTestTargetsPanel";
export { LandedFeaturesPanel } from "./LandedFeaturesPanel";
export { MachineCard } from "./MachineCard";
export { DeviceStatusTile } from "./DeviceStatusTile";
export { DevActionsTile } from "./DevActionsTile";
export { MergeDependencyGraph } from "./MergeDependencyGraph";
export { MigrationQueueTile } from "./MigrationQueueTile";
export { MergeOrchestrationOnboarding } from "./MergeOrchestrationOnboarding";
export { MergePipeline } from "./MergePipeline";
export { MergeTrainActivity } from "./MergeTrainActivity";
export { StuckPrRecoveryPanel } from "./StuckPrRecoveryPanel";
export { TaskRunCard } from "./TaskRunCard";
export { OutputViewer } from "./OutputViewer";
