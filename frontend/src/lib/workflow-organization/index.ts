/**
 * Workflow Organization - Public API
 *
 * Central export point for all workflow organization features.
 * Import from this file to access types, utilities, and services.
 *
 * @example
 * ```typescript
 * import type { WorkflowFolder, TestCase, DependencyGraph } from '@/lib/workflow-organization';
 * ```
 */

// Re-export all types
export type {
  // Folder System
  WorkflowFolder,
  FolderTree,
  FolderPath,
  FolderPathComponent,

  // Dependencies
  DependencyType,
  WorkflowDependency,
  DependencyNode,
  DependencyEdge,
  DependencyGraph,
  CircularDependency,
  ImpactAnalysis,
  DependencyAnalysis,

  // Testing
  AssertionType,
  TestAssertion,
  TestStatus,
  TestCase,
  TestSuite,
  TestResult,
  TestSuiteResult,

  // Metrics & Analytics
  WorkflowMetrics,
  ComplexityMetrics,
  PerformanceBottleneck,
  PerformanceMetrics,
  TimeRange,
  AnalyticsData,

  // Documentation
  DocumentationSection,
  TocEntry,
  WorkflowDocumentation,
  ActionComment,

  // Version Control
  WorkflowBranch,
  ChangeType,
  VersionChange,
  WorkflowVersion,
  VersionDiff,

  // Collaboration
  WorkflowLock,
  WorkflowComment,
  ReviewStatus,
  ReviewRequest,

  // Search & Filter
  DateRangeFilter,
  ComplexityFilter,
  SearchFilter,
  SavedFilter,
  SearchResult,

  // Bulk Operations
  BulkOperationType,
  BulkOperationStatus,
  BulkOperation,
  BulkOperationItemResult,
  BulkOperationResult,

  // Utility Types
  WorkflowUpdate,
  FolderUpdate,
  TestCaseUpdate,
  ArrayElement,
  RequireProperties,
  OptionalProperties,
} from "./types";

// Re-export type guards
export {
  isAssertionPassed,
  isTestSuccessful,
  hasCircularDependencies,
  isRootFolder,
} from "./types";

// Re-export constants
export {
  COMPLEXITY_THRESHOLDS,
  DEFAULT_TEST_TIMEOUT,
  DEFAULT_LOCK_EXPIRATION,
  MAX_FOLDER_DEPTH,
  MAX_BULK_OPERATION_SIZE,
} from "./types";
