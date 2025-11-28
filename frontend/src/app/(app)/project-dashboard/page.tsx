"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Download,
  Upload,
  Settings,
  Search,
  TrendingUp,
  TrendingDown,
  FileCode,
  Layers,
  Image as ImageIcon,
  GitBranch,
  TestTube,
  BookOpen,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Zap,
  Target,
  Activity,
  FolderTree,
  Tags,
  FileText,
  Trash2,
  RefreshCw,
  Archive,
  Copy,
  Link2,
  BarChart3,
  PieChart,
  Database,
  HardDrive,
  Users,
  Calendar,
  Filter,
  ArrowUpDown,
  ExternalLink,
  Plus,
  Minus,
  AlertCircle,
  Info,
  CheckCircle,
  Save,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  ScatterChart,
  Scatter,
  Treemap,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from "recharts";

// ============================================================================
// Types
// ============================================================================

interface ProjectMetrics {
  totalWorkflows: number;
  totalStates: number;
  totalImages: number;
  totalTransitions: number;
  testCoverage: number;
  docCoverage: number;
  trends: {
    workflows: number;
    states: number;
    images: number;
    transitions: number;
  };
}

interface HealthFactors {
  testCoverage: number;
  docCoverage: number;
  organization: number;
  complexity: number;
  unusedResources: number;
  brokenReferences: number;
}

interface HealthIssue {
  id: string;
  type: "error" | "warning" | "info";
  category: string;
  title: string;
  description: string;
  count: number;
  affectedResources: string[];
  link: string;
}

interface ResourceUsage {
  type: "workflow" | "state" | "image" | "transition";
  id: string;
  name: string;
  usageCount: number;
  lastUsed?: string;
  size?: number;
}

interface ActivityEvent {
  id: string;
  type: "created" | "modified" | "deleted" | "imported" | "exported" | "tested";
  resourceType: "workflow" | "state" | "image" | "transition";
  resourceName: string;
  timestamp: Date;
  user?: string;
  metadata?: Record<string, any>;
}

interface DependencyNode {
  id: string;
  type: "workflow" | "state" | "image";
  name: string;
  dependencies: string[];
}

interface SearchResult {
  type: "workflow" | "state" | "image" | "transition";
  id: string;
  name: string;
  description?: string;
  matches: string[];
  relevance: number;
}

// ============================================================================
// Mock Data Generation
// ============================================================================

