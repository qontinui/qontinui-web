/**
 * Shared types for project optimization modules
 */

import type { ComplexityAnalysis } from '../workflow-complexity-analyzer';

// ============================================================================
// Health Types
// ============================================================================

/**
 * Project health score and breakdown
 */
export interface ProjectHealth {
  /** Overall health score (0-100) */
  score: number;

  /** Rating based on score */
  rating: 'critical' | 'poor' | 'fair' | 'good' | 'excellent';

  /** Individual factor scores */
  factors: {
    testCoverage: HealthFactor;
    documentationCoverage: HealthFactor;
    organization: HealthFactor;
    complexity: HealthFactor;
    unusedResources: HealthFactor;
    brokenReferences: HealthFactor;
  };

  /** Timestamp of analysis */
  timestamp: string;

  /** Total resources analyzed */
  totalResources: {
    workflows: number;
    states: number;
    images: number;
    transitions: number;
  };
}

/**
 * Individual health factor
 */
export interface HealthFactor {
  /** Score for this factor (0-100) */
  score: number;

  /** Weight in overall health calculation (%) */
  weight: number;

  /** Weighted contribution to total score */
  contribution: number;

  /** Status based on score */
  status: 'critical' | 'warning' | 'good' | 'excellent';

  /** Detailed breakdown */
  details: string;

  /** Issues found */
  issues?: string[];

  /** Suggestions for improvement */
  suggestions?: string[];
}

/**
 * Detailed health report
 */
export interface HealthReport {
  /** Overall health */
  health: ProjectHealth;

  /** Resource analyses */
  resources: {
    workflows: WorkflowAnalysis[];
    states: StateAnalysis[];
    images: ImageAnalysis[];
    transitions: TransitionAnalysis[];
  };

  /** All optimization suggestions */
  suggestions: OptimizationSuggestion[];

  /** All issues found */
  issues: ProjectIssue[];

  /** Storage breakdown */
  storage: StorageAnalysis;

  /** Generated at */
  generatedAt: string;
}

// ============================================================================
// Resource Analysis Types
// ============================================================================

/**
 * Workflow analysis result
 */
export interface WorkflowAnalysis {
  workflowId: string;
  name: string;

  /** Complexity metrics */
  complexity: ComplexityAnalysis;

  /** Has tests? */
  hasTesting: boolean;
  testCount: number;

  /** Has documentation? */
  hasDocumentation: boolean;

  /** Is organized in folder? */
  isOrganized: boolean;
  folderPath?: string;

  /** Number of dependencies */
  dependencyCount: number;

  /** Number of dependents */
  dependentCount: number;

  /** Is unused (never called)? */
  isUnused: boolean;

  /** Broken references found */
  brokenReferences: BrokenReference[];

  /** Overall status */
  status: 'healthy' | 'warning' | 'critical';

  /** Issues */
  issues: string[];
}

/**
 * State analysis result
 */
export interface StateAnalysis {
  stateId: string;
  name: string;

  /** Number of images */
  imageCount: number;

  /** Number of regions */
  regionCount: number;

  /** Number of locations */
  locationCount: number;

  /** Is used in transitions? */
  isUsed: boolean;
  usageCount: number;

  /** Has orphaned images? */
  hasOrphanedImages: boolean;
  orphanedImageIds: string[];

  /** Complexity score */
  complexityScore: number;

  /** Broken references */
  brokenReferences: BrokenReference[];

  /** Status */
  status: 'healthy' | 'warning' | 'critical';

  /** Issues */
  issues: string[];
}

/**
 * Image analysis result
 */
export interface ImageAnalysis {
  imageId: string;
  name: string;

  /** File size in bytes */
  size: number;

  /** Is used? */
  isUsed: boolean;

  /** Usage count */
  usageCount: number;

  /** Where it's used */
  usedIn: Array<{
    type: 'state' | 'workflow';
    id: string;
    name: string;
  }>;

  /** Potential duplicates */
  duplicates: DuplicateMatch[];

  /** Storage optimization potential */
  canOptimize: boolean;
  potentialSavings: number;

  /** Status */
  status: 'healthy' | 'warning' | 'critical';

