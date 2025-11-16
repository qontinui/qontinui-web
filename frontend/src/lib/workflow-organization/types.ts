/**
 * Workflow Organization - Type Definitions
 *
 * Comprehensive type system for workflow organization features including:
 * - Folder system and hierarchical organization
 * - Dependency tracking and analysis
 * - Testing framework and assertions
 * - Metrics, analytics, and performance monitoring
 * - Reusable components and subflows
 * - Documentation and collaboration
 * - Version control and branching
 * - Search, filtering, and bulk operations
 */

import type { Workflow, Action, ActionType } from '@/lib/action-schema/action-types';

// ============================================================================
// Folder System
// ============================================================================

/**
 * Workflow folder for hierarchical organization
 *
 * Folders can contain workflows and other folders, creating a tree structure
 * for organizing large numbers of workflows.
 */
export interface WorkflowFolder {
  /** Unique folder identifier */
  id: string;

  /** Folder name */
  name: string;

  /** Parent folder ID (null for root folders) */
  parentId: string | null;

  /** Full path from root (e.g., '/automation/login/flows') */
  path: string;

  /** Child folder IDs */
  children: string[];

  /** Workflow IDs contained in this folder */
  workflowIds: string[];

  /** Optional color for visual organization */
  color?: string;

  /** Optional icon for visual identification */
  icon?: string;

  /** When this folder was created */
  createdAt: string;

  /** When this folder was last updated */
  updatedAt: string;

  /** Optional description */
  description?: string;

  /** Custom metadata */
  metadata?: Record<string, any>;
}

/**
 * Tree structure representing folder hierarchy
 */
export interface FolderTree {
  /** The folder node */
  folder: WorkflowFolder;

  /** Child folder trees */
  children: FolderTree[];

  /** Workflows in this folder */
  workflows: Workflow[];

  /** Depth in the tree (root = 0) */
  depth: number;

  /** Whether this folder is expanded in the UI */
  expanded?: boolean;
}

/**
 * Breadcrumb path component for navigation
 */
export interface FolderPathComponent {
  /** Folder ID */
  id: string;

  /** Folder name */
  name: string;

  /** Path segment */
  path: string;
}

/**
 * Complete path from root to a specific folder
 */
export type FolderPath = FolderPathComponent[];

// ============================================================================
// Dependencies
// ============================================================================

/**
 * Type of dependency between workflows
 */
export type DependencyType =
  | 'workflow-call'     // Direct RUN_WORKFLOW action
  | 'subflow'           // Embedded subflow component
  | 'state-reference'   // Reference to shared state
  | 'variable-reference'; // Reference to shared variable

/**
 * Dependency relationship between two workflows
 *
 * Represents a directed edge from source to target workflow,
 * typically created by a RUN_WORKFLOW action.
 */
export interface WorkflowDependency {
  /** Source workflow ID (the one that depends on target) */
  sourceWorkflowId: string;

  /** Target workflow ID (the one being depended upon) */
  targetWorkflowId: string;

  /** Action ID that creates this dependency (e.g., RUN_WORKFLOW action) */
  actionId: string;

  /** Type of dependency */
  type: DependencyType;

  /** Optional context or metadata about the dependency */
  metadata?: Record<string, any>;
}

/**
 * Graph node in dependency visualization
 */
export interface DependencyNode {
  /** Workflow ID */
  id: string;

  /** Workflow name */
  name: string;

  /** Workflow reference */
  workflow: Workflow;

  /** Number of incoming dependencies */
  inDegree: number;

  /** Number of outgoing dependencies */
  outDegree: number;

  /** Level in the dependency hierarchy */
  level: number;

  /** Position for graph visualization */
  position?: { x: number; y: number };
}

/**
 * Graph edge in dependency visualization
 */
export interface DependencyEdge {
  /** Source workflow ID */
  source: string;

  /** Target workflow ID */
  target: string;

  /** Dependency details */
  dependency: WorkflowDependency;

  /** Visual weight/thickness for rendering */
  weight?: number;
}

/**
 * Complete dependency graph
 */
