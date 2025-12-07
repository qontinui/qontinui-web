# Workflow Dependency Analyzer Service

A comprehensive service for tracking and analyzing workflow relationships in qontinui-web.

## Overview

The `WorkflowDependencyAnalyzer` provides a complete solution for understanding, validating, and visualizing dependencies between workflows. It analyzes `RUN_WORKFLOW` actions to build a dependency graph and detect potential issues.

## Features

### 1. Dependency Detection

- **analyzeDependencies(workflow)** - Find all RUN_WORKFLOW actions in a workflow
- **getDependencies(workflowId)** - Get direct dependencies for a workflow
- **getDependents(workflowId)** - Get workflows that depend on this one
- **getAllDependencies(workflowId, recursive)** - Get full dependency tree
- **getAllDependents(workflowId, recursive)** - Get all workflows that depend on this one

### 2. Graph Building

- **buildDependencyGraph(workflows)** - Create complete dependency graph
- **buildDependencyTree(workflowId)** - Build tree structure for single workflow
- Calculates in-degree and out-degree for each workflow
- Identifies root workflows (no dependencies)
- Identifies leaf workflows (no dependents)

### 3. Analysis

- **findCircularDependencies(workflows)** - Detect circular references using DFS
- **findUnusedWorkflows(workflows)** - Find workflows never called by others
- **getImpactAnalysis(workflowId)** - Analyze what breaks if this workflow changes
- **getDependencyDepth(workflowId)** - Calculate depth in dependency chain
- **getDependencyStats(workflows)** - Overall project statistics

### 4. Visualization Data

- **getGraphData(workflows)** - Format data for React Flow or D3
- **getNodesAndEdges(workflows)** - Generate nodes + edges for graph visualization
- **getCriticalPath(workflows)** - Find most important dependency chains
- Automatic layout calculation
- Node positioning based on depth

### 5. Validation

- **validateDependencies(workflow)** - Check for broken references
- **findMissingWorkflows(workflow)** - Find referenced workflows that don't exist
- **validateCircularRefs(workflows)** - Ensure no circular dependencies
- Detailed error reporting with severity levels

### 6. Caching

- Automatic caching of dependency graphs (5-minute TTL)
- **invalidateCache()** - Clear cache when workflows change
- **isCacheValid()** - Check cache status
- **getCachedGraph()** - Get cached graph if valid

### 7. Export

- **exportDependencyReport(workflows)** - Generate comprehensive JSON report
- **exportGraphML(workflows)** - Export to GraphML format for external tools

## Installation

```typescript
import { workflowDependencyAnalyzer } from "@/services/workflow-dependency-analyzer";
```

## Quick Start

```typescript
import { workflowDependencyAnalyzer } from "@/services/workflow-dependency-analyzer";

// Get singleton instance
const analyzer = workflowDependencyAnalyzer;

// Analyze dependencies for a workflow
const dependencies = analyzer.analyzeDependencies(myWorkflow);
console.log("Dependencies:", dependencies);

// Build complete dependency graph
const graph = analyzer.buildDependencyGraph(allWorkflows);
console.log("Total workflows:", graph.nodes.size);
console.log("Total dependencies:", graph.edges.length);

// Check for circular dependencies
const cycles = analyzer.findCircularDependencies(allWorkflows);
if (cycles.length > 0) {
  console.warn("Circular dependencies detected:", cycles);
}

// Get impact analysis
const impact = analyzer.getImpactAnalysis("my-workflow-id", allWorkflows);
console.log(`Impact level: ${impact.impactLevel}`);
console.log(`Affected workflows: ${impact.affectedCount}`);
```

## Usage Examples

### Example 1: Basic Dependency Detection

```typescript
const workflows = [workflowA, workflowB, workflowC];
const analyzer = workflowDependencyAnalyzer;

// Find what workflow B depends on
const deps = analyzer.getDependencies("workflow-b", workflows);
console.log("Workflow B depends on:", deps);

// Find what depends on workflow A
const dependents = analyzer.getDependents("workflow-a", workflows);
console.log("Workflows that depend on A:", dependents);

// Get full dependency tree
const allDeps = analyzer.getAllDependencies("workflow-c", workflows);
console.log("All dependencies of C:", allDeps);
```

### Example 2: Circular Dependency Detection

```typescript
const workflows = loadAllWorkflows();
const cycles = analyzer.findCircularDependencies(workflows);

if (cycles.length > 0) {
  console.error("⚠️ Circular dependencies detected:");
  cycles.forEach((cycle, i) => {
    console.error(`  Cycle ${i + 1}: ${cycle.join(" -> ")}`);
  });
}
```

### Example 3: Impact Analysis

```typescript
// Before modifying a workflow, check its impact
const impact = analyzer.getImpactAnalysis("login-workflow", workflows);

console.log(`Impact Level: ${impact.impactLevel.toUpperCase()}`);
console.log(`Direct impact: ${impact.directDependents.length} workflows`);
console.log(`Total impact: ${impact.affectedCount} workflows`);

if (impact.impactLevel === "critical") {
  console.warn("⚠️ This workflow has critical dependencies!");
  console.warn("Affected workflows:", impact.allDependents);
}
```

