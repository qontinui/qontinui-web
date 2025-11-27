/**
 * Project Optimization Service - Main Orchestrator
 *
 * This module ties together all the focused sub-services and maintains
 * backward compatibility with the original ProjectOptimizationService API.
 */

import type { Workflow } from '@/lib/action-schema/action-types';
import type { State, ImageAsset, Transition } from '@/contexts/automation-context/types';

// Import all types
export type * from './types';

// Import all sub-modules
import {
  calculateProjectHealth,
  getHealthReport,
  createMetricsSnapshot,
  calculateMetricsTrend,
  checkAlerts,
} from './health-analyzer';

import {
  analyzeWorkflows,
  analyzeStates,
  analyzeImages,
  analyzeTransitions,
} from './resource-analyzer';

import {
  findUnusedImages,
  findUnusedStates,
  findUnusedWorkflows,
  findOrphanedStates,
} from './unused-resource-detector';

import {
  findDuplicateImages,
  findDuplicateStates,
  findDuplicateWorkflows,
} from './duplicate-detector';

import {
  validateAllReferences,
  findBrokenWorkflowReferences,
  findBrokenStateReferences,
  findBrokenTransitionReferences,
} from './reference-validator';

import {
  getStorageUsage,
  estimateStorageSavings,
  getImageStorageBreakdown,
} from './storage-analyzer';

import {
  getComplexityDistribution,
  findHighComplexityResources,
  suggestComplexityReductions,
} from './complexity-analyzer';

import {
  calculateTestCoverage,
  calculateDocumentationCoverage,
  getUndocumentedResources,
  getUntestedResources,
} from './coverage-analyzer';

import {
  analyzeProjectDependencies,
  findCriticalResources,
  findCircularDependencies,
  getImpactAnalysis,
} from './dependency-analyzer';

import { generateSuggestions } from './suggestion-generator';
import { autoOptimize, exportBackup } from './auto-optimizer';
import { exportOptimizationReport } from './report-exporter';

import type {
  ProjectMetrics,
  MetricsTrend,
  HealthAlert,
  HealthAlertTrigger,
} from './types';

// ============================================================================
// Main Service Class (Singleton)
// ============================================================================

export class ProjectOptimizationService {
  private static instance: ProjectOptimizationService;

  private metricsHistory: ProjectMetrics[] = [];
  private alerts: HealthAlert[] = [];

  private readonly STORAGE_KEY = 'project-optimization-metrics';
  private readonly ALERTS_STORAGE_KEY = 'project-optimization-alerts';

