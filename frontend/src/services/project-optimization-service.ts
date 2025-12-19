/**
 * Project Optimization and Health Monitoring Service
 *
 * Comprehensive service for analyzing project health, detecting issues,
 * and providing optimization suggestions across all resource types.
 *
 * Features:
 * - Project health scoring (0-100)
 * - Resource analysis (workflows, states, images, transitions)
 * - Unused resource detection
 * - Duplicate detection
 * - Broken reference validation
 * - Storage analysis
 * - Complexity analysis
 * - Coverage analysis (tests, documentation)
 * - Dependency impact analysis
 * - Auto-optimization capabilities
 * - Metrics tracking over time
 * - Health alerts
 */

import type { Workflow } from "@/lib/action-schema/action-types";
import type {
  State,
  ImageAsset,
  Transition,
} from "@/contexts/automation-context/types";
import {
  workflowComplexityAnalyzer,
  ComplexityAnalysis,
} from "./workflow-complexity-analyzer";
import { WorkflowDependencyAnalyzer } from "./workflow-dependency-analyzer";
import { WorkflowDocumentationService } from "./workflow-documentation-service";
import { getWorkflowTestingService } from "./workflow-testing-service";

// ============================================================================
// Core Types
// ============================================================================

/**
 * Project health score and breakdown
 */
export interface ProjectHealth {
  /** Overall health score (0-100) */
  score: number;

