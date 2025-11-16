'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Plus,
  Upload,
  Play,
  FileText,
  FolderTree,
  Tags,
  Activity,
  AlertTriangle,
  TrendingUp,
  BarChart3,
  GitBranch,
  TestTube,
  FileCode,
  Settings,
  BookOpen,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Zap,
  Target,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Treemap,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
} from 'recharts';

// ============================================================================
// Mock Data Utilities
// ============================================================================

interface WorkflowMetrics {
  totalWorkflows: number;
  totalActions: number;
  totalTestCases: number;
  testPassRate: number;
  avgComplexity: number;
  recentActivityCount: number;
}

interface FolderData {
  name: string;
  size: number;
  fill: string;
  workflows: number;
}

interface TagData {
  tag: string;
  count: number;
  size: number;
}

interface ActivityItem {
  id: string;
  type: 'created' | 'modified' | 'test_run' | 'imported' | 'exported' | 'folder_change';
  workflowName: string;
  timestamp: Date;
  user?: string;
  status?: 'success' | 'failed';
}

interface HealthRecommendation {
  id: string;
  severity: 'error' | 'warning' | 'info';
  title: string;
  description: string;
  count: number;
  action: string;
  link: string;
}

interface ActiveWorkflow {
  id: string;
  name: string;
  folder: string;
  executionCount: number;
  successRate: number;
}

interface ProblemArea {
  id: string;
  type: 'high_error' | 'circular_dependency' | 'unused' | 'complex';
  title: string;
  workflows: string[];
  severity: 'error' | 'warning';
}

