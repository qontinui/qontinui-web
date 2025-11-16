/**
 * Workflow Dependency Analyzer - Usage Examples
 *
 * This file demonstrates how to use the WorkflowDependencyAnalyzer service
 * to analyze workflow relationships, detect issues, and generate reports.
 */

import { Workflow, createAction } from '../lib/action-schema/action-types';
import { workflowDependencyAnalyzer } from './workflow-dependency-analyzer';

// ============================================================================
// Example Workflows
// ============================================================================

/**
 * Create example workflows for demonstration
 */
function createExampleWorkflows(): Workflow[] {
  // Workflow A - Root workflow (no dependencies)
  const workflowA: Workflow = {
    id: 'workflow-a',
    name: 'Login Workflow',
    version: '1.0.0',
    format: 'graph',
    category: 'Main',
    actions: [
      createAction('CLICK', { target: { image: 'login-button.png' } }, [100, 100], {
        id: 'action-1',
      }),
      createAction('TYPE', { text: 'username', target: { selector: '#username' } }, [100, 250], {
        id: 'action-2',
      }),
    ],
    connections: {
      'action-1': {
        main: [[{ action: 'action-2', type: 'main', index: 0 }]],
      },
    },
  };

  // Workflow B - Depends on A
  const workflowB: Workflow = {
    id: 'workflow-b',
    name: 'Checkout Workflow',
    version: '1.0.0',
    format: 'graph',
    category: 'Main',
    actions: [
      createAction('RUN_WORKFLOW', { workflowId: 'workflow-a' }, [100, 100], {
        id: 'action-1',
      }),
      createAction('CLICK', { target: { selector: '#checkout' } }, [100, 250], {
        id: 'action-2',
      }),
    ],
    connections: {
      'action-1': {
        main: [[{ action: 'action-2', type: 'main', index: 0 }]],
      },
    },
  };

  // Workflow C - Depends on B (and transitively on A)
  const workflowC: Workflow = {
    id: 'workflow-c',
    name: 'Complete Purchase',
    version: '1.0.0',
    format: 'graph',
    category: 'Main',
    actions: [
      createAction('RUN_WORKFLOW', { workflowId: 'workflow-b' }, [100, 100], {
        id: 'action-1',
      }),
      createAction('CLICK', { target: { selector: '#confirm' } }, [100, 250], {
        id: 'action-2',
      }),
    ],
    connections: {
      'action-1': {
        main: [[{ action: 'action-2', type: 'main', index: 0 }]],
      },
    },
  };

  // Workflow D - Unused (no one calls it)
  const workflowD: Workflow = {
    id: 'workflow-d',
    name: 'Unused Utility',
    version: '1.0.0',
    format: 'graph',
    category: 'Utilities',
    actions: [
      createAction('WAIT', { duration: 1000 }, [100, 100], {
        id: 'action-1',
      }),
    ],
    connections: {},
  };

  // Workflow E & F - Circular dependency
  const workflowE: Workflow = {
    id: 'workflow-e',
    name: 'Workflow E',
    version: '1.0.0',
    format: 'graph',
    category: 'Main',
    actions: [
      createAction('RUN_WORKFLOW', { workflowId: 'workflow-f' }, [100, 100], {
        id: 'action-1',
      }),
    ],
    connections: {},
  };

  const workflowF: Workflow = {
    id: 'workflow-f',
    name: 'Workflow F',
    version: '1.0.0',
    format: 'graph',
    category: 'Main',
    actions: [
      createAction('RUN_WORKFLOW', { workflowId: 'workflow-e' }, [100, 100], {
        id: 'action-1',
      }),
    ],
    connections: {},
  };

  return [workflowA, workflowB, workflowC, workflowD, workflowE, workflowF];
}

// ============================================================================
// Usage Examples
// ============================================================================

/**
 * Example 1: Basic Dependency Detection
 */