export interface DependencyGraph {
  /** All workflow nodes */
  nodes: DependencyNode[];

  /** All dependency edges */
  edges: DependencyEdge[];

  /** Root workflows (no incoming dependencies) */
  roots: string[];

  /** Leaf workflows (no outgoing dependencies) */
  leaves: string[];
}

/**
 * Circular dependency path
 */
export interface CircularDependency {
  /** Workflow IDs in the cycle */
  cycle: string[];

  /** Workflow names in the cycle */
  names: string[];

  /** Dependencies that form the cycle */
  dependencies: WorkflowDependency[];
}

/**
 * Impact analysis for a workflow change
 */
export interface ImpactAnalysis {
  /** Workflow being analyzed */
  workflowId: string;

  /** Direct dependents (workflows that directly call this one) */
  directDependents: string[];

  /** All transitive dependents (entire dependency tree) */
  transitiveDependents: string[];

  /** Estimated number of workflows affected */
  affectedCount: number;

  /** Risk level based on dependency count */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Complete dependency analysis results
 */
export interface DependencyAnalysis {
  /** Dependency graph */
  graph: DependencyGraph;

  /** Circular dependencies found */
  circular: CircularDependency[];

  /** Workflows with no dependencies (candidates for deletion) */
  unused: string[];

  /** Impact map for each workflow */
  impactMap: Map<string, ImpactAnalysis>;

  /** Analysis timestamp */
  timestamp: string;
}

// ============================================================================
// Testing
// ============================================================================

/**
 * Test assertion types
 */
export type AssertionType =
  | 'equals'          // Exact equality
  | 'notEquals'       // Inequality
  | 'contains'        // String/array contains
  | 'notContains'     // Does not contain
  | 'exists'          // Value exists (not null/undefined)
  | 'notExists'       // Value doesn't exist
  | 'greaterThan'     // Numeric comparison
  | 'lessThan'        // Numeric comparison
  | 'greaterOrEqual'  // Numeric comparison
  | 'lessOrEqual'     // Numeric comparison
  | 'matches'         // Regex match
  | 'hasProperty'     // Object has property
  | 'hasLength'       // Array/string length
  | 'isType';         // Type checking

/**
 * Test assertion definition
 */
export interface TestAssertion {
  /** Assertion type */
  type: AssertionType;

  /** Path to value in workflow output/variables (e.g., 'output.result.count') */
  path: string;

  /** Expected value */
  expected: any;

  /** Actual value (filled during test execution) */
  actual?: any;

  /** Human-readable description */
  description?: string;

  /** Whether assertion passed */
  passed?: boolean;

  /** Error message if failed */
  error?: string;
}

/**
 * Test case status
 */
export type TestStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'error';

/**
 * Test case for a workflow
 */
export interface TestCase {
  /** Unique test case identifier */
  id: string;

  /** Test case name */
  name: string;

  /** Workflow ID being tested */
  workflowId: string;

  /** Test description */
  description?: string;

  /** Input variables/parameters for the test */
  inputs: Record<string, any>;

  /** Expected outputs/results */
  expectedOutputs?: Record<string, any>;

  /** Assertions to validate */
  assertions: TestAssertion[];

  /** Test status */
  status: TestStatus;

  /** When test was last run */
  lastRun?: string;

  /** Initial screenshot ID for integration test */
  initialScreenshotId?: string;

  /** Initial state IDs for integration test */
  initialStateIds?: string[];

  /** Tags for organization */
  tags?: string[];

  /** Whether test is enabled */
  enabled: boolean;

  /** Timeout in milliseconds */
  timeout?: number;

  /** Custom metadata */
  metadata?: Record<string, any>;
}

/**
 * Test suite - collection of related test cases
 */
export interface TestSuite {
  /** Unique test suite identifier */
  id: string;

  /** Suite name */
  name: string;

  /** Suite description */
  description?: string;

  /** Test cases in this suite */
  testCases: string[];

  /** Tags for organization and filtering */
  tags?: string[];

  /** Scheduled execution (cron expression) */
  schedule?: string;

