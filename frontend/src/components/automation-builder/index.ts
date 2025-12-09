/**
 * Automation Builder - Public Exports
 *
 * Barrel export for the unified automation builder module.
 */

// Types
export * from "./types";

// Hooks
export { useItemManagement } from "./hooks/useItemManagement";
export { useModeDetection } from "./hooks/useModeDetection";
export { useFormatConversion } from "./hooks/useFormatConversion";

// Components
export { EmptyState } from "./components/EmptyState";
export { SequentialEditor } from "./components/SequentialEditor";
export { GraphEditor } from "./components/GraphEditor";
export {
  BuilderModeSelector,
  CompactModeSelector,
} from "./components/BuilderModeSelector";
export { ItemMetadataPanel } from "./components/ItemMetadataPanel";
export { EditorToolbar, CompactToolbar } from "./components/EditorToolbar";
export { EdgePropertiesPanel } from "./components/EdgePropertiesPanel";

// Main component
export { AutomationBuilder } from "./AutomationBuilder";
