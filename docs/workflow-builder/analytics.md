# Workflow Analytics & Complexity

This guide covers workflow execution analytics and structural complexity analysis.

## Table of Contents

- [Overview](#overview)
- [Execution Analytics](#execution-analytics)
- [Complexity Analysis](#complexity-analysis)
- [Best Practices](#best-practices)

## Overview

Two services provide insight into workflows:

- **`workflowAnalyticsService`** (`@/services/workflow-analytics-service`) records executions in browser storage and derives per-workflow metrics, aggregate stats and reports from them.
- **`workflowComplexityAnalyzer`** (`@/services/workflow-complexity-analyzer`) computes structural metrics from a workflow's actions and connections.

## Execution Analytics

### Track an Execution

```typescript
import { workflowAnalyticsService } from '@/services/workflow-analytics-service';

// trackExecution(workflowId, workflowName, duration, success, error?, folderId?)
workflowAnalyticsService.trackExecution('workflow-123', 'Login Flow', 1500, true);
workflowAnalyticsService.trackExecution('workflow-123', 'Login Flow', 900, false, 'Element not found');
```

### Workflow Metrics

```typescript
const metrics = workflowAnalyticsService.getWorkflowMetrics(workflowId);

if (metrics) {
  console.log(`Executions: ${metrics.totalExecutions}`);
  console.log(`Success Rate: ${metrics.successRate}%`);
  console.log(`Average Duration: ${metrics.avgDuration}ms`);
}
```

`getWorkflowMetrics` returns `null` for a workflow with no recorded executions. The full `WorkflowMetrics` shape is defined in `frontend/src/services/workflow-analytics-service.ts`.

### Rankings, Stats and Reports

```typescript
const mostUsed = workflowAnalyticsService.getMostUsedWorkflows(10);
const slowest = workflowAnalyticsService.getSlowestWorkflows(10);
const failing = workflowAnalyticsService.getHighestErrorRateWorkflows();

const stats = workflowAnalyticsService.getAggregatedStats();
const timeline = workflowAnalyticsService.getExecutionTimeline(workflowId);

// Optional TimeRange narrows the report
const report = workflowAnalyticsService.exportAnalyticsReport();

// Clear one workflow's history, or everything
workflowAnalyticsService.clearMetrics(workflowId);
```

## Complexity Analysis

### Analyze Complexity

```typescript
import { workflowComplexityAnalyzer } from '@/services/workflow-complexity-analyzer';

const complexity = workflowComplexityAnalyzer.analyzeComplexity(workflow);

console.log(`Actions: ${complexity.actionCount}`);
console.log(`Cyclomatic Complexity: ${complexity.cyclomaticComplexity}`);
console.log(`Max Depth: ${complexity.maxDepth}`);
console.log(`Score: ${complexity.complexityScore}/100 (${complexity.complexityRating})`);
```

The full `ComplexityAnalysis` shape is defined in `frontend/src/services/workflow-complexity-analyzer.ts`.

### Simplification Suggestions

```typescript
const suggestions = workflowComplexityAnalyzer.suggestSimplifications(workflow);

suggestions.forEach((s) => {
  console.log(`[${s.severity}] ${s.type}: ${s.description}`);
  console.log(`  ${s.recommendation}`);
});
```

### Comparing Workflows

```typescript
const comparison = workflowComplexityAnalyzer.compareComplexity(workflowA, workflowB);
const distribution = workflowComplexityAnalyzer.getComplexityDistribution(workflows);
```

## Best Practices

### Performance Monitoring

```typescript
function monitorWorkflowPerformance(workflowId: string) {
  const metrics = workflowAnalyticsService.getWorkflowMetrics(workflowId);
  if (!metrics) return;

  if (metrics.successRate < 90) {
    console.warn(`Success rate dropped to ${metrics.successRate}%`);
  }
  if (metrics.avgDuration > 5000) {
    console.warn(`Average duration increased to ${metrics.avgDuration}ms`);
  }
}
```

## See Also

- [Testing Guide](./testing.md) - Test performance improvements
- [Best Practices](./best-practices.md) - Performance optimization patterns