  /** Rating based on score */
  rating: "critical" | "poor" | "fair" | "good" | "excellent";

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
  status: "critical" | "warning" | "good" | "excellent";

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
  status: "healthy" | "warning" | "critical";

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
  status: "healthy" | "warning" | "critical";

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
    type: "state" | "workflow";
    id: string;
    name: string;
  }>;

  /** Potential duplicates */
  duplicates: DuplicateMatch[];

  /** Storage optimization potential */
  canOptimize: boolean;
  potentialSavings: number;

  /** Status */
  status: "healthy" | "warning" | "critical";

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
  status: "healthy" | "warning" | "critical";

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
    | "delete-unused-images"
    | "delete-unused-states"
    | "delete-unused-workflows"
    | "add-tests"
    | "add-documentation"
    | "organize-folders"
    | "fix-broken-references"
    | "reduce-complexity"
    | "remove-orphaned-states"
    | "consolidate-duplicates"
    | "optimize-storage";

  /** Priority level */
  priority: "low" | "medium" | "high" | "critical";

  /** Human-readable title */
  title: string;

  /** Detailed description */
  description: string;

  /** Affected resource IDs */
  affectedResources: Array<{
    type: "workflow" | "state" | "image" | "transition";
    id: string;
    name: string;
  }>;

  /** Potential impact */
  impact: {
    /** Storage savings in bytes */
    storageSavings?: number;

    /** Performance improvement estimate */
    performanceGain?: "low" | "medium" | "high";

    /** Maintainability improvement */
    maintainabilityGain?: "low" | "medium" | "high";
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
  severity: "error" | "warning" | "info";

  /** Issue type */
  type:
    | "broken-reference"
    | "unused-resource"
    | "missing-test"
    | "missing-doc"
    | "high-complexity"
    | "duplicate";

  /** Message */
  message: string;

  /** Resource affected */
  resource: {
    type: "workflow" | "state" | "image" | "transition";
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
  matchType: "exact" | "similar" | "potential";

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
  type: "workflow" | "state" | "image" | "action";

  /** Source resource */
  source: {
    type: "workflow" | "state" | "transition";
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
    type: "workflow" | "state";
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
    health: "improving" | "declining" | "stable";
    coverage: "improving" | "declining" | "stable";
    issues: "improving" | "declining" | "stable";
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
  type: "health-drop" | "critical-issue" | "storage-limit" | "complexity-spike";

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

// ============================================================================
// Project Optimization Service
// ============================================================================

export class ProjectOptimizationService {
  private static instance: ProjectOptimizationService;

  private metricsHistory: ProjectMetrics[] = [];
  private alerts: HealthAlert[] = [];

  private readonly STORAGE_KEY = "project-optimization-metrics";
  private readonly ALERTS_STORAGE_KEY = "project-optimization-alerts";

  private dependencyAnalyzer: WorkflowDependencyAnalyzer;
  private documentationService: WorkflowDocumentationService;

  private constructor() {
    this.dependencyAnalyzer = WorkflowDependencyAnalyzer.getInstance();
    this.documentationService = WorkflowDocumentationService.getInstance();
    this.loadFromStorage();
  }

  static getInstance(): ProjectOptimizationService {
    if (!ProjectOptimizationService.instance) {
      ProjectOptimizationService.instance = new ProjectOptimizationService();
    }
    return ProjectOptimizationService.instance;
  }

  // ==========================================================================
  // 1. Project Health Analysis
  // ==========================================================================

  /**
   * Calculate overall project health score (0-100)
   */
  calculateProjectHealth(
    workflows: Workflow[],
    states: State[],
    images: ImageAsset[],
    transitions: Transition[]
  ): number {
    const health = this.getHealthReport(workflows, states, images, transitions);
    return health.health.score;
  }

  /**
   * Get detailed health report with breakdown
   */
  getHealthReport(
    workflows: Workflow[],
    states: State[],
    images: ImageAsset[],
    transitions: Transition[]
  ): HealthReport {
    // Analyze all resources
    const workflowAnalyses = this.analyzeWorkflows(workflows, states, images);
    const stateAnalyses = this.analyzeStates(states, transitions, images);
    const imageAnalyses = this.analyzeImages(images, workflows, states);
    const transitionAnalyses = this.analyzeTransitions(
      transitions,
      workflows,
      states
    );

    // Calculate health factors
    const testCoverage = this.calculateTestCoverageFactor(workflows);
    const documentationCoverage =
      this.calculateDocumentationCoverageFactor(workflows);
    const organization = this.calculateOrganizationFactor(workflows);
    const complexity = this.calculateComplexityFactor(workflows);
    const unusedResources = this.calculateUnusedResourcesFactor(
      workflowAnalyses,
      stateAnalyses,
      imageAnalyses
    );
    const brokenReferences = this.calculateBrokenReferencesFactor(
      workflowAnalyses,
      stateAnalyses,
      transitionAnalyses
    );

    // Calculate overall score
    const factors = {
      testCoverage,
      documentationCoverage,
      organization,
      complexity,
      unusedResources,
      brokenReferences,
    };

    const overallScore = Math.round(
      testCoverage.contribution +
        documentationCoverage.contribution +
        organization.contribution +
        complexity.contribution +
        unusedResources.contribution +
        brokenReferences.contribution
    );

    const rating = this.getHealthRating(overallScore);

    const health: ProjectHealth = {
      score: overallScore,
      rating,
      factors,
      timestamp: new Date().toISOString(),
      totalResources: {
        workflows: workflows.length,
        states: states.length,
        images: images.length,
        transitions: transitions.length,
      },
    };

    // Generate suggestions and issues
    const suggestions = this.generateSuggestions(
      workflowAnalyses,
      stateAnalyses,
      imageAnalyses
    );

    const issues = this.collectIssues(
      workflowAnalyses,
      stateAnalyses,
      imageAnalyses
    );

    const storage = this.getStorageUsage(
      workflows,
      states,
      images,
      transitions
    );

    return {
      health,
      resources: {
        workflows: workflowAnalyses,
        states: stateAnalyses,
        images: imageAnalyses,
        transitions: transitionAnalyses,
      },
      suggestions,
      issues,
      storage,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Get health rating from score
   */
  private getHealthRating(
    score: number
  ): "critical" | "poor" | "fair" | "good" | "excellent" {
    if (score >= 90) return "excellent";
    if (score >= 75) return "good";
    if (score >= 60) return "fair";
    if (score >= 40) return "poor";
    return "critical";
  }

  /**
   * Calculate test coverage factor (25% weight)
   */
  private calculateTestCoverageFactor(workflows: Workflow[]): HealthFactor {
    const coverage = this.calculateTestCoverage(workflows);
    const score = Math.round(coverage.overall);
    const weight = 25;

    return {
      score,
      weight,
      contribution: (score * weight) / 100,
      status:
        score >= 80
          ? "excellent"
          : score >= 60
            ? "good"
            : score >= 40
              ? "warning"
              : "critical",
      details: `${coverage.untested.length} of ${workflows.length} workflows lack tests`,
      issues:
        coverage.untested.length > 0
          ? [`${coverage.untested.length} workflows without tests`]
          : [],
      suggestions:
        coverage.overall < 80 ? ["Add tests to increase coverage"] : [],
    };
  }

  /**
   * Calculate documentation coverage factor (20% weight)
   */
  private calculateDocumentationCoverageFactor(
    workflows: Workflow[]
  ): HealthFactor {
    const coverage = this.calculateDocumentationCoverage(workflows);
    const score = Math.round(coverage.overall);
    const weight = 20;

    return {
      score,
      weight,
      contribution: (score * weight) / 100,
      status:
        score >= 80
          ? "excellent"
          : score >= 60
            ? "good"
            : score >= 40
              ? "warning"
              : "critical",
      details: `${coverage.undocumented.length} of ${workflows.length} workflows lack documentation`,
      issues:
        coverage.undocumented.length > 0
          ? [`${coverage.undocumented.length} workflows without documentation`]
          : [],
      suggestions:
        coverage.overall < 80 ? ["Add documentation to workflows"] : [],
    };
  }

  /**
   * Calculate organization factor (15% weight)
   */
  private calculateOrganizationFactor(workflows: Workflow[]): HealthFactor {
    const unorganized = workflows.filter(
      (w) => !w.category || w.category === "Uncategorized"
    );
    const score = Math.round(
      ((workflows.length - unorganized.length) /
        Math.max(workflows.length, 1)) *
        100
    );
    const weight = 15;

    return {
      score,
      weight,
      contribution: (score * weight) / 100,
      status:
        score >= 80
          ? "excellent"
          : score >= 60
            ? "good"
            : score >= 40
              ? "warning"
              : "critical",
      details: `${workflows.length - unorganized.length} of ${workflows.length} workflows are organized`,
      issues:
        unorganized.length > 0
          ? [`${unorganized.length} workflows not organized in folders`]
          : [],
      suggestions:
        score < 80 ? ["Organize workflows into folders/categories"] : [],
    };
  }

  /**
   * Calculate complexity factor (20% weight)
   */
  private calculateComplexityFactor(workflows: Workflow[]): HealthFactor {
    const distribution =
      workflowComplexityAnalyzer.getComplexityDistribution(workflows);
    const highComplexCount =
      distribution.byRating.high + distribution.byRating["very-high"];
    const score = Math.round(
      100 - (highComplexCount / Math.max(workflows.length, 1)) * 100
    );
    const weight = 20;

    return {
      score,
      weight,
      contribution: (score * weight) / 100,
      status:
        score >= 80
          ? "excellent"
          : score >= 60
            ? "good"
            : score >= 40
              ? "warning"
              : "critical",
      details: `${highComplexCount} workflows have high complexity`,
      issues:
        highComplexCount > 0
          ? [`${highComplexCount} workflows with high complexity`]
          : [],
      suggestions:
        score < 80 ? ["Reduce complexity in high-complexity workflows"] : [],
    };
  }

  /**
   * Calculate unused resources factor (10% weight)
   */
  private calculateUnusedResourcesFactor(
    workflows: WorkflowAnalysis[],
    states: StateAnalysis[],
    images: ImageAnalysis[]
  ): HealthFactor {
    const unusedWorkflows = workflows.filter((w) => w.isUnused).length;
    const unusedStates = states.filter((s) => !s.isUsed).length;
    const unusedImages = images.filter((i) => !i.isUsed).length;

    const totalUnused = unusedWorkflows + unusedStates + unusedImages;
    const totalResources = workflows.length + states.length + images.length;

    const score = Math.round(
      100 - (totalUnused / Math.max(totalResources, 1)) * 100
    );
    const weight = 10;

    return {
      score,
      weight,
      contribution: (score * weight) / 100,
      status:
        score >= 90
          ? "excellent"
          : score >= 70
            ? "good"
            : score >= 50
              ? "warning"
              : "critical",
      details: `${totalUnused} unused resources found`,
      issues: [
        unusedWorkflows > 0 ? `${unusedWorkflows} unused workflows` : null,
        unusedStates > 0 ? `${unusedStates} unused states` : null,
        unusedImages > 0 ? `${unusedImages} unused images` : null,
      ].filter(Boolean) as string[],
      suggestions: totalUnused > 0 ? ["Remove unused resources"] : [],
    };
  }

  /**
   * Calculate broken references factor (10% weight)
   */
  private calculateBrokenReferencesFactor(
    workflows: WorkflowAnalysis[],
    states: StateAnalysis[],
    transitions: TransitionAnalysis[]
  ): HealthFactor {
    const workflowRefs = workflows.reduce(
      (sum, w) => sum + w.brokenReferences.length,
      0
    );
    const stateRefs = states.reduce(
      (sum, s) => sum + s.brokenReferences.length,
      0
    );
    const transitionRefs = transitions.reduce(
      (sum, t) => sum + t.brokenReferences.length,
      0
    );

    const totalBroken = workflowRefs + stateRefs + transitionRefs;
    const score = totalBroken === 0 ? 100 : Math.max(0, 100 - totalBroken * 10);
    const weight = 10;

    return {
      score,
      weight,
      contribution: (score * weight) / 100,
      status:
        score >= 95
          ? "excellent"
          : score >= 80
            ? "good"
            : score >= 60
              ? "warning"
              : "critical",
      details: `${totalBroken} broken references found`,
      issues:
        totalBroken > 0 ? [`${totalBroken} broken references need fixing`] : [],
      suggestions: totalBroken > 0 ? ["Fix broken references"] : [],
    };
  }

  // ==========================================================================
  // 2. Resource Analysis
  // ==========================================================================

  /**
   * Analyze all workflows
   */
  analyzeWorkflows(
    workflows: Workflow[],
    states: State[],
    images: ImageAsset[]
  ): WorkflowAnalysis[] {
    return workflows.map((workflow) => {
      const complexity = workflowComplexityAnalyzer.analyzeComplexity(workflow);

      // Check testing
      const tests = getWorkflowTestingService().getTestCasesForWorkflow(
        workflow.id
      );
      const hasTesting = tests.length > 0;

      // Check documentation
      const hasDocumentation = this.documentationService.hasDocumentation(
        workflow.id
      );

      // Check organization
      const isOrganized = !!(
        workflow.category && workflow.category !== "Uncategorized"
      );

      // Analyze dependencies
      const deps = this.dependencyAnalyzer.analyzeDependencies(workflow);
      const dependents = this.dependencyAnalyzer.getDependents(
        workflow.id,
        workflows
      );

      // Check if unused
      const isUnused =
        dependents.length === 0 && !workflow.metadata?.isEntryPoint;

      // Find broken references
      const brokenReferences = this.findBrokenWorkflowReferences(
        workflow,
        workflows,
        states,
        images
      );

      // Determine status
      let status: "healthy" | "warning" | "critical" = "healthy";
      const issues: string[] = [];

      if (brokenReferences.length > 0) {
        status = "critical";
        issues.push(`${brokenReferences.length} broken references`);
      }

      if (complexity.complexityScore > 75) {
        status = status === "critical" ? "critical" : "warning";
        issues.push("High complexity");
      }

      if (!hasTesting) {
        issues.push("No tests");
      }

      if (!hasDocumentation) {
        issues.push("No documentation");
      }

      return {
        workflowId: workflow.id,
        name: workflow.name,
        complexity,
        hasTesting,
        testCount: tests.length,
        hasDocumentation,
        isOrganized,
        folderPath: workflow.category,
        dependencyCount: deps.length,
        dependentCount: dependents.length,
        isUnused,
        brokenReferences,
        status,
        issues,
      };
    });
  }

  /**
   * Analyze all states
   */
  analyzeStates(
    states: State[],
    transitions: Transition[],
    images: ImageAsset[]
  ): StateAnalysis[] {
    return states.map((state) => {
      // Count usage in transitions
      const usageCount = transitions.filter((t) => {
        if (t.type === "OutgoingTransition") {
          return (
            t.fromState === state.id ||
            t.toState === state.id ||
            t.activateStates.includes(state.id)
          );
        }
        return t.toState === state.id;
      }).length;

      const isUsed = usageCount > 0 || state.initial === true;

      // Find orphaned images (referenced but don't exist)
      const imageIds = new Set(images.map((img) => img.id));
      const orphanedImageIds = state.stateImages
        .flatMap((si) => si.patterns.map((p) => p.imageId))
        .filter((id): id is string => id !== undefined && !imageIds.has(id));

      // Calculate complexity
      const complexityScore = this.calculateStateComplexity(state);

      // Find broken references
      const brokenReferences = this.findBrokenStateReferences(state, images);

      // Determine status
      let status: "healthy" | "warning" | "critical" = "healthy";
      const issues: string[] = [];

      if (brokenReferences.length > 0) {
        status = "critical";
        issues.push(`${brokenReferences.length} broken references`);
      }

      if (!isUsed && !state.initial) {
        status = status === "critical" ? "critical" : "warning";
        issues.push("Unused state");
      }

      if (orphanedImageIds.length > 0) {
        status = status === "critical" ? "critical" : "warning";
        issues.push(`${orphanedImageIds.length} missing images`);
      }

      return {
        stateId: state.id,
        name: state.name,
        imageCount: state.stateImages.length,
        regionCount: state.regions.length,
        locationCount: state.locations.length,
        isUsed,
        usageCount,
        hasOrphanedImages: orphanedImageIds.length > 0,
        orphanedImageIds,
        complexityScore,
        brokenReferences,
        status,
        issues,
      };
    });
  }

  /**
   * Analyze all images
   */
  analyzeImages(
    images: ImageAsset[],
    workflows: Workflow[],
    states: State[]
  ): ImageAnalysis[] {
    return images.map((image) => {
      // Find usage
      const usedIn: Array<{
        type: "state" | "workflow";
        id: string;
        name: string;
      }> = [];

      // Check states
      states.forEach((state) => {
        const usedInState = state.stateImages.some((si) =>
          si.patterns.some((p) => p.imageId === image.id)
        );
        if (usedInState) {
          usedIn.push({ type: "state", id: state.id, name: state.name });
        }
      });

      // Check workflows (actions with image configs)
      workflows.forEach((workflow) => {
        const usedInWorkflow = workflow.actions.some((action) => {
          const config = action.config as { target?: { image?: string }; imageId?: string };
          return (
            config.target?.image === image.id || config.imageId === image.id
          );
        });
        if (usedInWorkflow) {
          usedIn.push({
            type: "workflow",
            id: workflow.id,
            name: workflow.name,
          });
        }
      });

      const isUsed = usedIn.length > 0;

      // Find duplicates
      const duplicates = this.findDuplicateImages(image, images, 0.95);

      // Calculate optimization potential
      const canOptimize = image.size > 500000; // > 500KB
      const potentialSavings = canOptimize ? Math.round(image.size * 0.3) : 0; // Assume 30% compression

      // Determine status
      let status: "healthy" | "warning" | "critical" = "healthy";
      const issues: string[] = [];

      if (!isUsed) {
        status = "warning";
        issues.push("Unused image");
      }

      if (duplicates.length > 0) {
        issues.push(`${duplicates.length} potential duplicates`);
      }

      if (canOptimize) {
        issues.push("Large file size - can be optimized");
      }

      return {
        imageId: image.id,
        name: image.name,
        size: image.size,
        isUsed,
        usageCount: usedIn.length,
        usedIn,
        duplicates,
        canOptimize,
        potentialSavings,
        status,
        issues,
      };
    });
  }

  /**
   * Analyze all transitions
   */
  analyzeTransitions(
    transitions: Transition[],
    workflows: Workflow[],
    states: State[]
  ): TransitionAnalysis[] {
    const workflowIds = new Set(workflows.map((w) => w.id));
    const stateIds = new Set(states.map((s) => s.id));

    return transitions.map((transition) => {
      const brokenReferences: BrokenReference[] = [];

      // Check state references
      let hasValidStates = true;

      if (transition.type === "OutgoingTransition") {
        if (!stateIds.has(transition.fromState)) {
          hasValidStates = false;
          brokenReferences.push({
            type: "state",
            source: {
              type: "transition",
              id: transition.id,
              name: transition.id,
            },
            referencedId: transition.fromState,
            message: `From state "${transition.fromState}" does not exist`,
          });
        }

        if (transition.toState && !stateIds.has(transition.toState)) {
          hasValidStates = false;
          brokenReferences.push({
            type: "state",
            source: {
              type: "transition",
              id: transition.id,
              name: transition.id,
            },
            referencedId: transition.toState,
            message: `To state "${transition.toState}" does not exist`,
          });
        }

        transition.activateStates.forEach((stateId) => {
          if (!stateIds.has(stateId)) {
            hasValidStates = false;
            brokenReferences.push({
              type: "state",
              source: {
                type: "transition",
                id: transition.id,
                name: transition.id,
              },
              referencedId: stateId,
              message: `Activate state "${stateId}" does not exist`,
            });
          }
        });
      } else {
        if (!stateIds.has(transition.toState)) {
          hasValidStates = false;
          brokenReferences.push({
            type: "state",
            source: {
              type: "transition",
              id: transition.id,
              name: transition.id,
            },
            referencedId: transition.toState,
            message: `To state "${transition.toState}" does not exist`,
          });
        }
      }

      // Check workflow references
      let hasValidWorkflows = true;
      transition.workflows.forEach((workflowId) => {
        if (!workflowIds.has(workflowId)) {
          hasValidWorkflows = false;
          brokenReferences.push({
            type: "workflow",
            source: {
              type: "transition",
              id: transition.id,
              name: transition.id,
            },
            referencedId: workflowId,
            message: `Workflow "${workflowId}" does not exist`,
          });
        }
      });

      // Check for circular dependencies
      const isCircular = this.isTransitionCircular(transition, transitions);

      // Determine status
      let status: "healthy" | "warning" | "critical" = "healthy";
      const issues: string[] = [];

      if (brokenReferences.length > 0) {
        status = "critical";
        issues.push(`${brokenReferences.length} broken references`);
      }

      if (isCircular) {
        issues.push("Part of circular dependency");
      }

      return {
        transitionId: transition.id,
        hasValidStates,
        hasValidWorkflows,
        brokenReferences,
        isCircular,
        status,
        issues,
      };
    });
  }

  // ==========================================================================
  // 3. Optimization Suggestions
  // ==========================================================================

  /**
   * Generate actionable optimization suggestions
   */
  generateSuggestions(
    workflows: WorkflowAnalysis[],
    states: StateAnalysis[],
    images: ImageAnalysis[]
  ): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];
    let suggestionId = 1;

    // Unused images
    const unusedImages = images.filter((i) => !i.isUsed);
    if (unusedImages.length > 0) {
      const totalSize = unusedImages.reduce((sum, i) => sum + i.size, 0);
      suggestions.push({
        id: `opt-${suggestionId++}`,
        type: "delete-unused-images",
        priority: totalSize > 10_000_000 ? "high" : "medium",
        title: `Delete ${unusedImages.length} unused images`,
        description: `Found ${unusedImages.length} images that are not referenced anywhere. Removing them will save ${this.formatBytes(totalSize)}.`,
        affectedResources: unusedImages.map((i) => ({
          type: "image",
          id: i.imageId,
          name: i.name,
        })),
        impact: {
          storageSavings: totalSize,
          maintainabilityGain: "medium",
        },
        autoFixable: true,
      });
    }

    // Workflows without tests
    const untestedWorkflows = workflows.filter((w) => !w.hasTesting);
    if (untestedWorkflows.length > 0) {
      suggestions.push({
        id: `opt-${suggestionId++}`,
        type: "add-tests",
        priority: untestedWorkflows.length > 10 ? "high" : "medium",
        title: `Add tests to ${untestedWorkflows.length} workflows`,
        description: `${untestedWorkflows.length} workflows lack automated tests. Adding tests will improve reliability.`,
        affectedResources: untestedWorkflows.map((w) => ({
          type: "workflow",
          id: w.workflowId,
          name: w.name,
        })),
        impact: {
          maintainabilityGain: "high",
        },
        autoFixable: false,
      });
    }

    // Workflows without documentation
    const undocumentedWorkflows = workflows.filter((w) => !w.hasDocumentation);
    if (undocumentedWorkflows.length > 0) {
      suggestions.push({
        id: `opt-${suggestionId++}`,
        type: "add-documentation",
        priority: undocumentedWorkflows.length > 10 ? "high" : "medium",
        title: `Document ${undocumentedWorkflows.length} workflows`,
        description: `${undocumentedWorkflows.length} workflows lack documentation. Adding documentation will improve maintainability.`,
        affectedResources: undocumentedWorkflows.map((w) => ({
          type: "workflow",
          id: w.workflowId,
          name: w.name,
        })),
        impact: {
          maintainabilityGain: "high",
        },
        autoFixable: true, // Can auto-generate
      });
    }

    // Unorganized workflows
    const unorganizedWorkflows = workflows.filter((w) => !w.isOrganized);
    if (unorganizedWorkflows.length > 0) {
      suggestions.push({
        id: `opt-${suggestionId++}`,
        type: "organize-folders",
        priority: unorganizedWorkflows.length > 20 ? "high" : "low",
        title: `Organize ${unorganizedWorkflows.length} workflows into folders`,
        description: `${unorganizedWorkflows.length} workflows are not organized. Organizing them will improve navigation.`,
        affectedResources: unorganizedWorkflows.map((w) => ({
          type: "workflow",
          id: w.workflowId,
          name: w.name,
        })),
        impact: {
          maintainabilityGain: "medium",
        },
        autoFixable: true,
      });
    }

    // Broken references
    const withBrokenRefs = [
      ...workflows
        .filter((w) => w.brokenReferences.length > 0)
        .map((w) => ({
          type: "workflow" as const,
          id: w.workflowId,
          name: w.name,
          count: w.brokenReferences.length,
        })),
      ...states
        .filter((s) => s.brokenReferences.length > 0)
        .map((s) => ({
          type: "state" as const,
          id: s.stateId,
          name: s.name,
          count: s.brokenReferences.length,
        })),
    ];

    if (withBrokenRefs.length > 0) {
      const totalBroken = withBrokenRefs.reduce((sum, r) => sum + r.count, 0);
      suggestions.push({
        id: `opt-${suggestionId++}`,
        type: "fix-broken-references",
        priority: "critical",
        title: `Fix ${totalBroken} broken references`,
        description: `Found ${totalBroken} broken references across ${withBrokenRefs.length} resources. These can cause runtime errors.`,
        affectedResources: withBrokenRefs.map((r) => ({
          type: r.type,
          id: r.id,
          name: r.name,
        })),
        impact: {
          maintainabilityGain: "high",
        },
        autoFixable: false,
      });
    }

    // High complexity workflows
    const highComplexity = workflows.filter(
      (w) => w.complexity.complexityScore > 75
    );
    if (highComplexity.length > 0) {
      suggestions.push({
        id: `opt-${suggestionId++}`,
        type: "reduce-complexity",
        priority: highComplexity.length > 5 ? "high" : "medium",
        title: `Reduce complexity in ${highComplexity.length} workflows`,
        description: `${highComplexity.length} workflows have high complexity. Consider breaking them into smaller workflows.`,
        affectedResources: highComplexity.map((w) => ({
          type: "workflow",
          id: w.workflowId,
          name: w.name,
        })),
        impact: {
          maintainabilityGain: "high",
        },
        autoFixable: false,
      });
    }

    // Orphaned states
    const orphanedStates = states.filter(
      (s) => !s.isUsed && !s.brokenReferences.length
    );
    if (orphanedStates.length > 0) {
      suggestions.push({
        id: `opt-${suggestionId++}`,
        type: "remove-orphaned-states",
        priority: "medium",
        title: `Remove ${orphanedStates.length} orphaned states`,
        description: `${orphanedStates.length} states are not referenced by any transitions. Consider removing them.`,
        affectedResources: orphanedStates.map((s) => ({
          type: "state",
          id: s.stateId,
          name: s.name,
        })),
        impact: {
          maintainabilityGain: "medium",
        },
        autoFixable: true,
      });
    }

    // Duplicate images
    const withDuplicates = images.filter((i) => i.duplicates.length > 0);
    if (withDuplicates.length > 0) {
      suggestions.push({
        id: `opt-${suggestionId++}`,
        type: "consolidate-duplicates",
        priority: "low",
        title: `Consolidate ${withDuplicates.length} potential duplicate images`,
        description: `Found ${withDuplicates.length} images with potential duplicates. Review and consolidate to save space.`,
        affectedResources: withDuplicates.map((i) => ({
          type: "image",
          id: i.imageId,
          name: i.name,
        })),
        impact: {
          storageSavings:
            withDuplicates.reduce((sum, i) => sum + i.size, 0) / 2,
          maintainabilityGain: "low",
        },
        autoFixable: false,
      });
    }

    // Large images
    const largeImages = images.filter((i) => i.canOptimize);
    if (largeImages.length > 0) {
      const totalSavings = largeImages.reduce(
        (sum, i) => sum + i.potentialSavings,
        0
      );
      suggestions.push({
        id: `opt-${suggestionId++}`,
        type: "optimize-storage",
        priority: totalSavings > 50_000_000 ? "high" : "low",
        title: `Optimize ${largeImages.length} large images`,
        description: `${largeImages.length} images are larger than 500KB. Optimizing them could save ${this.formatBytes(totalSavings)}.`,
        affectedResources: largeImages.map((i) => ({
          type: "image",
          id: i.imageId,
          name: i.name,
        })),
        impact: {
          storageSavings: totalSavings,
          performanceGain: "medium",
        },
        autoFixable: true,
      });
    }

    return suggestions.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  // ==========================================================================
  // 4. Unused Resource Detection
  // ==========================================================================

  /**
   * Find unused images
   */
  findUnusedImages(
    images: ImageAsset[],
    workflows: Workflow[],
    states: State[]
  ): string[] {
    const analyses = this.analyzeImages(images, workflows, states);
    return analyses.filter((a) => !a.isUsed).map((a) => a.imageId);
  }

  /**
   * Find unused states
   */
  findUnusedStates(states: State[], transitions: Transition[]): string[] {
    const analyses = this.analyzeStates(states, transitions, []);
    return analyses.filter((a) => !a.isUsed).map((a) => a.stateId);
  }

  /**
   * Find unused workflows
   */
  findUnusedWorkflows(workflows: Workflow[]): string[] {
    return this.dependencyAnalyzer.findUnusedWorkflows(workflows);
  }

  /**
   * Find orphaned states (no transitions)
   */
  findOrphanedStates(states: State[], transitions: Transition[]): string[] {
    const statesInTransitions = new Set<string>();

    transitions.forEach((t) => {
      if (t.type === "OutgoingTransition") {
        statesInTransitions.add(t.fromState);
        if (t.toState) statesInTransitions.add(t.toState);
        t.activateStates.forEach((id) => statesInTransitions.add(id));
      } else {
        statesInTransitions.add(t.toState);
      }
    });

    return states
      .filter((s) => !statesInTransitions.has(s.id) && !s.initial)
      .map((s) => s.id);
  }

  // ==========================================================================
  // 5. Duplicate Detection
  // ==========================================================================

  /**
   * Find duplicate images by similarity
   */
  findDuplicateImages(
    image: ImageAsset,
    allImages: ImageAsset[],
    threshold: number = 0.9
  ): DuplicateMatch[] {
    const duplicates: DuplicateMatch[] = [];

    allImages.forEach((other) => {
      if (other.id === image.id) return;

      // Exact name match
      if (other.name === image.name) {
        duplicates.push({
          id: other.id,
          name: other.name,
          similarity: 1.0,
          matchType: "exact",
          details: "Exact name match",
        });
        return;
      }

      // Size similarity (within 5%)
      const sizeDiff = Math.abs(other.size - image.size) / image.size;
      if (sizeDiff < 0.05) {
        const similarity = 1 - sizeDiff;
        if (similarity >= threshold) {
          duplicates.push({
            id: other.id,
            name: other.name,
            similarity,
            matchType: "similar",
            details: `Similar size: ${this.formatBytes(other.size)}`,
          });
        }
      }

      // Name similarity (basic)
      const nameSimilarity = this.calculateStringSimilarity(
        image.name,
        other.name
      );
      if (nameSimilarity >= threshold) {
        duplicates.push({
          id: other.id,
          name: other.name,
          similarity: nameSimilarity,
          matchType: "potential",
          details: "Similar name",
        });
      }
    });

    return duplicates;
  }

  /**
   * Find duplicate states
   */
  findDuplicateStates(
    state: State,
    allStates: State[],
    threshold: number = 0.9
  ): DuplicateMatch[] {
    const duplicates: DuplicateMatch[] = [];

    allStates.forEach((other) => {
      if (other.id === state.id) return;

      // Exact name match
      if (other.name === state.name) {
        duplicates.push({
          id: other.id,
          name: other.name,
          similarity: 1.0,
          matchType: "exact",
          details: "Exact name match",
        });
        return;
      }

      // Structure similarity
      const imageCountSimilar =
        state.stateImages.length === other.stateImages.length;
      const regionCountSimilar = state.regions.length === other.regions.length;

      if (
        imageCountSimilar &&
        regionCountSimilar &&
        state.stateImages.length > 0
      ) {
        const nameSimilarity = this.calculateStringSimilarity(
          state.name,
          other.name
        );
        if (nameSimilarity >= threshold) {
          duplicates.push({
            id: other.id,
            name: other.name,
            similarity: nameSimilarity,
            matchType: "potential",
            details: "Similar structure and name",
          });
        }
      }
    });

    return duplicates;
  }

  /**
   * Find duplicate workflows
   */
  findDuplicateWorkflows(
    workflow: Workflow,
    allWorkflows: Workflow[]
  ): DuplicateMatch[] {
    const duplicates: DuplicateMatch[] = [];

    allWorkflows.forEach((other) => {
      if (other.id === workflow.id) return;

      // Exact name match
      if (other.name === workflow.name) {
        duplicates.push({
          id: other.id,
          name: other.name,
          similarity: 1.0,
          matchType: "exact",
          details: "Exact name match",
        });
        return;
      }

      // Structure similarity
      const actionCountSame = other.actions.length === workflow.actions.length;
      if (actionCountSame && workflow.actions.length > 0) {
        // Compare action types
        const workflowTypes = workflow.actions.map((a) => a.type).join(",");
        const otherTypes = other.actions.map((a) => a.type).join(",");

        if (workflowTypes === otherTypes) {
          const nameSimilarity = this.calculateStringSimilarity(
            workflow.name,
            other.name
          );
          duplicates.push({
            id: other.id,
            name: other.name,
            similarity: nameSimilarity,
            matchType: "potential",
            details: "Identical action sequence",
          });
        }
      }
    });

    return duplicates;
  }

  // ==========================================================================
  // 6. Broken Reference Detection
  // ==========================================================================

  /**
   * Validate all references in the project
   */
  validateAllReferences(
    workflows: Workflow[],
    states: State[],
    images: ImageAsset[],
    transitions: Transition[]
  ): BrokenReference[] {
    const broken: BrokenReference[] = [];

    workflows.forEach((workflow) => {
      broken.push(
        ...this.findBrokenWorkflowReferences(
          workflow,
          workflows,
          states,
          images
        )
      );
    });

    states.forEach((state) => {
      broken.push(...this.findBrokenStateReferences(state, images));
    });

    transitions.forEach((transition) => {
      broken.push(
        ...this.findBrokenTransitionReferences(transition, workflows, states)
      );
    });

    return broken;
  }

  /**
   * Find broken references in a workflow
   */
  findBrokenWorkflowReferences(
    workflow: Workflow,
    allWorkflows: Workflow[],
    states: State[],
    images: ImageAsset[]
  ): BrokenReference[] {
    const broken: BrokenReference[] = [];
    const workflowIds = new Set(allWorkflows.map((w) => w.id));
    const stateIds = new Set(states.map((s) => s.id));
    const imageIds = new Set(images.map((i) => i.id));

    workflow.actions.forEach((action) => {
      // Check RUN_WORKFLOW actions
      if (action.type === "RUN_WORKFLOW") {
        const config = action.config as { workflowId?: string };
        if (config.workflowId && !workflowIds.has(config.workflowId)) {
          broken.push({
            type: "workflow",
            source: { type: "workflow", id: workflow.id, name: workflow.name },
            referencedId: config.workflowId,
            location: action.id,
            message: `Action "${action.name || action.id}" references missing workflow "${config.workflowId}"`,
          });
        }
      }

      // Check GO_TO_STATE actions
      if (action.type === "GO_TO_STATE") {
        const config = action.config as { stateId?: string };
        if (config.stateId && !stateIds.has(config.stateId)) {
          broken.push({
            type: "state",
            source: { type: "workflow", id: workflow.id, name: workflow.name },
            referencedId: config.stateId,
            location: action.id,
            message: `Action "${action.name || action.id}" references missing state "${config.stateId}"`,
          });
        }
      }

      // Check image references in action configs
      const config = action.config as { target?: { image?: string }; imageId?: string };
      if (config.target?.image && !imageIds.has(config.target.image)) {
        broken.push({
          type: "image",
          source: { type: "workflow", id: workflow.id, name: workflow.name },
          referencedId: config.target.image,
          location: action.id,
          message: `Action "${action.name || action.id}" references missing image "${config.target.image}"`,
        });
      }

      if (config.imageId && !imageIds.has(config.imageId)) {
        broken.push({
          type: "image",
          source: { type: "workflow", id: workflow.id, name: workflow.name },
          referencedId: config.imageId,
          location: action.id,
          message: `Action "${action.name || action.id}" references missing image "${config.imageId}"`,
        });
      }
    });

    return broken;
  }

  /**
   * Find broken references in a state
   */
  findBrokenStateReferences(
    state: State,
    images: ImageAsset[]
  ): BrokenReference[] {
    const broken: BrokenReference[] = [];
    const imageIds = new Set(images.map((i) => i.id));

    state.stateImages.forEach((stateImage) => {
      stateImage.patterns.forEach((pattern) => {
        if (pattern.imageId && !imageIds.has(pattern.imageId)) {
          broken.push({
            type: "image",
            source: { type: "state", id: state.id, name: state.name },
            referencedId: pattern.imageId,
            location: stateImage.id,
            message: `State image "${stateImage.name}" pattern references missing image "${pattern.imageId}"`,
          });
        }
      });
    });

    return broken;
  }

  /**
   * Find broken references in a transition
   */
  findBrokenTransitionReferences(
    transition: Transition,
    workflows: Workflow[],
    states: State[]
  ): BrokenReference[] {
    const broken: BrokenReference[] = [];
    const workflowIds = new Set(workflows.map((w) => w.id));
    const stateIds = new Set(states.map((s) => s.id));

    // Check workflow references
    transition.workflows.forEach((workflowId) => {
      if (!workflowIds.has(workflowId)) {
        broken.push({
          type: "workflow",
          source: {
            type: "transition",
            id: transition.id,
            name: transition.id,
          },
          referencedId: workflowId,
          message: `Transition references missing workflow "${workflowId}"`,
        });
      }
    });

    // Check state references
    if (transition.type === "OutgoingTransition") {
      if (!stateIds.has(transition.fromState)) {
        broken.push({
          type: "state",
          source: {
            type: "transition",
            id: transition.id,
            name: transition.id,
          },
          referencedId: transition.fromState,
          message: `Transition references missing from state "${transition.fromState}"`,
        });
      }

      if (transition.toState && !stateIds.has(transition.toState)) {
        broken.push({
          type: "state",
          source: {
            type: "transition",
            id: transition.id,
            name: transition.id,
          },
          referencedId: transition.toState,
          message: `Transition references missing to state "${transition.toState}"`,
        });
      }

      transition.activateStates.forEach((stateId) => {
        if (!stateIds.has(stateId)) {
          broken.push({
            type: "state",
            source: {
              type: "transition",
              id: transition.id,
              name: transition.id,
            },
            referencedId: stateId,
            message: `Transition references missing activate state "${stateId}"`,
          });
        }
      });
    } else {
      if (!stateIds.has(transition.toState)) {
        broken.push({
          type: "state",
          source: {
            type: "transition",
            id: transition.id,
            name: transition.id,
          },
          referencedId: transition.toState,
          message: `Transition references missing to state "${transition.toState}"`,
        });
      }
    }

    return broken;
  }

  // ==========================================================================
  // 7. Storage Analysis
  // ==========================================================================

  /**
   * Get storage usage breakdown
   */
  getStorageUsage(
    workflows: Workflow[],
    states: State[],
    images: ImageAsset[],
    transitions: Transition[]
  ): StorageAnalysis {
    // Calculate image storage
    const imageStorage = images.reduce((sum, img) => sum + img.size, 0);

    // Estimate other storage (simplified)
    const workflowStorage = workflows.length * 1024; // ~1KB per workflow
    const stateStorage = states.length * 512; // ~512B per state
    const transitionStorage = transitions.length * 256; // ~256B per transition

    // Storage from localStorage
    const testStorage = this.estimateLocalStorageSize("workflow-test-");
    const docStorage = this.estimateLocalStorageSize("workflow-documentation");

    const total =
      imageStorage +
      workflowStorage +
      stateStorage +
      transitionStorage +
      testStorage +
      docStorage;

    // Breakdown by folder
    const byFolder: Record<string, number> = {};
    workflows.forEach((workflow) => {
      const folder = workflow.category || "Uncategorized";
      byFolder[folder] = (byFolder[folder] || 0) + 1024;
    });

    // Calculate potential savings
    const unusedImages = images.filter((img) => {
      const analyses = this.analyzeImages([img], workflows, states);
      const firstAnalysis = analyses[0];
      return firstAnalysis ? !firstAnalysis.isUsed : false;
    });
    const unusedStorage = unusedImages.reduce((sum, img) => sum + img.size, 0);

    const duplicateStorage = images.reduce((sum, img) => {
      const dups = this.findDuplicateImages(img, images, 0.95);
      return sum + (dups.length > 0 ? img.size / 2 : 0);
    }, 0);

    const potentialSavings = unusedStorage + duplicateStorage;

    return {
      total,
      byType: {
        images: imageStorage,
        workflows: workflowStorage,
        states: stateStorage,
        transitions: transitionStorage,
        tests: testStorage,
        documentation: docStorage,
        other: 0,
      },
      byFolder,
      potentialSavings,
      unusedStorage,
      duplicateStorage,
    };
  }

  /**
   * Estimate storage savings from optimizations
   */
  estimateStorageSavings(
    images: ImageAsset[],
    workflows: Workflow[],
    states: State[]
  ): number {
    const storage = this.getStorageUsage(workflows, states, images, []);
    return storage.potentialSavings;
  }

  /**
   * Get image storage breakdown
   */
  getImageStorageBreakdown(images: ImageAsset[]): Record<string, number> {
    const breakdown: Record<string, number> = {};

    images.forEach((image) => {
      const category = image.source || "unknown";
      breakdown[category] = (breakdown[category] || 0) + image.size;
    });

    return breakdown;
  }

  // ==========================================================================
  // 8. Complexity Analysis
  // ==========================================================================

  /**
   * Get complexity distribution
   */
  getComplexityDistribution(workflows: Workflow[]): ComplexityReport {
    const distribution =
      workflowComplexityAnalyzer.getComplexityDistribution(workflows);

    const scores = workflows.map((w) =>
      workflowComplexityAnalyzer.getComplexityScore(w)
    );
    const sortedScores = [...scores].sort((a, b) => a - b);
    const median =
      sortedScores.length > 0
        ? (sortedScores[Math.floor(sortedScores.length / 2)] ?? 0)
        : 0;

    const highComplexity = workflowComplexityAnalyzer
      .getComplexWorkflows(workflows, 50)
      .map((item) => ({
        id: item.workflow.id,
        name: item.workflow.name,
        type: "workflow" as const,
        score: item.analysis.complexityScore,
      }));

    return {
      distribution: {
        low: distribution.byRating.low,
        medium: distribution.byRating.medium,
        high: distribution.byRating.high,
        veryHigh: distribution.byRating["very-high"],
      },
      average: distribution.averageScore,
      median,
      highComplexity,
    };
  }

  /**
   * Find high complexity resources
   */
  findHighComplexityResources(
    workflows: Workflow[],
    threshold: number = 50
  ): Array<{
    id: string;
    name: string;
    type: "workflow";
    score: number;
  }> {
    return workflowComplexityAnalyzer
      .getComplexWorkflows(workflows, threshold)
      .map((item) => ({
        id: item.workflow.id,
        name: item.workflow.name,
        type: "workflow" as const,
        score: item.analysis.complexityScore,
      }));
  }

  /**
   * Suggest complexity reductions
   */
  suggestComplexityReductions(workflow: Workflow): string[] {
    const suggestions =
      workflowComplexityAnalyzer.suggestSimplifications(workflow);
    return suggestions.map((s) => s.recommendation);
  }

  /**
   * Calculate state complexity
   */
  private calculateStateComplexity(state: State): number {
    // Simple complexity based on number of elements
    const imageCount = state.stateImages.length;
    const regionCount = state.regions.length;
    const locationCount = state.locations.length;
    const stringCount = state.strings.length;

    // Weighted sum
    const score =
      imageCount * 10 + regionCount * 5 + locationCount * 3 + stringCount * 2;

    // Normalize to 0-100
    return Math.min(100, score);
  }

  // ==========================================================================
  // 9. Coverage Analysis
  // ==========================================================================

  /**
   * Calculate test coverage
   */
  calculateTestCoverage(workflows: Workflow[]): CoverageReport["testCoverage"] {
    const tested = new Set<string>();
    const allTests = getWorkflowTestingService().getAllTestCases();

    allTests.forEach((test) => {
      if (test.enabled !== false) {
        tested.add(test.workflowId);
      }
    });

    const overall =
      workflows.length > 0 ? (tested.size / workflows.length) * 100 : 0;

    const byFolder: Record<string, number> = {};
    const folderCounts: Record<string, { total: number; tested: number }> = {};

    workflows.forEach((workflow) => {
      const folder = workflow.category || "Uncategorized";
      if (!folderCounts[folder]) {
        folderCounts[folder] = { total: 0, tested: 0 };
      }
      folderCounts[folder].total++;
      if (tested.has(workflow.id)) {
        folderCounts[folder].tested++;
      }
    });

    Object.entries(folderCounts).forEach(([folder, counts]) => {
      byFolder[folder] = (counts.tested / counts.total) * 100;
    });

    const untested = workflows
      .filter((w) => !tested.has(w.id))
      .map((w) => w.id);

    return {
      overall,
      byFolder,
      untested,
    };
  }

  /**
   * Calculate documentation coverage
   */
  calculateDocumentationCoverage(
    workflows: Workflow[]
  ): CoverageReport["documentationCoverage"] {
    const documented = new Set<string>();

    workflows.forEach((workflow) => {
      if (this.documentationService.hasDocumentation(workflow.id)) {
        documented.add(workflow.id);
      }
    });

    const overall =
      workflows.length > 0 ? (documented.size / workflows.length) * 100 : 0;

    const byFolder: Record<string, number> = {};
    const folderCounts: Record<string, { total: number; documented: number }> =
      {};

    workflows.forEach((workflow) => {
      const folder = workflow.category || "Uncategorized";
      if (!folderCounts[folder]) {
        folderCounts[folder] = { total: 0, documented: 0 };
      }
      folderCounts[folder].total++;
      if (documented.has(workflow.id)) {
        folderCounts[folder].documented++;
      }
    });

    Object.entries(folderCounts).forEach(([folder, counts]) => {
      byFolder[folder] = (counts.documented / counts.total) * 100;
    });

    const undocumented = workflows
      .filter((w) => !documented.has(w.id))
      .map((w) => w.id);

    return {
      overall,
      byFolder,
      undocumented,
    };
  }

  /**
   * Get undocumented resources
   */
  getUndocumentedResources(workflows: Workflow[]): string[] {
    return workflows
      .filter((w) => !this.documentationService.hasDocumentation(w.id))
      .map((w) => w.id);
  }

  /**
   * Get untested resources
   */
  getUntestedResources(workflows: Workflow[]): string[] {
    const coverage = this.calculateTestCoverage(workflows);
    return coverage.untested;
  }

  // ==========================================================================
  // 10. Dependency Analysis
  // ==========================================================================

  /**
   * Analyze project dependencies
   */
  analyzeProjectDependencies(workflows: Workflow[]) {
    return this.dependencyAnalyzer.buildDependencyGraph(workflows);
  }

  /**
   * Find critical resources (most depended-on)
   */
  findCriticalResources(
    workflows: Workflow[],
    limit: number = 10
  ): Array<{
    id: string;
    name: string;
    type: "workflow";
    dependentCount: number;
  }> {
    const graph = this.dependencyAnalyzer.buildDependencyGraph(workflows);

    return Array.from(graph.nodes.values())
      .sort((a, b) => b.inDegree - a.inDegree)
      .slice(0, limit)
      .map((node) => ({
        id: node.id,
        name: node.name,
        type: "workflow" as const,
        dependentCount: node.inDegree,
      }));
  }

  /**
   * Find circular dependencies
   */
  findCircularDependencies(workflows: Workflow[]): string[][] {
    return this.dependencyAnalyzer.findCircularDependencies(workflows);
  }

  /**
   * Get impact analysis for a resource
   */
  getImpactAnalysis(
    resourceId: string,
    type: "workflow" | "state" | "image",
    workflows: Workflow[],
    states: State[]
  ) {
    if (type === "workflow") {
      return this.dependencyAnalyzer.getImpactAnalysis(resourceId, workflows);
    }

    // For states and images, analyze usage
    const affectedWorkflows: string[] = [];
    const affectedStates: string[] = [];

    if (type === "image") {
      // Find states using this image
      states.forEach((state) => {
        const usesImage = state.stateImages.some((si) =>
          si.patterns.some((p) => p.imageId === resourceId)
        );
        if (usesImage) {
          affectedStates.push(state.id);
        }
      });

      // Find workflows using this image
      workflows.forEach((workflow) => {
        const usesImage = workflow.actions.some((action) => {
          const config = action.config as { target?: { image?: string }; imageId?: string };
          return (
            config.target?.image === resourceId || config.imageId === resourceId
          );
        });
        if (usesImage) {
          affectedWorkflows.push(workflow.id);
        }
      });
    } else if (type === "state") {
      // Find workflows using this state
      workflows.forEach((workflow) => {
        const usesState = workflow.actions.some((action) => {
          if (action.type === "GO_TO_STATE") {
            const config = action.config as { stateId?: string };
            return config.stateId === resourceId;
          }
          return false;
        });
        if (usesState) {
          affectedWorkflows.push(workflow.id);
        }
      });
    }

    const totalAffected = affectedWorkflows.length + affectedStates.length;

    return {
      workflowId: resourceId,
      directDependents: [...affectedWorkflows, ...affectedStates],
      allDependents: [...affectedWorkflows, ...affectedStates],
      criticalPaths: [],
      impactLevel:
        totalAffected === 0
          ? "low"
          : totalAffected <= 2
            ? "medium"
            : totalAffected <= 5
              ? "high"
              : ("critical" as const),
      affectedCount: totalAffected,
    };
  }

  /**
   * Check if transition is circular
   */
  private isTransitionCircular(
    transition: Transition,
    allTransitions: Transition[]
  ): boolean {
    if (transition.type !== "OutgoingTransition" || !transition.toState) {
      return false;
    }

    const visited = new Set<string>();
    const checkCircular = (fromState: string): boolean => {
      if (visited.has(fromState)) return false;
      visited.add(fromState);

      const outgoing = allTransitions.filter(
        (t) => t.type === "OutgoingTransition" && t.fromState === fromState
      ) as Array<{ toState?: string }>;

      for (const t of outgoing) {
        if (t.toState === transition.fromState) return true;
        if (t.toState && checkCircular(t.toState)) return true;
      }

      return false;
    };

    return checkCircular(transition.toState);
  }

  // ==========================================================================
  // 11. Auto-Optimization
  // ==========================================================================

  /**
   * Auto-optimize project based on options
   */
  async autoOptimize(
    workflows: Workflow[],
    states: State[],
    images: ImageAsset[],
    transitions: Transition[],
    options: AutoOptimizationOptions
  ): Promise<AutoOptimizationResult> {
    const result: AutoOptimizationResult = {
      success: true,
      changes: {
        imagesRemoved: 0,
        statesRemoved: 0,
        workflowsRemoved: 0,
        referencesFixed: 0,
        foldersCreated: 0,
        storageSaved: 0,
      },
      errors: [],
      warnings: [],
      summary: "",
    };

    try {
      // Remove unused images
      if (options.removeUnusedImages) {
        const unusedImageIds = this.findUnusedImages(images, workflows, states);

        if (!options.dryRun) {
          // In a real implementation, would delete from backend
          result.changes.imagesRemoved = unusedImageIds.length;
          const savings = unusedImageIds.reduce((sum, id) => {
            const img = images.find((i) => i.id === id);
            return sum + (img?.size || 0);
          }, 0);
          result.changes.storageSaved += savings;
        } else {
          result.warnings.push(
            `Would remove ${unusedImageIds.length} unused images`
          );
        }
      }

      // Remove orphaned states
      if (options.removeOrphanedStates) {
        const orphanedStateIds = this.findOrphanedStates(states, transitions);

        if (!options.dryRun) {
          // In a real implementation, would delete from backend
          result.changes.statesRemoved = orphanedStateIds.length;
        } else {
          result.warnings.push(
            `Would remove ${orphanedStateIds.length} orphaned states`
          );
        }
      }

      // Organize folders
      if (options.organizeFolders) {
        const unorganized = workflows.filter(
          (w) => !w.category || w.category === "Uncategorized"
        );

        if (!options.dryRun) {
          // Auto-categorize based on workflow characteristics
          const folders = new Set<string>();
          unorganized.forEach((workflow) => {
            const category = this.suggestCategory(workflow);
            if (category !== "Uncategorized") {
              folders.add(category);
            }
          });
          result.changes.foldersCreated = folders.size;
        } else {
          result.warnings.push(
            `Would organize ${unorganized.length} workflows`
          );
        }
      }

      // Generate summary
      const totalChanges = Object.values(result.changes).reduce(
        (sum, val) => sum + val,
        0
      );
      result.summary = options.dryRun
        ? `Dry run: Would make ${totalChanges} changes`
        : `Successfully made ${totalChanges} optimizations`;
    } catch (error) {
      result.success = false;
      result.errors.push(
        error instanceof Error ? error.message : "Unknown error"
      );
    }

    return result;
  }

  /**
   * Suggest category for workflow
   */
  private suggestCategory(workflow: Workflow): string {
    const actionTypes = workflow.actions.map((a) => a.type);

    // UI testing
    if (
      actionTypes.some((t) => ["CLICK", "TYPE", "FIND", "EXISTS"].includes(t))
    ) {
      return "UI Testing";
    }

    // Data processing
    if (
      actionTypes.some((t) => ["FILTER", "MAP", "REDUCE", "SORT"].includes(t))
    ) {
      return "Data Processing";
    }

    // Control flow heavy
    if (
      actionTypes.filter((t) => ["IF", "LOOP", "SWITCH"].includes(t)).length >=
      3
    ) {
      return "Business Logic";
    }

    return "Uncategorized";
  }

  // ==========================================================================
  // 12. Export/Import
  // ==========================================================================

  /**
   * Export optimization report
   */
  exportOptimizationReport(
    workflows: Workflow[],
    states: State[],
    images: ImageAsset[],
    transitions: Transition[]
  ): OptimizationReport {
    const healthReport = this.getHealthReport(
      workflows,
      states,
      images,
      transitions
    );

    return {
      metadata: {
        generatedAt: new Date().toISOString(),
        projectName: "qontinui-project",
        version: "1.0.0",
      },
      health: healthReport.health,
      suggestions: healthReport.suggestions,
      issues: healthReport.issues,
      resources: {
        workflows: workflows.length,
        states: states.length,
        images: images.length,
        transitions: transitions.length,
      },
      storage: healthReport.storage,
    };
  }

  /**
   * Export backup before optimization
   */
  exportBackup(
    workflows: Workflow[],
    states: State[],
    images: ImageAsset[],
    transitions: Transition[]
  ): string {
    const backup = {
      timestamp: new Date().toISOString(),
      workflows,
      states,
      images: images.map((img) => ({
        ...img,
        url: undefined, // Don't include URLs in backup
      })),
      transitions,
    };

    return JSON.stringify(backup, null, 2);
  }

  // ==========================================================================
  // 13. Monitoring
  // ==========================================================================

  /**
   * Track project metrics
   */
  trackProjectMetrics(
    workflows: Workflow[],
    states: State[],
    images: ImageAsset[],
    transitions: Transition[]
  ): void {
    const health = this.calculateProjectHealth(
      workflows,
      states,
      images,
      transitions
    );
    const coverage = {
      tests: this.calculateTestCoverage(workflows).overall,
      documentation: this.calculateDocumentationCoverage(workflows).overall,
    };

    const workflowAnalyses = this.analyzeWorkflows(workflows, states, images);
    const stateAnalyses = this.analyzeStates(states, transitions, images);
    const transitionAnalyses = this.analyzeTransitions(
      transitions,
      workflows,
      states
    );

    const issues = {
      critical:
        workflowAnalyses.filter((w) => w.status === "critical").length +
        stateAnalyses.filter((s) => s.status === "critical").length +
        transitionAnalyses.filter((t) => t.status === "critical").length,
      warnings:
        workflowAnalyses.filter((w) => w.status === "warning").length +
        stateAnalyses.filter((s) => s.status === "warning").length,
      info: 0,
    };

    const storage = this.getStorageUsage(
      workflows,
      states,
      images,
      transitions
    );

    const metrics: ProjectMetrics = {
      timestamp: new Date().toISOString(),
      healthScore: health,
      counts: {
        workflows: workflows.length,
        states: states.length,
        images: images.length,
        transitions: transitions.length,
      },
      coverage,
      issues,
      storage: storage.total,
    };

    this.metricsHistory.push(metrics);

    // Keep only last 100 snapshots
    if (this.metricsHistory.length > 100) {
      this.metricsHistory = this.metricsHistory.slice(-100);
    }

    this.saveToStorage();

    // Check alerts
    this.checkAlerts(metrics);
  }

  /**
   * Get metrics trend
   */
  getMetricsTrend(days: number = 7): MetricsTrend {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const metrics = this.metricsHistory.filter(
      (m) => new Date(m.timestamp) >= cutoff
    );

    if (metrics.length === 0) {
      return {
        metrics: [],
        trend: {
          health: "stable",
          coverage: "stable",
          issues: "stable",
        },
        period: {
          start: cutoff.toISOString(),
          end: new Date().toISOString(),
        },
      };
    }

    // Calculate trends
    const firstMetric = metrics[0];
    const lastMetric = metrics[metrics.length - 1];

    if (!firstMetric || !lastMetric) {
      return {
        metrics,
        trend: {
          health: "stable",
          coverage: "stable",
          issues: "stable",
        },
        period: {
          start: new Date().toISOString(),
          end: new Date().toISOString(),
        },
      };
    }

    const healthTrend = this.calculateTrend(
      firstMetric.healthScore,
      lastMetric.healthScore
    );
    const coverageTrend = this.calculateTrend(
      (firstMetric.coverage.tests + firstMetric.coverage.documentation) / 2,
      (lastMetric.coverage.tests + lastMetric.coverage.documentation) / 2
    );
    const issuesTrend = this.calculateTrend(
      -(firstMetric.issues.critical + firstMetric.issues.warnings),
      -(lastMetric.issues.critical + lastMetric.issues.warnings)
    );

    return {
      metrics,
      trend: {
        health: healthTrend,
        coverage: coverageTrend,
        issues: issuesTrend,
      },
      period: {
        start: metrics[0]?.timestamp ?? new Date().toISOString(),
        end: metrics[metrics.length - 1]?.timestamp ?? new Date().toISOString(),
      },
    };
  }

  /**
   * Calculate trend direction
   */
  private calculateTrend(
    oldValue: number,
    newValue: number
  ): "improving" | "declining" | "stable" {
    const diff = newValue - oldValue;
    const threshold = 5; // 5% change

    if (diff > threshold) return "improving";
    if (diff < -threshold) return "declining";
    return "stable";
  }

  /**
   * Set health alerts
   */
  setHealthAlerts(thresholds: {
    healthDrop?: number;
    criticalIssues?: number;
    storageLimit?: number;
  }): void {
    this.alerts = [];

    if (thresholds.healthDrop !== undefined) {
      this.alerts.push({
        id: "health-drop",
        type: "health-drop",
        threshold: thresholds.healthDrop,
        enabled: true,
      });
    }

    if (thresholds.criticalIssues !== undefined) {
      this.alerts.push({
        id: "critical-issues",
        type: "critical-issue",
        threshold: thresholds.criticalIssues,
        enabled: true,
      });
    }

    if (thresholds.storageLimit !== undefined) {
      this.alerts.push({
        id: "storage-limit",
        type: "storage-limit",
        threshold: thresholds.storageLimit,
        enabled: true,
      });
    }

    this.saveToStorage();
  }

  /**
   * Check alerts against current metrics
   */
  private checkAlerts(currentMetrics: ProjectMetrics): void {
    if (this.metricsHistory.length < 2) return;

    const previousMetrics = this.metricsHistory[this.metricsHistory.length - 2];

    this.alerts.forEach((alert) => {
      if (!alert.enabled) return;

      let shouldTrigger = false;
      let currentValue = 0;
      let previousValue = 0;
      let message = "";

      switch (alert.type) {
        case "health-drop":
          currentValue = currentMetrics.healthScore;
          previousValue = previousMetrics?.healthScore ?? currentValue;
          const drop = previousValue - currentValue;
          if (drop >= alert.threshold) {
            shouldTrigger = true;
            message = `Health score dropped by ${drop.toFixed(1)} points`;
          }
          break;

        case "critical-issue":
          currentValue = currentMetrics.issues.critical;
          previousValue = previousMetrics?.issues.critical ?? 0;
          if (currentValue >= alert.threshold) {
            shouldTrigger = true;
            message = `${currentValue} critical issues detected`;
          }
          break;

        case "storage-limit":
          currentValue = currentMetrics.storage;
          previousValue = previousMetrics?.storage ?? 0;
          if (currentValue >= alert.threshold) {
            shouldTrigger = true;
            message = `Storage usage (${this.formatBytes(currentValue)}) exceeded threshold`;
          }
          break;
      }

      if (shouldTrigger && alert.callback && message) {
        const trigger: HealthAlertTrigger = {
          alert,
          currentValue,
          previousValue,
          timestamp: new Date().toISOString(),
          message,
        };
        alert.callback(trigger);
      }
    });
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Collect issues from analyses
   */
  private collectIssues(
    workflows: WorkflowAnalysis[],
    states: StateAnalysis[],
    images: ImageAnalysis[]
  ): ProjectIssue[] {
    const issues: ProjectIssue[] = [];
    let issueId = 1;

    workflows.forEach((w) => {
      if (w.status === "critical" || w.status === "warning") {
        w.issues.forEach((issue) => {
          issues.push({
            id: `issue-${issueId++}`,
            severity: w.status === "critical" ? "error" : "warning",
            type: issue.includes("broken")
              ? "broken-reference"
              : issue.includes("test")
                ? "missing-test"
                : issue.includes("doc")
                  ? "missing-doc"
                  : issue.includes("complex")
                    ? "high-complexity"
                    : "unused-resource",
            message: issue,
            resource: {
              type: "workflow",
              id: w.workflowId,
              name: w.name,
            },
          });
        });
      }
    });

    states.forEach((s) => {
      if (s.status === "critical" || s.status === "warning") {
        s.issues.forEach((issue) => {
          issues.push({
            id: `issue-${issueId++}`,
            severity: s.status === "critical" ? "error" : "warning",
            type: issue.includes("broken")
              ? "broken-reference"
              : "unused-resource",
            message: issue,
            resource: {
              type: "state",
              id: s.stateId,
              name: s.name,
            },
          });
        });
      }
    });

    images.forEach((i) => {
      if (i.status === "warning") {
        i.issues.forEach((issue) => {
          issues.push({
            id: `issue-${issueId++}`,
            severity: "warning",
            type: issue.includes("duplicate") ? "duplicate" : "unused-resource",
            message: issue,
            resource: {
              type: "image",
              id: i.imageId,
              name: i.name,
            },
          });
        });
      }
    });

    return issues;
  }

  /**
   * Calculate string similarity (Levenshtein distance)
   */
  private calculateStringSimilarity(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix: number[][] = [];

    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }

    const firstRow = matrix[0];
    if (firstRow) {
      for (let j = 0; j <= len2; j++) {
        firstRow[j] = j;
      }
    }

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        const prevRow = matrix[i - 1];
        const currRow = matrix[i];
        const prevRowPrev = prevRow?.[j - 1];
        const prevRowCurr = prevRow?.[j];
        const currRowPrev = currRow?.[j - 1];

        if (
          prevRowPrev !== undefined &&
          prevRowCurr !== undefined &&
          currRowPrev !== undefined &&
          currRow
        ) {
          currRow[j] = Math.min(
            prevRowCurr + 1,
            currRowPrev + 1,
            prevRowPrev + cost
          );
        }
      }
    }

    const lastRow = matrix[len1];
    const distance = lastRow?.[len2] ?? 0;
    const maxLen = Math.max(len1, len2);
    return maxLen === 0 ? 1 : 1 - distance / maxLen;
  }

  /**
   * Estimate localStorage size for keys
   */
  private estimateLocalStorageSize(prefix: string): number {
    let size = 0;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        const value = localStorage.getItem(key);
        if (value) {
          size += value.length * 2; // UTF-16 encoding
        }
      }
    }

    return size;
  }

  /**
   * Format bytes to human readable
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return "0 Bytes";

    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  }

  /**
   * Save to localStorage
   */
  private saveToStorage(): void {
    try {
      localStorage.setItem(
        this.STORAGE_KEY,
        JSON.stringify(this.metricsHistory)
      );
      localStorage.setItem(
        this.ALERTS_STORAGE_KEY,
        JSON.stringify(this.alerts)
      );
    } catch (error) {
      console.error("Failed to save optimization metrics:", error);
    }
  }

  /**
   * Load from localStorage
   */
  private loadFromStorage(): void {
    try {
      const metricsJson = localStorage.getItem(this.STORAGE_KEY);
      if (metricsJson) {
        this.metricsHistory = JSON.parse(metricsJson);
      }

      const alertsJson = localStorage.getItem(this.ALERTS_STORAGE_KEY);
      if (alertsJson) {
        this.alerts = JSON.parse(alertsJson);
      }
    } catch (error) {
      console.error("Failed to load optimization metrics:", error);
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const projectOptimizationService =
  ProjectOptimizationService.getInstance();

export default projectOptimizationService;
