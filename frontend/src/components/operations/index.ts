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

export { CiCapacityDisclosure } from "./CiCapacityDisclosure";
export type { CiCapacityDisclosureProps } from "./CiCapacityDisclosure";
export { indexMachinesByCoordDevice, resolveCiCapacity } from "./ciCapacity";
export type { CiCapacityJoin, DevenvMachinesRead } from "./ciCapacity";
export { useDevenvMachines } from "./useDevenvMachines";
export {
  CI_ROUTING_LABELS,
  describeMirrorFreshness,
  hasLabel,
  indexCiRunners,
  isRoutingLabel,
  matchesFleetRouting,
  mergeCiRunners,
  mirrorRowAgeSecs,
  missingRoutingLabels,
  normalizeCiRunnerStatus,
  parseCiRunnersPayload,
} from "./ciRunnerMirror";
export type {
  CiRunnerMirrorRead,
  CoordCiRunnerRow,
  CoordCiRunnersPayload,
} from "./ciRunnerMirror";
export {
  CI_RUNNER_MIRROR_API,
  CI_RUNNER_MIRROR_POLL_MS,
  useCiRunnerMirror,
} from "./useCiRunnerMirror";
export { OPERATOR_AUDIT_API, OperatorAuditPanel } from "./OperatorAuditPanel";
export {
  AUDIT_FILTERS,
  DEFAULT_AUDIT_FILTER_ID,
  NIL_OPERATOR_ID,
  blastRadiusOf,
  describeAuditAction,
  isNilOperator,
  parseAuditPayload,
  reasonOf,
  resolveAuditFilter,
} from "./operatorAudit";
export type {
  AuditActionLabel,
  AuditFilter,
  AuditRead,
  AuditRow,
  BlastRadius,
  BlastRadiusItem,
} from "./operatorAudit";
// Was `CiStatusPanel`, mounted directly on /admin/coord/pipeline. The
// 2026-09-19 redesign moved it onto the Train tab's repo axis and made it own
// its own transport — see `CiRepoStrip`'s module header. It is exported for
// tests and for a future repo-axis surface; the only render site today is
// `MergeTrainActivity`.
export { CiRepoStrip } from "./CiRepoStrip";
export {
  DevicePicker,
  deviceStateLabel,
  findRosterDevice,
  normalizeDeviceId,
} from "./DevicePicker";
export type { DevicePickerProps } from "./DevicePicker";
export { DeviceDrainControl } from "./DeviceDrainControl";
export type { DeviceDrainControlProps } from "./DeviceDrainControl";
export {
  DRAIN_PRESETS,
  MAX_DRAIN_DAYS,
  canActOnDrain,
  describeDrainError,
  formatDrainRemaining,
  parseDrainEntry,
  parseFleetDrain,
  resolveDeviceDrain,
  resolveDrainTarget,
  toLocalInputValue,
  validateDrainForm,
} from "./fleetDrain";
export type {
  DeviceDrainState,
  DrainEntry,
  DrainTarget,
  FleetDrainRead,
} from "./fleetDrain";
export {
  FLEET_DRAIN_API,
  FLEET_UNDRAIN_API,
  postDrain,
  postUndrain,
  useFleetDrain,
} from "./useFleetDrain";
export type { UseFleetDrainResult } from "./useFleetDrain";
export { FleetOverview } from "./FleetOverview";
export type { FleetOverviewProps } from "./FleetOverview";
export {
  DeviceCrossLinks,
  deviceStateBadgeVariant,
} from "./FleetHealthSummary";
export { FLEET_HEALTH_API, useFleetHealth } from "./useFleetHealth";
export type {
  FleetConditionsDomain,
  FleetHealthConditions,
  FleetHealthDevice,
  FleetHealthPayload,
  FleetHealthSettingInEffect,
  UseFleetHealthResult,
} from "./useFleetHealth";
export { summarizeFleetLiveness } from "./fleetLiveness";
export type { FleetLivenessLevel, FleetLivenessSummary } from "./fleetLiveness";
export { summarizeFleetConditions } from "./fleetConditions";
export type {
  FleetConditionsLevel,
  FleetConditionsState,
  FleetConditionsSummary,
} from "./fleetConditions";
export { FleetConditionsPanel } from "./FleetConditionsPanel";
export type { FleetConditionsPanelProps } from "./FleetConditionsPanel";
export { FleetResourcesSection } from "./FleetResourcesSection";
export { FleetTestTargetsPanel } from "./FleetTestTargetsPanel";
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