  /** When suite was created */
  createdAt: string;

  /** When suite was last updated */
  updatedAt: string;

  /** Custom metadata */
  metadata?: Record<string, any>;
}

/**
 * Test execution result
 */
export interface TestResult {
  /** Test case ID */
  testCaseId: string;

  /** Execution status */
  status: TestStatus;

  /** Execution duration in milliseconds */
  duration: number;

  /** Error message/stack if failed */
  error?: string;

  /** When test was executed */
  timestamp: string;

  /** Execution logs */
  logs?: string[];

  /** Screenshots captured during test */
  screenshots?: string[];

  /** Assertion results */
  assertions?: TestAssertion[];

  /** Output variables */
  outputs?: Record<string, any>;

  /** Custom metadata */
  metadata?: Record<string, any>;
}

/**
 * Test suite execution summary
 */
export interface TestSuiteResult {
  /** Test suite ID */
  suiteId: string;

  /** Individual test results */
  results: TestResult[];

  /** Total number of tests */
  total: number;

  /** Number of passed tests */
  passed: number;

  /** Number of failed tests */
  failed: number;

  /** Number of skipped tests */
  skipped: number;

  /** Total execution duration */
  duration: number;

  /** When suite was executed */
  timestamp: string;

  /** Overall success rate */
  successRate: number;
}

// ============================================================================
// Metrics & Analytics
// ============================================================================

/**
 * Workflow execution metrics
 */
export interface WorkflowMetrics {
  /** Workflow ID */
  workflowId: string;

  /** Total number of executions */
  executionCount: number;

  /** Average execution duration in milliseconds */
  avgDuration: number;

  /** Minimum execution duration */
  minDuration: number;

  /** Maximum execution duration */
  maxDuration: number;

  /** Success rate (0-1) */
  successRate: number;

  /** Error rate (0-1) */
  errorRate: number;

  /** When workflow was last run */
  lastRun?: string;

  /** Last execution status */
  lastStatus?: 'success' | 'failure' | 'error';

  /** Execution count by time period */
  executionsByPeriod?: {
    day: number;
    week: number;
    month: number;
  };
}

/**
 * Workflow complexity metrics
 */
export interface ComplexityMetrics {
  /** Workflow ID */
  workflowId: string;

  /** Total number of actions */
  actionCount: number;

  /** Number of connections */
  connectionCount: number;

  /** Maximum depth of execution tree */
  maxDepth: number;

  /** Branching factor (average number of outputs per action) */
  branchingFactor: number;

  /** Cyclomatic complexity (number of decision points) */
  cyclomaticComplexity: number;

  /** Overall complexity score (0-100) */
  score: number;

  /** Complexity rating */
  rating: 'simple' | 'moderate' | 'complex' | 'very-complex';

  /** Action type distribution */
  actionTypeDistribution: Record<ActionType, number>;
}

/**
 * Performance bottleneck identification
 */
export interface PerformanceBottleneck {
  /** Action ID */
  actionId: string;

  /** Action type */
  actionType: ActionType;

  /** Average duration */
  avgDuration: number;

  /** Percentage of total workflow time */
  percentageOfTotal: number;

  /** Suggested optimization */
  suggestion?: string;
}

/**
 * Performance metrics and analysis
 */
export interface PerformanceMetrics {
  /** Workflow ID */
  workflowId: string;

  /** Slowest actions in the workflow */
  slowestActions: PerformanceBottleneck[];

  /** Identified bottlenecks */
  bottlenecks: PerformanceBottleneck[];

  /** Optimization suggestions */
  suggestions: string[];

  /** Memory usage (if available) */
  memoryUsage?: {
    average: number;
    peak: number;
    unit: 'MB' | 'GB';
  };
}

/**
 * Time range for analytics
 */
export interface TimeRange {
  /** Start timestamp */
  start: string;

  /** End timestamp */
  end: string;

  /** Granularity */
  granularity: 'hour' | 'day' | 'week' | 'month';
}

/**
 * Aggregated analytics data
 */
export interface AnalyticsData {
  /** Time range for this data */
  timeRange: TimeRange;

