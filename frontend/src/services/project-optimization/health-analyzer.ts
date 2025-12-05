/**
 * Health Analyzer Module
 *
 * Responsible for:
 * - Project health scoring
 * - Health factor calculation
 * - Health report generation
 * - Health alerts
 * - Metrics tracking
 */

import type { Workflow } from "@/lib/action-schema/action-types";
import type {
  State,
  ImageAsset,
  Transition,
} from "@/contexts/automation-context/types";
import { workflowComplexityAnalyzer } from "../workflow-complexity-analyzer";
import type {
  ProjectHealth,
  HealthFactor,
  HealthReport,
  WorkflowAnalysis,
  StateAnalysis,
  ImageAnalysis,
  TransitionAnalysis,
  ProjectIssue,
  ProjectMetrics,
  MetricsTrend,
  HealthAlert,
  HealthAlertTrigger,
} from "./types";
import {
  analyzeWorkflows,
  analyzeStates,
  analyzeImages,
  analyzeTransitions,
} from "./resource-analyzer";
import {
  calculateTestCoverage,
  calculateDocumentationCoverage,
} from "./coverage-analyzer";
import { getStorageUsage } from "./storage-analyzer";
import { generateSuggestions } from "./suggestion-generator";
import { formatBytes } from "./utils";

/**
 * Calculate overall project health score (0-100)
 */
export function calculateProjectHealth(
  workflows: Workflow[],
  states: State[],
  images: ImageAsset[],
  transitions: Transition[]
): number {
  const health = getHealthReport(workflows, states, images, transitions);
  return health.health.score;
}

/**
 * Get detailed health report with breakdown
 */
export function getHealthReport(
  workflows: Workflow[],
  states: State[],
  images: ImageAsset[],
  transitions: Transition[]
): HealthReport {
  // Analyze all resources
  const workflowAnalyses = analyzeWorkflows(workflows, states, images);
  const stateAnalyses = analyzeStates(states, transitions, images);
  const imageAnalyses = analyzeImages(images, workflows, states);
  const transitionAnalyses = analyzeTransitions(transitions, workflows, states);

  // Calculate health factors
  const testCoverage = calculateTestCoverageFactor(workflows);
  const documentationCoverage = calculateDocumentationCoverageFactor(workflows);
  const organization = calculateOrganizationFactor(workflows);
  const complexity = calculateComplexityFactor(workflows);
  const unusedResources = calculateUnusedResourcesFactor(
    workflowAnalyses,
    stateAnalyses,
    imageAnalyses
  );
  const brokenReferences = calculateBrokenReferencesFactor(
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

  const rating = getHealthRating(overallScore);

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
  const suggestions = generateSuggestions(
    workflowAnalyses,
    stateAnalyses,
    imageAnalyses,
    transitionAnalyses
  );

  const issues = collectIssues(
    workflowAnalyses,
    stateAnalyses,
    imageAnalyses,
    transitionAnalyses
  );

  const storage = getStorageUsage(workflows, states, images, transitions);

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
function getHealthRating(
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
function calculateTestCoverageFactor(workflows: Workflow[]): HealthFactor {
  const coverage = calculateTestCoverage(workflows);
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
function calculateDocumentationCoverageFactor(
  workflows: Workflow[]
): HealthFactor {
  const coverage = calculateDocumentationCoverage(workflows);
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
function calculateOrganizationFactor(workflows: Workflow[]): HealthFactor {
  const unorganized = workflows.filter(
    (w) => !w.category || w.category === "Uncategorized"
  );
  const score = Math.round(
    ((workflows.length - unorganized.length) / Math.max(workflows.length, 1)) *
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
function calculateComplexityFactor(workflows: Workflow[]): HealthFactor {
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
function calculateUnusedResourcesFactor(
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
function calculateBrokenReferencesFactor(
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

/**
 * Collect issues from analyses
 */
function collectIssues(
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
 * Track project metrics
 */
export function createMetricsSnapshot(
  workflows: Workflow[],
  states: State[],
  images: ImageAsset[],
  transitions: Transition[]
): ProjectMetrics {
  const health = calculateProjectHealth(workflows, states, images, transitions);
  const coverage = {
    tests: calculateTestCoverage(workflows).overall,
    documentation: calculateDocumentationCoverage(workflows).overall,
  };

  const workflowAnalyses = analyzeWorkflows(workflows, states, images);
  const stateAnalyses = analyzeStates(states, transitions, images);
  const transitionAnalyses = analyzeTransitions(transitions, workflows, states);

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

  const storage = getStorageUsage(workflows, states, images, transitions);

  return {
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
}

/**
 * Calculate metrics trend
 */
export function calculateMetricsTrend(
  metrics: ProjectMetrics[],
  days: number = 7
): MetricsTrend {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const filtered = metrics.filter((m) => new Date(m.timestamp) >= cutoff);

  if (filtered.length === 0) {
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
  const firstMetric = filtered[0];
  const lastMetric = filtered[filtered.length - 1];

  const healthTrend = calculateTrend(
    firstMetric.healthScore,
    lastMetric.healthScore
  );
  const coverageTrend = calculateTrend(
    (firstMetric.coverage.tests + firstMetric.coverage.documentation) / 2,
    (lastMetric.coverage.tests + lastMetric.coverage.documentation) / 2
  );
  const issuesTrend = calculateTrend(
    -(firstMetric.issues.critical + firstMetric.issues.warnings),
    -(lastMetric.issues.critical + lastMetric.issues.warnings)
  );

  return {
    metrics: filtered,
    trend: {
      health: healthTrend,
      coverage: coverageTrend,
      issues: issuesTrend,
    },
    period: {
      start: filtered[0].timestamp,
      end: filtered[filtered.length - 1].timestamp,
    },
  };
}

/**
 * Calculate trend direction
 */
function calculateTrend(
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
 * Check alerts against current metrics
 */
export function checkAlerts(
  currentMetrics: ProjectMetrics,
  previousMetrics: ProjectMetrics | undefined,
  alerts: HealthAlert[]
): HealthAlertTrigger[] {
  if (!previousMetrics) return [];

  const triggers: HealthAlertTrigger[] = [];

  alerts.forEach((alert) => {
    if (!alert.enabled) return;

    let shouldTrigger = false;
    let currentValue = 0;
    let previousValue = 0;
    let message = "";

    switch (alert.type) {
      case "health-drop":
        currentValue = currentMetrics.healthScore;
        previousValue = previousMetrics.healthScore;
        const drop = previousValue - currentValue;
        if (drop >= alert.threshold) {
          shouldTrigger = true;
          message = `Health score dropped by ${drop.toFixed(1)} points`;
        }
        break;

      case "critical-issue":
        currentValue = currentMetrics.issues.critical;
        previousValue = previousMetrics.issues.critical;
        if (currentValue >= alert.threshold) {
          shouldTrigger = true;
          message = `${currentValue} critical issues detected`;
        }
        break;

      case "storage-limit":
        currentValue = currentMetrics.storage;
        previousValue = previousMetrics.storage;
        if (currentValue >= alert.threshold) {
          shouldTrigger = true;
          message = `Storage usage (${formatBytes(currentValue)}) exceeded threshold`;
        }
        break;
    }

    if (shouldTrigger) {
      triggers.push({
        alert,
        currentValue,
        previousValue,
        timestamp: new Date().toISOString(),
        message,
      });
    }
  });

  return triggers;
}