// Generate mock data
// TODO: Replace all mock data with real data from backend API
function generateMockData() {
  // TODO: Fetch real metrics from backend - GET /api/v1/workflows/metrics
  const metrics: WorkflowMetrics = {
    totalWorkflows: 47,
    totalActions: 324,
    totalTestCases: 89,
    testPassRate: 87.6,
    avgComplexity: 6.3,
    recentActivityCount: 23,
  };

  // TODO: Fetch real folder/category data from backend - GET /api/v1/workflows/folders
  const folders: FolderData[] = [
    { name: 'Authentication', size: 12, fill: '#00D9FF', workflows: 12 },
    { name: 'User Management', size: 8, fill: '#BD00FF', workflows: 8 },
    { name: 'Navigation', size: 15, fill: '#00FF88', workflows: 15 },
    { name: 'Forms', size: 7, fill: '#FFD700', workflows: 7 },
    { name: 'Testing', size: 5, fill: '#FF6B6B', workflows: 5 },
  ];

  // TODO: Fetch real tag data from backend - GET /api/v1/workflows/tags
  const tags: TagData[] = [
    { tag: 'login', count: 15, size: 32 },
    { tag: 'form', count: 12, size: 28 },
    { tag: 'navigation', count: 10, size: 24 },
    { tag: 'validation', count: 8, size: 20 },
    { tag: 'api', count: 7, size: 18 },
    { tag: 'ui', count: 6, size: 16 },
    { tag: 'test', count: 5, size: 14 },
    { tag: 'error-handling', count: 4, size: 12 },
  ];

  // TODO: Fetch real activity feed from backend - GET /api/v1/workflows/activities
  // TODO: Replace fixed timestamp with real activity timestamps from backend
  const baseTimestamp = 1700000000000; // Fixed timestamp: Nov 14, 2023 (placeholder)
  const activities: ActivityItem[] = [
    {
      id: '1',
      type: 'modified',
      workflowName: 'User Login Flow',
      timestamp: new Date(baseTimestamp - 1000 * 60 * 5),
      user: 'John Doe',
    },
    {
      id: '2',
      type: 'test_run',
      workflowName: 'Form Validation',
      timestamp: new Date(baseTimestamp - 1000 * 60 * 15),
      status: 'success',
    },
    {
      id: '3',
      type: 'created',
      workflowName: 'Dashboard Navigation',
      timestamp: new Date(baseTimestamp - 1000 * 60 * 30),
      user: 'Jane Smith',
    },
    {
      id: '4',
      type: 'test_run',
      workflowName: 'API Integration',
      timestamp: new Date(baseTimestamp - 1000 * 60 * 45),
      status: 'failed',
    },
    {
      id: '5',
      type: 'modified',
      workflowName: 'Checkout Process',
      timestamp: new Date(baseTimestamp - 1000 * 60 * 60),
      user: 'John Doe',
    },
    {
      id: '6',
      type: 'imported',
      workflowName: 'Payment Gateway',
      timestamp: new Date(baseTimestamp - 1000 * 60 * 90),
      user: 'Admin',
    },
  ];

  // TODO: Calculate real health score from backend - GET /api/v1/workflows/health
  const healthScore = 78;

  // TODO: Fetch real workflow health recommendations from backend - GET /api/v1/workflows/recommendations
  const recommendations: HealthRecommendation[] = [
    {
      id: '1',
      severity: 'warning',
      title: 'Workflows without tests',
      description: '5 workflows have no test cases defined',
      count: 5,
      action: 'Add tests',
      link: '/automation-builder?filter=no-tests',
    },
    {
      id: '2',
      severity: 'info',
      title: 'Inactive workflows',
      description: "3 workflows haven't been executed in 30 days",
      count: 3,
      action: 'Review usage',
      link: '/automation-builder?filter=inactive',
    },
    {
      id: '3',
      severity: 'error',
      title: 'Circular dependencies',
      description: '2 circular dependencies detected',
      count: 2,
      action: 'Fix dependencies',
      link: '/automation-builder?filter=circular',
    },
    {
      id: '4',
      severity: 'warning',
      title: 'Missing documentation',
      description: '10 workflows have no description',
      count: 10,
      action: 'Add documentation',
      link: '/automation-builder?filter=no-docs',
    },
  ];

  // TODO: Fetch real most active workflows from backend - GET /api/v1/workflows/most-active
  const activeWorkflows: ActiveWorkflow[] = [
    { id: '1', name: 'User Login Flow', folder: 'Authentication', executionCount: 1247, successRate: 98.5 },
    { id: '2', name: 'Form Validation', folder: 'Forms', executionCount: 892, successRate: 95.2 },
    { id: '3', name: 'Dashboard Navigation', folder: 'Navigation', executionCount: 743, successRate: 99.1 },
    { id: '4', name: 'API Integration', folder: 'Testing', executionCount: 621, successRate: 87.3 },
    { id: '5', name: 'Checkout Process', folder: 'Forms', executionCount: 534, successRate: 93.7 },
  ];

  // TODO: Fetch real problem areas from backend - GET /api/v1/workflows/problems
  const problemAreas: ProblemArea[] = [
    {
      id: '1',
      type: 'high_error',
      title: 'High Error Rate',
      workflows: ['API Integration', 'Payment Gateway'],
      severity: 'error',
    },
    {
      id: '2',
      type: 'circular_dependency',
      title: 'Circular Dependencies',
      workflows: ['User Profile', 'Settings Manager'],
      severity: 'error',
    },
    {
      id: '3',
      type: 'unused',
      title: 'Unused Workflows',
      workflows: ['Legacy Login', 'Old Checkout', 'Deprecated Form'],
      severity: 'warning',
    },
    {
      id: '4',
      type: 'complex',
      title: 'Very Complex',
      workflows: ['Master Workflow', 'Full Integration Test'],
      severity: 'warning',
    },
  ];

  // TODO: Fetch real workflow creation/modification timeline from backend - GET /api/v1/workflows/timeline
  // TODO: Replace fixed date with real timeline dates from backend
  // Timeline data (last 30 days)
  // Use deterministic values based on index to avoid hydration mismatches
  const baseDate = 1700000000000; // Fixed timestamp: Nov 14, 2023 (placeholder)
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const timelineData = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(baseDate - (29 - i) * 24 * 60 * 60 * 1000);
    // Use UTC methods to avoid timezone differences between server and client
    return {
      date: `${monthNames[date.getUTCMonth()]} ${date.getUTCDate()}`,
      created: (i * 3) % 5, // Deterministic pattern: 0,3,1,4,2,0,3,1,4,2...
      modified: 5 + ((i * 7) % 10), // Deterministic pattern: 5-14
    };
  });

  // TODO: Fetch real workflow complexity distribution from backend - GET /api/v1/workflows/complexity
  // Complexity distribution
  const complexityData = [
    { range: '1-3', count: 15, fill: '#00FF88' },
    { range: '4-6', count: 18, fill: '#00D9FF' },
    { range: '7-9', count: 10, fill: '#FFD700' },
    { range: '10-15', count: 3, fill: '#FF6B6B' },
    { range: '15+', count: 1, fill: '#BD00FF' },
  ];

  // TODO: Fetch real test coverage by folder from backend - GET /api/v1/workflows/test-coverage
  // Test coverage by folder
  const testCoverageData = [
    { name: 'Authentication', coverage: 95, workflows: 12 },
    { name: 'User Management', coverage: 80, workflows: 8 },
    { name: 'Navigation', coverage: 91, workflows: 15 },
    { name: 'Forms', coverage: 77, workflows: 7 },
    { name: 'Testing', coverage: 71, workflows: 5 },
  ];

  return {
    metrics,
    folders,
    tags,
    activities,
    healthScore,
    recommendations,
    activeWorkflows,
    problemAreas,
    timelineData,
    complexityData,
    testCoverageData,
  };
}

