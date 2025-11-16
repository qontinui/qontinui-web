# Workflow Dependency Analyzer - Integration Guide

This guide shows how to integrate the Workflow Dependency Analyzer into various parts of the qontinui-web application.

## Quick Integration Examples

### 1. Add to Workflow Builder UI

Show dependency information when editing workflows:

```typescript
// components/workflow-builder/DependencyPanel.tsx
'use client';

import { useState, useEffect } from 'react';
import { workflowDependencyAnalyzer } from '@/services/workflow-dependency-analyzer';
import { Workflow } from '@/lib/action-schema/action-types';

interface DependencyPanelProps {
  workflow: Workflow;
  allWorkflows: Workflow[];
}

export function DependencyPanel({ workflow, allWorkflows }: DependencyPanelProps) {
  const [dependencies, setDependencies] = useState<string[]>([]);
  const [dependents, setDependents] = useState<string[]>([]);
  const [impact, setImpact] = useState<any>(null);

  useEffect(() => {
    const analyzer = workflowDependencyAnalyzer;

    setDependencies(analyzer.getDependencies(workflow.id, allWorkflows));
    setDependents(analyzer.getDependents(workflow.id, allWorkflows));
    setImpact(analyzer.getImpactAnalysis(workflow.id, allWorkflows));
  }, [workflow, allWorkflows]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">Dependencies</h3>
        <p className="text-xs text-gray-500">
          This workflow depends on {dependencies.length} other workflow(s)
        </p>
        {dependencies.length > 0 && (
          <ul className="mt-2 space-y-1">
            {dependencies.map((id) => {
              const dep = allWorkflows.find((w) => w.id === id);
              return (
                <li key={id} className="text-sm">
                  → {dep?.name || id}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium">Dependents</h3>
        <p className="text-xs text-gray-500">
          {dependents.length} workflow(s) depend on this one
        </p>
        {dependents.length > 0 && (
          <ul className="mt-2 space-y-1">
            {dependents.map((id) => {
              const dep = allWorkflows.find((w) => w.id === id);
              return (
                <li key={id} className="text-sm">
                  ← {dep?.name || id}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {impact && (
        <div
          className={`p-3 rounded ${
            impact.impactLevel === 'critical'
              ? 'bg-red-900/20'
              : impact.impactLevel === 'high'
              ? 'bg-orange-900/20'
              : 'bg-gray-800'
          }`}
        >
          <h3 className="text-sm font-medium">Impact Level</h3>
          <p className="text-lg font-bold capitalize">{impact.impactLevel}</p>
          <p className="text-xs text-gray-400">
            Changes will affect {impact.affectedCount} workflow(s)
          </p>
        </div>
      )}
    </div>
  );
}
```

### 2. Add Validation Before Save

Validate workflows before saving to prevent broken dependencies:

```typescript
// hooks/useWorkflowValidation.ts
import { useState, useCallback } from 'react';
import { workflowDependencyAnalyzer } from '@/services/workflow-dependency-analyzer';
import { Workflow } from '@/lib/action-schema/action-types';

export function useWorkflowValidation(allWorkflows: Workflow[]) {
  const [errors, setErrors] = useState<any[]>([]);

  const validate = useCallback(
    (workflow: Workflow) => {
      const analyzer = workflowDependencyAnalyzer;
      const validation = analyzer.validateDependencies(workflow, allWorkflows);

      setErrors(validation.errors);
      return validation.valid;
    },
    [allWorkflows]
  );

  return { validate, errors };
}

// Usage in component
function WorkflowEditor() {
  const { workflows } = useWorkflows();
  const { validate, errors } = useWorkflowValidation(workflows);

  const handleSave = async () => {
    if (!validate(currentWorkflow)) {
      toast.error('Validation failed: ' + errors[0].message);
      return;
    }

    await saveWorkflow(currentWorkflow);
    toast.success('Workflow saved!');
  };

  return (
    <div>
      {errors.length > 0 && (
        <Alert severity="error">
          <h3>Validation Errors</h3>
          {errors.map((err, i) => (
            <p key={i}>{err.message}</p>
          ))}
        </Alert>
      )}
      <Button onClick={handleSave}>Save Workflow</Button>
    </div>
  );
}
```

