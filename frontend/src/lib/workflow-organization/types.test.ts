/**
 * Type validation test for workflow-organization types
 * This file verifies that all types compile and can be used correctly
 *
 * Note: These imports are intentionally unused - the test validates
 * that the types can be imported and compile correctly.
 */

import type {
  // Folder System
  WorkflowFolder as _WorkflowFolder,
  FolderTree as _FolderTree,
  FolderPath as _FolderPath,

  // Dependencies
  WorkflowDependency as _WorkflowDependency,
  DependencyGraph as _DependencyGraph,
  DependencyAnalysis as _DependencyAnalysis,

  // Testing
  TestCase as _TestCase,
  TestSuite as _TestSuite,
  TestResult as _TestResult,
  TestAssertion as _TestAssertion,

  // Metrics & Analytics
  WorkflowMetrics as _WorkflowMetrics,
  ComplexityMetrics as _ComplexityMetrics,
  PerformanceMetrics as _PerformanceMetrics,
  AnalyticsData as _AnalyticsData,

  // Reusable Components
  SubflowComponent as _SubflowComponent,
  ComponentParameter as _ComponentParameter,
  ComponentLibrary as _ComponentLibrary,

  // Documentation
  WorkflowDocumentation as _WorkflowDocumentation,
  ActionComment as _ActionComment,

  // Version Control
  WorkflowBranch as _WorkflowBranch,
  WorkflowVersion as _WorkflowVersion,
  VersionDiff as _VersionDiff,

  // Collaboration
  WorkflowLock as _WorkflowLock,
  WorkflowComment as _WorkflowComment,
  ReviewRequest as _ReviewRequest,

  // Search & Filter
  SearchFilter as _SearchFilter,
  SavedFilter as _SavedFilter,
  SearchResult as _SearchResult,

  // Bulk Operations
  BulkOperation as _BulkOperation,
  BulkOperationResult as _BulkOperationResult,

  // Constants
  COMPLEXITY_THRESHOLDS as _COMPLEXITY_THRESHOLDS,
  DEFAULT_TEST_TIMEOUT as _DEFAULT_TEST_TIMEOUT,
} from "./types";

// Type compilation verification - types are imported above to verify they compile