  private constructor() {
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

  calculateProjectHealth(
    workflows: Workflow[],
    states: State[],
    images: ImageAsset[],
    transitions: Transition[]
  ): number {
    return calculateProjectHealth(workflows, states, images, transitions);
  }

  getHealthReport(
    workflows: Workflow[],
    states: State[],
    images: ImageAsset[],
    transitions: Transition[]
  ) {
    return getHealthReport(workflows, states, images, transitions);
  }

  // ==========================================================================
  // 2. Resource Analysis
  // ==========================================================================

  analyzeWorkflows(workflows: Workflow[], states: State[], images: ImageAsset[]) {
    return analyzeWorkflows(workflows, states, images);
  }

  analyzeStates(states: State[], transitions: Transition[], images: ImageAsset[]) {
    return analyzeStates(states, transitions, images);
  }

  analyzeImages(images: ImageAsset[], workflows: Workflow[], states: State[]) {
    return analyzeImages(images, workflows, states);
  }

  analyzeTransitions(transitions: Transition[], workflows: Workflow[], states: State[]) {
    return analyzeTransitions(transitions, workflows, states);
  }

  // ==========================================================================
  // 3. Optimization Suggestions
  // ==========================================================================

  generateSuggestions(
    workflows: ReturnType<typeof analyzeWorkflows>,
    states: ReturnType<typeof analyzeStates>,
    images: ReturnType<typeof analyzeImages>,
    transitions: ReturnType<typeof analyzeTransitions>
  ) {
    return generateSuggestions(workflows, states, images, transitions);
  }

  // ==========================================================================
  // 4. Unused Resource Detection
  // ==========================================================================

  findUnusedImages(images: ImageAsset[], workflows: Workflow[], states: State[]) {
    return findUnusedImages(images, workflows, states);
  }

  findUnusedStates(states: State[], transitions: Transition[]) {
    return findUnusedStates(states, transitions);
  }

  findUnusedWorkflows(workflows: Workflow[]) {
    return findUnusedWorkflows(workflows);
  }

  findOrphanedStates(states: State[], transitions: Transition[]) {
    return findOrphanedStates(states, transitions);
  }

  // ==========================================================================
  // 5. Duplicate Detection
  // ==========================================================================

  findDuplicateImages(image: ImageAsset, allImages: ImageAsset[], threshold: number = 0.9) {
    return findDuplicateImages(image, allImages, threshold);
  }

  findDuplicateStates(state: State, allStates: State[], threshold: number = 0.9) {
    return findDuplicateStates(state, allStates, threshold);
  }

  findDuplicateWorkflows(workflow: Workflow, allWorkflows: Workflow[], threshold: number = 0.9) {
    return findDuplicateWorkflows(workflow, allWorkflows, threshold);
  }

  // ==========================================================================
  // 6. Broken Reference Detection
  // ==========================================================================

  validateAllReferences(
    workflows: Workflow[],
    states: State[],
    images: ImageAsset[],
    transitions: Transition[]
  ) {
    return validateAllReferences(workflows, states, images, transitions);
  }

  findBrokenWorkflowReferences(
    workflow: Workflow,
    allWorkflows: Workflow[],
    states: State[],
    images: ImageAsset[]
  ) {
    return findBrokenWorkflowReferences(workflow, allWorkflows, states, images);
  }

  findBrokenStateReferences(state: State, images: ImageAsset[]) {
    return findBrokenStateReferences(state, images);
  }

  findBrokenTransitionReferences(transition: Transition, workflows: Workflow[], states: State[]) {
    return findBrokenTransitionReferences(transition, workflows, states);
  }

  // ==========================================================================
  // 7. Storage Analysis
  // ==========================================================================

  getStorageUsage(
    workflows: Workflow[],
    states: State[],
    images: ImageAsset[],
    transitions: Transition[]
  ) {
    return getStorageUsage(workflows, states, images, transitions);
  }

  estimateStorageSavings(images: ImageAsset[], workflows: Workflow[], states: State[]) {
    return estimateStorageSavings(images, workflows, states);
  }

  getImageStorageBreakdown(images: ImageAsset[]) {
    return getImageStorageBreakdown(images);
  }

  // ==========================================================================
  // 8. Complexity Analysis
  // ==========================================================================

  getComplexityDistribution(workflows: Workflow[]) {
    return getComplexityDistribution(workflows);
  }

  findHighComplexityResources(workflows: Workflow[], threshold: number = 50) {
    return findHighComplexityResources(workflows, threshold);
  }

  suggestComplexityReductions(workflow: Workflow) {
    return suggestComplexityReductions(workflow);
  }

  // ==========================================================================
  // 9. Coverage Analysis
  // ==========================================================================

  calculateTestCoverage(workflows: Workflow[]) {
    return calculateTestCoverage(workflows);
  }

  calculateDocumentationCoverage(workflows: Workflow[]) {
    return calculateDocumentationCoverage(workflows);
  }

  getUndocumentedResources(workflows: Workflow[]) {
    return getUndocumentedResources(workflows);
  }

  getUntestedResources(workflows: Workflow[]) {
    return getUntestedResources(workflows);
  }

  // ==========================================================================
  // 10. Dependency Analysis
  // ==========================================================================

  analyzeProjectDependencies(workflows: Workflow[]) {
    return analyzeProjectDependencies(workflows);
  }

  findCriticalResources(workflows: Workflow[], limit: number = 10) {
    return findCriticalResources(workflows, limit);
  }

  findCircularDependencies(workflows: Workflow[]) {
    return findCircularDependencies(workflows);
  }

  getImpactAnalysis(
    resourceId: string,
    type: 'workflow' | 'state' | 'image',
    workflows: Workflow[],
    states: State[],
    images: ImageAsset[]
  ) {
    return getImpactAnalysis(resourceId, type, workflows, states, images);
  }

  // ==========================================================================
  // 11. Auto-Optimization
  // ==========================================================================

  async autoOptimize(
    workflows: Workflow[],
    states: State[],
    images: ImageAsset[],
    transitions: Transition[],
    options: Parameters<typeof autoOptimize>[4]
  ) {
    return autoOptimize(workflows, states, images, transitions, options);
  }

  // ==========================================================================
  // 12. Export/Import
  // ==========================================================================

  exportOptimizationReport(
    workflows: Workflow[],
    states: State[],
    images: ImageAsset[],
    transitions: Transition[]
  ) {
    return exportOptimizationReport(workflows, states, images, transitions);
  }

  exportBackup(
    workflows: Workflow[],
    states: State[],
    images: ImageAsset[],
    transitions: Transition[]
  ) {
    return exportBackup(workflows, states, images, transitions);
  }

  // ==========================================================================
  // 13. Monitoring
  // ==========================================================================

  trackProjectMetrics(
    workflows: Workflow[],
    states: State[],
    images: ImageAsset[],
    transitions: Transition[]
  ): void {
    const metrics = createMetricsSnapshot(workflows, states, images, transitions);
    this.metricsHistory.push(metrics);

    // Keep only last 100 snapshots
    if (this.metricsHistory.length > 100) {
      this.metricsHistory = this.metricsHistory.slice(-100);
    }

    this.saveToStorage();

    // Check alerts
    if (this.metricsHistory.length >= 2) {
      const previousMetrics = this.metricsHistory[this.metricsHistory.length - 2];
      const triggers = checkAlerts(metrics, previousMetrics, this.alerts);

      // Execute alert callbacks
      triggers.forEach(trigger => {
        if (trigger.alert.callback) {
          trigger.alert.callback(trigger);
        }
      });
    }
  }

  getMetricsTrend(days: number = 7): MetricsTrend {
    return calculateMetricsTrend(this.metricsHistory, days);
  }

  setHealthAlerts(thresholds: {
    healthDrop?: number;
    criticalIssues?: number;
    storageLimit?: number;
  }): void {
    this.alerts = [];

    if (thresholds.healthDrop !== undefined) {
      this.alerts.push({
        id: 'health-drop',
        type: 'health-drop',
        threshold: thresholds.healthDrop,
        enabled: true,
      });
    }

    if (thresholds.criticalIssues !== undefined) {
      this.alerts.push({
        id: 'critical-issues',
        type: 'critical-issue',
        threshold: thresholds.criticalIssues,
        enabled: true,
      });
    }

    if (thresholds.storageLimit !== undefined) {
      this.alerts.push({
        id: 'storage-limit',
        type: 'storage-limit',
        threshold: thresholds.storageLimit,
        enabled: true,
      });
    }

    this.saveToStorage();
  }

  // ==========================================================================
  // Storage Management
  // ==========================================================================

  private saveToStorage(): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.metricsHistory));
      localStorage.setItem(this.ALERTS_STORAGE_KEY, JSON.stringify(this.alerts));
    } catch (error) {
      console.error('Failed to save optimization metrics:', error);
    }
  }

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
      console.error('Failed to load optimization metrics:', error);
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const projectOptimizationService = ProjectOptimizationService.getInstance();

