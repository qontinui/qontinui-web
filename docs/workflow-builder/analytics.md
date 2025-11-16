# Workflow Analytics & Performance

This guide covers workflow analytics, metrics tracking, performance analysis, and optimization suggestions.

## Table of Contents

- [Overview](#overview)
- [Analytics Dashboard](#analytics-dashboard)
- [Metrics Collection](#metrics-collection)
- [Performance Analysis](#performance-analysis)
- [Bottleneck Detection](#bottleneck-detection)
- [Optimization Suggestions](#optimization-suggestions)
- [Reports & Exports](#reports--exports)
- [Best Practices](#best-practices)

## Overview

The Workflow Analytics and Performance systems provide comprehensive insights into workflow execution, performance bottlenecks, and optimization opportunities.

### Key Features

- **Analytics**: Execution metrics, success rates, duration tracking
- **Performance Analysis**: Bottleneck identification, parallelization opportunities
- **Complexity Analysis**: Cyclomatic complexity, cognitive load, maintainability
- **Optimization**: Actionable suggestions for improvement
- **Reporting**: Detailed reports and trend analysis

## Analytics Dashboard

### Workflow Metrics

```typescript
import { workflowAnalyticsService } from '@/services/workflow-analytics-service';

// Get metrics for a workflow
const metrics = workflowAnalyticsService.getWorkflowMetrics(workflowId);

console.log(`Execution Count: ${metrics.executionCount}`);
console.log(`Success Rate: ${metrics.successRate}%`);
console.log(`Average Duration: ${metrics.averageDuration}ms`);
console.log(`Last Executed: ${new Date(metrics.lastExecuted).toLocaleString()}`);
```

### Metrics Structure

```typescript
interface WorkflowMetrics {
  workflowId: string;
  workflowName: string;

  // Execution stats
  executionCount: number;
  successCount: number;
  failureCount: number;
  errorCount: number;

  // Performance
  averageDuration: number;
  minDuration: number;
  maxDuration: number;
  totalDuration: number;

  // Success rate
  successRate: number;

  // Timestamps
  firstExecuted?: string;
  lastExecuted?: string;

  // Trend data
  trend?: 'improving' | 'declining' | 'stable';
}
```

### Record Execution

```typescript
// Record workflow execution
workflowAnalyticsService.recordExecution({
  workflowId: 'workflow-123',
  workflowName: 'Login Flow',
  duration: 1500,
  success: true,
  timestamp: new Date().toISOString(),
  metadata: {
    environment: 'production',
    userId: 'user-456'
  }
});
```

### Performance Report

```typescript
// Get performance report
const report = workflowAnalyticsService.generatePerformanceReport(workflowId);

console.log(report.summary);
console.log(`Avg Duration: ${report.averageDuration}ms`);
console.log(`P95 Duration: ${report.p95Duration}ms`);
console.log(`Success Rate: ${report.successRate}%`);
```

## Metrics Collection

### Automatic Tracking

```typescript
// Metrics are automatically collected during workflow execution
// This happens in the execution engine

async function executeWorkflow(workflow: Workflow) {
  const startTime = Date.now();

  try {
    // Execute workflow
    const result = await runWorkflow(workflow);

    // Record success
    workflowAnalyticsService.recordExecution({
      workflowId: workflow.id,
      workflowName: workflow.name,
      duration: Date.now() - startTime,
      success: true,
      timestamp: new Date().toISOString()
    });

    return result;
  } catch (error) {
    // Record failure
    workflowAnalyticsService.recordExecution({
      workflowId: workflow.id,
      workflowName: workflow.name,
      duration: Date.now() - startTime,
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });

    throw error;
  }
}
```

### Custom Metrics

```typescript
// Track custom metrics
workflowAnalyticsService.recordCustomMetric({
  workflowId: 'workflow-123',
  metricName: 'apiCallCount',
  value: 5,
  timestamp: new Date().toISOString()
});

workflowAnalyticsService.recordCustomMetric({
  workflowId: 'workflow-123',
  metricName: 'dataProcessed',
  value: 1000,
  unit: 'records',
  timestamp: new Date().toISOString()
});
```

### Metrics Aggregation

```typescript
// Get aggregated metrics
const aggregated = workflowAnalyticsService.getAggregatedMetrics({
  workflowIds: ['wf-1', 'wf-2', 'wf-3'],
  period: 'last-7-days',
  groupBy: 'day'
});

aggregated.forEach(day => {
  console.log(`Date: ${day.date}`);
  console.log(`  Executions: ${day.executionCount}`);
  console.log(`  Avg Duration: ${day.averageDuration}ms`);
  console.log(`  Success Rate: ${day.successRate}%`);
});
```

## Performance Analysis

### Analyze Workflow Performance

```typescript
import { workflowPerformanceAnalyzer } from '@/services/workflow-performance-analyzer';

// Analyze workflow performance (static or with execution data)
const analysis = workflowPerformanceAnalyzer.analyzePerformance(workflow);

console.log(`Performance Score: ${analysis.performanceScore}/100`);
console.log(`Bottleneck Score: ${analysis.bottleneckScore}/100`);
console.log(`Estimated Time: ${analysis.estimatedExecutionTime}ms`);
```

### Performance Metrics

```typescript
interface PerformanceAnalysisResult {
  // Overall scores
  performanceScore: number;        // 0-100, higher is better
  bottleneckScore: number;         // 0-100, higher is worse

  // Timing
  estimatedExecutionTime: number;  // ms
  actualExecutionTime?: number;    // ms (if execution data available)

  // Analysis results
  bottlenecks: PerformanceBottleneck[];
  suggestions: OptimizationSuggestion[];
  parallelizationOpportunities: ParallelizationOpportunity[];

  // Detailed analysis
  waitAnalysis: WaitAnalysis;
  loopAnalysis: LoopAnalysis;
  resourceAnalysis: ResourceAnalysis;

  // Visualization
  heatmap: PerformanceHeatmap;
  criticalPath?: string[];

  timestamp: Date;
}
```

### With Execution Data

```typescript
// Analyze with actual execution data
const executionData: ExecutionData = {
  totalDuration: 2500,
  actionStates: {
    'action-1': { status: 'success', duration: 500 },
    'action-2': { status: 'success', duration: 1000 },
    'action-3': { status: 'success', duration: 1000 }
  },
  executionOrder: ['action-1', 'action-2', 'action-3']
};

const analysis = workflowPerformanceAnalyzer.analyzePerformance(
  workflow,
  executionData
);

// Now includes actual vs estimated comparison
console.log(`Estimated: ${analysis.estimatedExecutionTime}ms`);
console.log(`Actual: ${analysis.actualExecutionTime}ms`);
```

## Bottleneck Detection

### Identify Bottlenecks

```typescript
// Get bottlenecks
const bottlenecks = analysis.bottlenecks;

bottlenecks.forEach(bottleneck => {
  console.log(`Type: ${bottleneck.type}`);
  console.log(`Severity: ${bottleneck.severity}/100`);
  console.log(`Description: ${bottleneck.description}`);
  console.log(`Impact: ${bottleneck.estimatedImpact}ms saved if fixed`);
  console.log('Suggestions:');
  bottleneck.suggestions.forEach(s => console.log(`  - ${s}`));
  console.log('');
});
```

### Bottleneck Types

```typescript
type BottleneckType =
  | 'slow_action'              // Individual action is slow
  | 'unnecessary_wait'          // Fixed waits that could be dynamic
  | 'sequential_operations'     // Actions that could be parallel
  | 'loop'                      // Inefficient loops
  | 'resource_intensive';       // Heavy resource usage

interface PerformanceBottleneck {
  type: BottleneckType;
  severity: number;             // 0-100
  actionIds: string[];
  description: string;
  estimatedImpact: number;      // ms
  suggestions: string[];
}
```

### Wait Analysis

```typescript
// Analyze wait actions
const waitAnalysis = analysis.waitAnalysis;

console.log(`Total Wait Time: ${waitAnalysis.totalWaitTime}ms`);
console.log(`Wait Actions: ${waitAnalysis.waitCount}`);
console.log(`Fixed Waits: ${waitAnalysis.fixedWaits.length}`);
console.log(`Long Waits: ${waitAnalysis.longWaits.length}`);
console.log(`Missing Waits: ${waitAnalysis.missingWaits.length}`);

// Fixed waits that could be dynamic
waitAnalysis.fixedWaits.forEach(wait => {
  console.log(`Action ${wait.actionId}: ${wait.duration}ms`);
  console.log(`  Suggestion: ${wait.suggestion}`);
});

// WAIT + FIND patterns (redundant)
waitAnalysis.waitFindPatterns.forEach(pattern => {
  console.log(`WAIT followed by FIND:`);
  console.log(`  ${pattern.waitActionId} → ${pattern.findActionId}`);
  console.log(`  ${pattern.suggestion}`);
});
```

### Loop Analysis

```typescript
// Analyze loop efficiency
const loopAnalysis = analysis.loopAnalysis;

console.log(`Loop Count: ${loopAnalysis.loopCount}`);
console.log(`Infinite Loop Risks: ${loopAnalysis.infiniteLoopRisks.length}`);
console.log(`Nested Loops: ${loopAnalysis.nestedLoops.length}`);

// Risky loops
loopAnalysis.infiniteLoopRisks.forEach(risk => {
  console.log(`Loop ${risk.actionId}:`);
  console.log(`  Severity: ${risk.severity}`);
  console.log(`  Reason: ${risk.reason}`);
});

// Nested loops (potential performance issues)
loopAnalysis.nestedLoops.forEach(nested => {
  console.log(`Nested loop complexity: ${nested.complexity}`);
  console.log(`  Parent: ${nested.parentLoopId}`);
  console.log(`  Children: ${nested.childLoopIds.join(', ')}`);
});
```

### Resource Analysis

```typescript
// Analyze resource usage
const resourceAnalysis = analysis.resourceAnalysis;

console.log(`Screenshot Count: ${resourceAnalysis.screenshotCount}`);
console.log(`State Transitions: ${resourceAnalysis.stateTransitionCount}`);
console.log(`Resource Score: ${resourceAnalysis.resourceScore}/100`);

// Heavy computations
resourceAnalysis.heavyComputations.forEach(comp => {
  console.log(`Heavy action: ${comp.actionId}`);
  console.log(`  Type: ${comp.type}`);
  console.log(`  Reason: ${comp.reason}`);
});
```

## Optimization Suggestions

### Get Suggestions

```typescript
// Get optimization suggestions
const suggestions = analysis.suggestions;

// Sort by priority
suggestions.sort((a, b) => b.priority - a.priority);

suggestions.forEach(suggestion => {
  console.log(`\n[Priority ${suggestion.priority}/5] ${suggestion.title}`);
  console.log(`Type: ${suggestion.type}`);
  console.log(`Description: ${suggestion.description}`);

  if (suggestion.expectedSpeedup) {
    console.log(`Expected Speedup: ${suggestion.expectedSpeedup}`);
  }

  if (suggestion.difficulty) {
    console.log(`Difficulty: ${suggestion.difficulty}/5`);
  }

  console.log(`Affects ${suggestion.actionIds.length} action(s)`);
});
```

### Suggestion Types

```typescript
type SuggestionType =
  | 'parallelize'           // Run actions in parallel
  | 'replace_wait'          // Replace fixed WAIT with dynamic
  | 'add_caching'           // Cache repeated operations
  | 'optimize_loop'         // Optimize loop iterations
  | 'split_workflow'        // Break into smaller workflows
  | 'add_error_handling'    // Add error handling
  | 'remove_redundant'      // Remove duplicate operations
  | 'reduce_screenshots'    // Reduce screenshot count
  | 'add_wait'              // Add missing wait
  | 'reduce_wait';          // Reduce wait duration

interface OptimizationSuggestion {
  type: SuggestionType;
  priority: number;         // 1-5, 5 is highest
  actionIds: string[];
  title: string;
  description: string;
  expectedSpeedup?: number | string;
  difficulty?: number;      // 1-5
}
```

### Parallelization Opportunities

```typescript
// Find parallelization opportunities
const opportunities = analysis.parallelizationOpportunities;

opportunities.forEach(opp => {
  const actionCount = opp.groups.reduce((sum, g) => sum + g.length, 0);

  console.log(`\nParallelization Opportunity:`);
  console.log(`  ${actionCount} actions can run in parallel`);
  console.log(`  Estimated speedup: ${opp.estimatedSpeedup}ms`);
  console.log(`  Reason: ${opp.reason}`);

  if (opp.caveats) {
    console.log('  Caveats:');
    opp.caveats.forEach(c => console.log(`    - ${c}`));
  }
});
```

### Apply Optimizations

```typescript
// Apply optimization suggestion
function applyOptimization(
  workflow: Workflow,
  suggestion: OptimizationSuggestion
): Workflow {
  switch (suggestion.type) {
    case 'parallelize':
      return parallelizeActions(workflow, suggestion.actionIds);

    case 'replace_wait':
      return replaceWaitWithFind(workflow, suggestion.actionIds[0]);

    case 'remove_redundant':
      return removeRedundantActions(workflow, suggestion.actionIds);

    // ... other optimization types

    default:
      console.warn(`Unknown optimization type: ${suggestion.type}`);
      return workflow;
  }
}
```

## Complexity Analysis

### Analyze Complexity

```typescript
import { workflowComplexityAnalyzer } from '@/services/workflow-complexity-analyzer';

// Analyze workflow complexity
const complexity = workflowComplexityAnalyzer.analyzeComplexity(workflow);

console.log(`Cyclomatic Complexity: ${complexity.cyclomaticComplexity}`);
console.log(`Cognitive Complexity: ${complexity.cognitiveComplexity}`);
console.log(`Nesting Depth: ${complexity.maxNestingDepth}`);
console.log(`Maintainability Index: ${complexity.maintainabilityIndex}/100`);
```

### Complexity Metrics

```typescript
interface ComplexityMetrics {
  // Cyclomatic complexity (control flow complexity)
  cyclomaticComplexity: number;

  // Cognitive complexity (how hard to understand)
  cognitiveComplexity: number;

  // Nesting depth
  maxNestingDepth: number;
  averageNestingDepth: number;

  // Maintainability
  maintainabilityIndex: number;  // 0-100

  // Code smells
  codeSmells: CodeSmell[];

  // Action counts
  actionCounts: {
    total: number;
    byType: Record<string, number>;
  };
}
```

### Code Smells

```typescript
// Detect code smells
const smells = complexity.codeSmells;

smells.forEach(smell => {
  console.log(`\n${smell.type}:`);
  console.log(`  Severity: ${smell.severity}`);
  console.log(`  Description: ${smell.description}`);
  console.log(`  Location: ${smell.location}`);
  console.log(`  Suggestion: ${smell.suggestion}`);
});
```

## Reports & Exports

### Generate Performance Report

```typescript
// Generate comprehensive report
const report = workflowPerformanceAnalyzer.generatePerformanceReport(
  workflow,
  executionData
);

console.log(report);
```

### Report Example

```markdown
# Workflow Performance Analysis Report

**Workflow:** Login Flow
**Analysis Date:** 2024-01-15 10:30:00

## Overall Performance

- **Performance Score:** 72.5/100
- **Bottleneck Score:** 45.2/100 ⚠️
- **Estimated Execution Time:** 2500ms
- **Actual Execution Time:** 2650ms
- **Total Actions:** 15

## Identified Bottlenecks

### slow_action (Severity: 65)

Action "Wait for Dashboard" takes 1000ms, which is 4x longer than average

**Estimated Impact:** 750ms

**Suggestions:**
- Review action configuration for inefficiencies
- Consider using a more efficient approach
- Check if this action can be cached or optimized

## Top Optimization Suggestions

### Parallelize 4 independent actions (Priority: 5/5)

These actions have no dependencies and can run simultaneously

**Expected Speedup:** 800ms
**Implementation Difficulty:** 2/5

### Replace fixed WAIT with dynamic condition (Priority: 4/5)

This WAIT action uses a fixed duration. Consider using a FIND action instead.

**Implementation Difficulty:** 1/5

## Wait Analysis

- **Total Wait Time:** 1500ms
- **Wait Actions:** 3
- **Fixed Waits (could be dynamic):** 2
- **Unnecessarily Long Waits:** 1
- **Missing Waits:** 0

## Resource Usage

- **Screenshot Operations:** 2
- **State Transitions:** 3
- **Heavy Computations:** 0
- **Resource Usage Score:** 25/100
```

### Export Analytics Data

```typescript
// Export to JSON
const analyticsData = workflowAnalyticsService.exportAnalytics(workflowId);

// Export to CSV
const csv = workflowAnalyticsService.exportAnalyticsCSV(workflowId);

// Export performance analysis
const performanceData = workflowPerformanceAnalyzer.exportOptimizationReport(workflow);
```

### Trend Analysis

```typescript
// Get performance trends over time
const trends = workflowAnalyticsService.getPerformanceTrends(workflowId, {
  period: 'last-30-days',
  granularity: 'day'
});

trends.forEach(day => {
  console.log(`${day.date}:`);
  console.log(`  Avg Duration: ${day.avgDuration}ms (${day.trend})`);
  console.log(`  Success Rate: ${day.successRate}%`);
  console.log(`  Executions: ${day.executionCount}`);
});
```

### Compare Workflows

```typescript
// Compare two workflows
const comparison = workflowPerformanceAnalyzer.comparePerformance(
  workflow1,
  workflow2
);

console.log(`Winner: ${comparison.winner}`);
console.log(`\nPerformance Score Delta: ${comparison.differences.performanceScoreDelta}`);
console.log(`Execution Time Delta: ${comparison.differences.executionTimeDelta}ms`);
console.log(`\nSummary: ${comparison.summary}`);
```

### Performance Heatmap

```typescript
// Generate performance heatmap
const heatmap = analysis.heatmap;

// Use for visualization
Object.entries(heatmap.actionMetrics).forEach(([actionId, metrics]) => {
  console.log(`${actionId}:`);
  console.log(`  Score: ${metrics.score}/100`);
  console.log(`  Duration: ${metrics.duration}ms`);
  console.log(`  Status: ${metrics.status}`);
  console.log(`  Color: ${metrics.color}`);
});
```

## Best Practices

### Performance Monitoring

```typescript
// Monitor workflow performance continuously
function monitorWorkflowPerformance(workflowId: string) {
  const metrics = workflowAnalyticsService.getWorkflowMetrics(workflowId);

  // Alert on degradation
  if (metrics.successRate < 90) {
    alert(`Warning: Success rate dropped to ${metrics.successRate}%`);
  }

  if (metrics.averageDuration > 5000) {
    alert(`Warning: Average duration increased to ${metrics.averageDuration}ms`);
  }

  // Analyze if problems detected
  if (metrics.successRate < 90 || metrics.averageDuration > 5000) {
    const workflow = getWorkflow(workflowId);
    const analysis = workflowPerformanceAnalyzer.analyzePerformance(workflow);

    console.log('Performance issues detected. Top suggestions:');
    analysis.suggestions.slice(0, 3).forEach(s => {
      console.log(`- ${s.title}`);
    });
  }
}
```

### Regular Analysis

```typescript
// Run regular performance analysis
async function weeklyPerformanceReview() {
  const workflows = getAllWorkflows();

  const reports = workflows.map(workflow => {
    const analysis = workflowPerformanceAnalyzer.analyzePerformance(workflow);

    return {
      workflowName: workflow.name,
      performanceScore: analysis.performanceScore,
      bottleneckCount: analysis.bottlenecks.length,
      suggestionCount: analysis.suggestions.length
    };
  });

  // Sort by performance score (lowest first)
  reports.sort((a, b) => a.performanceScore - b.performanceScore);

  console.log('Workflows needing attention:');
  reports.slice(0, 10).forEach(report => {
    console.log(`- ${report.workflowName}: ${report.performanceScore}/100`);
  });
}
```

### Optimization Workflow

```
1. Analyze Performance
   ↓
2. Identify Bottlenecks
   ↓
3. Review Suggestions
   ↓
4. Apply Optimizations
   ↓
5. Test Changes
   ↓
6. Measure Impact
   ↓
7. Repeat
```

## See Also

- [Testing Guide](./testing.md) - Test performance improvements
- [Version Control](./version-control.md) - Track performance over versions
- [Best Practices](./best-practices.md) - Performance optimization patterns
- [API Reference](./api-reference.md) - Complete API documentation
