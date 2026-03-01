import React from "react";
import {
  Workflow,
  Action,
  ActionType,
  Connections,
} from "@/lib/action-schema/action-types";
import { WorkflowDocumentation } from "@/services/workflow-documentation-service";
import {
  BookOpen,
  FileCode,
  Folder,
  Package,
  TestTube,
  Code,
  History,
  GitBranch,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

export interface DocumentationNode {
  id: string;
  type: "root" | "folder" | "workflow" | "section";
  label: string;
  icon: React.ElementType;
  children?: DocumentationNode[];
  workflow?: Workflow;
  hasDocumentation?: boolean;
  lastUpdated?: Date;
}

export interface DocumentationFilter {
  status: "all" | "documented" | "undocumented";
  recentlyUpdated: boolean;
  searchQuery: string;
  folder?: string;
}

export interface DocumentationStats {
  total: number;
  documented: number;
  coverage: number;
  recentlyUpdated: number;
  mostViewed: string[];
  healthScore: number;
}

export interface WorkflowQuickStats {
  actionCount: number;
  complexity: number;
  dependencies: number;
  testCoverage: number;
  lastRun?: Date;
  successRate?: number;
}

// ============================================================================
// Mock Data (Replace with actual data from your backend/store)
// ============================================================================

export function generateMockWorkflows(): Workflow[] {
  return [
    {
      id: "wf-1",
      name: "User Login Flow",
      description: "Handles user authentication and login",
      version: "1.0.0",
      format: "graph" as const,
      actions: Array(12)
        .fill(null)
        .map((_, i) => ({
          id: `action-${i}`,
          type: "CLICK" as ActionType,
          name: `Action ${i + 1}`,
          config: {},
          position: [0, 0] as [number, number],
        })) as Action<ActionType>[],
      connections: {} as Connections,
      variables: {},
    },
    {
      id: "wf-2",
      name: "Form Validation",
      description: "Validates form inputs",
      version: "1.0.0",
      format: "graph" as const,
      actions: Array(8)
        .fill(null)
        .map((_, i) => ({
          id: `action-${i}`,
          type: "TYPE" as ActionType,
          name: `Action ${i + 1}`,
          config: {},
          position: [0, 0] as [number, number],
        })) as Action<ActionType>[],
      connections: {} as Connections,
      variables: {},
    },
    {
      id: "wf-3",
      name: "Dashboard Navigation",
      description: "Navigate through dashboard sections",
      version: "1.0.0",
      format: "graph" as const,
      actions: Array(15)
        .fill(null)
        .map((_, i) => ({
          id: `action-${i}`,
          type: "CLICK" as ActionType,
          name: `Action ${i + 1}`,
          config: {},
          position: [0, 0] as [number, number],
        })) as Action<ActionType>[],
      connections: {} as Connections,
      variables: {},
    },
    {
      id: "wf-4",
      name: "API Integration Test",
      description: "Tests API endpoints",
      version: "1.0.0",
      format: "graph" as const,
      actions: Array(20)
        .fill(null)
        .map((_, i) => ({
          id: `action-${i}`,
          type: "FIND" as ActionType,
          name: `Action ${i + 1}`,
          config: {},
          position: [0, 0] as [number, number],
        })) as Action<ActionType>[],
      connections: {} as Connections,
      variables: {},
    },
    {
      id: "wf-5",
      name: "User Registration",
      description: "New user signup flow",
      version: "1.0.0",
      format: "graph" as const,
      actions: Array(10)
        .fill(null)
        .map((_, i) => ({
          id: `action-${i}`,
          type: "TYPE" as ActionType,
          name: `Action ${i + 1}`,
          config: {},
          position: [0, 0] as [number, number],
        })) as Action<ActionType>[],
      connections: {} as Connections,
      variables: {},
    },
  ];
}

export function buildDocumentationTree(
  workflows: Workflow[],
  docs: Map<string, WorkflowDocumentation>
): DocumentationNode[] {
  const tree: DocumentationNode[] = [
    {
      id: "project-overview",
      type: "root",
      label: "Project Overview",
      icon: BookOpen,
      hasDocumentation: true,
    },
  ];

  const folderMap = new Map<string, Workflow[]>();
  workflows.forEach((workflow) => {
    const folder = workflow.category || "Uncategorized";
    if (!folderMap.has(folder)) {
      folderMap.set(folder, []);
    }
    folderMap.get(folder)!.push(workflow);
  });

  const workflowsNode: DocumentationNode = {
    id: "workflows",
    type: "section",
    label: "Workflows",
    icon: GitBranch,
    children: [],
  };

  folderMap.forEach((folderWorkflows, folderName) => {
    const folderNode: DocumentationNode = {
      id: `folder-${folderName}`,
      type: "folder",
      label: folderName,
      icon: Folder,
      children: folderWorkflows.map((wf) => ({
        id: `workflow-${wf.id}`,
        type: "workflow",
        label: wf.name,
        icon: FileCode,
        workflow: wf,
        hasDocumentation: docs.has(wf.id),
        lastUpdated: docs.get(wf.id)
          ? new Date(docs.get(wf.id)!.updated)
          : undefined,
      })),
    };
    workflowsNode.children!.push(folderNode);
  });

  tree.push(workflowsNode);

  tree.push(
    {
      id: "components",
      type: "section",
      label: "Components",
      icon: Package,
      hasDocumentation: false,
    },
    {
      id: "testing-guide",
      type: "section",
      label: "Testing Guide",
      icon: TestTube,
      hasDocumentation: false,
    },
    {
      id: "api-reference",
      type: "section",
      label: "API Reference",
      icon: Code,
      hasDocumentation: false,
    },
    {
      id: "changelog",
      type: "section",
      label: "Change Log",
      icon: History,
      hasDocumentation: false,
    }
  );

  return tree;
}

export function calculateDocStats(
  workflows: Workflow[],
  docs: Map<string, WorkflowDocumentation>
): DocumentationStats {
  const total = workflows.length;
  const documented = workflows.filter((wf) => docs.has(wf.id)).length;
  const coverage = total > 0 ? (documented / total) * 100 : 0;
  const recentlyUpdated = Array.from(docs.values()).filter((doc) => {
    const updated = new Date(doc.updated);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return updated > weekAgo;
  }).length;

  return {
    total,
    documented,
    coverage,
    recentlyUpdated,
    mostViewed: [
      "User Login Flow",
      "Dashboard Navigation",
      "API Integration Test",
    ],
    healthScore: Math.round(
      coverage * 0.6 + (recentlyUpdated / total) * 100 * 0.4
    ),
  };
}

export function calculateWorkflowStats(workflow: Workflow): WorkflowQuickStats {
  return {
    actionCount: workflow.actions.length,
    complexity:
      Math.floor(workflow.actions.length / 2) + Math.floor(Math.random() * 5),
    dependencies: Math.floor(Math.random() * 3),
    testCoverage: Math.floor(Math.random() * 40) + 60,
    lastRun: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
    successRate: Math.random() * 15 + 85,
  };
}
