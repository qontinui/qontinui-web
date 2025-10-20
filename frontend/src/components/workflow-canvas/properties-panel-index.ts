/**
 * Properties Panel - Export Index
 *
 * Central export point for all properties panel components and utilities
 */

// Main Components
export { CanvasPropertiesPanel } from './CanvasPropertiesPanel';
export type { CanvasPropertiesPanelProps } from './CanvasPropertiesPanel';

export { WorkflowProperties } from './WorkflowProperties';
export type { WorkflowPropertiesProps } from './WorkflowProperties';

export { MultiSelectProperties } from './MultiSelectProperties';
export type { MultiSelectPropertiesProps } from './MultiSelectProperties';

export { ConnectionProperties } from './ConnectionProperties';
export type { ConnectionPropertiesProps } from './ConnectionProperties';

export { QuickEditPopover } from './QuickEditPopover';
export type { QuickEditPopoverProps } from './QuickEditPopover';

export { PropertyHistory } from './PropertyHistory';
export type { PropertyHistoryProps } from './PropertyHistory';

// Adapters and Hooks
export {
  usePropertyAdapter,
  useMultiPropertyAdapter,
  PropertyEditorWrapper,
} from './property-adapter';
export type {
  PropertyAdapterResult,
  MultiPropertyAdapterResult,
  PropertyEditorWrapperProps,
} from './property-adapter';

// Validation
export {
  validateAction,
  validateProperty,
  getValidationRules,
  registerValidator,
  clearValidators,
  // Validators
  required,
  numberRange,
  minValue,
  maxValue,
  stringLength,
  pattern,
  enumValue,
  arrayLength,
  custom,
} from './property-validation';
export type {
  ValidationSeverity,
  ValidationError,
  ValidationResult,
  ValidatorFunction,
} from './property-validation';

// Store
export {
  usePropertiesPanelStore,
  useIsSectionCollapsed,
  usePanelDimensions,
  useUnsavedChangesCount,
} from '../../stores/properties-panel-store';
export type {
  PanelPosition,
  UnsavedChange,
  PropertiesPanelState,
  PropertiesPanelActions,
  PropertiesPanelStore,
} from '../../stores/properties-panel-store';
