# Data Models & Type Definitions

Complete reference for all data types used in the Workflow Builder.

## Table of Contents

- [Folder Management](#folder-management)
- [Dependencies](#dependencies)
- [Components](#components)
- [Testing](#testing)
- [Analytics](#analytics)
- [Performance](#performance)
- [Complexity](#complexity)
- [Version Control](#version-control)

## Folder Management

### WorkflowFolder

```typescript
interface WorkflowFolder {
  id: string;
  name: string;
  path: string;
  parentPath: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  workflowIds: string[];
  metadata?: Record<string, any>;
}
```

### FolderPath

```typescript
type FolderPath = string;  // e.g., "/Authentication/Login"
```

### BulkOperationResult

```typescript
interface BulkOperationResult {
  successful: string[];
  failed: Array<{
    workflowId: string;
    error: string;
  }>;
}
```

## Dependencies

### DependencyAnalysis

```typescript
interface DependencyAnalysis {
  totalWorkflows: number;
  workflowsWithDependencies: number;
  totalDependencies: number;
  dependencies: Map<string, WorkflowDependency[]>;
  dependents: Map<string, WorkflowDependency[]>;
  circularDependencies: CircularDependency[];
  unusedWorkflows: string[];
  mostDependedUpon: Array<{ workflowId: string; count: number }>;
  timestamp: Date;
}
```

### WorkflowDependency

```typescript
interface WorkflowDependency {
  sourceWorkflowId: string;
  sourceWorkflowName?: string;
  targetWorkflowId: string;
  targetWorkflowName?: string;
  actionId: string;
  actionName?: string;
  type: 'direct' | 'conditional' | 'loop';
  isConditional: boolean;
  isInLoop: boolean;
}
```

### CircularDependency

```typescript
interface CircularDependency {
  cycle: string[];
  path: string[];
  severity: 'low' | 'medium' | 'high';
  description: string;
}
```

### ImpactAnalysis

```typescript
interface ImpactAnalysis {
  workflowId: string;
  directImpact: string[];
  indirectImpact: string[];
  totalImpact: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  suggestions: string[];
  dependencyTree: DependencyNode;
}
```

## Components

### SubflowComponent

```typescript
interface SubflowComponent {
  id: string;
  name: string;
  description: string;
  category: string;
  actions: Action[];
  connections: Connections;
  parameters: ComponentParameter[];
  outputs: ComponentOutput[];
  version: string;
  createdAt: string;
  updatedAt: string;
  author?: string;
  tags?: string[];
  usageCount?: number;
  lastUsed?: string;
}
```

### ComponentParameter

```typescript
interface ComponentParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  defaultValue?: any;
  sensitive?: boolean;
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
    enum?: any[];
  };
}
```

### ComponentOutput

```typescript
interface ComponentOutput {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
}
```

## Testing

### TestCase

```typescript
interface TestCase {
  id: string;
  name: string;
  workflowId: string;
  description?: string;
  setup?: {
    variables?: Record<string, any>;
    initialState?: any;
  };
  assertions: TestAssertion[];
  expectedResult?: 'success' | 'failure' | 'error';
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  author?: string;
}
```

### TestAssertion

```typescript
interface TestAssertion {
  type:
    | 'equals'
    | 'notEquals'
    | 'contains'
    | 'notContains'
    | 'exists'
    | 'notExists'
    | 'greaterThan'
    | 'lessThan'
    | 'greaterThanOrEqual'
    | 'lessThanOrEqual'
    | 'matches'
    | 'type'
    | 'length'
    | 'custom';
  actual: string | any;
  expected?: any;
  message: string;
  customFunction?: (value: any) => boolean;
}
```

### TestResult

```typescript
interface TestResult {
  testCaseId: string;
  testCase: TestCase;
  passed: boolean;
  failures: AssertionFailure[];
  executionTime: number;
  timestamp: string;
  variables?: Record<string, any>;
}
```

### TestSuite

```typescript
interface TestSuite {
  id: string;
  name: string;
  description?: string;
  testCaseIds: string[];
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}
```

### TestSuiteResult

```typescript
interface TestSuiteResult {
  suiteId: string;
  suite: TestSuite;
  testResults: TestResult[];
  totalTests: number;
  passed: number;
  failed: number;
  successRate: number;
  totalExecutionTime: number;
  timestamp: string;
}
```

## Analytics

### WorkflowMetrics

```typescript
interface WorkflowMetrics {
  workflowId: string;
  workflowName: string;
  executionCount: number;
  successCount: number;
  failureCount: number;
  errorCount: number;
  averageDuration: number;
  minDuration: number;
  maxDuration: number;
  totalDuration: number;
  successRate: number;
  firstExecuted?: string;
  lastExecuted?: string;
  trend?: 'improving' | 'declining' | 'stable';
}
```

### PerformanceReport

```typescript
interface PerformanceReport {
  workflowId: string;
  summary: string;
  averageDuration: number;
  p95Duration: number;
  p99Duration: number;
  successRate: number;
  trends: TrendData[];
}
```

## Performance

### PerformanceAnalysisResult

```typescript
interface PerformanceAnalysisResult {
  performanceScore: number;
  bottleneckScore: number;
  estimatedExecutionTime: number;
  actualExecutionTime?: number;
  bottlenecks: PerformanceBottleneck[];
  suggestions: OptimizationSuggestion[];
  parallelizationOpportunities: ParallelizationOpportunity[];
  waitAnalysis: WaitAnalysis;
  loopAnalysis: LoopAnalysis;
  resourceAnalysis: ResourceAnalysis;
  criticalPath?: string[];
  actionTimings?: Record<string, number>;
  heatmap: PerformanceHeatmap;
  timestamp: Date;
}
```

### PerformanceBottleneck

```typescript
interface PerformanceBottleneck {
  type: 'slow_action' | 'unnecessary_wait' | 'sequential_operations' | 'loop' | 'resource_intensive';
  severity: number;
  actionIds: string[];
  description: string;
  estimatedImpact: number;
  suggestions: string[];
}
```

### OptimizationSuggestion

```typescript
interface OptimizationSuggestion {
  type:
    | 'parallelize'
    | 'replace_wait'
    | 'add_caching'
    | 'optimize_loop'
    | 'split_workflow'
    | 'add_error_handling'
    | 'remove_redundant'
    | 'reduce_screenshots'
    | 'add_wait'
    | 'reduce_wait';
  priority: number;
  actionIds: string[];
  title: string;
  description: string;
  expectedSpeedup?: number | string;
  difficulty?: number;
}
```

### WaitAnalysis

```typescript
interface WaitAnalysis {
  totalWaitTime: number;
  waitCount: number;
  fixedWaits: Array<{
    actionId: string;
    duration: number;
    suggestion: string;
  }>;
  longWaits: Array<{
    actionId: string;
    duration: number;
    suggestion: string;
  }>;
  missingWaits: Array<{
    actionId: string;
    reason: string;
  }>;
  waitFindPatterns: Array<{
    waitActionId: string;
    findActionId: string;
    suggestion: string;
  }>;
}
```

### LoopAnalysis

```typescript
interface LoopAnalysis {
  loopCount: number;
  infiniteLoopRisks: Array<{
    actionId: string;
    reason: string;
    severity: 'low' | 'medium' | 'high';
  }>;
  estimatedIterations: Record<string, number>;
  suggestions: Array<{
    actionId: string;
    suggestion: string;
    type: 'early_exit' | 'reduce_iterations' | 'optimize_body' | 'add_condition';
  }>;
  nestedLoops: Array<{
    parentLoopId: string;
    childLoopIds: string[];
    complexity: 'linear' | 'quadratic' | 'cubic';
  }>;
}
```

### ExecutionData

```typescript
interface ExecutionData {
  totalDuration: number;
  actionStates: Record<string, ActionExecutionState>;
  executionOrder?: string[];
  variableSnapshots?: Array<{
    actionId: string;
    variables: Record<string, any>;
  }>;
  criticalPath?: string[];
}
```

## Complexity

### ComplexityMetrics

```typescript
interface ComplexityMetrics {
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  maxNestingDepth: number;
  averageNestingDepth: number;
  maintainabilityIndex: number;
  codeSmells: CodeSmell[];
  actionCounts: {
    total: number;
    byType: Record<string, number>;
  };
}
```

### CodeSmell

```typescript
interface CodeSmell {
  type: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  location: string;
  suggestion: string;
}
```

## Version Control

### Branch

```typescript
interface Branch {
  id: string;
  workflowId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  parentBranchId?: string;
  currentVersionId?: string;
  isDefault?: boolean;
  metadata?: Record<string, any>;
}
```

### Version

```typescript
interface Version {
  id: string;
  workflowId: string;
  branchId: string;
  workflow: Workflow;
  message: string;
  author?: string;
  timestamp: string;
  parentVersionId?: string;
  tags?: string[];
  metadata?: {
    actionCount: number;
    connectionCount: number;
    changesSummary?: ChangeSummary;
    [key: string]: any;
  };
}
```

### Tag

```typescript
interface Tag {
  id: string;
  workflowId: string;
  versionId: string;
  name: string;
  description?: string;
  createdAt: string;
  metadata?: Record<string, any>;
}
```

### VersionDiff

```typescript
interface VersionDiff {
  actionsAdded: ActionDiff[];
  actionsRemoved: ActionDiff[];
  actionsModified: ActionModification[];
  actionsUnchanged: string[];
  connectionsAdded: ConnectionDiff[];
  connectionsRemoved: ConnectionDiff[];
  connectionsModified: ConnectionModification[];
  propertiesChanged: PropertyChange[];
  variablesChanged: VariableChange[];
  summary: DiffSummary;
}
```

### MergeResult

```typescript
interface MergeResult {
  success: boolean;
  workflow?: Workflow;
  conflicts: MergeConflict[];
  message: string;
}
```

### MergeConflict

```typescript
interface MergeConflict {
  id: string;
  type: 'action' | 'connection' | 'property' | 'variable';
  path: string;
  sourceValue: any;
  targetValue: any;
  baseValue?: any;
  description: string;
}
```

## Utility Types

### SearchResult

```typescript
interface SearchResult {
  workflow: Workflow;
  folder: WorkflowFolder;
  relevance: number;
}
```

### DependencyGraph

```typescript
interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    totalNodes: number;
    totalEdges: number;
    maxDepth: number;
    hasCircular: boolean;
  };
}
```

### PerformanceHeatmap

```typescript
interface PerformanceHeatmap {
  actionMetrics: Record<string, {
    score: number;
    duration?: number;
    executionCount?: number;
    status: 'fast' | 'normal' | 'slow' | 'critical';
    color: string;
  }>;
  overall: {
    averageDuration: number;
    maxDuration: number;
    minDuration: number;
  };
}
```

## See Also

- [API Reference](./api-reference.md) - Method signatures
- [Examples](./examples.md) - Usage examples
