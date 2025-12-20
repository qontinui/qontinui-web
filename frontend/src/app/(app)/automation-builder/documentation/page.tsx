"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Workflow,
  Action,
  ActionType,
  Connections,
} from "@/lib/action-schema/action-types";
import {
  WorkflowDocumentation,
  WorkflowDocumentationService,
} from "@/services/workflow-documentation-service";
import { DocumentationEditor } from "@/components/workflow-documentation/DocumentationEditor";
import { DocumentationViewer } from "@/components/workflow-documentation/DocumentationViewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  FileText,
  Plus,
  Sparkles,
  Download,
  Upload,
  Search,
  ChevronRight,
  ChevronDown,
  Folder,
  BookOpen,
  FileCode,
  Package,
  TestTube,
  Code,
  History,
  BarChart3,
  Eye,
  Edit,
  Trash2,
  MoreVertical,
  CheckCircle2,
  AlertCircle,
  Clock,
  TrendingUp,
  Settings,
  ExternalLink,
  Tags,
  GitBranch,
  Info,
  PlayCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RequireProject } from "@/components/require-project";
import { toast } from "sonner";

// ============================================================================
// Types
// ============================================================================

interface DocumentationNode {
  id: string;
  type: "root" | "folder" | "workflow" | "section";
  label: string;
  icon: React.ElementType;
  children?: DocumentationNode[];
  workflow?: Workflow;
  hasDocumentation?: boolean;
  lastUpdated?: Date;
}

interface DocumentationFilter {
  status: "all" | "documented" | "undocumented";
  recentlyUpdated: boolean;
  searchQuery: string;
  folder?: string;
}

interface DocumentationStats {
  total: number;
  documented: number;
  coverage: number;
  recentlyUpdated: number;
  mostViewed: string[];
  healthScore: number;
}