  /** Issues */
  issues: string[];
}

/**
 * Transition analysis result
 */
export interface TransitionAnalysis {
  transitionId: string;

  /** References valid states? */
  hasValidStates: boolean;

  /** References valid workflows? */
  hasValidWorkflows: boolean;

  /** Broken references */
  brokenReferences: BrokenReference[];

  /** Is part of circular dependency? */
  isCircular: boolean;

  /** Status */
  status: 'healthy' | 'warning' | 'critical';

  /** Issues */
  issues: string[];
}

// ============================================================================
// Optimization Types
// ============================================================================

/**
 * Optimization suggestion
 */
export interface OptimizationSuggestion {
  /** Unique ID */
  id: string;

  /** Suggestion type */
  type:
    | 'delete-unused-images'
    | 'delete-unused-states'
    | 'delete-unused-workflows'
    | 'add-tests'
    | 'add-documentation'
    | 'organize-folders'
    | 'fix-broken-references'
    | 'reduce-complexity'
    | 'remove-orphaned-states'
    | 'consolidate-duplicates'
    | 'optimize-storage';

  /** Priority level */
  priority: 'low' | 'medium' | 'high' | 'critical';

  /** Human-readable title */
  title: string;

  /** Detailed description */
  description: string;

  /** Affected resource IDs */
  affectedResources: Array<{
    type: 'workflow' | 'state' | 'image' | 'transition';
    id: string;
    name: string;
  }>;

  /** Potential impact */
  impact: {
    /** Storage savings in bytes */
    storageSavings?: number;

    /** Performance improvement estimate */
    performanceGain?: 'low' | 'medium' | 'high';

    /** Maintainability improvement */
    maintainabilityGain?: 'low' | 'medium' | 'high';
  };

  /** Can be auto-fixed? */
  autoFixable: boolean;

  /** Auto-fix action */
  autoFixAction?: () => Promise<void>;
}

/**
 * Project issue
 */
export interface ProjectIssue {
  /** Issue ID */
  id: string;

  /** Severity */
  severity: 'error' | 'warning' | 'info';

  /** Issue type */
  type: 'broken-reference' | 'unused-resource' | 'missing-test' | 'missing-doc' | 'high-complexity' | 'duplicate';

  /** Message */
  message: string;

  /** Resource affected */
  resource: {
    type: 'workflow' | 'state' | 'image' | 'transition';
    id: string;
    name: string;
  };

  /** How to fix */
  fix?: string;
}

// ============================================================================
// Duplicate Detection Types
// ============================================================================

/**
 * Duplicate match result
 */
export interface DuplicateMatch {
  /** ID of potentially duplicate resource */
  id: string;

  /** Name */
  name: string;

  /** Similarity score (0-1) */
  similarity: number;

  /** Match type */
  matchType: 'exact' | 'similar' | 'potential';

  /** Details about the match */
  details?: string;
}

// ============================================================================
// Reference Types
// ============================================================================

/**
 * Broken reference
 */
export interface BrokenReference {
  /** Reference type */
  type: 'workflow' | 'state' | 'image' | 'action';

  /** Source resource */
  source: {
    type: 'workflow' | 'state' | 'transition';
    id: string;
    name: string;
  };

  /** Referenced ID that doesn't exist */
  referencedId: string;

  /** Reference location (e.g., action ID) */
  location?: string;

  /** Error message */
  message: string;
}

// ============================================================================
// Storage Types
// ============================================================================

/**
 * Storage analysis
 */
export interface StorageAnalysis {
  /** Total storage used (bytes) */
  total: number;

  /** Breakdown by resource type */
  byType: {
    images: number;
    workflows: number;
    states: number;
    transitions: number;
    tests: number;
    documentation: number;
    other: number;
  };

  /** Breakdown by folder/category */
  byFolder: Record<string, number>;

  /** Potential savings */
  potentialSavings: number;

  /** Unused resources storage */
  unusedStorage: number;

  /** Duplicate resources storage */
  duplicateStorage: number;
}

// ============================================================================
// Coverage Types
// ============================================================================

/**
 * Coverage report
 */