// ============================================================================
// Components
// ============================================================================

function MetricCard({ icon: Icon, label, value, color, trend }: any) {
  return (
    <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-12 h-12 rounded-lg flex items-center justify-center`}
              style={{ backgroundColor: `${color}20` }}
            >
              <Icon className="w-6 h-6" style={{ color }} />
            </div>
            <div>
              <p className="text-sm text-gray-400">{label}</p>
              <p className="text-2xl font-bold" style={{ color }}>
                {value}
              </p>
            </div>
          </div>
          {trend && (
            <div className="text-right">
              <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/30">
                <TrendingUp className="w-3 h-3 mr-1" />
                {trend}
              </Badge>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CustomTreemap({ data }: { data: FolderData[] }) {
  const COLORS = ['#00D9FF', '#BD00FF', '#00FF88', '#FFD700', '#FF6B6B'];

  return (
    <ResponsiveContainer width="100%" height={300}>
      <Treemap
        data={data}
        dataKey="size"
        stroke="#1A1A1B"
        fill="#8884d8"
        content={({ x, y, width, height, index, name, workflows }: any) => {
          if (!x || !y || !width || !height) return null;
          return (
            <g>
              <rect
                x={x}
                y={y}
                width={width}
                height={height}
                style={{
                  fill: COLORS[index % COLORS.length],
                  fillOpacity: 0.9,
                  stroke: '#1A1A1B',
                  strokeWidth: 2,
                  cursor: 'pointer',
                }}
              />
              {width > 60 && height > 30 && (
                <>
                  <text
                    x={x + width / 2}
                    y={y + height / 2 - 8}
                    textAnchor="middle"
                    fill="#000"
                    fontSize={14}
                    fontWeight="600"
                  >
                    {name}
                  </text>
                  <text
                    x={x + width / 2}
                    y={y + height / 2 + 12}
                    textAnchor="middle"
                    fill="#000"
                    fontSize={12}
                  >
                    {workflows} workflows
                  </text>
                </>
              )}
            </g>
          );
        }}
      />
    </ResponsiveContainer>
  );
}

function TagCloud({ tags }: { tags: TagData[] }) {
  return (
    <div className="flex flex-wrap gap-2 p-4">
      {tags.map((tag) => (
        <Button
          key={tag.tag}
          variant="outline"
          size="sm"
          className="border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF] bg-transparent"
          style={{ fontSize: `${tag.size}px` }}
        >
          <Tags className="w-3 h-3 mr-2" />
          {tag.tag}
          <Badge variant="outline" className="ml-2 bg-gray-800/50 border-gray-700">
            {tag.count}
          </Badge>
        </Button>
      ))}
    </div>
  );
}

function ActivityFeed({ activities, isMounted }: { activities: ActivityItem[]; isMounted: boolean }) {
  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'created':
        return Plus;
      case 'modified':
        return FileCode;
      case 'test_run':
        return TestTube;
      case 'imported':
        return Upload;
      case 'exported':
        return FileText;
      case 'folder_change':
        return FolderTree;
      default:
        return Activity;
    }
  };

  const getActivityColor = (type: string) => {
    switch (type) {
      case 'created':
        return '#00FF88';
      case 'modified':
        return '#00D9FF';
      case 'test_run':
        return '#BD00FF';
      case 'imported':
        return '#FFD700';
      case 'exported':
        return '#FF6B6B';
      default:
        return '#666';
    }
  };

  const getRelativeTime = (date: Date) => {
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));

    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    const diffInDays = Math.floor(diffInHours / 24);
    return `${diffInDays}d ago`;
  };

  return (
    <div className="space-y-3">
      {activities.map((activity) => {
        const Icon = getActivityIcon(activity.type);
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
              <p className="text-sm font-medium text-gray-200">
                {activity.type === 'created' && 'Created '}
                {activity.type === 'modified' && 'Modified '}
                {activity.type === 'test_run' && 'Test run for '}
                {activity.type === 'imported' && 'Imported '}
                {activity.type === 'exported' && 'Exported '}
                <span className="text-[#00D9FF]">{activity.workflowName}</span>
              </p>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-xs text-gray-500">{isMounted ? getRelativeTime(activity.timestamp) : '...'}</p>
                {activity.user && (
                  <>
                    <span className="text-gray-600">•</span>
                    <p className="text-xs text-gray-500">{activity.user}</p>
                  </>
                )}
                {activity.status && (
                  <>
                    <span className="text-gray-600">•</span>
                    <Badge
                      variant="outline"
                      className={
                        activity.status === 'success'
                          ? 'bg-green-500/20 text-green-400 border-green-500/30 text-xs'
                          : 'bg-red-500/20 text-red-400 border-red-500/30 text-xs'
                      }
                    >
                      {activity.status}
                    </Badge>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HealthScoreGauge({ score }: { score: number }) {
  const getScoreColor = (score: number) => {
    if (score >= 80) return '#00FF88';
    if (score >= 60) return '#FFD700';
    return '#FF6B6B';
  };

  const getScoreLabel = (score: number) => {
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Fair';
    return 'Poor';
  };

  const color = getScoreColor(score);
  const label = getScoreLabel(score);

  return (
    <div className="flex flex-col items-center justify-center p-6">
      <div className="relative w-32 h-32">
        <svg className="w-full h-full transform -rotate-90">
          <circle
            cx="64"
            cy="64"
            r="56"
            stroke="#2A2A2B"
            strokeWidth="8"
            fill="none"
          />
          <circle
            cx="64"
            cy="64"
            r="56"
            stroke={color}
            strokeWidth="8"
            fill="none"
            strokeDasharray={`${(score / 100) * 351.86} 351.86`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-3xl font-bold" style={{ color }}>
            {score}
          </p>
          <p className="text-xs text-gray-400">out of 100</p>
        </div>
      </div>
      <p className="mt-4 text-lg font-semibold" style={{ color }}>
        {label}
      </p>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function AutomationBuilderOverviewPage() {
  const router = useRouter();
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  const data = useMemo(() => generateMockData(), []);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handleQuickAction = (action: string) => {
    switch (action) {
      case 'new-workflow':
        router.push('/automation-builder?action=new');
        break;
      case 'import':
        router.push('/automation-builder?action=import');
        break;
      case 'run-tests':
        router.push('/automation-builder?action=run-tests');
        break;
      case 'docs':
        router.push('/docs/automation-builder');
        break;
      default:
        break;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white p-6" suppressHydrationWarning>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Section */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] bg-clip-text text-transparent">
              Automation Project Overview
            </h1>
            <p className="text-gray-400">Complete project health and metrics dashboard</p>
            <div className="flex items-center gap-2 mt-2">
              <Clock className="w-4 h-4 text-gray-500" />
              <p className="text-sm text-gray-500">Last updated: Just now</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={() => handleQuickAction('new-workflow')}
              className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black font-medium"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create New Workflow
            </Button>
            <Button
              onClick={() => handleQuickAction('import')}
              variant="outline"
              className="border-gray-700 hover:border-[#BD00FF] hover:text-[#BD00FF] bg-transparent"
            >
              <Upload className="w-4 h-4 mr-2" />
              Import Workflows
            </Button>
            <Button
              onClick={() => handleQuickAction('run-tests')}
              variant="outline"
              className="border-gray-700 hover:border-[#00FF88] hover:text-[#00FF88] bg-transparent"
            >
              <Play className="w-4 h-4 mr-2" />
              Run All Tests
            </Button>
            <Button
              onClick={() => handleQuickAction('docs')}
              variant="outline"
              className="border-gray-700 hover:border-[#FFD700] hover:text-[#FFD700] bg-transparent"
            >
              <BookOpen className="w-4 h-4 mr-2" />
              Documentation
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
            trend="+8%"
          />
          <MetricCard
            icon={Zap}
            label="Total Actions"
            value={data.metrics.totalActions}
            color="#BD00FF"
            trend="+12%"
          />
          <MetricCard
            icon={TestTube}
            label="Test Cases"
            value={data.metrics.totalTestCases}
            color="#00FF88"
            trend="+5%"
          />
          <MetricCard
            icon={CheckCircle2}
            label="Pass Rate"
            value={`${data.metrics.testPassRate}%`}
            color="#FFD700"
          />
          <MetricCard
            icon={Target}
            label="Avg Complexity"
            value={data.metrics.avgComplexity.toFixed(1)}
            color="#FF6B6B"
          />
          <MetricCard
            icon={Activity}
            label="Recent Activity"
            value={data.metrics.recentActivityCount}
            color="#00D9FF"
          />
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - 2/3 width */}
          <div className="lg:col-span-2 space-y-6">
            {/* Workflows by Folder */}
            <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FolderTree className="w-5 h-5 text-[#00D9FF]" />
                  Workflows by Folder
                </CardTitle>
                <CardDescription>Click a folder to view its workflows</CardDescription>
              </CardHeader>
              <CardContent>
                <CustomTreemap data={data.folders} />
              </CardContent>
            </Card>

            {/* Charts Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Workflow Creation Timeline */}
              <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-lg">Workflow Activity</CardTitle>
                  <CardDescription>Last 30 days</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={data.timelineData}>
                      <defs>
                        <linearGradient id="colorCreated" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#00FF88" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#00FF88" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorModified" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#00D9FF" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#00D9FF" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                      <XAxis dataKey="date" stroke="#666" style={{ fontSize: '10px' }} />
                      <YAxis stroke="#666" style={{ fontSize: '10px' }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1A1A1B',
                          border: '1px solid #333',
                          borderRadius: '8px',
                          color: '#fff',
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="created"
                        stroke="#00FF88"
                        fill="url(#colorCreated)"
                        strokeWidth={2}
                      />
                      <Area
                        type="monotone"
                        dataKey="modified"
                        stroke="#00D9FF"
                        fill="url(#colorModified)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Complexity Distribution */}
              <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-lg">Complexity Distribution</CardTitle>
                  <CardDescription>Actions per workflow</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={data.complexityData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                      <XAxis dataKey="range" stroke="#666" style={{ fontSize: '10px' }} />
                      <YAxis stroke="#666" style={{ fontSize: '10px' }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1A1A1B',
                          border: '1px solid #333',
                          borderRadius: '8px',
                          color: '#fff',
                        }}
                      />
                      <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                        {data.complexityData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Test Coverage by Folder */}
            <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg">Test Coverage by Folder</CardTitle>
                <CardDescription>Percentage of workflows with tests</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {data.testCoverageData.map((folder) => (
                    <div key={folder.name}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">{folder.name}</span>
                        <span className="text-sm text-gray-400">
                          {folder.coverage}% ({folder.workflows} workflows)
                        </span>
                      </div>
                      <Progress value={folder.coverage} className="h-2" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Most Active Workflows */}
            <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-[#00FF88]" />
                  Most Active Workflows
                </CardTitle>
                <CardDescription>Top 5 most executed workflows</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {data.activeWorkflows.map((workflow) => (
                    <div
                      key={workflow.id}
                      className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-800/30 transition-colors cursor-pointer"
                    >
                      <div className="flex-1">
                        <p className="font-medium text-[#00D9FF]">{workflow.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-xs bg-gray-800/50 border-gray-700">
                            {workflow.folder}
                          </Badge>
                          <span className="text-xs text-gray-500">
                            {workflow.executionCount.toLocaleString('en-US')} executions
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p
                          className="text-sm font-semibold"
                          style={{
                            color: workflow.successRate >= 95 ? '#00FF88' : workflow.successRate >= 85 ? '#FFD700' : '#FF6B6B',
                          }}
                        >
                          {workflow.successRate}%
                        </p>
                        <p className="text-xs text-gray-500">success rate</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Column - 1/3 width */}
          <div className="space-y-6">
            {/* Health Score */}
            <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-[#00FF88]" />
                  Project Health Score
                </CardTitle>
              </CardHeader>
              <CardContent>
                <HealthScoreGauge score={data.healthScore} />
                <div className="mt-6 space-y-3">
                  {data.recommendations.map((rec) => {
                    const Icon =
                      rec.severity === 'error' ? XCircle : rec.severity === 'warning' ? AlertTriangle : AlertCircle;
                    const color =
                      rec.severity === 'error' ? '#FF6B6B' : rec.severity === 'warning' ? '#FFD700' : '#00D9FF';

                    return (
                      <div
                        key={rec.id}
                        className="p-3 rounded-lg border border-gray-800/50 hover:border-gray-700 transition-colors cursor-pointer"
                        style={{ backgroundColor: `${color}10` }}
                      >
                        <div className="flex items-start gap-2">
                          <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{rec.title}</p>
                            <p className="text-xs text-gray-400 mt-1">{rec.description}</p>
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0 mt-2 text-xs"
                              style={{ color }}
                              onClick={() => router.push(rec.link)}
                            >
                              {rec.action} →
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Recent Activity Feed */}
            <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-[#BD00FF]" />
                  Recent Activity
                </CardTitle>
                <CardDescription>Last 24 hours</CardDescription>
              </CardHeader>
              <CardContent>
                <ActivityFeed activities={data.activities} isMounted={isMounted} />
              </CardContent>
            </Card>

            {/* Problem Areas */}
            <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-[#FF6B6B]" />
                  Problem Areas
                </CardTitle>
                <CardDescription>Issues requiring attention</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {data.problemAreas.map((problem) => {
                    const Icon = problem.severity === 'error' ? XCircle : AlertTriangle;
                    const color = problem.severity === 'error' ? '#FF6B6B' : '#FFD700';

                    return (
                      <div
                        key={problem.id}
                        className="p-3 rounded-lg border border-gray-800/50 hover:border-gray-700 transition-colors cursor-pointer"
                      >
                        <div className="flex items-start gap-2 mb-2">
                          <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color }} />
                          <div className="flex-1">
                            <p className="text-sm font-medium">{problem.title}</p>
                            <p className="text-xs text-gray-400 mt-1">
                              {problem.workflows.length} workflow{problem.workflows.length > 1 ? 's' : ''}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            style={{
                              backgroundColor: `${color}20`,
                              borderColor: `${color}30`,
                              color,
                            }}
                          >
                            {problem.workflows.length}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {problem.workflows.slice(0, 3).map((workflow) => (
                            <Badge key={workflow} variant="outline" className="text-xs bg-gray-800/50 border-gray-700">
                              {workflow}
                            </Badge>
                          ))}
                          {problem.workflows.length > 3 && (
                            <Badge variant="outline" className="text-xs bg-gray-800/50 border-gray-700">
                              +{problem.workflows.length - 3} more
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Tags Cloud */}
        <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tags className="w-5 h-5 text-[#BD00FF]" />
              Workflow Tags
            </CardTitle>
            <CardDescription>Click a tag to filter workflows</CardDescription>
          </CardHeader>
          <CardContent>
            <TagCloud tags={data.tags} />
          </CardContent>
        </Card>

        {/* Quick Links Section */}
        <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Quick Links</CardTitle>
            <CardDescription>Navigate to key sections</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {[
                { label: 'Workflow Browser', icon: FileCode, link: '/automation-builder', color: '#00D9FF' },
                { label: 'Dependency Graph', icon: GitBranch, link: '/automation-builder/dependencies', color: '#BD00FF' },
                { label: 'Testing Dashboard', icon: TestTube, link: '/automation-builder/testing', color: '#00FF88' },
                { label: 'Analytics', icon: BarChart3, link: '/analytics', color: '#FFD700' },
                { label: 'Documentation', icon: BookOpen, link: '/docs', color: '#FF6B6B' },
                { label: 'Settings', icon: Settings, link: '/automation-builder/settings', color: '#00D9FF' },
              ].map((link) => (
                <Button
                  key={link.label}
                  variant="outline"
                  className="h-auto flex-col gap-2 p-4 border-gray-700 hover:border-gray-600 bg-transparent"
                  onClick={() => router.push(link.link)}
                >
                  <link.icon className="w-6 h-6" style={{ color: link.color }} />
                  <span className="text-xs text-center">{link.label}</span>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