  /** Per-workflow metrics */
  workflows: Map<string, WorkflowMetrics>;

  /** Aggregated statistics */
  aggregated: {
    /** Total executions across all workflows */
    totalExecutions: number;

    /** Average success rate */
    avgSuccessRate: number;

    /** Most executed workflows */
    topWorkflows: Array<{ workflowId: string; count: number }>;

    /** Most failed workflows */
    problemWorkflows: Array<{ workflowId: string; errorRate: number }>;

    /** Execution trends over time */
    trends: Array<{
      timestamp: string;
      executions: number;
      successRate: number;
    }>;
  };

  /** When analytics were calculated */
  calculatedAt: string;
}

// ============================================================================
// Reusable Components
// ============================================================================

/**
 * Parameter definition for a component
 */
export interface ComponentParameter {
  /** Parameter name */
  name: string;

  /** Parameter data type */
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any';

  /** Whether parameter is required */
  required: boolean;

  /** Default value if not provided */
  defaultValue?: any;

  /** Human-readable description */
  description?: string;

  /** Validation rules */
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    enum?: any[];
  };
}

/**
 * Reusable subflow component
 *
 * A subflow is a reusable piece of workflow logic that can be
 * embedded in multiple workflows, similar to a function.
 */
export interface SubflowComponent {
  /** Unique component identifier */
  id: string;

  /** Component name */
  name: string;

  /** Component description */
  description?: string;

  /** Actions that make up this component */
  actions: Action[];

  /** Input parameters */
  parameters: ComponentParameter[];

  /** Output parameters */
  outputs?: ComponentParameter[];

  /** Tags for categorization */
  tags?: string[];

  /** Category for organization */
  category?: string;

  /** Number of times this component is used */
  usageCount: number;

  /** When component was created */
  createdAt: string;

  /** When component was last updated */
  updatedAt: string;

  /** Version of the component */
  version: string;

  /** Author */
  author?: string;

  /** Icon for visual identification */
  icon?: string;

  /** Custom metadata */
  metadata?: Record<string, any>;
}

/**
 * Component library for organizing reusable components
 */
export interface ComponentLibrary {
  /** Library name */
  name: string;

  /** Library description */
  description?: string;

  /** Components in this library */
  components: SubflowComponent[];

  /** Categories for organization */
  categories: string[];

  /** When library was created */
  createdAt: string;

  /** When library was last updated */
  updatedAt: string;

  /** Custom metadata */
  metadata?: Record<string, any>;
}

/**
 * Component usage reference
 */
export interface ComponentUsage {
  /** Component ID */
  componentId: string;

  /** Workflow ID where it's used */
  workflowId: string;

  /** Action ID where it's instantiated */
  actionId: string;

  /** Parameter values passed to the component */
  parameterValues: Record<string, any>;
}

// ============================================================================
// Documentation
// ============================================================================

/**
 * Documentation section
 */
export interface DocumentationSection {
  /** Section ID */
  id: string;

  /** Section title */
  title: string;

  /** Section content (markdown) */
  content: string;

  /** Subsections */
  subsections?: DocumentationSection[];

  /** Order/position */
  order: number;
}

/**
 * Table of contents entry
 */
export interface TocEntry {
  /** Section ID */
  id: string;

  /** Section title */
  title: string;

  /** Heading level (1-6) */
  level: number;

  /** Child entries */
  children?: TocEntry[];
}

/**
 * Workflow documentation
 */
export interface WorkflowDocumentation {
  /** Workflow ID */
  workflowId: string;

  /** Main documentation content (markdown) */
  content: string;

  /** Structured sections */
  sections?: DocumentationSection[];

  /** Table of contents */
  toc?: TocEntry[];

  /** When documentation was last updated */
  lastUpdated: string;

  /** Who last updated the documentation */
  author?: string;

  /** Documentation version */
  version?: string;

  /** Related resources/links */
  relatedLinks?: Array<{
    title: string;
    url: string;
    type: 'internal' | 'external';
  }>;