### 3. Add Circular Dependency Warning

Show warnings when circular dependencies are detected:

```typescript
// components/workflow-builder/CircularDependencyWarning.tsx
'use client';

import { useEffect, useState } from 'react';
import { workflowDependencyAnalyzer } from '@/services/workflow-dependency-analyzer';
import { Workflow } from '@/lib/action-schema/action-types';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

interface CircularDependencyWarningProps {
  workflows: Workflow[];
}

export function CircularDependencyWarning({ workflows }: CircularDependencyWarningProps) {
  const [cycles, setCycles] = useState<string[][]>([]);

  useEffect(() => {
    const analyzer = workflowDependencyAnalyzer;
    const detected = analyzer.findCircularDependencies(workflows);
    setCycles(detected);
  }, [workflows]);

  if (cycles.length === 0) {
    return null;
  }

  return (
    <Alert variant="destructive" className="mb-4">
      <AlertTitle>Circular Dependencies Detected</AlertTitle>
      <AlertDescription>
        <p className="mb-2">
          {cycles.length} circular dependency chain(s) found. This can cause infinite loops:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          {cycles.map((cycle, i) => (
            <li key={i} className="font-mono text-sm">
              {cycle.map((id) => {
                const workflow = workflows.find((w) => w.id === id);
                return workflow?.name || id;
              }).join(' → ')}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
```

### 4. Add Dependency Graph Visualization

Visualize workflow dependencies using React Flow:

```typescript
// components/workflow-builder/DependencyGraph.tsx
'use client';

import { useEffect, useState } from 'react';
import ReactFlow, { Background, Controls } from 'reactflow';
import 'reactflow/dist/style.css';
import { workflowDependencyAnalyzer } from '@/services/workflow-dependency-analyzer';
import { Workflow } from '@/lib/action-schema/action-types';

interface DependencyGraphProps {
  workflows: Workflow[];
}

export function DependencyGraph({ workflows }: DependencyGraphProps) {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);

  useEffect(() => {
    const analyzer = workflowDependencyAnalyzer;
    const vizData = analyzer.getGraphData(workflows);

    // Customize nodes for better display
    const customNodes = vizData.nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        label: (
          <div className="p-2">
            <div className="font-medium">{node.data.label}</div>
            <div className="text-xs text-gray-500">
              {node.data.inDegree} in • {node.data.outDegree} out
            </div>
          </div>
        ),
      },
      style: {
        background: node.data.isCircular ? '#fee' : '#fff',
        border: node.data.isCircular ? '2px solid #f00' : '1px solid #ddd',
        borderRadius: 8,
        padding: 10,
      },
    }));

    setNodes(customNodes);
    setEdges(vizData.edges);
  }, [workflows]);

  return (
    <div className="h-[600px] w-full border rounded">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        attributionPosition="bottom-left"
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
```

### 5. Add Statistics Dashboard

Show overall dependency statistics:

