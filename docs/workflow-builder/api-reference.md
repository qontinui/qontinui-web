# API Reference

Complete API documentation for all Workflow Builder services.

## Table of Contents

- [WorkflowFolderManager](#workflowfoldermanager)
- [WorkflowDependencyAnalyzer](#workflowdependencyanalyzer)
- [WorkflowComponentsService](#workflowcomponentsservice)
- [WorkflowTestingService](#workflowtestingservice)
- [WorkflowAnalyticsService](#workflowanalyticsservice)
- [WorkflowPerformanceAnalyzer](#workflowperformanceanalyzer)
- [WorkflowComplexityAnalyzer](#workflowcomplexityanalyzer)
- [WorkflowDocumentationService](#workflowdocumentationservice)
- [WorkflowVersionControl](#workflowversioncontrol)

## WorkflowFolderManager

Manages hierarchical folder organization for workflows.

### Methods

#### `createFolder(options)`
Creates a new folder.

**Parameters:**
- `options.name: string` - Folder name
- `options.parentPath: string` - Parent folder path
- `options.description?: string` - Optional description
- `options.metadata?: Record<string, any>` - Custom metadata

**Returns:** `WorkflowFolder`

**Example:**
```typescript
const folder = workflowFolderManager.createFolder({
  name: 'Authentication',
  parentPath: '/',
  description: 'Auth workflows'
});
```

#### `deleteFolder(path)`
Deletes a folder and moves workflows to parent.

**Parameters:**
- `path: string` - Folder path

**Returns:** `boolean`

#### `getFolder(path)`
Gets a folder by path.

**Parameters:**
- `path: string` - Folder path

**Returns:** `WorkflowFolder | null`

#### `moveWorkflow(workflowId, targetPath)`
Moves a workflow to a folder.

**Parameters:**
- `workflowId: string`
- `targetPath: string` - Target folder path

**Returns:** `boolean`

#### `addTag(workflowId, tag)`
Adds a tag to a workflow.

**Parameters:**
- `workflowId: string`
- `tag: string`

**Returns:** `void`

#### `searchWorkflows(query, options?)`
Searches workflows by name or tags.

**Parameters:**
- `query: string` - Search text
- `options?.tags?: string[]` - Filter by tags

**Returns:** `SearchResult[]`

## WorkflowDependencyAnalyzer

Analyzes workflow dependencies and detects circular dependencies.

### Methods

#### `analyzeDependencies(workflows)`
Analyzes all workflow dependencies.

**Parameters:**
- `workflows: Workflow[]`

**Returns:** `DependencyAnalysis`

#### `detectCircularDependencies(workflows)`
Detects circular dependencies.

**Parameters:**
- `workflows: Workflow[]`

**Returns:** `CircularDependency[]`

#### `getDependencies(workflowId)`
Gets dependencies for a workflow.

**Parameters:**
- `workflowId: string`

**Returns:** `WorkflowDependency[]`

#### `getImpactAnalysis(workflowId, workflows)`
Analyzes impact of changing/deleting a workflow.

**Parameters:**
- `workflowId: string`
- `workflows: Workflow[]`

**Returns:** `ImpactAnalysis`

#### `buildDependencyGraph(workflows)`
Builds a dependency graph for visualization.

**Parameters:**
- `workflows: Workflow[]`

**Returns:** `DependencyGraph`

## WorkflowComponentsService

Manages reusable workflow components.

### Methods

#### `createComponent(options)`
Creates a new component.

**Parameters:**
- `options.name: string`
- `options.description: string`
- `options.category: string`
- `options.actions: Action[]`
- `options.parameters: ComponentParameter[]`
- `options.outputs: ComponentOutput[]`

**Returns:** `SubflowComponent`

#### `getComponent(componentId)`
Gets a component by ID.

**Parameters:**
- `componentId: string`

**Returns:** `SubflowComponent | undefined`

#### `insertComponent(workflow, component, parameterMapping, position)`
Inserts a component into a workflow.

**Parameters:**
- `workflow: Workflow`
- `component: SubflowComponent`
- `parameterMapping: Record<string, any>`
- `position: [number, number]`

**Returns:** `Action[]`

#### `validateParameters(component, values)`
Validates parameter values.

**Parameters:**
- `component: SubflowComponent`
- `values: Record<string, any>`

**Returns:** `{ valid: boolean; errors: ValidationError[] }`

## WorkflowTestingService

Provides comprehensive workflow testing framework.

### Methods

#### `createTestCase(options)`
Creates a test case.

**Parameters:**
- `options.name: string`
- `options.workflowId: string`
- `options.assertions: TestAssertion[]`
- `options.setup?: TestSetup`

**Returns:** `TestCase`

#### `runTestCase(testCaseId)`
Runs a test case.

**Parameters:**
- `testCaseId: string`

**Returns:** `Promise<TestResult>`

#### `createTestSuite(options)`
Creates a test suite.

**Parameters:**
- `options.name: string`
- `options.testCaseIds: string[]`

**Returns:** `TestSuite`

#### `runTestSuite(suiteId)`
Runs a test suite.

**Parameters:**
- `suiteId: string`

**Returns:** `Promise<TestSuiteResult>`

#### `generateTestReport(result)`
Generates a test report.

**Parameters:**
- `result: TestSuiteResult`

**Returns:** `string` (Markdown)

## WorkflowAnalyticsService

Tracks workflow metrics and analytics.

### Methods

#### `getWorkflowMetrics(workflowId)`
Gets metrics for a workflow.

**Parameters:**
- `workflowId: string`

**Returns:** `WorkflowMetrics`

#### `recordExecution(data)`
Records a workflow execution.

**Parameters:**
- `data.workflowId: string`
- `data.duration: number`
- `data.success: boolean`
- `data.timestamp: string`

**Returns:** `void`

#### `generatePerformanceReport(workflowId)`
Generates a performance report.

**Parameters:**
- `workflowId: string`

**Returns:** `PerformanceReport`

#### `getPerformanceTrends(workflowId, options)`
Gets performance trends over time.

**Parameters:**
- `workflowId: string`
- `options.period: string`

**Returns:** `TrendData[]`

## WorkflowPerformanceAnalyzer

Analyzes workflow performance and identifies bottlenecks.

### Methods

#### `analyzePerformance(workflow, executionData?)`
Analyzes workflow performance.

**Parameters:**
- `workflow: Workflow`
- `executionData?: ExecutionData`

**Returns:** `PerformanceAnalysisResult`

#### `identifyBottlenecks(workflow, executionData?)`
Identifies performance bottlenecks.

**Parameters:**
- `workflow: Workflow`
- `executionData?: ExecutionData`

**Returns:** `PerformanceBottleneck[]`

#### `generateSuggestions(workflow, executionData?)`
Generates optimization suggestions.

**Parameters:**
- `workflow: Workflow`
- `executionData?: ExecutionData`

**Returns:** `OptimizationSuggestion[]`

#### `comparePerformance(workflow1, workflow2)`
Compares two workflows.

**Parameters:**
- `workflow1: Workflow`
- `workflow2: Workflow`

**Returns:** `PerformanceComparison`

#### `generatePerformanceReport(workflow, executionData?)`
Generates detailed performance report.

**Parameters:**
- `workflow: Workflow`
- `executionData?: ExecutionData`

**Returns:** `string` (Markdown)

## WorkflowComplexityAnalyzer

Analyzes workflow complexity metrics.

### Methods

#### `analyzeComplexity(workflow)`
Analyzes workflow complexity.

**Parameters:**
- `workflow: Workflow`

**Returns:** `ComplexityMetrics`

#### `calculateCyclomaticComplexity(workflow)`
Calculates cyclomatic complexity.

**Parameters:**
- `workflow: Workflow`

**Returns:** `number`

#### `calculateCognitiveComplexity(workflow)`
Calculates cognitive complexity.

**Parameters:**
- `workflow: Workflow`

**Returns:** `number`

#### `detectCodeSmells(workflow)`
Detects code smells.

**Parameters:**
- `workflow: Workflow`

**Returns:** `CodeSmell[]`

## WorkflowDocumentationService

Generates and manages workflow documentation.

### Methods

#### `generateDocumentation(workflow, options?)`
Generates documentation for a workflow.

**Parameters:**
- `workflow: Workflow`
- `options?: DocumentationOptions`

**Returns:** `string` (Markdown)

#### `exportDocumentation(workflowId, format)`
Exports documentation.

**Parameters:**
- `workflowId: string`
- `format: 'markdown' | 'html' | 'json'`

**Returns:** `string`

#### `addCustomDocumentation(workflowId, section)`
Adds custom documentation section.

**Parameters:**
- `workflowId: string`
- `section: CustomSection`

**Returns:** `void`

## WorkflowVersionControl

Git-like version control for workflows.

### Methods

#### `createBranch(workflowId, name, fromBranchId?, description?)`
Creates a new branch.

**Parameters:**
- `workflowId: string`
- `name: string`
- `fromBranchId?: string`
- `description?: string`

**Returns:** `Branch`

#### `saveVersion(workflowId, branchId, workflow, message, author?)`
Saves a new version.

**Parameters:**
- `workflowId: string`
- `branchId: string`
- `workflow: Workflow`
- `message: string`
- `author?: string`

**Returns:** `Version`

#### `createTag(workflowId, versionId, name, description?)`
Creates a tag.

**Parameters:**
- `workflowId: string`
- `versionId: string`
- `name: string`
- `description?: string`

**Returns:** `Tag`

#### `compareVersions(version1Id, version2Id)`
Compares two versions.

**Parameters:**
- `version1Id: string`
- `version2Id: string`

**Returns:** `VersionDiff | null`

#### `mergeBranch(sourceBranchId, targetBranchId, author?)`
Merges branches.

**Parameters:**
- `sourceBranchId: string`
- `targetBranchId: string`
- `author?: string`

**Returns:** `MergeResult`

#### `rollbackToVersion(workflowId, versionId, author?)`
Rolls back to a version.

**Parameters:**
- `workflowId: string`
- `versionId: string`
- `author?: string`

**Returns:** `Version`

## Common Patterns

### Service Access

All services are singleton instances:

```typescript
import { workflowFolderManager } from '@/services/workflow-folder-manager';
import { workflowDependencyAnalyzer } from '@/services/workflow-dependency-analyzer';
import { workflowVersionControl } from '@/services/workflow-version-control';
// etc.
```

### Error Handling

```typescript
try {
  const result = workflowVersionControl.createBranch(/* ... */);
} catch (error) {
  console.error('Failed to create branch:', error.message);
}
```

### Async Operations

Testing and some analysis operations are async:

```typescript
const result = await workflowTestingService.runTestCase(testCaseId);
```

## See Also

- [Data Models](./data-models.md) - Type definitions
- [Examples](./examples.md) - Usage examples
- [Best Practices](./best-practices.md) - Recommended patterns