### Example 4: Dependency Statistics

```typescript
const stats = analyzer.getDependencyStats(workflows);

console.log("=== Dependency Statistics ===");
console.log(`Total Workflows: ${stats.totalWorkflows}`);
console.log(`Total Dependencies: ${stats.totalDependencies}`);
console.log(`Circular Dependencies: ${stats.circularDependencies}`);
console.log(`Unused Workflows: ${stats.unusedWorkflows}`);
console.log(
  `Average Dependencies: ${stats.avgDependenciesPerWorkflow.toFixed(2)}`
);
console.log(`Max Depth: ${stats.maxDepth}`);

console.log("\nMost Depended Upon:");
stats.mostDepended.slice(0, 5).forEach((item, i) => {
  console.log(`  ${i + 1}. ${item.name} (${item.count} dependents)`);
});
```

### Example 5: Validation

```typescript
// Validate all workflows
const errors = [];

for (const workflow of workflows) {
  const validation = analyzer.validateDependencies(workflow, workflows);

  if (!validation.valid) {
    errors.push(...validation.errors);
  }

  if (validation.warnings.length > 0) {
    console.warn(`Warnings for ${workflow.name}:`, validation.warnings);
  }
}

if (errors.length > 0) {
  console.error("❌ Validation failed:");
  errors.forEach((error) => {
    console.error(`  [${error.type}] ${error.message}`);
  });
}
```

### Example 6: Visualization Data

```typescript
// Get data for React Flow visualization
const vizData = analyzer.getGraphData(workflows);

// Use with React Flow
<ReactFlow
  nodes={vizData.nodes}
  edges={vizData.edges}
  nodeTypes={customNodeTypes}
  edgeTypes={customEdgeTypes}
/>
```

### Example 7: Export Report

```typescript
// Generate comprehensive report
const report = analyzer.exportDependencyReport(workflows);

// Save to file or display
console.log("Report generated:", report.metadata.generated);
console.log("Statistics:", report.statistics);

// Download as JSON
const blob = new Blob([JSON.stringify(report, null, 2)], {
  type: "application/json",
});
downloadFile(blob, "dependency-report.json");
```

### Example 8: Export GraphML

```typescript
// Export to GraphML for external visualization tools
const graphML = analyzer.exportGraphML(workflows);

// Save to file
const blob = new Blob([graphML], { type: "application/xml" });
downloadFile(blob, "workflow-dependencies.graphml");

// Can be imported into:
// - Gephi
// - yEd
// - Cytoscape
// - NetworkX
```

### Example 9: Cache Management

```typescript
// Build graph (uses cache)
const graph1 = analyzer.buildDependencyGraph(workflows);

// Check cache status
if (analyzer.isCacheValid()) {
  console.log("Using cached graph");
}

// Invalidate cache when workflows change
function onWorkflowUpdate(workflow: Workflow) {
  updateWorkflow(workflow);
  analyzer.invalidateCache(); // Clear cache
}

// Force rebuild without cache
const freshGraph = analyzer.buildDependencyGraph(workflows, false);
```

### Example 10: Finding Unused Workflows

```typescript
const unused = analyzer.findUnusedWorkflows(workflows);

if (unused.length > 0) {
  console.log("📊 Unused workflows found:");
  unused.forEach((id) => {
    const workflow = workflows.find((w) => w.id === id);
    console.log(`  - ${workflow?.name || id}`);
  });

  console.log("\nConsider:");
  console.log("  1. Adding them to a main workflow");
  console.log("  2. Documenting their purpose");
  console.log("  3. Archiving if no longer needed");
}
```

## Type Definitions

### DependencyNode

```typescript
interface DependencyNode {
  id: string; // Workflow ID
  name: string; // Workflow name
  category?: string; // Workflow category
  dependencies: string[]; // Direct dependencies
  dependents: string[]; // Direct dependents
  inDegree: number; // How many depend on this
  outDegree: number; // How many this depends on
  depth: number; // Depth in dependency tree
  isCircular: boolean; // Part of circular dependency
  tags?: string[]; // Workflow tags
}
```

### DependencyGraph

```typescript
interface DependencyGraph {
  nodes: Map<string, DependencyNode>; // All workflow nodes
  edges: DependencyEdge[]; // All dependency edges
  cycles: string[][]; // Circular dependency chains
  roots: string[]; // Workflows with no dependencies
  leaves: string[]; // Workflows with no dependents
  timestamp: number; // When graph was built
}
```

### ImpactAnalysis

```typescript
interface ImpactAnalysis {
  workflowId: string; // Workflow being analyzed
  directDependents: string[]; // Direct dependents
  allDependents: string[]; // All dependents (recursive)
  criticalPaths: string[][]; // Critical paths through workflow
  impactLevel: "low" | "medium" | "high" | "critical";
  affectedCount: number; // Number of workflows affected
}
```

### DependencyStats

