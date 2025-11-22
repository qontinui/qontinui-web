"use client";

export const dynamic = 'force-dynamic'

import { useEffect, useState } from "react";
import dynamicImport from "next/dynamic";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { analyticsService } from "@/services/service-factory";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Activity,
  FolderOpen,
  HardDrive,
  Clock,
} from "lucide-react";
import { toast } from "sonner";

// Dynamic imports for analytics components (charts/visualizations)
const MetricCard = dynamicImport(() => import("@/components/analytics/metric-card").then(mod => ({ default: mod.MetricCard })), {
  loading: () => <div className="h-32 bg-gray-800/50 rounded-lg animate-pulse" />
});

const UsageChart = dynamicImport(() => import("@/components/analytics/usage-chart").then(mod => ({ default: mod.UsageChart })), {
  loading: () => <div className="h-64 bg-gray-800/50 rounded-lg animate-pulse" />
});

const StorageBreakdown = dynamicImport(() => import("@/components/analytics/storage-breakdown").then(mod => ({ default: mod.StorageBreakdown })), {
  loading: () => <div className="h-64 bg-gray-800/50 rounded-lg animate-pulse" />
});

const ActivityTimeline = dynamicImport(() => import("@/components/analytics/activity-timeline").then(mod => ({ default: mod.ActivityTimeline })), {
  loading: () => <div className="h-96 bg-gray-800/50 rounded-lg animate-pulse" />
});

export default function AnalyticsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [usageSummary, setUsageSummary] = useState({
    api_calls_today: 0,
    total_projects: 0,
    storage_used: 0,
    last_active: new Date().toISOString(),
  });
  const [metrics, setMetrics] = useState<Array<{ date: string; api_calls: number }>>([]);
  const [storageBreakdown, setStorageBreakdown] = useState({
    avatars: 0,
    images: 0,
    screenshots: 0,
    exports: 0,
  });
  const [activities, setActivities] = useState<
    Array<{
      id: string;
      type: "create" | "update" | "delete" | "export" | "run";
      description: string;
      timestamp: string;
      project_name?: string;
    }>
  >([]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
      return;
    }

    if (user) {
      loadAnalytics();
    }
  }, [user, authLoading, router]);

  const loadAnalytics = async () => {
    try {
      setLoading(true);

      // Load all analytics data in parallel
      const [usageData, metricsData, storageData, activityData] = await Promise.allSettled([
        analyticsService.getUsageSummary(),
        analyticsService.getMetrics(7),
        analyticsService.getStorageBreakdown(),
        analyticsService.getActivityTimeline(10),
      ]);

      // Handle usage summary
      if (usageData.status === "fulfilled") {
        setUsageSummary(usageData.value);
      } else {
        console.warn("Failed to load usage summary:", usageData.reason);
        // Use mock data for development
        setUsageSummary({
          api_calls_today: 142,
          total_projects: 8,
          storage_used: 2048000000, // 2 GB
          last_active: new Date().toISOString(),
        });
      }

      // Handle metrics
      if (metricsData.status === "fulfilled") {
        setMetrics(metricsData.value);
      } else {
        console.warn("Failed to load metrics:", metricsData.reason);
        // Use mock data for development
        const mockMetrics = Array.from({ length: 7 }, (_, i) => ({
          date: new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000).toISOString(),
          api_calls: Math.floor(Math.random() * 200) + 50,
        }));
        setMetrics(mockMetrics);
      }

      // Handle storage breakdown
      if (storageData.status === "fulfilled") {
        setStorageBreakdown(storageData.value);
      } else {
        console.warn("Failed to load storage breakdown:", storageData.reason);
        // Use mock data for development
        setStorageBreakdown({
          avatars: 512000000, // 512 MB
          images: 768000000, // 768 MB
          screenshots: 512000000, // 512 MB
          exports: 256000000, // 256 MB
        });
      }

      // Handle activity timeline
      if (activityData.status === "fulfilled") {
        setActivities(activityData.value);
      } else {
        console.warn("Failed to load activity timeline:", activityData.reason);
        // Use mock data for development
        setActivities([
          {
            id: "1",
            type: "create",
            description: "Created new automation project",
            timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
            project_name: "Login Automation",
          },
          {
            id: "2",
            type: "update",
            description: "Updated state transitions",
            timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
            project_name: "Dashboard Flow",
          },
          {
            id: "3",
            type: "export",
            description: "Exported configuration file",
            timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
            project_name: "Payment Flow",
          },
          {
            id: "4",
            type: "run",
            description: "Executed automation workflow",
            timestamp: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
            project_name: "User Onboarding",
          },
          {
            id: "5",
            type: "update",
            description: "Modified state configuration",
            timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
            project_name: "Search Feature",
          },
        ]);
      }
    } catch (error) {
      console.error("Failed to load analytics:", error);
      toast.error("Failed to load analytics data");
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const getRelativeTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));

    if (diffInHours < 1) return "Just now";
    if (diffInHours < 24) return `${diffInHours}h ago`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays === 1) return "1d ago";
    return `${diffInDays}d ago`;
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white">
      {/* Header */}
      <header className="border-b border-gray-800/50 bg-[#0A0A0B]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/dashboard")}
              className="border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF] bg-transparent"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] bg-clip-text text-transparent">
              Analytics Dashboard
            </h1>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium">{user.full_name || user.username}</p>
            <p className="text-xs text-gray-400">{user.email}</p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6 max-w-7xl mx-auto">
        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading analytics...</div>
        ) : (
          <>
            {/* Metric Cards Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <MetricCard
                title="API Calls Today"
                value={usageSummary.api_calls_today}
                icon={Activity}
                trend="up"
                trendValue="+12%"
                gradientFrom="#00D9FF"
                gradientTo="#0099FF"
              />
              <MetricCard
                title="Total Projects"
                value={usageSummary.total_projects}
                icon={FolderOpen}
                gradientFrom="#BD00FF"
                gradientTo="#8B00CC"
              />
              <MetricCard
                title="Storage Used"
                value={formatBytes(usageSummary.storage_used)}
                icon={HardDrive}
                trend="up"
                trendValue="+5%"
                gradientFrom="#00FF88"
                gradientTo="#00CC6A"
              />
              <MetricCard
                title="Last Active"
                value={getRelativeTime(usageSummary.last_active)}
                icon={Clock}
                gradientFrom="#FFB800"
                gradientTo="#CC9300"
              />
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column - 2/3 width */}
              <div className="lg:col-span-2 space-y-6">
                <UsageChart data={metrics} />
                <StorageBreakdown data={storageBreakdown} />
              </div>

              {/* Right Column - 1/3 width */}
              <div className="lg:col-span-1">
                <ActivityTimeline activities={activities} />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