export function example1_BasicDependencyDetection() {
  const workflows = createExampleWorkflows();
  const analyzer = workflowDependencyAnalyzer;

  console.log('=== Example 1: Basic Dependency Detection ===\n');

  // Analyze single workflow
  const workflowB = workflows.find((w) => w.id === 'workflow-b')!;
  const dependencies = analyzer.analyzeDependencies(workflowB);

  console.log(`Workflow: ${workflowB.name}`);
  console.log(`Direct dependencies: ${dependencies.join(', ')}`);

  // Get all dependencies recursively
  const allDeps = analyzer.getAllDependencies('workflow-c', workflows);
  console.log(`\nWorkflow C all dependencies: ${allDeps.join(', ')}`);

  // Get dependents (who depends on this workflow)
  const dependents = analyzer.getDependents('workflow-a', workflows);
  console.log(`\nWorkflow A dependents: ${dependents.join(', ')}`);
}

/**
 * Example 2: Build and Analyze Dependency Graph
 */
export function example2_BuildDependencyGraph() {
  const workflows = createExampleWorkflows();
  const analyzer = workflowDependencyAnalyzer;

  console.log('\n=== Example 2: Build Dependency Graph ===\n');

  const graph = analyzer.buildDependencyGraph(workflows);

  console.log(`Total workflows: ${graph.nodes.size}`);
  console.log(`Total dependencies: ${graph.edges.length}`);
  console.log(`Root workflows: ${graph.roots.join(', ')}`);
  console.log(`Leaf workflows: ${graph.leaves.join(', ')}`);

  console.log('\nNode details:');
  for (const [id, node] of graph.nodes) {
    console.log(`  ${node.name}:`);
    console.log(`    - Dependencies (${node.outDegree}): ${node.dependencies.join(', ') || 'none'}`);
    console.log(`    - Dependents (${node.inDegree}): ${node.dependents.join(', ') || 'none'}`);
    console.log(`    - Depth: ${node.depth}`);
    console.log(`    - Circular: ${node.isCircular}`);
  }
}

/**
 * Example 3: Detect Circular Dependencies
 */
export function example3_CircularDependencies() {
  const workflows = createExampleWorkflows();
  const analyzer = workflowDependencyAnalyzer;

  console.log('\n=== Example 3: Circular Dependencies ===\n');

  const cycles = analyzer.findCircularDependencies(workflows);

  if (cycles.length === 0) {
    console.log('No circular dependencies found!');
  } else {
    console.log(`Found ${cycles.length} circular dependency chain(s):\n`);
    cycles.forEach((cycle, i) => {
      console.log(`Cycle ${i + 1}: ${cycle.join(' -> ')}`);
    });
  }

  // Validate circular references
  const errors = analyzer.validateCircularRefs(workflows);
  if (errors.length > 0) {
    console.log('\nCircular dependency errors:');
    errors.forEach((error) => {
      console.log(`  - [${error.severity}] ${error.message}`);
    });
  }
}

/**
 * Example 4: Find Unused Workflows
 */
export function example4_UnusedWorkflows() {
  const workflows = createExampleWorkflows();
  const analyzer = workflowDependencyAnalyzer;

  console.log('\n=== Example 4: Unused Workflows ===\n');

  const unused = analyzer.findUnusedWorkflows(workflows);

  if (unused.length === 0) {
    console.log('All workflows are being used!');
  } else {
    console.log(`Found ${unused.length} unused workflow(s):\n`);
    unused.forEach((id) => {
      const workflow = workflows.find((w) => w.id === id);
      console.log(`  - ${workflow?.name || id}`);
    });
  }
}

/**
 * Example 5: Impact Analysis
 */
export function example5_ImpactAnalysis() {
  const workflows = createExampleWorkflows();
  const analyzer = workflowDependencyAnalyzer;

  console.log('\n=== Example 5: Impact Analysis ===\n');

  // Analyze impact of changing workflow A
  const impact = analyzer.getImpactAnalysis('workflow-a', workflows);

  console.log(`Analyzing impact of changes to: workflow-a\n`);
  console.log(`Impact Level: ${impact.impactLevel.toUpperCase()}`);
  console.log(`Affected Workflows: ${impact.affectedCount}`);
  console.log(`Direct Dependents: ${impact.directDependents.join(', ') || 'none'}`);
  console.log(`All Dependents: ${impact.allDependents.join(', ') || 'none'}`);

  if (impact.criticalPaths.length > 0) {
    console.log('\nCritical Paths:');
    impact.criticalPaths.forEach((path, i) => {
      console.log(`  ${i + 1}. ${path.join(' -> ')}`);
    });
  }
}