function generateMockProjectData() {
  // Project metrics
  const metrics: ProjectMetrics = {
    totalWorkflows: 142,
    totalStates: 387,
    totalImages: 1243,
    totalTransitions: 524,
    testCoverage: 73.5,
    docCoverage: 61.2,
    trends: {
      workflows: 8.3,
      states: 12.1,
      images: 15.7,
      transitions: 9.4,
    },
  };

  // Health factors (0-100 scale)
  const healthFactors: HealthFactors = {
    testCoverage: 73.5,
    docCoverage: 61.2,
    organization: 85.0,
    complexity: 72.0,
    unusedResources: 65.0,
    brokenReferences: 92.0,
  };

  // Calculate overall health score
  const healthScore = Math.round(
    healthFactors.testCoverage * 0.25 +
      healthFactors.docCoverage * 0.2 +
      healthFactors.organization * 0.15 +
      healthFactors.complexity * 0.2 +
      healthFactors.unusedResources * 0.1 +
      healthFactors.brokenReferences * 0.1
  );

  // Health issues
  const healthIssues: HealthIssue[] = [
    {
      id: "1",
      type: "error",
      category: "Broken References",
      title: "Missing Image References",
      description: "8 workflows reference images that no longer exist",
      count: 8,
      affectedResources: ["LoginFlow", "CheckoutProcess", "UserProfile"],
      link: "/automation-builder?filter=broken-refs",
    },
    {
      id: "2",
      type: "error",
      category: "Circular Dependencies",
      title: "Circular Workflow Dependencies",
      description: "3 workflows have circular dependencies",
      count: 3,
      affectedResources: ["MainFlow", "SubFlow", "HelperFlow"],
      link: "/automation-builder/dependencies?filter=circular",
    },
    {
      id: "3",
      type: "warning",
      category: "Missing Tests",
      title: "Workflows Without Tests",
      description: "42 workflows have no test cases",
      count: 42,
      affectedResources: [],
      link: "/automation-builder/testing?filter=no-tests",
    },
    {
      id: "4",
      type: "warning",
      category: "High Complexity",
      title: "High Complexity Workflows",
      description: "7 workflows exceed complexity threshold (15+ actions)",
      count: 7,
      affectedResources: ["MasterWorkflow", "FullIntegration"],
      link: "/automation-builder?filter=complex",
    },
    {
      id: "5",
      type: "warning",
      category: "Unused Resources",
      title: "Unused Images",
      description: "156 images are not used in any workflow or state",
      count: 156,
      affectedResources: [],
      link: "/project-dashboard?tab=cleanup",
    },
    {
      id: "6",
      type: "warning",
      category: "Orphaned States",
      title: "Orphaned States",
      description: "12 states are not referenced by any workflow",
      count: 12,
      affectedResources: [],
      link: "/project-dashboard?tab=cleanup",
    },
    {
      id: "7",
      type: "info",
      category: "Documentation",
      title: "Missing Documentation",
      description: "58 workflows have no description",
      count: 58,
      affectedResources: [],
      link: "/automation-builder/documentation",
    },
    {
      id: "8",
      type: "info",
      category: "Duplicate Detection",
      title: "Potential Duplicate Images",
      description: "23 images may be duplicates based on visual similarity",
      count: 23,
      affectedResources: [],
      link: "/project-dashboard?tab=duplicates",
    },
  ];

  // Resource usage
  const resourceUsage: ResourceUsage[] = [
    {
      type: "workflow",
      id: "wf-1",
      name: "User Login Flow",
      usageCount: 1247,
      lastUsed: "2 hours ago",
    },
    {
      type: "state",
      id: "st-1",
      name: "LoginPage",
      usageCount: 892,
      lastUsed: "5 hours ago",
    },
    {
      type: "image",
      id: "img-1",
      name: "login_button.png",
      usageCount: 743,
      lastUsed: "1 day ago",
      size: 45678,
    },
    {
      type: "workflow",
      id: "wf-2",
      name: "Form Validation",
      usageCount: 621,
      lastUsed: "3 days ago",
    },
    {
      type: "state",
      id: "st-2",
      name: "Dashboard",
      usageCount: 534,
      lastUsed: "1 week ago",
    },
  ];

  // Activity events
  const activities: ActivityEvent[] = Array.from({ length: 50 }, (_, i) => {
    const types: ActivityEvent["type"][] = [
      "created",
      "modified",
      "deleted",
      "imported",
      "exported",
      "tested",
    ];
    const resourceTypes: ActivityEvent["resourceType"][] = [
      "workflow",
      "state",
      "image",
      "transition",
    ];
    const type = types[Math.floor(Math.random() * types.length)];
    const resourceType =
      resourceTypes[Math.floor(Math.random() * resourceTypes.length)];

    return {
      id: `event-${i}`,
      type,
      resourceType,
      resourceName: `${resourceType}-${i}`,
      timestamp: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
      user: Math.random() > 0.5 ? "John Doe" : "Jane Smith",
    };
  }).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  // Timeline data (last 30 days)
  const timelineData = Array.from({ length: 30 }, (_, i) => ({
    date: new Date(
      Date.now() - (29 - i) * 24 * 60 * 60 * 1000
    ).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    workflows: Math.floor(Math.random() * 5 + 2),
    states: Math.floor(Math.random() * 10 + 5),
    images: Math.floor(Math.random() * 15 + 8),
    transitions: Math.floor(Math.random() * 8 + 3),
  }));

  // Workflow statistics
  const workflowsByComplexity = [
    { range: "Simple (1-5)", count: 58, fill: "#00FF88" },
    { range: "Medium (6-10)", count: 47, fill: "#00D9FF" },
    { range: "Complex (11-15)", count: 30, fill: "#FFD700" },
    { range: "Very Complex (16+)", count: 7, fill: "#FF6B6B" },
  ];

  const workflowsByFolder = [
    { name: "Authentication", count: 35, fill: "#00D9FF" },
    { name: "Navigation", count: 28, fill: "#BD00FF" },
    { name: "Forms", count: 24, fill: "#00FF88" },
    { name: "Testing", count: 21, fill: "#FFD700" },
    { name: "API", count: 18, fill: "#FF6B6B" },
    { name: "Uncategorized", count: 16, fill: "#888888" },
  ];

  const statesByGroup = [
    { name: "Login States", count: 45, fill: "#00D9FF" },
    { name: "Dashboard States", count: 67, fill: "#BD00FF" },
    { name: "Form States", count: 89, fill: "#00FF88" },
    { name: "Error States", count: 34, fill: "#FF6B6B" },
    { name: "Loading States", count: 56, fill: "#FFD700" },
    { name: "Other", count: 96, fill: "#888888" },
  ];

  const imagesByFolder = [
    { name: "buttons", size: 234, fill: "#00D9FF", count: 234 },
    { name: "icons", size: 189, fill: "#BD00FF", count: 189 },
    { name: "backgrounds", size: 156, fill: "#00FF88", count: 156 },
    { name: "forms", size: 143, fill: "#FFD700", count: 143 },
    { name: "navigation", size: 128, fill: "#FF6B6B", count: 128 },
    { name: "misc", size: 393, fill: "#888888", count: 393 },
  ];

  const transitionsByType = [
    { name: "Outgoing", count: 312, fill: "#00D9FF" },
    { name: "Incoming", count: 212, fill: "#BD00FF" },
  ];

  // Storage statistics
  const storageStats = {
    totalSize: 847.5, // MB
    byType: [
      { type: "Images", size: 723.2, count: 1243, fill: "#00D9FF" },
      { type: "Workflows", size: 45.8, count: 142, fill: "#BD00FF" },
      { type: "States", size: 52.3, count: 387, fill: "#00FF88" },
      { type: "Other", size: 26.2, count: 524, fill: "#888888" },
    ],
  };

  // Dependency data
  const dependencyData: DependencyNode[] = [
    {
      id: "wf-1",
      type: "workflow",
      name: "Main Login",
      dependencies: ["st-1", "st-2", "img-1"],
    },
    {
      id: "st-1",
      type: "state",
      name: "LoginPage",
      dependencies: ["img-1", "img-2", "img-3"],
    },
    {
      id: "st-2",
      type: "state",
      name: "Dashboard",
      dependencies: ["img-4", "img-5"],
    },
    {
      id: "img-1",
      type: "image",
      name: "login_button.png",
      dependencies: [],
    },
    {
      id: "img-2",
      type: "image",
      name: "username_field.png",
      dependencies: [],
    },
  ];

  return {
    metrics,
    healthScore,
    healthFactors,
    healthIssues,
    resourceUsage,
    activities,
    timelineData,
    workflowsByComplexity,
    workflowsByFolder,
    statesByGroup,
    imagesByFolder,
    transitionsByType,
    storageStats,
    dependencyData,
  };
}

// ============================================================================
// Components
// ============================================================================