  /** Custom metadata */
  metadata?: Record<string, any>;
}

/**
 * Comment on a specific action
 */
export interface ActionComment {
  /** Comment ID */
  id: string;

  /** Action ID */
  actionId: string;

  /** Comment text */
  comment: string;

  /** Author */
  author: string;

  /** When comment was created */
  timestamp: string;

  /** Whether comment is resolved */
  resolved?: boolean;

  /** Thread of replies */
  replies?: ActionComment[];
}

// ============================================================================
// Version Control
// ============================================================================

/**
 * Workflow branch for parallel development
 */
export interface WorkflowBranch {
  /** Unique branch identifier */
  id: string;

  /** Branch name */
  name: string;

  /** Parent branch ID (null for main branch) */
  parentBranch: string | null;

  /** Workflow ID this branch belongs to */
  workflowId: string;

  /** When branch was created */
  createdAt: string;

  /** Who created the branch */
  createdBy?: string;

  /** Whether this is the active branch */
  isActive: boolean;

  /** Whether this branch is merged */
  isMerged: boolean;

  /** Custom metadata */
  metadata?: Record<string, any>;
}

/**
 * Change type in a version
 */
export type ChangeType =
  | 'action-added'
  | 'action-removed'
  | 'action-modified'
  | 'connection-added'
  | 'connection-removed'
  | 'metadata-changed'
  | 'settings-changed';

/**
 * Individual change in a version
 */
export interface VersionChange {
  /** Change type */
  type: ChangeType;

  /** Path to changed element */
  path: string;

  /** Previous value */
  oldValue?: any;

  /** New value */
  newValue?: any;

  /** Human-readable description */
  description?: string;
}

/**
 * Workflow version/snapshot
 */
export interface WorkflowVersion {
  /** Version identifier (semantic version or hash) */
  version: string;

  /** When version was created */
  timestamp: string;

  /** Who created this version */
  author?: string;

  /** List of changes in this version */
  changes: VersionChange[];

  /** Branch ID if applicable */
  branchId?: string;

  /** Commit message */
  message?: string;

  /** Complete workflow snapshot */
  snapshot: Workflow;

  /** Parent version */
  parentVersion?: string;

  /** Tags for this version */
  tags?: string[];

  /** Custom metadata */
  metadata?: Record<string, any>;
}

/**
 * Diff between two versions
 */
export interface VersionDiff {
  /** Actions added */
  added: Action[];

  /** Actions removed */
  removed: Action[];

  /** Actions modified */
  modified: Array<{
    actionId: string;
    oldAction: Action;
    newAction: Action;
    changes: VersionChange[];
  }>;

  /** Connections added */
  connectionsAdded: Array<{
    source: string;
    target: string;
  }>;

  /** Connections removed */
  connectionsRemoved: Array<{
    source: string;
    target: string;
  }>;

  /** Metadata changes */
  metadataChanges?: VersionChange[];

  /** Summary statistics */
  summary: {
    actionsAdded: number;
    actionsRemoved: number;
    actionsModified: number;
    connectionsChanged: number;
  };
}

// ============================================================================
// Collaboration (Future)
// ============================================================================

/**
 * Workflow lock for preventing concurrent edits
 */
export interface WorkflowLock {
  /** Workflow ID */
  workflowId: string;

  /** User ID who has the lock */
  userId: string;

  /** User name */
  userName: string;

  /** When lock was acquired */
  timestamp: string;

  /** When lock expires */
  expiresAt?: string;

  /** Lock type */
  type: 'edit' | 'view';
}

/**
 * Comment on a workflow (for collaboration)
 */
export interface WorkflowComment {
  /** Comment ID */
  id: string;

  /** Workflow ID */
  workflowId: string;

  /** Author user ID */
  author: string;

  /** Author name */
  authorName: string;

  /** Comment content */
  content: string;

  /** Position in workflow (for visual comments) */
  position?: { x: number; y: number };

  /** Related action ID if comment is on specific action */
  actionId?: string;

  /** When comment was created */
  timestamp: string;