/**
 * Example 6: Dependency Statistics
 */
export function example6_DependencyStatistics() {
  const workflows = createExampleWorkflows();
  const analyzer = workflowDependencyAnalyzer;

  console.log('\n=== Example 6: Dependency Statistics ===\n');

  const stats = analyzer.getDependencyStats(workflows);

  console.log(`Total Workflows: ${stats.totalWorkflows}`);
  console.log(`Total Dependencies: ${stats.totalDependencies}`);
  console.log(`Circular Dependencies: ${stats.circularDependencies}`);
  console.log(`Unused Workflows: ${stats.unusedWorkflows}`);
  console.log(`Root Workflows: ${stats.rootWorkflows}`);
  console.log(`Leaf Workflows: ${stats.leafWorkflows}`);
  console.log(`Avg Dependencies per Workflow: ${stats.avgDependenciesPerWorkflow.toFixed(2)}`);
  console.log(`Avg Dependents per Workflow: ${stats.avgDependentsPerWorkflow.toFixed(2)}`);
  console.log(`Max Dependency Depth: ${stats.maxDepth}`);

  if (stats.mostDepended.length > 0) {
    console.log('\nMost Depended Upon:');
    stats.mostDepended.forEach((item, i) => {
      console.log(`  ${i + 1}. ${item.name} (${item.count} dependents)`);
    });
  }

  if (stats.mostDependencies.length > 0) {
    console.log('\nMost Dependencies:');
    stats.mostDependencies.forEach((item, i) => {
      console.log(`  ${i + 1}. ${item.name} (${item.count} dependencies)`);
    });
  }
}

/**
 * Example 7: Validation
 */
export function example7_Validation() {
  const workflows = createExampleWorkflows();
  const analyzer = workflowDependencyAnalyzer;

  console.log('\n=== Example 7: Validation ===\n');

  // Validate each workflow
  workflows.forEach((workflow) => {
    const validation = analyzer.validateDependencies(workflow, workflows);

    console.log(`${workflow.name}:`);
    console.log(`  Valid: ${validation.valid ? 'Yes' : 'No'}`);

    if (validation.errors.length > 0) {
      console.log('  Errors:');
      validation.errors.forEach((error) => {
        console.log(`    - [${error.type}] ${error.message}`);
      });
    }

    if (validation.warnings.length > 0) {
      console.log('  Warnings:');
      validation.warnings.forEach((warning) => {
        console.log(`    - ${warning}`);
      });
    }

    if (validation.valid && validation.warnings.length === 0) {
      console.log('  No issues found.');
    }

    console.log('');
  });
}

/**
 * Example 8: Visualization Data Export
 */
export function example8_VisualizationData() {
  const workflows = createExampleWorkflows();
  const analyzer = workflowDependencyAnalyzer;

  console.log('\n=== Example 8: Visualization Data ===\n');

  const graphData = analyzer.getGraphData(workflows);

  console.log(`Nodes: ${graphData.nodes.length}`);
  console.log(`Edges: ${graphData.edges.length}\n`);

  console.log('Sample node data:');
  graphData.nodes.slice(0, 2).forEach((node) => {
    console.log(`  ${node.data.label}:`);
    console.log(`    - Type: ${node.type}`);
    console.log(`    - Position: (${node.position.x}, ${node.position.y})`);
    console.log(`    - In-degree: ${node.data.inDegree}`);
    console.log(`    - Out-degree: ${node.data.outDegree}`);
  });

  console.log('\nSample edge data:');
  graphData.edges.slice(0, 2).forEach((edge) => {
    console.log(`  ${edge.id}:`);
    console.log(`    - From: ${edge.source}`);
    console.log(`    - To: ${edge.target}`);
    console.log(`    - Type: ${edge.type}`);
    console.log(`    - Actions: ${edge.data?.actionCount}`);
  });
}

/**
 * Example 9: Export Report
 */
