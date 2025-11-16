/**
 * Type validation test for workflow-organization types
 * This file verifies that all types compile and can be used correctly
 */

import type {
  // Folder System
  WorkflowFolder,
  FolderTree,
  FolderPath,

  // Dependencies
  WorkflowDependency,
  DependencyGraph,
  DependencyAnalysis,

  // Testing
  TestCase,
  TestSuite,
  TestResult,
  TestAssertion,

  // Metrics & Analytics
  WorkflowMetrics,
  ComplexityMetrics,
  PerformanceMetrics,
  AnalyticsData,

  // Reusable Components
  SubflowComponent,
  ComponentParameter,
  ComponentLibrary,

  // Documentation
  WorkflowDocumentation,
  ActionComment,

  // Version Control
  WorkflowBranch,
  WorkflowVersion,
  VersionDiff,

  // Collaboration
  WorkflowLock,
  WorkflowComment,
  ReviewRequest,

  // Search & Filter
  SearchFilter,
  SavedFilter,
  SearchResult,

  // Bulk Operations
  BulkOperation,
  BulkOperationResult,

  // Constants
  COMPLEXITY_THRESHOLDS,
  DEFAULT_TEST_TIMEOUT,
} from './types';

// Type compilation verification
const _typeCheck = true;