  /** Whether comment is resolved */
  resolved: boolean;

  /** Thread of replies */
  replies?: WorkflowComment[];

  /** Mentions (@user) */
  mentions?: string[];
}

/**
 * Review request status
 */
export type ReviewStatus = 'pending' | 'approved' | 'changes-requested' | 'rejected';

/**
 * Workflow review request
 */
export interface ReviewRequest {
  /** Review request ID */
  id: string;

  /** Workflow ID being reviewed */
  workflowId: string;

  /** Version being reviewed */
  version?: string;

  /** Author requesting review */
  author: string;

  /** Author name */
  authorName: string;

  /** Reviewers (user IDs) */
  reviewers: string[];

  /** Review status */
  status: ReviewStatus;

  /** Comments from reviewers */
  comments: WorkflowComment[];

  /** When review was requested */
  requestedAt: string;

  /** When review was completed */
  completedAt?: string;

  /** Description of changes */
  description?: string;

  /** Custom metadata */
  metadata?: Record<string, any>;
}

// ============================================================================
// Search & Filter
// ============================================================================

/**
 * Date range filter
 */
export interface DateRangeFilter {
  /** Start date */
  start?: string;

  /** End date */
  end?: string;

  /** Preset (e.g., 'last-7-days', 'last-month') */
  preset?: 'today' | 'yesterday' | 'last-7-days' | 'last-30-days' | 'last-90-days' | 'custom';
}

/**
 * Complexity filter
 */
export interface ComplexityFilter {
  /** Minimum action count */
  minActions?: number;

  /** Maximum action count */
  maxActions?: number;

  /** Complexity rating */
  rating?: Array<'simple' | 'moderate' | 'complex' | 'very-complex'>;

  /** Minimum complexity score */
  minScore?: number;

  /** Maximum complexity score */
  maxScore?: number;
}

/**
 * Search and filter criteria
 */
export interface SearchFilter {
  /** Text search query */
  text?: string;

  /** Search in specific fields */
  fields?: Array<'name' | 'description' | 'tags' | 'author' | 'content'>;

  /** Filter by tags */
  tags?: string[];

  /** Filter by folders */
  folders?: string[];

  /** Filter by date range */
  dateRange?: DateRangeFilter;

  /** Filter by action types used */
  actionTypes?: ActionType[];

  /** Filter by complexity */
  complexity?: ComplexityFilter;

  /** Filter by category */
  categories?: string[];

  /** Filter by author */
  authors?: string[];

  /** Filter by status */
  status?: Array<'active' | 'archived' | 'draft'>;

  /** Sort field */
  sortBy?: 'name' | 'created' | 'updated' | 'executions' | 'complexity';

  /** Sort direction */
  sortOrder?: 'asc' | 'desc';

  /** Maximum results to return */
  limit?: number;

  /** Offset for pagination */
  offset?: number;
}

/**
 * Saved filter/search preset
 */
export interface SavedFilter {
  /** Saved filter ID */
  id: string;

  /** Filter name */
  name: string;

  /** Filter criteria */
  filter: SearchFilter;

  /** Who created this filter */
  createdBy?: string;

  /** When filter was created */
  createdAt: string;

  /** Whether filter is shared with team */
  isShared: boolean;

  /** Custom metadata */
  metadata?: Record<string, any>;
}

/**
 * Search result
 */
export interface SearchResult {
  /** Matching workflows */
  workflows: Array<{
    workflow: Workflow;
    score: number;
    highlights?: Record<string, string[]>;
  }>;

  /** Total number of matches */
  total: number;

  /** Applied filter */
  filter: SearchFilter;

  /** Execution time in milliseconds */
  executionTime: number;

  /** Facets for refinement */
  facets?: {
    tags: Map<string, number>;
    folders: Map<string, number>;
    actionTypes: Map<ActionType, number>;
    authors: Map<string, number>;
  };
}

// ============================================================================
// Bulk Operations
// ============================================================================

/**
 * Bulk operation type
 */
