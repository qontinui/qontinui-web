/**
 * Workflow Documentation Service
 *
 * Barrel export that re-exports everything from the split modules.
 * Single home of the workflow documentation service (types, generator,
 * formatter, exporter, templates); import it as
 * `@/services/workflow-documentation`.
 */

// Types
export type {
  WorkflowDocumentation,
  ActionComment,
  DocumentationVersion,
  DocumentationTemplate,
  VariableInfo,
  DependencyInfo,
  ComplexityMetrics,
  DocumentationSection,
  ExportOptions,
} from "./types";

// Service class
export { WorkflowDocumentationService } from "./service";

// Singleton export
import { WorkflowDocumentationService } from "./service";
export const workflowDocumentation = WorkflowDocumentationService.getInstance();