export default projectOptimizationService;

// ============================================================================
// Re-export all sub-module functions for direct usage
// ============================================================================

export {
  // Health
  calculateProjectHealth,
  getHealthReport,
  createMetricsSnapshot,
  calculateMetricsTrend,
  checkAlerts,

  // Resource Analysis
  analyzeWorkflows,
  analyzeStates,
  analyzeImages,
  analyzeTransitions,

  // Unused Resources
  findUnusedImages,
  findUnusedStates,
  findUnusedWorkflows,
  findOrphanedStates,

  // Duplicates
  findDuplicateImages,
  findDuplicateStates,
  findDuplicateWorkflows,

  // References
  validateAllReferences,
  findBrokenWorkflowReferences,
  findBrokenStateReferences,
  findBrokenTransitionReferences,

  // Storage
  getStorageUsage,
  estimateStorageSavings,
  getImageStorageBreakdown,

  // Complexity
  getComplexityDistribution,
  findHighComplexityResources,
  suggestComplexityReductions,

  // Coverage
  calculateTestCoverage,
  calculateDocumentationCoverage,
  getUndocumentedResources,
  getUntestedResources,

  // Dependencies
  analyzeProjectDependencies,
  findCriticalResources,
  findCircularDependencies,
  getImpactAnalysis,

  // Suggestions
  generateSuggestions,

  // Auto-optimization
  autoOptimize,
  exportBackup,

  // Reports
  exportOptimizationReport,
};