export interface CoverageReport {
  /** Test coverage */
  testCoverage: {
    overall: number;
    byFolder: Record<string, number>;
    untested: string[];
  };

  /** Documentation coverage */
  documentationCoverage: {
    overall: number;
    byFolder: Record<string, number>;
    undocumented: string[];
  };
}

// ============================================================================
// Complexity Types
// ============================================================================

/**
 * Complexity distribution report
 */
export interface ComplexityReport {
  /** Distribution histogram */
  distribution: {
    low: number;
    medium: number;
    high: number;
    veryHigh: number;
  };

  /** Average score */
  average: number;

  /** Median score */
  median: number;

  /** High complexity resources */
  highComplexity: Array<{
    id: string;
    name: string;
    type: 'workflow' | 'state';
    score: number;
  }>;
}

// ============================================================================
// Metrics Tracking Types
// ============================================================================

/**
 * Project metrics snapshot
 */
export interface ProjectMetrics {
  timestamp: string;
  healthScore: number;

  counts: {
    workflows: number;
    states: number;
    images: number;
    transitions: number;
  };

  coverage: {
    tests: number;
    documentation: number;
  };

  issues: {
    critical: number;
    warnings: number;
    info: number;
  };

  storage: number;
}

/**
 * Metrics trend
 */
export interface MetricsTrend {
  metrics: ProjectMetrics[];

  /** Trend direction */
  trend: {
    health: 'improving' | 'declining' | 'stable';
    coverage: 'improving' | 'declining' | 'stable';
    issues: 'improving' | 'declining' | 'stable';
  };

  /** Period */
  period: {
    start: string;
    end: string;
  };
}

// ============================================================================
// Auto-Optimization Types
// ============================================================================

/**
 * Auto-optimization options
 */
export interface AutoOptimizationOptions {
  /** Remove unused images */
  removeUnusedImages?: boolean;

  /** Remove orphaned states */
  removeOrphanedStates?: boolean;

  /** Fix broken references (where possible) */
  fixBrokenReferences?: boolean;

  /** Auto-organize into folders */
  organizeFolders?: boolean;

  /** Compress/optimize images */
  optimizeImages?: boolean;

  /** Remove duplicate resources */
  removeDuplicates?: boolean;

  /** Dry run (don't actually make changes) */
  dryRun?: boolean;
}

/**
 * Auto-optimization result
 */
export interface AutoOptimizationResult {
  /** Success */
  success: boolean;

  /** Changes made */
  changes: {
    imagesRemoved: number;
    statesRemoved: number;
    workflowsRemoved: number;
    referencesFixed: number;
    foldersCreated: number;
    storageSaved: number;
  };

  /** Errors encountered */
  errors: string[];

  /** Warnings */
  warnings: string[];

  /** Summary message */
  summary: string;
}

// ============================================================================
// Export Types
// ============================================================================

/**
 * Optimization report export
 */
export interface OptimizationReport {
  /** Report metadata */
  metadata: {
    generatedAt: string;
    projectName: string;
    version: string;
  };

  /** Health summary */
  health: ProjectHealth;

  /** All suggestions */
  suggestions: OptimizationSuggestion[];

  /** All issues */
  issues: ProjectIssue[];

  /** Resource counts */
  resources: {
    workflows: number;
    states: number;
    images: number;
    transitions: number;
  };

  /** Storage analysis */
  storage: StorageAnalysis;
}

// ============================================================================
// Health Alert Types
// ============================================================================

/**
 * Health alert configuration
 */
export interface HealthAlert {
  /** Alert ID */
  id: string;

  /** Alert type */
  type: 'health-drop' | 'critical-issue' | 'storage-limit' | 'complexity-spike';

  /** Threshold value */
  threshold: number;

  /** Enabled */
  enabled: boolean;

  /** Callback when triggered */
  callback?: (alert: HealthAlertTrigger) => void;
}

/**
 * Health alert trigger
 */
export interface HealthAlertTrigger {
  /** Alert that was triggered */
  alert: HealthAlert;

  /** Current value */
  currentValue: number;

  /** Previous value */
  previousValue: number;

  /** Timestamp */
  timestamp: string;

  /** Message */
  message: string;
}