interface WorkflowQuickStats {
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

function generateMockWorkflows(): Workflow[] {
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

function buildDocumentationTree(
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

  // Group workflows by category
  const folderMap = new Map<string, Workflow[]>();
  workflows.forEach((workflow) => {
    const folder = workflow.category || "Uncategorized";
    if (!folderMap.has(folder)) {
      folderMap.set(folder, []);
    }
    folderMap.get(folder)!.push(workflow);
  });

  // Create folder nodes
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

  // Add other sections
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

function calculateDocStats(
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

function calculateWorkflowStats(workflow: Workflow): WorkflowQuickStats {
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

// ============================================================================
// Sub-Components
// ============================================================================

function DocumentationNavigator({
  tree,
  selectedNodeId,
  onSelectNode,
  filter,
  onFilterChange,
}: {
  tree: DocumentationNode[];
  selectedNodeId: string | null;
  onSelectNode: (node: DocumentationNode) => void;
  filter: DocumentationFilter;
  onFilterChange: (filter: DocumentationFilter) => void;
}) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(
    new Set(["workflows"])
  );

  const toggleNode = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const renderNode = (
    node: DocumentationNode,
    depth: number = 0
  ): React.ReactNode => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedNodes.has(node.id);
    const isSelected = selectedNodeId === node.id;
    const Icon = node.icon;

    // Apply filter
    if (
      filter.status === "documented" &&
      !node.hasDocumentation &&
      node.type === "workflow"
    ) {
      return null;
    }
    if (
      filter.status === "undocumented" &&
      node.hasDocumentation &&
      node.type === "workflow"
    ) {
      return null;
    }
    if (filter.searchQuery && node.type === "workflow") {
      if (
        !node.label.toLowerCase().includes(filter.searchQuery.toLowerCase())
      ) {
        return null;
      }
    }

    return (
      <div key={node.id}>
        <button
          onClick={() => {
            if (hasChildren) {
              toggleNode(node.id);
            }
            onSelectNode(node);
          }}
          className={cn(
            "w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
            isSelected && "bg-[#00D9FF]/20 text-[#00D9FF] font-medium",
            !isSelected && "hover:bg-gray-800/50 text-gray-300"
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {hasChildren && (
            <span className="size-4 flex items-center justify-center">
              {isExpanded ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
            </span>
          )}
          {!hasChildren && <span className="size-4" />}
          <Icon className="size-4 flex-shrink-0" />
          <span className="flex-1 truncate text-left">{node.label}</span>
          {node.type === "workflow" && !node.hasDocumentation && (
            <AlertCircle className="size-3 text-yellow-500" />
          )}
          {node.type === "workflow" && node.hasDocumentation && (
            <CheckCircle2 className="size-3 text-green-500" />
          )}
        </button>

        {hasChildren && isExpanded && (
          <div>
            {node.children!.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full border-r border-gray-800/50 bg-[#1A1A1B]/30">
      {/* Header */}
      <div className="p-4 border-b border-gray-800/50 space-y-3">
        <div className="flex items-center gap-2">
          <BookOpen className="size-5 text-[#00D9FF]" />
          <h3 className="font-semibold">Documentation</h3>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-gray-500" />
          <Input
            placeholder="Search docs..."
            value={filter.searchQuery}
            onChange={(e) =>
              onFilterChange({ ...filter, searchQuery: e.target.value })
            }
            className="pl-8 h-9 bg-gray-900/50 border-gray-700"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-2">
          <Select
            value={filter.status}
            onValueChange={(value) =>
              onFilterChange({
                ...filter,
                status: value as "all" | "documented" | "undocumented",
              })
            }
          >
            <SelectTrigger className="h-9 bg-gray-900/50 border-gray-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Workflows</SelectItem>
              <SelectItem value="documented">Documented</SelectItem>
              <SelectItem value="undocumented">Undocumented</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tree */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {tree.map((node) => renderNode(node))}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-2 border-t border-gray-800/50">
        <Button
          variant="outline"
          size="sm"
          className="w-full border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF] bg-transparent"
          onClick={() => tree[0] && onSelectNode(tree[0])}
        >
          <Plus className="size-4 mr-2" />
          New Doc
        </Button>
      </div>
    </div>
  );
}

function DocumentationDashboard({
  stats,
  workflows,
  onSelectWorkflow,
}: {
  stats: DocumentationStats;
  workflows: Workflow[];
  onSelectWorkflow: (workflow: Workflow) => void;
}) {
  const undocumentedWorkflows = workflows.filter((wf) => {
    const docService = WorkflowDocumentationService.getInstance();
    return !docService.getDocumentation(wf.id);
  });

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] bg-clip-text text-transparent">
          Documentation Dashboard
        </h1>
        <p className="text-gray-400 mt-2">
          Manage and maintain your workflow documentation
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-[#00D9FF]/20 flex items-center justify-center">
                <FileText className="size-6 text-[#00D9FF]" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Total Documents</p>
                <p className="text-2xl font-bold text-[#00D9FF]">
                  {stats.documented}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-[#00FF88]/20 flex items-center justify-center">
                <BarChart3 className="size-6 text-[#00FF88]" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Coverage</p>
                <p className="text-2xl font-bold text-[#00FF88]">
                  {stats.coverage.toFixed(1)}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-[#BD00FF]/20 flex items-center justify-center">
                <Clock className="size-6 text-[#BD00FF]" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Recently Updated</p>
                <p className="text-2xl font-bold text-[#BD00FF]">
                  {stats.recentlyUpdated}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-[#FFD700]/20 flex items-center justify-center">
                <TrendingUp className="size-6 text-[#FFD700]" />
              </div>
              <div>
                <p className="text-sm text-gray-400">Health Score</p>
                <p className="text-2xl font-bold text-[#FFD700]">
                  {stats.healthScore}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Coverage Progress */}
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardHeader>
          <CardTitle>Documentation Coverage</CardTitle>
          <CardDescription>
            {stats.documented} of {stats.total} workflows documented
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Progress value={stats.coverage} className="h-3" />
        </CardContent>
      </Card>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Undocumented Workflows */}
        <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <AlertCircle className="size-5 text-yellow-500" />
                  Undocumented Workflows
                </CardTitle>
                <CardDescription>
                  {undocumentedWorkflows.length} workflows need documentation
                </CardDescription>
              </div>
              {undocumentedWorkflows.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-[#00D9FF] text-[#00D9FF] hover:bg-[#00D9FF]/20"
                >
                  <Sparkles className="size-4 mr-2" />
                  Generate All
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              <div className="space-y-2">
                {undocumentedWorkflows.slice(0, 10).map((workflow) => (
                  <div
                    key={workflow.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-800/50 hover:border-gray-700 transition-colors cursor-pointer"
                    onClick={() => onSelectWorkflow(workflow)}
                  >
                    <div className="flex items-center gap-3">
                      <FileCode className="size-4 text-gray-500" />
                      <div>
                        <p className="text-sm font-medium">{workflow.name}</p>
                        <p className="text-xs text-gray-500">
                          {workflow.category}
                        </p>
                      </div>
                    </div>
                    <Button size="sm" variant="ghost">
                      <Edit className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Most Viewed */}
        <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="size-5 text-[#00D9FF]" />
              Most Viewed
            </CardTitle>
            <CardDescription>Popular documentation pages</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats.mostViewed.map((name, idx) => (
                <div
                  key={name}
                  className="flex items-center justify-between p-3 rounded-lg border border-gray-800/50 hover:border-gray-700 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[#00D9FF]/20 text-[#00D9FF] font-bold text-sm">
                      {idx + 1}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{name}</p>
                      <p className="text-xs text-gray-500">
                        {[329, 552, 418, 267, 385][idx] || 200} views
                      </p>
                    </div>
                  </div>
                  <ExternalLink className="size-4 text-gray-500" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Links */}
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Common documentation tasks</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Button
              variant="outline"
              className="h-auto flex-col gap-2 p-4 border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF] bg-transparent"
            >
              <Sparkles className="size-6" />
              <span className="text-xs">Auto-Generate</span>
            </Button>
            <Button
              variant="outline"
              className="h-auto flex-col gap-2 p-4 border-gray-700 hover:border-[#BD00FF] hover:text-[#BD00FF] bg-transparent"
            >
              <Download className="size-6" />
              <span className="text-xs">Export All</span>
            </Button>
            <Button
              variant="outline"
              className="h-auto flex-col gap-2 p-4 border-gray-700 hover:border-[#00FF88] hover:text-[#00FF88] bg-transparent"
            >
              <Upload className="size-6" />
              <span className="text-xs">Import Docs</span>
            </Button>
            <Button
              variant="outline"
              className="h-auto flex-col gap-2 p-4 border-gray-700 hover:border-[#FFD700] hover:text-[#FFD700] bg-transparent"
            >
              <Settings className="size-6" />
              <span className="text-xs">Templates</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function WorkflowInfoPanel({
  workflow,
  onEdit,
  onRun,
  onViewTests,
  onViewMetrics,
}: {
  workflow: Workflow;
  onEdit: () => void;
  onRun: () => void;
  onViewTests: () => void;
  onViewMetrics: () => void;
}) {
  const stats = calculateWorkflowStats(workflow);
  const docService = WorkflowDocumentationService.getInstance();
  const documentation = docService.getDocumentation(workflow.id);

  return (
    <div className="flex flex-col h-full border-l border-gray-800/50 bg-[#1A1A1B]/30">
      {/* Header */}
      <div className="p-4 border-b border-gray-800/50">
        <h3 className="font-semibold flex items-center gap-2">
          <Info className="size-5 text-[#BD00FF]" />
          Workflow Info
        </h3>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Quick Stats */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-400 uppercase">
              Quick Stats
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-gray-900/50 border border-gray-800/50">
                <p className="text-xs text-gray-500">Actions</p>
                <p className="text-lg font-bold text-[#00D9FF]">
                  {stats.actionCount}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-gray-900/50 border border-gray-800/50">
                <p className="text-xs text-gray-500">Complexity</p>
                <p className="text-lg font-bold text-[#BD00FF]">
                  {stats.complexity}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-gray-900/50 border border-gray-800/50">
                <p className="text-xs text-gray-500">Dependencies</p>
                <p className="text-lg font-bold text-[#FFD700]">
                  {stats.dependencies}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-gray-900/50 border border-gray-800/50">
                <p className="text-xs text-gray-500">Test Coverage</p>
                <p className="text-lg font-bold text-[#00FF88]">
                  {stats.testCoverage}%
                </p>
              </div>
            </div>
          </div>

          {/* Metrics */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-400 uppercase">
              Performance
            </h4>
            {stats.lastRun && (
              <div className="p-3 rounded-lg bg-gray-900/50 border border-gray-800/50">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500">Last Run</span>
                  <Clock className="size-3 text-gray-500" />
                </div>
                <p className="text-sm font-medium">
                  {new Date(stats.lastRun).toLocaleDateString()}
                </p>
              </div>
            )}
            {stats.successRate && (
              <div className="p-3 rounded-lg bg-gray-900/50 border border-gray-800/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500">Success Rate</span>
                  <span
                    className="text-sm font-bold"
                    style={{
                      color:
                        stats.successRate >= 95
                          ? "#00FF88"
                          : stats.successRate >= 85
                            ? "#FFD700"
                            : "#FF6B6B",
                    }}
                  >
                    {stats.successRate.toFixed(1)}%
                  </span>
                </div>
                <Progress value={stats.successRate} className="h-2" />
              </div>
            )}
          </div>

          {/* Tags */}
          {workflow.tags && workflow.tags.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-gray-400 uppercase">
                Tags
              </h4>
              <div className="flex flex-wrap gap-2">
                {workflow.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="outline"
                    className="bg-gray-900/50 border-gray-700 text-gray-300"
                  >
                    <Tags className="size-3 mr-1" />
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Recent Changes */}
          {documentation && (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-gray-400 uppercase">
                Documentation
              </h4>
              <div className="p-3 rounded-lg bg-gray-900/50 border border-gray-800/50">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 className="size-4 text-green-500" />
                  <span className="text-sm font-medium">Documented</span>
                </div>
                <p className="text-xs text-gray-500">
                  Last updated:{" "}
                  {new Date(documentation.updated).toLocaleDateString()}
                </p>
                <p className="text-xs text-gray-500">
                  Version: {documentation.version}
                </p>
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-400 uppercase">
              Quick Actions
            </h4>
            <div className="space-y-2">
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF] bg-transparent"
                onClick={onEdit}
              >
                <Edit className="size-4 mr-2" />
                Open in Editor
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start border-gray-700 hover:border-[#00FF88] hover:text-[#00FF88] bg-transparent"
                onClick={onRun}
              >
                <PlayCircle className="size-4 mr-2" />
                Run Workflow
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start border-gray-700 hover:border-[#BD00FF] hover:text-[#BD00FF] bg-transparent"
                onClick={onViewTests}
              >
                <TestTube className="size-4 mr-2" />
                View Tests
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start border-gray-700 hover:border-[#FFD700] hover:text-[#FFD700] bg-transparent"
                onClick={onViewMetrics}
              >
                <BarChart3 className="size-4 mr-2" />
                View Metrics
              </Button>
            </div>
          </div>

          {/* Related Documentation */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-400 uppercase">
              Related Docs
            </h4>
            <div className="space-y-2">
              <button className="w-full text-left p-2 rounded hover:bg-gray-800/50 transition-colors">
                <p className="text-sm text-[#00D9FF]">Getting Started Guide</p>
                <p className="text-xs text-gray-500">
                  Introduction to this workflow
                </p>
              </button>
              <button className="w-full text-left p-2 rounded hover:bg-gray-800/50 transition-colors">
                <p className="text-sm text-[#00D9FF]">API Documentation</p>
                <p className="text-xs text-gray-500">Related endpoints</p>
              </button>
              <button className="w-full text-left p-2 rounded hover:bg-gray-800/50 transition-colors">
                <p className="text-sm text-[#00D9FF]">Troubleshooting</p>
                <p className="text-xs text-gray-500">Common issues and fixes</p>
              </button>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function DocumentationPage() {
  const router = useRouter();
  const docService = WorkflowDocumentationService.getInstance();

  // State
  const [workflows] = useState<Workflow[]>(generateMockWorkflows());
  const [selectedNode, setSelectedNode] = useState<DocumentationNode | null>(
    null
  );
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [filter, setFilter] = useState<DocumentationFilter>({
    status: "all",
    recentlyUpdated: false,
    searchQuery: "",
  });
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Compute documentation map
  const docsMap = useMemo(() => {
    const map = new Map<string, WorkflowDocumentation>();
    workflows.forEach((wf) => {
      const doc = docService.getDocumentation(wf.id);
      if (doc) {
        map.set(wf.id, doc);
      }
    });
    return map;
  }, [workflows]);

  // Build tree
  const tree = useMemo(
    () => buildDocumentationTree(workflows, docsMap),
    [workflows, docsMap]
  );

  // Calculate stats
  const stats = useMemo(
    () => calculateDocStats(workflows, docsMap),
    [workflows, docsMap]
  );

  // Get selected workflow
  const selectedWorkflow = selectedNode?.workflow || null;
  const selectedDocumentation = selectedWorkflow
    ? docService.getDocumentation(selectedWorkflow.id)
    : null;

  // Handlers
  const handleSelectNode = (node: DocumentationNode) => {
    setSelectedNode(node);
    setMode("view");
  };

  const handleSaveDocumentation = (content: string) => {
    if (!selectedWorkflow) return;

    if (selectedDocumentation) {
      docService.updateDocumentation(selectedWorkflow.id, content);
    } else {
      docService.createDocumentation(selectedWorkflow.id, content);
    }

    setMode("view");
    // Refresh to show updated data
    window.location.reload();
  };

  const handleGenerateAuto = () => {
    if (!selectedWorkflow) return;

    const generated = docService.generateDocumentation(selectedWorkflow);
    docService.createDocumentation(selectedWorkflow.id, generated);
    setMode("view");
    window.location.reload();
  };

  const handleDeleteDocumentation = () => {
    if (!selectedWorkflow) return;
    docService.deleteDocumentation(selectedWorkflow.id);
    setShowDeleteDialog(false);
    setMode("view");
    window.location.reload();
  };

  const handleExportAll = () => {
    // Implement export all functionality
    console.log("Exporting all documentation...");
  };

  const handleImport = () => {
    // Implement import functionality
    console.log("Importing documentation...");
  };

  const handleGenerateAll = () => {
    workflows.forEach((wf) => {
      if (!docService.getDocumentation(wf.id)) {
        const generated = docService.generateDocumentation(wf);
        docService.createDocumentation(wf.id, generated);
      }
    });
    window.location.reload();
  };

  return (
    <RequireProject pageName="Documentation">
      <div className="flex flex-col h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800/50 bg-[#1A1A1B]/50 backdrop-blur-sm">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] bg-clip-text text-transparent">
              Project Documentation
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              Document your workflows and automation project
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF] bg-transparent"
              onClick={() => setMode("edit")}
            >
              <Plus className="size-4 mr-2" />
              New Documentation
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-gray-700 hover:border-[#BD00FF] hover:text-[#BD00FF] bg-transparent"
              onClick={handleGenerateAll}
            >
              <Sparkles className="size-4 mr-2" />
              Generate All Docs
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-gray-700 hover:border-[#00FF88] hover:text-[#00FF88] bg-transparent"
              onClick={handleExportAll}
            >
              <Download className="size-4 mr-2" />
              Export Documentation
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-gray-700 hover:border-[#FFD700] hover:text-[#FFD700] bg-transparent"
              onClick={handleImport}
            >
              <Upload className="size-4 mr-2" />
              Import Documentation
            </Button>
          </div>
        </div>

        {/* Three Column Layout */}
        <div className="flex flex-1 min-h-0">
          {/* Left Sidebar - Documentation Navigator (20%) */}
          <div className="w-[20%] min-w-[250px] max-w-[350px]">
            <DocumentationNavigator
              tree={tree}
              selectedNodeId={selectedNode?.id || null}
              onSelectNode={handleSelectNode}
              filter={filter}
              onFilterChange={setFilter}
            />
          </div>

          {/* Center Column - Viewer/Editor (50%) */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Show Dashboard when no workflow selected */}
            {!selectedWorkflow && (
              <DocumentationDashboard
                stats={stats}
                workflows={workflows}
                onSelectWorkflow={(wf) => {
                  const node = tree
                    .find((n) => n.id === "workflows")
                    ?.children?.flatMap((folder) => folder.children || [])
                    .find((n) => n.workflow?.id === wf.id);
                  if (node) {
                    handleSelectNode(node);
                  }
                }}
              />
            )}

            {/* Show Viewer or Editor for selected workflow */}
            {selectedWorkflow && (
              <>
                {/* Tabs */}
                <div className="flex items-center gap-4 px-4 py-3 border-b border-gray-800/50 bg-[#1A1A1B]/30">
                  <Button
                    size="sm"
                    variant={mode === "view" ? "default" : "ghost"}
                    onClick={() => setMode("view")}
                    disabled={!selectedDocumentation}
                  >
                    <Eye className="size-4 mr-2" />
                    View
                  </Button>
                  <Button
                    size="sm"
                    variant={mode === "edit" ? "default" : "ghost"}
                    onClick={() => setMode("edit")}
                  >
                    <Edit className="size-4 mr-2" />
                    Edit
                  </Button>

                  <div className="flex-1" />

                  {selectedDocumentation && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="ghost">
                          <MoreVertical className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setMode("edit")}>
                          <Edit className="size-4 mr-2" />
                          Edit Documentation
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleGenerateAuto}>
                          <Sparkles className="size-4 mr-2" />
                          Regenerate
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem>
                          <Download className="size-4 mr-2" />
                          Export
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <History className="size-4 mr-2" />
                          Version History
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setShowDeleteDialog(true)}
                          className="text-red-400 focus:text-red-400"
                        >
                          <Trash2 className="size-4 mr-2" />
                          Delete Documentation
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-h-0">
                  {mode === "view" && selectedDocumentation && (
                    <DocumentationViewer
                      workflow={selectedWorkflow}
                      documentation={selectedDocumentation}
                      onEdit={() => setMode("edit")}
                    />
                  )}

                  {mode === "edit" && (
                    <DocumentationEditor
                      workflow={selectedWorkflow}
                      documentation={selectedDocumentation || undefined}
                      onSave={handleSaveDocumentation}
                      onCancel={() => setMode("view")}
                      onGenerateAuto={handleGenerateAuto}
                    />
                  )}

                  {mode === "view" && !selectedDocumentation && (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center p-8 max-w-md">
                        <FileText className="size-16 mx-auto mb-4 text-gray-600" />
                        <h3 className="text-xl font-semibold mb-2">
                          No Documentation Yet
                        </h3>
                        <p className="text-gray-400 mb-6">
                          This workflow doesn&apos;t have documentation yet.
                          Create documentation to help others understand how it
                          works.
                        </p>
                        <div className="flex gap-3 justify-center">
                          <Button
                            onClick={() => setMode("edit")}
                            className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
                          >
                            <Edit className="size-4 mr-2" />
                            Create Documentation
                          </Button>
                          <Button
                            variant="outline"
                            onClick={handleGenerateAuto}
                            className="border-[#BD00FF] text-[#BD00FF] hover:bg-[#BD00FF]/20"
                          >
                            <Sparkles className="size-4 mr-2" />
                            Auto-Generate
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Right Sidebar - Workflow Info (30%) */}
          {selectedWorkflow && (
            <div className="w-[30%] min-w-[300px] max-w-[400px]">
              <WorkflowInfoPanel
                workflow={selectedWorkflow}
                onEdit={() =>
                  router.push(
                    `/automation-builder?workflow=${selectedWorkflow.id}`
                  )
                }
                onRun={() => {
                  router.push(
                    `/automation-builder?workflow=${selectedWorkflow.id}&mode=run`
                  );
                  toast.info("Opening workflow in run mode");
                }}
                onViewTests={() =>
                  router.push(
                    `/automation-builder/testing?workflow=${selectedWorkflow.id}`
                  )
                }
                onViewMetrics={() =>
                  router.push(
                    `/automation-builder/analytics?workflow=${selectedWorkflow.id}`
                  )
                }
              />
            </div>
          )}
        </div>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent className="bg-[#1A1A1B] border-gray-800">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Documentation</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete the documentation for &quot;
                {selectedWorkflow?.name}&quot;? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="bg-transparent border-gray-700">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteDocumentation}
                className="bg-red-600 hover:bg-red-700"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </RequireProject>
  );
}
