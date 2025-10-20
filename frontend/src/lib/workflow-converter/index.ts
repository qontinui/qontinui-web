/**
 * Workflow Converter Module
 *
 * Provides bidirectional conversion between sequential and graph workflow formats:
 * - Graph to Sequential: Convert graph workflows to sequential format
 * - Sequential to Graph: Convert sequential actions to graph workflows with auto-layout
 *
 * @module workflow-converter
 */

// Graph to Sequential conversion
export { GraphToSequentialConverter } from './graph-to-sequential-converter';
export type { ConversionOptions } from './graph-to-sequential-converter';

export { LinearizabilityChecker } from './linearizability-checker';
export type { LinearizabilityResult } from './linearizability-checker';

export { PatternDetector } from './pattern-detector';
export type { IfPattern, LoopPattern } from './pattern-detector';

export { NonLinearWorkflowError, WorkflowValidationError } from './errors';

// Sequential to Graph conversion
export {
  SequentialToGraphConverter,
  convertSequentialToGraph,
  type ConverterOptions,
  type ConversionResult,
} from './sequential-to-graph-converter';

// Auto-layout
export {
  AutoLayout,
  layoutActions,
  type LayoutOptions,
} from './auto-layout';