```typescript
// components/workflow-builder/DependencyStatistics.tsx
'use client';

import { useEffect, useState } from 'react';
import { workflowDependencyAnalyzer, DependencyStats } from '@/services/workflow-dependency-analyzer';
import { Workflow } from '@/lib/action-schema/action-types';

interface DependencyStatisticsProps {
  workflows: Workflow[];
}

export function DependencyStatistics({ workflows }: DependencyStatisticsProps) {
  const [stats, setStats] = useState<DependencyStats | null>(null);

  useEffect(() => {
    const analyzer = workflowDependencyAnalyzer;
    setStats(analyzer.getDependencyStats(workflows));
  }, [workflows]);

  if (!stats) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard
        title="Total Workflows"
        value={stats.totalWorkflows}
        icon="📊"
      />
      <StatCard
        title="Dependencies"
        value={stats.totalDependencies}
        icon="🔗"
      />
      <StatCard
        title="Circular Deps"
        value={stats.circularDependencies}
        icon={stats.circularDependencies > 0 ? "⚠️" : "✅"}
        alert={stats.circularDependencies > 0}
      />
      <StatCard
        title="Unused"
        value={stats.unusedWorkflows}
        icon="📦"
        alert={stats.unusedWorkflows > 0}
      />

      <StatCard
        title="Avg Dependencies"
        value={stats.avgDependenciesPerWorkflow.toFixed(1)}
        icon="📈"
      />
      <StatCard
        title="Avg Dependents"
        value={stats.avgDependentsPerWorkflow.toFixed(1)}
        icon="📉"
      />
      <StatCard
        title="Max Depth"
        value={stats.maxDepth}
        icon="🎯"
      />
      <StatCard
        title="Root Workflows"
        value={stats.rootWorkflows}
        icon="🌳"
      />

      {stats.mostDepended.length > 0 && (
        <div className="col-span-2 md:col-span-4">
          <h3 className="text-sm font-medium mb-2">Most Depended Upon</h3>
          <div className="space-y-1">
            {stats.mostDepended.slice(0, 5).map((item, i) => (
              <div key={item.id} className="flex items-center justify-between text-sm">
                <span>
                  {i + 1}. {item.name}
                </span>
                <span className="text-gray-500">{item.count} dependents</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ title, value, icon, alert = false }) {
  return (
    <div className={`p-4 rounded border ${alert ? 'border-red-500 bg-red-900/10' : 'border-gray-700'}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">{title}</span>
        <span className="text-xl">{icon}</span>
      </div>
      <div className="text-2xl font-bold mt-2">{value}</div>
    </div>
  );
}
```

### 6. Add to Context Menu

Add dependency actions to workflow context menu:

```typescript
// components/workflow-builder/WorkflowContextMenu.tsx
import { workflowDependencyAnalyzer } from '@/services/workflow-dependency-analyzer';

export function WorkflowContextMenu({ workflow, workflows, onClose }) {
  const showDependencies = () => {
    const analyzer = workflowDependencyAnalyzer;
    const deps = analyzer.getDependencies(workflow.id, workflows);
    const dependents = analyzer.getDependents(workflow.id, workflows);

    alert(`
      Dependencies: ${deps.length}
      Dependents: ${dependents.length}
    `);
    onClose();
  };

  const checkImpact = () => {
    const analyzer = workflowDependencyAnalyzer;
    const impact = analyzer.getImpactAnalysis(workflow.id, workflows);

    alert(`
      Impact Level: ${impact.impactLevel}
      Affected Workflows: ${impact.affectedCount}
    `);
    onClose();
  };

  const exportDependencies = () => {
    const analyzer = workflowDependencyAnalyzer;
    const report = analyzer.exportDependencyReport(workflows);

    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json',
    });
    downloadFile(blob, 'dependencies.json');
    onClose();
  };

  return (
    <div className="context-menu">
      <button onClick={showDependencies}>Show Dependencies</button>
      <button onClick={checkImpact}>Check Impact</button>
      <button onClick={exportDependencies}>Export Report</button>
    </div>
  );
}
```

### 7. Add Pre-Delete Confirmation

Warn users before deleting workflows with dependents:

```typescript
// hooks/useWorkflowDeletion.ts
import { useCallback } from 'react';
import { workflowDependencyAnalyzer } from '@/services/workflow-dependency-analyzer';
import { Workflow } from '@/lib/action-schema/action-types';

