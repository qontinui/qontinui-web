# Workflow Analytics & Complexity

This guide covers workflow analytics, metrics tracking, and complexity analysis.

## Table of Contents

- [Overview](#overview)
- [Analytics Dashboard](#analytics-dashboard)
- [Metrics Collection](#metrics-collection)
- [Complexity Analysis](#complexity-analysis)
- [Reports & Exports](#reports--exports)
- [Best Practices](#best-practices)

## Overview

The Workflow Analytics and Complexity services provide insight into workflow execution history and structural complexity.

### Key Features

- **Analytics**: Execution metrics, success rates, duration tracking
- **Complexity Analysis**: Cyclomatic complexity, cognitive load, maintainability
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

### Export Analytics Data

```typescript
// Export to JSON
const analyticsData = workflowAnalyticsService.exportAnalytics(workflowId);

// Export to CSV
const csv = workflowAnalyticsService.exportAnalyticsCSV(workflowId);
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
}
```

## See Also

- [Testing Guide](./testing.md) - Test performance improvements
- [Best Practices](./best-practices.md) - Performance optimization patterns
- [API Reference](./api-reference.md) - Complete API documentation