export function example9_ExportReport() {
  const workflows = createExampleWorkflows();
  const analyzer = workflowDependencyAnalyzer;

  console.log('\n=== Example 9: Export Report ===\n');

  const report = analyzer.exportDependencyReport(workflows);

  console.log('Report Metadata:');
  console.log(`  Generated: ${report.metadata.generated}`);
  console.log(`  Version: ${report.metadata.version}`);
  console.log(`  Total Workflows: ${report.metadata.totalWorkflows}\n`);

  console.log('Statistics:');
  console.log(`  Total Dependencies: ${report.statistics.totalDependencies}`);
  console.log(`  Circular Dependencies: ${report.statistics.circularDependencies}`);
  console.log(`  Unused Workflows: ${report.statistics.unusedWorkflows}\n`);

  if (report.circularDependencies.length > 0) {
    console.log('Circular Dependencies:');
    report.circularDependencies.forEach((cycle) => {
      console.log(`  - ${cycle.join(' -> ')}`);
    });
    console.log('');
  }

  if (report.missingWorkflows.length > 0) {
    console.log('Missing Workflows:');
    report.missingWorkflows.forEach((id) => {
      console.log(`  - ${id}`);
    });
    console.log('');
  }

  if (report.unusedWorkflows.length > 0) {
    console.log('Unused Workflows:');
    report.unusedWorkflows.forEach((id) => {
      const workflow = workflows.find((w) => w.id === id);
      console.log(`  - ${workflow?.name || id}`);
    });
  }

  // Save report as JSON
  const reportJson = JSON.stringify(report, null, 2);
  console.log(`\nReport size: ${reportJson.length} characters`);
}

/**
 * Example 10: Export GraphML
 */
export function example10_ExportGraphML() {
  const workflows = createExampleWorkflows();
  const analyzer = workflowDependencyAnalyzer;

  console.log('\n=== Example 10: Export GraphML ===\n');

  const graphML = analyzer.exportGraphML(workflows);

  console.log('GraphML export successful!');
  console.log(`Size: ${graphML.length} characters`);
  console.log(`\nFirst 500 characters:\n${graphML.substring(0, 500)}...`);

  // In a real application, you would save this to a file
  // downloadFile(graphML, 'workflow-dependencies.graphml', 'application/xml');
}

/**
 * Example 11: Cache Management
 */
export function example11_CacheManagement() {
  const workflows = createExampleWorkflows();
  const analyzer = workflowDependencyAnalyzer;

  console.log('\n=== Example 11: Cache Management ===\n');

  // Build graph (will cache)
  console.log('Building graph (first time - no cache)...');
  const start1 = Date.now();
  analyzer.buildDependencyGraph(workflows, true);
  const time1 = Date.now() - start1;
  console.log(`Time taken: ${time1}ms`);

  // Build again (will use cache)
  console.log('\nBuilding graph (second time - from cache)...');
  const start2 = Date.now();
  analyzer.buildDependencyGraph(workflows, true);
  const time2 = Date.now() - start2;
  console.log(`Time taken: ${time2}ms`);

  console.log(`\nSpeed improvement: ${((time1 / Math.max(time2, 0.001)) * 100).toFixed(0)}%`);

  // Check cache status
  console.log(`\nCache valid: ${analyzer.isCacheValid()}`);

  // Invalidate cache
  analyzer.invalidateCache();
  console.log('Cache invalidated');
  console.log(`Cache valid: ${analyzer.isCacheValid()}`);

  // Rebuild without cache
  console.log('\nBuilding graph (after invalidation - no cache)...');
  const start3 = Date.now();
  analyzer.buildDependencyGraph(workflows, false);
  const time3 = Date.now() - start3;
  console.log(`Time taken: ${time3}ms`);
}

// ============================================================================
// Run All Examples
// ============================================================================

export function runAllExamples() {
  example1_BasicDependencyDetection();
  example2_BuildDependencyGraph();
  example3_CircularDependencies();
  example4_UnusedWorkflows();
  example5_ImpactAnalysis();
  example6_DependencyStatistics();
  example7_Validation();
  example8_VisualizationData();
  example9_ExportReport();
  example10_ExportGraphML();
  example11_CacheManagement();

  console.log('\n=== All Examples Complete ===\n');
}

// Uncomment to run examples:
// runAllExamples();