export function useWorkflowDeletion(workflows: Workflow[]) {
  const deleteWorkflow = useCallback(
    async (workflowId: string) => {
      const analyzer = workflowDependencyAnalyzer;
      const dependents = analyzer.getDependents(workflowId, workflows);

      if (dependents.length > 0) {
        const workflow = workflows.find((w) => w.id === workflowId);
        const dependentNames = dependents
          .map((id) => workflows.find((w) => w.id === id)?.name || id)
          .join(', ');

        const confirmed = confirm(
          `Warning: ${workflow?.name} is used by ${dependents.length} workflow(s):\n\n` +
          `${dependentNames}\n\n` +
          `Deleting it will break these workflows. Continue?`
        );

        if (!confirmed) {
          return false;
        }
      }

      await deleteWorkflowFromDatabase(workflowId);
      return true;
    },
    [workflows]
  );

  return { deleteWorkflow };
}
```

### 8. Add to Project Settings

Show project-wide dependency health:

```typescript
// app/settings/dependencies/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { workflowDependencyAnalyzer } from '@/services/workflow-dependency-analyzer';
import { useWorkflows } from '@/hooks/useWorkflows';

export default function DependenciesSettingsPage() {
  const { workflows } = useWorkflows();
  const [report, setReport] = useState(null);

  useEffect(() => {
    if (workflows.length > 0) {
      const analyzer = workflowDependencyAnalyzer;
      setReport(analyzer.exportDependencyReport(workflows));
    }
  }, [workflows]);

  if (!report) return <div>Loading...</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Workflow Dependencies</h1>

      <DependencyStatistics workflows={workflows} />

      {report.circularDependencies.length > 0 && (
        <CircularDependencyWarning workflows={workflows} />
      )}

      {report.unusedWorkflows.length > 0 && (
        <div className="border border-yellow-500 bg-yellow-900/10 p-4 rounded">
          <h3 className="font-medium mb-2">Unused Workflows</h3>
          <p className="text-sm text-gray-400 mb-2">
            {report.unusedWorkflows.length} workflow(s) are never called by others:
          </p>
          <ul className="list-disc pl-5">
            {report.unusedWorkflows.map((id) => {
              const workflow = workflows.find((w) => w.id === id);
              return <li key={id}>{workflow?.name || id}</li>;
            })}
          </ul>
        </div>
      )}

      <div>
        <h2 className="text-lg font-medium mb-4">Dependency Graph</h2>
        <DependencyGraph workflows={workflows} />
      </div>

      <div>
        <button
          onClick={() => {
            const blob = new Blob([JSON.stringify(report, null, 2)], {
              type: 'application/json',
            });
            downloadFile(blob, 'dependency-report.json');
          }}
          className="btn btn-primary"
        >
          Export Full Report
        </button>
      </div>
    </div>
  );
}
```

## API Reference

### Main Methods

```typescript
// Get instance
const analyzer = workflowDependencyAnalyzer;

// Analyze dependencies
analyzer.analyzeDependencies(workflow: Workflow): string[]
analyzer.getDependencies(workflowId: string, workflows: Workflow[]): string[]
analyzer.getDependents(workflowId: string, workflows: Workflow[]): string[]
analyzer.getAllDependencies(workflowId: string, workflows: Workflow[]): string[]

// Build graph
analyzer.buildDependencyGraph(workflows: Workflow[]): DependencyGraph

// Analysis
analyzer.findCircularDependencies(workflows: Workflow[]): string[][]
analyzer.findUnusedWorkflows(workflows: Workflow[]): string[]
analyzer.getImpactAnalysis(workflowId: string, workflows: Workflow[]): ImpactAnalysis
analyzer.getDependencyStats(workflows: Workflow[]): DependencyStats

// Validation
analyzer.validateDependencies(workflow: Workflow, workflows: Workflow[]): DependencyValidation

// Export
analyzer.exportDependencyReport(workflows: Workflow[]): DependencyReport
analyzer.exportGraphML(workflows: Workflow[]): string

// Cache
analyzer.invalidateCache(): void
analyzer.isCacheValid(): boolean
```

## Next Steps

1. Add dependency panel to workflow editor
2. Implement circular dependency warnings
3. Add validation before save
4. Create dependency visualization page
5. Add statistics dashboard
6. Implement pre-delete warnings
7. Export reports and GraphML

See `workflow-dependency-analyzer.README.md` for detailed documentation.