function MetricCard({
  icon: Icon,
  label,
  value,
  color,
  trend,
}: {
  icon: any;
  label: string;
  value: string | number;
  color: string;
  trend?: number;
}) {
  const TrendIcon = trend && trend > 0 ? TrendingUp : TrendingDown;
  const trendColor = trend && trend > 0 ? "#00FF88" : "#FF6B6B";

  return (
    <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm hover:border-gray-700 transition-all">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3 flex-1">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${color}20` }}
            >
              <Icon className="w-5 h-5" style={{ color }} />
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">{label}</p>
              <p className="text-2xl font-bold" style={{ color }}>
                {value}
              </p>
            </div>
          </div>
          {trend !== undefined && (
            <Badge
              variant="outline"
              className="text-xs"
              style={{
                backgroundColor: `${trendColor}20`,
                borderColor: `${trendColor}40`,
                color: trendColor,
              }}
            >
              <TrendIcon className="w-3 h-3 mr-1" />
              {trend > 0 ? "+" : ""}
              {trend.toFixed(1)}%
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function HealthScoreGauge({
  score,
  factors,
}: {
  score: number;
  factors: HealthFactors;
}) {
  const getScoreColor = (score: number) => {
    if (score >= 80) return "#00FF88";
    if (score >= 60) return "#FFD700";
    return "#FF6B6B";
  };

  const getScoreLabel = (score: number) => {
    if (score >= 90) return "Excellent";
    if (score >= 75) return "Good";
    if (score >= 60) return "Fair";
    if (score >= 40) return "Poor";
    return "Critical";
  };

  const color = getScoreColor(score);
  const label = getScoreLabel(score);

  // Prepare radar chart data
  const radarData = [
    { factor: "Tests", value: factors.testCoverage, fullMark: 100 },
    { factor: "Docs", value: factors.docCoverage, fullMark: 100 },
    { factor: "Organized", value: factors.organization, fullMark: 100 },
    { factor: "Complexity", value: factors.complexity, fullMark: 100 },
    { factor: "Unused", value: factors.unusedResources, fullMark: 100 },
    { factor: "References", value: factors.brokenReferences, fullMark: 100 },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center justify-center">
        <div className="relative w-40 h-40">
          <svg className="w-full h-full transform -rotate-90">
            <circle
              cx="80"
              cy="80"
              r="70"
              stroke="#2A2A2B"
              strokeWidth="12"
              fill="none"
            />
            <circle
              cx="80"
              cy="80"
              r="70"
              stroke={color}
              strokeWidth="12"
              fill="none"
              strokeDasharray={`${(score / 100) * 439.82} 439.82`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-4xl font-bold" style={{ color }}>
              {score}
            </p>
            <p className="text-xs text-gray-400">out of 100</p>
          </div>
        </div>
        <p className="mt-3 text-lg font-semibold" style={{ color }}>
          {label}
        </p>
      </div>

      <div className="mt-6">
        <ResponsiveContainer width="100%" height={200}>
          <RadarChart data={radarData}>
            <PolarGrid stroke="#333" />
            <PolarAngleAxis
              dataKey="factor"
              stroke="#888"
              style={{ fontSize: "11px" }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              stroke="#666"
              style={{ fontSize: "10px" }}
            />
            <Radar
              name="Score"
              dataKey="value"
              stroke={color}
              fill={color}
              fillOpacity={0.3}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Test Coverage</span>
          <span className="font-medium">
            {factors.testCoverage.toFixed(1)}%
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Documentation</span>
          <span className="font-medium">{factors.docCoverage.toFixed(1)}%</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Organization</span>
          <span className="font-medium">
            {factors.organization.toFixed(1)}%
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Complexity</span>
          <span className="font-medium">{factors.complexity.toFixed(1)}%</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Clean Resources</span>
          <span className="font-medium">
            {factors.unusedResources.toFixed(1)}%
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Valid References</span>
          <span className="font-medium">
            {factors.brokenReferences.toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  );
}

function HealthIssuesList({ issues }: { issues: HealthIssue[] }) {
  const router = useRouter();

  const getIssueIcon = (type: HealthIssue["type"]) => {
    switch (type) {
      case "error":
        return XCircle;
      case "warning":
        return AlertTriangle;
      case "info":
        return Info;
    }
  };

  const getIssueColor = (type: HealthIssue["type"]) => {
    switch (type) {
      case "error":
        return "#FF6B6B";
      case "warning":
        return "#FFD700";
      case "info":
        return "#00D9FF";
    }
  };

  return (
    <div className="space-y-2">
      {issues.map((issue) => {
        const Icon = getIssueIcon(issue.type);
        const color = getIssueColor(issue.type);

        return (
          <div
            key={issue.id}
            className="p-3 rounded-lg border border-gray-800/50 hover:border-gray-700 transition-all cursor-pointer"
            style={{ backgroundColor: `${color}08` }}
            onClick={() => router.push(issue.link)}
          >
            <div className="flex items-start gap-3">
              <Icon
                className="w-4 h-4 mt-0.5 flex-shrink-0"
                style={{ color }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-sm font-medium">{issue.title}</p>
                  <Badge
                    variant="outline"
                    style={{
                      backgroundColor: `${color}20`,
                      borderColor: `${color}40`,
                      color,
                    }}
                  >
                    {issue.count}
                  </Badge>
                </div>
                <p className="text-xs text-gray-400 mb-2">
                  {issue.description}
                </p>
                {issue.affectedResources.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {issue.affectedResources.slice(0, 3).map((resource) => (
                      <Badge
                        key={resource}
                        variant="outline"
                        className="text-xs bg-gray-800/50 border-gray-700"
                      >
                        {resource}
                      </Badge>
                    ))}
                    {issue.affectedResources.length > 3 && (
                      <Badge
                        variant="outline"
                        className="text-xs bg-gray-800/50 border-gray-700"
                      >
                        +{issue.affectedResources.length - 3} more
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ResourceOverviewTabs({
  data,
}: {
  data: ReturnType<typeof generateMockProjectData>;
}) {
  return (
    <Tabs defaultValue="workflows" className="w-full">
      <TabsList className="grid w-full grid-cols-4 bg-gray-800/30">
        <TabsTrigger value="workflows">Workflows</TabsTrigger>
        <TabsTrigger value="states">States</TabsTrigger>
        <TabsTrigger value="images">Images</TabsTrigger>
        <TabsTrigger value="transitions">Transitions</TabsTrigger>
      </TabsList>

      <TabsContent value="workflows" className="space-y-4 mt-4">
        <div className="grid grid-cols-2 gap-4">
          <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
            <CardHeader>
              <CardTitle className="text-sm">By Complexity</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <RechartsPieChart>
                  <Pie
                    data={data.workflowsByComplexity}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={2}
                    dataKey="count"
                  >
                    {data.workflowsByComplexity.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1A1A1B",
                      border: "1px solid #333",
                      borderRadius: "8px",
                    }}
                  />
                </RechartsPieChart>
              </ResponsiveContainer>
              <div className="mt-4 space-y-1 text-xs">
                {data.workflowsByComplexity.map((item) => (
                  <div
                    key={item.range}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded"
                        style={{ backgroundColor: item.fill }}
                      />
                      <span className="text-gray-400">{item.range}</span>
                    </div>
                    <span className="font-medium">{item.count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
            <CardHeader>
              <CardTitle className="text-sm">By Folder</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.workflowsByFolder}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis
                    dataKey="name"
                    stroke="#666"
                    style={{ fontSize: "10px" }}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis stroke="#666" style={{ fontSize: "10px" }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1A1A1B",
                      border: "1px solid #333",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {data.workflowsByFolder.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="states" className="space-y-4 mt-4">
        <div className="grid grid-cols-2 gap-4">
          <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
            <CardHeader>
              <CardTitle className="text-sm">By Group</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <RechartsPieChart>
                  <Pie
                    data={data.statesByGroup}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={2}
                    dataKey="count"
                  >
                    {data.statesByGroup.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1A1A1B",
                      border: "1px solid #333",
                      borderRadius: "8px",
                    }}
                  />
                </RechartsPieChart>
              </ResponsiveContainer>
              <div className="mt-4 space-y-1 text-xs">
                {data.statesByGroup.map((item) => (
                  <div
                    key={item.name}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded"
                        style={{ backgroundColor: item.fill }}
                      />
                      <span className="text-gray-400">{item.name}</span>
                    </div>
                    <span className="font-medium">{item.count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
            <CardHeader>
              <CardTitle className="text-sm">Distribution Stats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span className="text-gray-400">Avg Images per State</span>
                  <span className="font-medium">3.2</span>
                </div>
                <Progress value={64} className="h-2" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span className="text-gray-400">
                    Avg Transitions per State
                  </span>
                  <span className="font-medium">1.4</span>
                </div>
                <Progress value={28} className="h-2" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span className="text-gray-400">States with Regions</span>
                  <span className="font-medium">67%</span>
                </div>
                <Progress value={67} className="h-2" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span className="text-gray-400">States with Locations</span>
                  <span className="font-medium">54%</span>
                </div>
                <Progress value={54} className="h-2" />
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="images" className="space-y-4 mt-4">
        <div className="grid grid-cols-2 gap-4">
          <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
            <CardHeader>
              <CardTitle className="text-sm">By Folder (Treemap)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <Treemap
                  data={data.imagesByFolder}
                  dataKey="size"
                  stroke="#1A1A1B"
                  content={({
                    x,
                    y,
                    width,
                    height,
                    index,
                    name,
                    count,
                  }: any) => {
                    if (!x || !y || !width || !height) return null;
                    const colors = [
                      "#00D9FF",
                      "#BD00FF",
                      "#00FF88",
                      "#FFD700",
                      "#FF6B6B",
                      "#888888",
                    ];
                    return (
                      <g>
                        <rect
                          x={x}
                          y={y}
                          width={width}
                          height={height}
                          style={{
                            fill: colors[index % colors.length],
                            fillOpacity: 0.9,
                            stroke: "#1A1A1B",
                            strokeWidth: 2,
                          }}
                        />
                        {width > 60 && height > 30 && (
                          <>
                            <text
                              x={x + width / 2}
                              y={y + height / 2 - 6}
                              textAnchor="middle"
                              fill="#000"
                              fontSize={12}
                              fontWeight="600"
                            >
                              {name}
                            </text>
                            <text
                              x={x + width / 2}
                              y={y + height / 2 + 10}
                              textAnchor="middle"
                              fill="#000"
                              fontSize={10}
                            >
                              {count} images
                            </text>
                          </>
                        )}
                      </g>
                    );
                  }}
                />
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
            <CardHeader>
              <CardTitle className="text-sm">Usage Statistics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span className="text-gray-400">Used in Workflows</span>
                  <span className="font-medium">67%</span>
                </div>
                <Progress value={67} className="h-2" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span className="text-gray-400">Used in States</span>
                  <span className="font-medium">81%</span>
                </div>
                <Progress value={81} className="h-2" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span className="text-gray-400">Unused Images</span>
                  <span className="font-medium text-yellow-500">13%</span>
                </div>
                <Progress value={13} className="h-2" />
              </div>
              <Separator />
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-400">Total Storage</span>
                  <span className="font-medium">723.2 MB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Avg Image Size</span>
                  <span className="font-medium">582 KB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Largest Image</span>
                  <span className="font-medium">4.7 MB</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="transitions" className="space-y-4 mt-4">
        <div className="grid grid-cols-2 gap-4">
          <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
            <CardHeader>
              <CardTitle className="text-sm">By Type</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <RechartsPieChart>
                  <Pie
                    data={data.transitionsByType}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={2}
                    dataKey="count"
                  >
                    {data.transitionsByType.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1A1A1B",
                      border: "1px solid #333",
                      borderRadius: "8px",
                    }}
                  />
                </RechartsPieChart>
              </ResponsiveContainer>
              <div className="mt-4 space-y-1 text-xs">
                {data.transitionsByType.map((item) => (
                  <div
                    key={item.name}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded"
                        style={{ backgroundColor: item.fill }}
                      />
                      <span className="text-gray-400">{item.name}</span>
                    </div>
                    <span className="font-medium">{item.count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
            <CardHeader>
              <CardTitle className="text-sm">Transition Stats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span className="text-gray-400">Avg Timeout (s)</span>
                  <span className="font-medium">15.3</span>
                </div>
                <Progress value={51} className="h-2" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span className="text-gray-400">With Workflows</span>
                  <span className="font-medium">89%</span>
                </div>
                <Progress value={89} className="h-2" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span className="text-gray-400">Complex Transitions</span>
                  <span className="font-medium">23%</span>
                </div>
                <Progress value={23} className="h-2" />
              </div>
              <Separator />
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-400">Max Retry Count</span>
                  <span className="font-medium">5</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Avg States Activated</span>
                  <span className="font-medium">2.3</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>
    </Tabs>
  );
}

function ActivityTimeline({ activities }: { activities: ActivityEvent[] }) {
  const getActivityIcon = (type: ActivityEvent["type"]) => {
    switch (type) {
      case "created":
        return Plus;
      case "modified":
        return FileText;
      case "deleted":
        return Trash2;
      case "imported":
        return Upload;
      case "exported":
        return Download;
      case "tested":
        return TestTube;
    }
  };

  const getActivityColor = (type: ActivityEvent["type"]) => {
    switch (type) {
      case "created":
        return "#00FF88";
      case "modified":
        return "#00D9FF";
      case "deleted":
        return "#FF6B6B";
      case "imported":
        return "#FFD700";
      case "exported":
        return "#BD00FF";
      case "tested":
        return "#888888";
    }
  };

  const getResourceTypeIcon = (type: ActivityEvent["resourceType"]) => {
    switch (type) {
      case "workflow":
        return FileCode;
      case "state":
        return Layers;
      case "image":
        return ImageIcon;
      case "transition":
        return GitBranch;
    }
  };

  const getRelativeTime = (date: Date) => {
    const now = new Date();
    const diffInMinutes = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60)
    );

    if (diffInMinutes < 1) return "Just now";
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `${diffInDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <ScrollArea className="h-[400px] pr-4">
      <div className="space-y-2">
        {activities.slice(0, 20).map((activity) => {
          const Icon = getActivityIcon(activity.type);
          const ResourceIcon = getResourceTypeIcon(activity.resourceType);
          const color = getActivityColor(activity.type);

          return (
            <div
              key={activity.id}
              className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-800/30 transition-colors cursor-pointer"
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${color}20` }}
              >
                <Icon className="w-4 h-4" style={{ color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  {activity.type.charAt(0).toUpperCase() +
                    activity.type.slice(1)}{" "}
                  <span className="text-[#00D9FF]">
                    {activity.resourceName}
                  </span>
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <ResourceIcon className="w-3 h-3 text-gray-500" />
                  <span className="text-xs text-gray-500">
                    {activity.resourceType}
                  </span>
                  <span className="text-gray-600">•</span>
                  <span className="text-xs text-gray-500">
                    {getRelativeTime(activity.timestamp)}
                  </span>
                  {activity.user && (
                    <>
                      <span className="text-gray-600">•</span>
                      <span className="text-xs text-gray-500">
                        {activity.user}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function StorageAnalysis({
  stats,
}: {
  stats: ReturnType<typeof generateMockProjectData>["storageStats"];
}) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <p className="text-sm text-gray-400 mb-1">Total Storage Used</p>
        <p className="text-3xl font-bold text-[#00D9FF]">
          {stats.totalSize.toFixed(1)} MB
        </p>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <RechartsPieChart>
          <Pie
            data={stats.byType}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={3}
            dataKey="size"
          >
            {stats.byType.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.fill} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: "#1A1A1B",
              border: "1px solid #333",
              borderRadius: "8px",
            }}
            formatter={(value: number) => `${value.toFixed(1)} MB`}
          />
        </RechartsPieChart>
      </ResponsiveContainer>

      <div className="space-y-3">
        {stats.byType.map((item) => (
          <div key={item.type}>
            <div className="flex items-center justify-between mb-2 text-sm">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded"
                  style={{ backgroundColor: item.fill }}
                />
                <span className="text-gray-400">{item.type}</span>
              </div>
              <div className="text-right">
                <span className="font-medium">{item.size.toFixed(1)} MB</span>
                <span className="text-xs text-gray-500 ml-2">
                  ({item.count})
                </span>
              </div>
            </div>
            <Progress
              value={(item.size / stats.totalSize) * 100}
              className="h-2"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function BulkOptimizationTools() {
  const [isProcessing, setIsProcessing] = useState(false);

  const tools = [
    {
      id: "unused-images",
      title: "Remove Unused Images",
      description: "Find and remove 156 images not used anywhere",
      icon: ImageIcon,
      color: "#FF6B6B",
      action: "Clean Up",
      count: 156,
    },
    {
      id: "orphaned-states",
      title: "Remove Orphaned States",
      description: "Delete 12 states not referenced by any workflow",
      icon: Layers,
      color: "#FFD700",
      action: "Remove",
      count: 12,
    },
    {
      id: "duplicate-states",
      title: "Consolidate Duplicate States",
      description: "Merge 8 potentially duplicate states",
      icon: Copy,
      color: "#00D9FF",
      action: "Consolidate",
      count: 8,
    },
    {
      id: "optimize-complexity",
      title: "Optimize Workflow Complexity",
      description: "Suggest optimizations for 7 complex workflows",
      icon: Target,
      color: "#BD00FF",
      action: "Optimize",
      count: 7,
    },
    {
      id: "fix-references",
      title: "Fix Broken References",
      description: "Repair 8 broken image references",
      icon: Link2,
      color: "#00FF88",
      action: "Fix",
      count: 8,
    },
    {
      id: "compress-images",
      title: "Compress Large Images",
      description: "Reduce size of 34 large images (>1MB)",
      icon: Archive,
      color: "#888888",
      action: "Compress",
      count: 34,
    },
  ];

  const handleToolAction = useCallback((toolId: string) => {
    setIsProcessing(true);
    // Simulate processing
    setTimeout(() => {
      setIsProcessing(false);
    }, 2000);
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {tools.map((tool) => {
        const Icon = tool.icon;
        return (
          <Card
            key={tool.id}
            className="bg-[#1A1A1B]/50 border-gray-800/50 hover:border-gray-700 transition-all"
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3 mb-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: `${tool.color}20` }}
                >
                  <Icon className="w-5 h-5" style={{ color: tool.color }} />
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-semibold mb-1">{tool.title}</h4>
                  <p className="text-xs text-gray-400">{tool.description}</p>
                </div>
              </div>
              <Button
                size="sm"
                className="w-full"
                style={{
                  backgroundColor: `${tool.color}20`,
                  color: tool.color,
                  borderColor: `${tool.color}40`,
                }}
                variant="outline"
                onClick={() => handleToolAction(tool.id)}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-3 h-3 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    {tool.action} ({tool.count})
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function ExportImportPanel() {
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const handleExport = useCallback(() => {
    setIsExporting(true);
    // Simulate export
    setTimeout(() => {
      setIsExporting(false);
      // Trigger download
      const data = {
        version: "1.0.0",
        exportedAt: new Date().toISOString(),
        workflows: [],
        states: [],
        images: [],
        transitions: [],
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `project-backup-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }, 2000);
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Download className="w-5 h-5 text-[#00D9FF]" />
            Export Project
          </CardTitle>
          <CardDescription>Download complete project backup</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between p-2 rounded bg-gray-800/30">
              <span className="text-gray-400">Workflows</span>
              <Badge
                variant="outline"
                className="bg-gray-800/50 border-gray-700"
              >
                142
              </Badge>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-gray-800/30">
              <span className="text-gray-400">States</span>
              <Badge
                variant="outline"
                className="bg-gray-800/50 border-gray-700"
              >
                387
              </Badge>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-gray-800/30">
              <span className="text-gray-400">Images</span>
              <Badge
                variant="outline"
                className="bg-gray-800/50 border-gray-700"
              >
                1,243
              </Badge>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-gray-800/30">
              <span className="text-gray-400">Transitions</span>
              <Badge
                variant="outline"
                className="bg-gray-800/50 border-gray-700"
              >
                524
              </Badge>
            </div>
          </div>
          <Separator />
          <div className="text-xs text-gray-400">
            <p className="mb-2">Export includes:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>All workflow definitions</li>
              <li>State configurations</li>
              <li>Image assets and metadata</li>
              <li>Transition configurations</li>
              <li>Folder organization</li>
            </ul>
          </div>
          <Button
            className="w-full bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Export Project
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Upload className="w-5 h-5 text-[#BD00FF]" />
            Import Project
          </CardTitle>
          <CardDescription>
            Restore from backup or merge projects
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="border-2 border-dashed border-gray-700 rounded-lg p-8 text-center hover:border-gray-600 transition-colors cursor-pointer">
            <Upload className="w-8 h-8 mx-auto mb-3 text-gray-500" />
            <p className="text-sm text-gray-400 mb-1">
              Drop backup file here or click to browse
            </p>
            <p className="text-xs text-gray-500">
              Supports .json and .zip formats
            </p>
          </div>
          <Separator />
          <div className="space-y-2">
            <label className="text-sm font-medium">Import Options</label>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="merge"
                  defaultChecked
                  className="rounded"
                />
                <label htmlFor="merge" className="text-gray-400">
                  Merge with existing data
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="replace" className="rounded" />
                <label htmlFor="replace" className="text-gray-400">
                  Replace existing items
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="backup-before"
                  defaultChecked
                  className="rounded"
                />
                <label htmlFor="backup-before" className="text-gray-400">
                  Create backup before import
                </label>
              </div>
            </div>
          </div>
          <Button
            className="w-full bg-[#BD00FF] hover:bg-[#BD00FF]/80 text-white"
            onClick={() => setIsImporting(true)}
            disabled={isImporting}
          >
            {isImporting ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Import Project
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function ProjectDashboardPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTab, setSelectedTab] = useState("overview");

  const data = useMemo(() => generateMockProjectData(), []);

  const handleExportProject = useCallback(() => {
    console.log("Exporting project...");
  }, []);

  const handleImportProject = useCallback(() => {
    console.log("Importing project...");
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white p-6">
      <div className="max-w-[1600px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-[#00D9FF] via-[#BD00FF] to-[#00FF88] bg-clip-text text-transparent">
              Project Dashboard
            </h1>
            <p className="text-gray-400 text-lg">
              Complete project resource management and health monitoring
            </p>
            <div className="flex items-center gap-4 mt-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-gray-500" />
                <span className="text-sm text-gray-500">
                  Last updated: Just now
                </span>
              </div>
              <Badge
                variant="outline"
                className="bg-green-500/20 text-green-400 border-green-500/30"
              >
                <CheckCircle className="w-3 h-3 mr-1" />
                Auto-sync enabled
              </Badge>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleExportProject}
              variant="outline"
              className="border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF] bg-transparent"
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
            <Button
              onClick={handleImportProject}
              variant="outline"
              className="border-gray-700 hover:border-[#BD00FF] hover:text-[#BD00FF] bg-transparent"
            >
              <Upload className="w-4 h-4 mr-2" />
              Import
            </Button>
            <Button
              onClick={() => router.push("/automation-builder/settings")}
              variant="outline"
              className="border-gray-700 hover:border-[#FFD700] hover:text-[#FFD700] bg-transparent"
            >
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </Button>
          </div>
        </div>

        {/* Key Metrics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <MetricCard
            icon={FileCode}
            label="Total Workflows"
            value={data.metrics.totalWorkflows}
            color="#00D9FF"
            trend={data.metrics.trends.workflows}
          />
          <MetricCard
            icon={Layers}
            label="Total States"
            value={data.metrics.totalStates}
            color="#BD00FF"
            trend={data.metrics.trends.states}
          />
          <MetricCard
            icon={ImageIcon}
            label="Total Images"
            value={data.metrics.totalImages}
            color="#00FF88"
            trend={data.metrics.trends.images}
          />
          <MetricCard
            icon={GitBranch}
            label="Total Transitions"
            value={data.metrics.totalTransitions}
            color="#FFD700"
            trend={data.metrics.trends.transitions}
          />
          <MetricCard
            icon={TestTube}
            label="Test Coverage"
            value={`${data.metrics.testCoverage.toFixed(1)}%`}
            color="#FF6B6B"
          />
          <MetricCard
            icon={BookOpen}
            label="Doc Coverage"
            value={`${data.metrics.docCoverage.toFixed(1)}%`}
            color="#888888"
          />
        </div>

        {/* Global Search */}
        <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
          <CardContent className="p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500" />
              <Input
                type="text"
                placeholder="Search across workflows, states, images, and transitions..."
                className="pl-10 bg-gray-800/50 border-gray-700 focus:border-[#00D9FF] h-12 text-base"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Main Content */}
        <Tabs
          defaultValue="overview"
          className="w-full"
          onValueChange={setSelectedTab}
        >
          <TabsList className="grid w-full grid-cols-6 bg-gray-800/30 p-1">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="resources">Resources</TabsTrigger>
            <TabsTrigger value="health">Health</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="optimization">Optimization</TabsTrigger>
            <TabsTrigger value="export-import">Export/Import</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6 mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column - 2/3 width */}
              <div className="lg:col-span-2 space-y-6">
                {/* Project Activity Timeline */}
                <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Activity className="w-5 h-5 text-[#00D9FF]" />
                      Project Activity Timeline
                    </CardTitle>
                    <CardDescription>
                      Resource changes over the last 30 days
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <AreaChart data={data.timelineData}>
                        <defs>
                          <linearGradient
                            id="colorWorkflows"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#00D9FF"
                              stopOpacity={0.3}
                            />
                            <stop
                              offset="95%"
                              stopColor="#00D9FF"
                              stopOpacity={0}
                            />
                          </linearGradient>
                          <linearGradient
                            id="colorStates"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#BD00FF"
                              stopOpacity={0.3}
                            />
                            <stop
                              offset="95%"
                              stopColor="#BD00FF"
                              stopOpacity={0}
                            />
                          </linearGradient>
                          <linearGradient
                            id="colorImages"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#00FF88"
                              stopOpacity={0.3}
                            />
                            <stop
                              offset="95%"
                              stopColor="#00FF88"
                              stopOpacity={0}
                            />
                          </linearGradient>
                          <linearGradient
                            id="colorTransitions"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#FFD700"
                              stopOpacity={0.3}
                            />
                            <stop
                              offset="95%"
                              stopColor="#FFD700"
                              stopOpacity={0}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                        <XAxis
                          dataKey="date"
                          stroke="#666"
                          style={{ fontSize: "10px" }}
                        />
                        <YAxis stroke="#666" style={{ fontSize: "10px" }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#1A1A1B",
                            border: "1px solid #333",
                            borderRadius: "8px",
                          }}
                        />
                        <Legend />
                        <Area
                          type="monotone"
                          dataKey="workflows"
                          stroke="#00D9FF"
                          fill="url(#colorWorkflows)"
                          strokeWidth={2}
                        />
                        <Area
                          type="monotone"
                          dataKey="states"
                          stroke="#BD00FF"
                          fill="url(#colorStates)"
                          strokeWidth={2}
                        />
                        <Area
                          type="monotone"
                          dataKey="images"
                          stroke="#00FF88"
                          fill="url(#colorImages)"
                          strokeWidth={2}
                        />
                        <Area
                          type="monotone"
                          dataKey="transitions"
                          stroke="#FFD700"
                          fill="url(#colorTransitions)"
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Resource Overview */}
                <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-[#BD00FF]" />
                      Resource Overview
                    </CardTitle>
                    <CardDescription>
                      Detailed statistics by resource type
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResourceOverviewTabs data={data} />
                  </CardContent>
                </Card>

                {/* Most Used Resources */}
                <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-[#00FF88]" />
                      Most Used Resources
                    </CardTitle>
                    <CardDescription>
                      Top 5 resources by usage count
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {data.resourceUsage.map((resource) => {
                        const icons = {
                          workflow: FileCode,
                          state: Layers,
                          image: ImageIcon,
                          transition: GitBranch,
                        };
                        const colors = {
                          workflow: "#00D9FF",
                          state: "#BD00FF",
                          image: "#00FF88",
                          transition: "#FFD700",
                        };
                        const Icon = icons[resource.type];
                        const color = colors[resource.type];

                        return (
                          <div
                            key={resource.id}
                            className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-800/30 transition-colors cursor-pointer"
                          >
                            <div className="flex items-center gap-3 flex-1">
                              <div
                                className="w-8 h-8 rounded-lg flex items-center justify-center"
                                style={{ backgroundColor: `${color}20` }}
                              >
                                <Icon className="w-4 h-4" style={{ color }} />
                              </div>
                              <div>
                                <p
                                  className="font-medium text-sm"
                                  style={{ color }}
                                >
                                  {resource.name}
                                </p>
                                <div className="flex items-center gap-2 mt-1">
                                  <Badge
                                    variant="outline"
                                    className="text-xs bg-gray-800/50 border-gray-700"
                                  >
                                    {resource.type}
                                  </Badge>
                                  {resource.lastUsed && (
                                    <span className="text-xs text-gray-500">
                                      Last used: {resource.lastUsed}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-semibold text-sm">
                                {resource.usageCount.toLocaleString()}
                              </p>
                              <p className="text-xs text-gray-500">uses</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Right Column - 1/3 width */}
              <div className="space-y-6">
                {/* Project Health Score */}
                <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Activity className="w-5 h-5 text-[#00FF88]" />
                      Project Health Score
                    </CardTitle>
                    <CardDescription>
                      Overall project quality metrics
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <HealthScoreGauge
                      score={data.healthScore}
                      factors={data.healthFactors}
                    />
                  </CardContent>
                </Card>

                {/* Storage Analysis */}
                <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <HardDrive className="w-5 h-5 text-[#FFD700]" />
                      Storage Analysis
                    </CardTitle>
                    <CardDescription>
                      Resource storage breakdown
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <StorageAnalysis stats={data.storageStats} />
                  </CardContent>
                </Card>

                {/* Quick Actions */}
                <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="text-lg">Quick Actions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Button
                      className="w-full justify-start bg-[#00D9FF]/10 hover:bg-[#00D9FF]/20 text-[#00D9FF] border border-[#00D9FF]/30"
                      onClick={() => router.push("/automation-builder")}
                    >
                      <FileCode className="w-4 h-4 mr-2" />
                      Browse Workflows
                    </Button>
                    <Button
                      className="w-full justify-start bg-[#BD00FF]/10 hover:bg-[#BD00FF]/20 text-[#BD00FF] border border-[#BD00FF]/30"
                      onClick={() =>
                        router.push("/automation-builder/dependencies")
                      }
                    >
                      <GitBranch className="w-4 h-4 mr-2" />
                      View Dependencies
                    </Button>
                    <Button
                      className="w-full justify-start bg-[#00FF88]/10 hover:bg-[#00FF88]/20 text-[#00FF88] border border-[#00FF88]/30"
                      onClick={() => router.push("/automation-builder/testing")}
                    >
                      <TestTube className="w-4 h-4 mr-2" />
                      Run Tests
                    </Button>
                    <Button
                      className="w-full justify-start bg-[#FFD700]/10 hover:bg-[#FFD700]/20 text-[#FFD700] border border-[#FFD700]/30"
                      onClick={() =>
                        router.push("/automation-builder/analytics")
                      }
                    >
                      <BarChart3 className="w-4 h-4 mr-2" />
                      View Analytics
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* Resources Tab */}
          <TabsContent value="resources" className="space-y-6 mt-6">
            <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle>Resource Statistics</CardTitle>
                <CardDescription>
                  Detailed breakdown of all project resources
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResourceOverviewTabs data={data} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Health Tab */}
          <TabsContent value="health" className="space-y-6 mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle>Health Score</CardTitle>
                </CardHeader>
                <CardContent>
                  <HealthScoreGauge
                    score={data.healthScore}
                    factors={data.healthFactors}
                  />
                </CardContent>
              </Card>

              <div className="lg:col-span-2">
                <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm h-full">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-[#FF6B6B]" />
                      Health Issues
                    </CardTitle>
                    <CardDescription>
                      Issues requiring attention
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[600px] pr-4">
                      <HealthIssuesList issues={data.healthIssues} />
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* Activity Tab */}
          <TabsContent value="activity" className="space-y-6 mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-[#00D9FF]" />
                    Activity Timeline
                  </CardTitle>
                  <CardDescription>
                    Recent project activity (last 7 days)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ActivityTimeline activities={data.activities} />
                </CardContent>
              </Card>

              <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-[#BD00FF]" />
                    Activity Chart
                  </CardTitle>
                  <CardDescription>Activity over time</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={350}>
                    <LineChart data={data.timelineData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                      <XAxis
                        dataKey="date"
                        stroke="#666"
                        style={{ fontSize: "10px" }}
                      />
                      <YAxis stroke="#666" style={{ fontSize: "10px" }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#1A1A1B",
                          border: "1px solid #333",
                          borderRadius: "8px",
                        }}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="workflows"
                        stroke="#00D9FF"
                        strokeWidth={2}
                      />
                      <Line
                        type="monotone"
                        dataKey="states"
                        stroke="#BD00FF"
                        strokeWidth={2}
                      />
                      <Line
                        type="monotone"
                        dataKey="images"
                        stroke="#00FF88"
                        strokeWidth={2}
                      />
                      <Line
                        type="monotone"
                        dataKey="transitions"
                        stroke="#FFD700"
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Optimization Tab */}
          <TabsContent value="optimization" className="space-y-6 mt-6">
            <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-[#FFD700]" />
                  Bulk Optimization Tools
                </CardTitle>
                <CardDescription>
                  Clean up and optimize your project resources
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BulkOptimizationTools />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Export/Import Tab */}
          <TabsContent value="export-import" className="space-y-6 mt-6">
            <ExportImportPanel />

            <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Archive className="w-5 h-5 text-[#888888]" />
                  Recent Backups
                </CardTitle>
                <CardDescription>
                  Automatically saved project backups
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    { date: "2 hours ago", size: "847.5 MB", type: "Auto" },
                    { date: "1 day ago", size: "832.1 MB", type: "Manual" },
                    { date: "3 days ago", size: "798.3 MB", type: "Auto" },
                    { date: "1 week ago", size: "756.7 MB", type: "Manual" },
                  ].map((backup, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 rounded-lg border border-gray-800/50 hover:border-gray-700 transition-all cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-gray-800/50 flex items-center justify-center">
                          <Archive className="w-5 h-5 text-gray-500" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">
                            Backup - {backup.date}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge
                              variant="outline"
                              className="text-xs bg-gray-800/50 border-gray-700"
                            >
                              {backup.type}
                            </Badge>
                            <span className="text-xs text-gray-500">
                              {backup.size}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-gray-700 hover:border-[#00D9FF]"
                        >
                          <Download className="w-3 h-3 mr-1" />
                          Download
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-gray-700 hover:border-[#00FF88]"
                        >
                          <RefreshCw className="w-3 h-3 mr-1" />
                          Restore
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
