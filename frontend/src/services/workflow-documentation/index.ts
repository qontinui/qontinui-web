/**
 * Workflow Documentation Service
 *
 * Barrel export that re-exports everything from the split modules.
 * This replaces the original workflow-documentation-service.ts file.
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
