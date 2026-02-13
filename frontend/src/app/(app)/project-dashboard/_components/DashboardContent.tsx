"use client";

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
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Download,
  Upload,
  Settings,
  Search,
  FileCode,
  GitBranch,
  TestTube,
  Clock,
  Zap,
  Activity,
  BarChart3,
  HardDrive,
  CheckCircle,
  Archive,
  RefreshCw,
} from "lucide-react";
import { useDashboardData } from "../_hooks/useDashboardData";
import { useDashboardFilters } from "../_hooks/useDashboardFilters";
import { MetricsOverview } from "./MetricsOverview";
import { HealthPanel } from "./HealthPanel";
import { ResourceUsagePanel } from "./ResourceUsagePanel";
import { ActivityTimelineChart, ActivityLineChart } from "./ChartsSection";
import { HealthScoreGauge } from "./health-score-gauge";
import { StorageAnalysis } from "./storage-analysis";
import { ResourceOverviewTabs } from "./resource-overview-tabs";
import { ActivityTimeline } from "./activity-timeline";
import { BulkOptimizationTools } from "./bulk-optimization-tools";
import { ExportImportPanel } from "./export-import-panel";

export function DashboardContent() {
  const router = useRouter();
  const { data } = useDashboardData();
  const {
    searchQuery,
    setSearchQuery,
    setSelectedTab,
    handleExportProject,
    handleImportProject,
  } = useDashboardFilters();

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-surface-canvas to-surface-canvas text-white p-6">
      <div className="max-w-[1600px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-brand-primary via-brand-secondary to-brand-success bg-clip-text text-transparent">
              Project Dashboard
            </h1>
            <p className="text-text-muted text-lg">
              Complete project resource management and health monitoring
            </p>
            <div className="flex items-center gap-4 mt-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-text-muted" />
                <span className="text-sm text-text-muted">
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
              className="border-border-default hover:border-brand-primary hover:text-brand-primary bg-transparent"
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
            <Button
              onClick={handleImportProject}
              variant="outline"
              className="border-border-default hover:border-brand-secondary hover:text-brand-secondary bg-transparent"
            >
              <Upload className="w-4 h-4 mr-2" />
              Import
            </Button>
            <Button
              onClick={() => router.push("/automation-builder/settings")}
              variant="outline"
              className="border-border-default hover:border-warning hover:text-warning bg-transparent"
            >
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </Button>
          </div>
        </div>

        {/* Key Metrics Cards */}
        <MetricsOverview data={data} />

        {/* Global Search */}
        <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm">
          <CardContent className="p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-text-muted" />
              <Input
                type="text"
                placeholder="Search across workflows, states, images, and transitions..."
                className="pl-10 bg-surface-hover/50 border-border-default focus:border-brand-primary h-12 text-base"
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
          <TabsList className="grid w-full grid-cols-6 bg-surface-hover/30 p-1">
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
                <ActivityTimelineChart timelineData={data.timelineData} />

                <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-brand-secondary" />
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

                <ResourceUsagePanel data={data} />
              </div>

              {/* Right Column - 1/3 width */}
              <div className="space-y-6">
                <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Activity className="w-5 h-5 text-brand-success" />
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

                <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <HardDrive className="w-5 h-5 text-warning" />
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

                <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="text-lg">Quick Actions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Button
                      className="w-full justify-start bg-brand-primary/10 hover:bg-brand-primary/20 text-brand-primary border border-brand-primary/30"
                      onClick={() => router.push("/automation-builder")}
                    >
                      <FileCode className="w-4 h-4 mr-2" />
                      Browse Workflows
                    </Button>
                    <Button
                      className="w-full justify-start bg-brand-secondary/10 hover:bg-brand-secondary/20 text-brand-secondary border border-brand-secondary/30"
                      onClick={() =>
                        router.push("/automation-builder/dependencies")
                      }
                    >
                      <GitBranch className="w-4 h-4 mr-2" />
                      View Dependencies
                    </Button>
                    <Button
                      className="w-full justify-start bg-brand-success/10 hover:bg-brand-success/20 text-brand-success border border-brand-success/30"
                      onClick={() =>
                        router.push("/automation-builder/testing")
                      }
                    >
                      <TestTube className="w-4 h-4 mr-2" />
                      Run Tests
                    </Button>
                    <Button
                      className="w-full justify-start bg-warning/10 hover:bg-warning/20 text-warning border border-warning/30"
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
            <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm">
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
            <HealthPanel data={data} />
          </TabsContent>

          {/* Activity Tab */}
          <TabsContent value="activity" className="space-y-6 mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-brand-primary" />
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

              <ActivityLineChart timelineData={data.timelineData} />
            </div>
          </TabsContent>

          {/* Optimization Tab */}
          <TabsContent value="optimization" className="space-y-6 mt-6">
            <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-warning" />
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

            <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Archive className="w-5 h-5 text-text-muted" />
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
                    {
                      date: "1 week ago",
                      size: "756.7 MB",
                      type: "Manual",
                    },
                  ].map((backup, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 rounded-lg border border-border-subtle/50 hover:border-border-default transition-all cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-surface-hover/50 flex items-center justify-center">
                          <Archive className="w-5 h-5 text-text-muted" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">
                            Backup - {backup.date}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge
                              variant="outline"
                              className="text-xs bg-surface-hover/50 border-border-default"
                            >
                              {backup.type}
                            </Badge>
                            <span className="text-xs text-text-muted">
                              {backup.size}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-border-default hover:border-brand-primary"
                        >
                          <Download className="w-3 h-3 mr-1" />
                          Download
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-border-default hover:border-brand-success"
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