export type BulkOperationType =
  | 'move'        // Move to folder
  | 'tag'         // Add/remove tags
  | 'delete'      // Delete workflows
  | 'archive'     // Archive workflows
  | 'export'      // Export workflows
  | 'test'        // Run tests
  | 'duplicate'   // Duplicate workflows
  | 'update';     // Update metadata/settings

/**
 * Bulk operation status
 */
export type BulkOperationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'partial';

/**
 * Bulk operation configuration
 */
export interface BulkOperation {
  /** Operation type */
  type: BulkOperationType;

  /** Workflow IDs to operate on */
  workflowIds: string[];

  /** Operation-specific parameters */
  parameters: Record<string, any>;

  /** Whether to confirm before executing */
  requireConfirmation?: boolean;
}

/**
 * Individual item result in bulk operation
 */
export interface BulkOperationItemResult {
  /** Workflow ID */
  workflowId: string;

  /** Whether operation succeeded for this item */
  success: boolean;

  /** Error message if failed */
  error?: string;

  /** Additional result data */
  data?: any;
}

/**
 * Result of bulk operation
 */
export interface BulkOperationResult {
  /** Operation that was performed */
  operation: BulkOperation;

  /** Overall status */
  status: BulkOperationStatus;

  /** Individual item results */
  results: BulkOperationItemResult[];

  /** Number of successful operations */
  successCount: number;

  /** Number of failed operations */
  failureCount: number;

  /** Total execution time in milliseconds */
  duration: number;

  /** When operation started */
  startedAt: string;

  /** When operation completed */
  completedAt?: string;

  /** Overall error message if operation failed */
  error?: string;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a test assertion passed
 */
export function isAssertionPassed(assertion: TestAssertion): boolean {
  return assertion.passed === true;
}

/**
 * Type guard to check if a test result is successful
 */
export function isTestSuccessful(result: TestResult): boolean {
  return result.status === 'passed';
}

/**
 * Type guard to check if a workflow has circular dependencies
 */
export function hasCircularDependencies(analysis: DependencyAnalysis): boolean {
  return analysis.circular.length > 0;
}

/**
 * Type guard to check if a folder is a root folder
 */
export function isRootFolder(folder: WorkflowFolder): boolean {
  return folder.parentId === null;
}

/**
 * Type guard to check if a component is used
 */
export function isComponentUsed(component: SubflowComponent): boolean {
  return component.usageCount > 0;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Partial update type for workflows
 */
export type WorkflowUpdate = Partial<Omit<Workflow, 'id' | 'version' | 'format'>>;

/**
 * Partial update type for folders
 */
export type FolderUpdate = Partial<Omit<WorkflowFolder, 'id' | 'createdAt'>>;

/**
 * Partial update type for test cases
 */
export type TestCaseUpdate = Partial<Omit<TestCase, 'id' | 'workflowId'>>;

/**
 * Extract type from array
 */
export type ArrayElement<T> = T extends Array<infer U> ? U : never;

/**
 * Make specific properties required
 */
export type RequireProperties<T, K extends keyof T> = T & Required<Pick<T, K>>;

/**
 * Make specific properties optional
 */
export type OptionalProperties<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// ============================================================================
// Constants
// ============================================================================

/**
 * Default complexity thresholds
 */
export const COMPLEXITY_THRESHOLDS = {
  SIMPLE: { maxActions: 10, maxScore: 25 },
  MODERATE: { maxActions: 25, maxScore: 50 },
  COMPLEX: { maxActions: 50, maxScore: 75 },
  VERY_COMPLEX: { maxActions: Infinity, maxScore: 100 },
} as const;

/**
 * Default test timeout in milliseconds
 */
export const DEFAULT_TEST_TIMEOUT = 60000; // 60 seconds

/**
 * Default lock expiration time in milliseconds
 */
export const DEFAULT_LOCK_EXPIRATION = 300000; // 5 minutes

/**
 * Maximum folder nesting depth
 */
export const MAX_FOLDER_DEPTH = 10;

/**
 * Maximum workflows per bulk operation
 */
export const MAX_BULK_OPERATION_SIZE = 100;