```typescript
interface DependencyStats {
  totalWorkflows: number;
  totalDependencies: number;
  circularDependencies: number;
  unusedWorkflows: number;
  rootWorkflows: number;
  leafWorkflows: number;
  avgDependenciesPerWorkflow: number;
  avgDependentsPerWorkflow: number;
  maxDepth: number;
  mostDepended: Array<{ id: string; name: string; count: number }>;
  mostDependencies: Array<{ id: string; name: string; count: number }>;
}
```

## Performance

### Caching

- Dependency graph is cached for 5 minutes
- Cache invalidation on workflow changes
- Significant performance improvement for repeated analyses

### Complexity

- **buildDependencyGraph**: O(W \* A) where W = workflows, A = actions
- **findCircularDependencies**: O(W + D) where D = dependencies
- **getAllDependencies**: O(W + D) with cycle detection
- **getImpactAnalysis**: O(W + D)

### Optimization Tips

1. Use cache for repeated analyses
2. Invalidate cache only when necessary
3. Use `useCache=true` parameter
4. Batch validations when possible

## Error Handling

The service provides detailed error reporting:

```typescript
interface DependencyError {
  type:
    | "missing_workflow"
    | "circular_dependency"
    | "invalid_reference"
    | "orphaned_workflow";
  workflowId: string; // Where error occurs
  actionId?: string; // Action causing error
  referencedId?: string; // Referenced workflow
  message: string; // Error description
  severity: "error" | "warning";
}
```

## Best Practices

### 1. Regular Validation

```typescript
// Validate before saving
function saveWorkflow(workflow: Workflow, allWorkflows: Workflow[]) {
  const validation = analyzer.validateDependencies(workflow, allWorkflows);

  if (!validation.valid) {
    throw new Error("Validation failed: " + validation.errors[0].message);
  }

  return saveToDatabase(workflow);
}
```

### 2. Impact Analysis Before Changes

```typescript
// Check impact before modifying
function modifyWorkflow(workflowId: string) {
  const impact = analyzer.getImpactAnalysis(workflowId, allWorkflows);

  if (impact.impactLevel === "critical") {
    const confirmed = confirm(
      `This change will affect ${impact.affectedCount} workflows. Continue?`
    );
    if (!confirmed) return;
  }

  // Proceed with modification
}
```

### 3. Cache Management

```typescript
// Invalidate cache on workflow changes
function updateWorkflow(workflow: Workflow) {
  saveWorkflow(workflow);
  analyzer.invalidateCache();
}

// Use cached graph for UI
function renderDependencyGraph() {
  const graph = analyzer.buildDependencyGraph(workflows, true);
  renderGraph(graph);
}
```

### 4. Circular Dependency Prevention

```typescript
// Check before adding dependency
function addWorkflowDependency(workflowId: string, dependencyId: string) {
  const testWorkflows = [...workflows];
  const workflow = testWorkflows.find((w) => w.id === workflowId);

  // Add test dependency
  workflow.actions.push(
    createAction("RUN_WORKFLOW", { workflowId: dependencyId }, [0, 0])
  );

  // Check for cycles
  const cycles = analyzer.findCircularDependencies(testWorkflows);

  if (cycles.length > 0) {
    alert("This would create a circular dependency!");
    return false;
  }

  return true;
}
```

## Integration Examples

### With React Component

```typescript
function WorkflowDependencyView({ workflows }: { workflows: Workflow[] }) {
  const [stats, setStats] = useState<DependencyStats | null>(null);
  const [cycles, setCycles] = useState<string[][]>([]);

  useEffect(() => {
    const analyzer = workflowDependencyAnalyzer;
    setStats(analyzer.getDependencyStats(workflows));
    setCycles(analyzer.findCircularDependencies(workflows));
  }, [workflows]);

  return (
    <div>
      <h2>Dependency Statistics</h2>
      {stats && (
        <div>
          <p>Total Workflows: {stats.totalWorkflows}</p>
          <p>Total Dependencies: {stats.totalDependencies}</p>
          <p>Circular Dependencies: {stats.circularDependencies}</p>
        </div>
      )}

      {cycles.length > 0 && (
        <Alert severity="error">
          <h3>Circular Dependencies Detected</h3>
          {cycles.map((cycle, i) => (
            <p key={i}>{cycle.join(' -> ')}</p>
          ))}
        </Alert>
      )}
    </div>
  );
}
```

### With React Flow

```typescript
function WorkflowDependencyGraph({ workflows }: { workflows: Workflow[] }) {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);

  useEffect(() => {
    const analyzer = workflowDependencyAnalyzer;
    const vizData = analyzer.getGraphData(workflows);
    setNodes(vizData.nodes);
    setEdges(vizData.edges);
  }, [workflows]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      fitView
    />
  );
}
```

## Testing

See `workflow-dependency-analyzer.test.ts` for comprehensive test suite.

Run tests:

```bash
npm test workflow-dependency-analyzer
```

## Examples

See `workflow-dependency-analyzer.example.ts` for detailed usage examples.

## License

Part of qontinui-web project.

## Changelog

### Version 1.0.0

- Initial release
- Complete dependency analysis
- Circular dependency detection
- Impact analysis
- Visualization data export
- GraphML export
- Comprehensive validation
- Caching system
