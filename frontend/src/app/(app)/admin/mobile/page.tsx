"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  RefreshCw,
  UserPlus,
  Users,
  Activity,
  TrendingUp,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { healthService } from "@/services/admin/health-service";

interface AnalyticsData {
  dau: number;
  new_users_today: number;
  new_users_week: number;
  total_sessions_today: number;
}

export default function MobileAdminDashboard() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  // Fetch health overview
  const {
    data: healthOverview,
    isLoading: healthLoading,
    refetch: refetchHealth,
  } = useQuery({
    queryKey: ["admin", "health", "overview"],
    queryFn: () => healthService.getHealthOverview(),
    refetchInterval: 60000, // Refresh every minute
  });

  // Fetch security warnings
  const {
    data: securityWarnings,
    isLoading: warningsLoading,
    refetch: refetchWarnings,
  } = useQuery({
    queryKey: ["admin", "health", "security-warnings"],
    queryFn: () => healthService.getSecurityWarnings(10),
    refetchInterval: 60000,
  });

  // Fetch analytics for activity data
  const {
    data: analytics,
    isLoading: analyticsLoading,
    refetch: refetchAnalytics,
  } = useQuery({
    queryKey: ["admin", "mobile", "analytics"],
    queryFn: async () => {
      // Use relative URL through Next.js proxy with credentials for cookie auth
      const response = await fetch("/api/v1/admin/analytics", {
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to load analytics");
      }

      return response.json() as Promise<AnalyticsData>;
    },
    refetchInterval: 60000,
  });

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
      return;
    }

    if (!authLoading && user && !user.is_superuser) {
      toast.error("Access denied - Admin privileges required");
      router.push("/build/workflows");
      return;
    }
  }, [user, authLoading, router]);

  const handleRefresh = async () => {
    const promises = [refetchHealth(), refetchWarnings(), refetchAnalytics()];

    toast.promise(Promise.all(promises), {
      loading: "Refreshing...",
      success: "Data refreshed",
      error: "Failed to refresh some data",
    });
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-text-muted">Loading...</div>
      </div>
    );
  }

  if (!user?.is_superuser) {
    return null;
  }

  const isLoading = healthLoading || warningsLoading || analyticsLoading;

  // Determine if there are health problems
  const hasHealthProblems =
    (healthOverview?.critical_alerts && healthOverview.critical_alerts > 0) ||
    healthOverview?.overall_status === "degraded" ||
    healthOverview?.overall_status === "down" ||
    securityWarnings?.some(
      (w) => w.severity === "high" || w.severity === "critical"
    );

  const criticalWarnings =
    securityWarnings?.filter(
      (w) => w.severity === "critical" || w.severity === "high"
    ) || [];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/admin")}
              className="p-2"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-bold">Admin Mobile</h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isLoading}
            className="flex items-center gap-2"
          >
            <RefreshCw
              className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </div>

      <div className="p-4 space-y-4 pb-safe">
        {/* Health Status - Only show if there are problems */}
        {hasHealthProblems && (
          <Card className="border-red-500/50 bg-red-500/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-red-600 dark:text-red-400">
                <AlertCircle className="h-5 w-5" />
                Health Alerts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* System Status */}
              {healthOverview &&
                healthOverview.overall_status !== "healthy" && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-background">
                    <XCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div
                        data-content-role="status"
                        data-content-label="system health status"
                        className="font-medium text-sm"
                      >
                        System Status:{" "}
                        {healthOverview.overall_status.toUpperCase()}
                      </div>
                      {healthOverview.critical_alerts > 0 && (
                        <div
                          data-content-role="metric"
                          data-content-label="critical alerts count"
                          className="text-xs text-muted-foreground mt-1"
                        >
                          {healthOverview.critical_alerts} critical alert
                          {healthOverview.critical_alerts !== 1 ? "s" : ""}
                        </div>
                      )}
                    </div>
                  </div>
                )}

              {/* Critical Security Warnings */}
              {criticalWarnings.slice(0, 3).map((warning) => (
                <div
                  key={warning.id}
                  className="flex items-start gap-3 p-3 rounded-lg bg-background"
                >
                  <AlertTriangle
                    className={`h-5 w-5 flex-shrink-0 mt-0.5 ${
                      warning.severity === "critical"
                        ? "text-red-500"
                        : "text-orange-500"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div
                      data-content-role="body-text"
                      data-content-label="warning message"
                      className="font-medium text-sm"
                    >
                      {warning.message}
                    </div>
                    <div
                      data-content-role="label"
                      data-content-label="warning severity and time"
                      className="text-xs text-muted-foreground mt-1 capitalize"
                    >
                      {warning.severity} •{" "}
                      {new Date(warning.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}

              {criticalWarnings.length > 3 && (
                <div className="text-xs text-center text-muted-foreground pt-2">
                  +{criticalWarnings.length - 3} more warning
                  {criticalWarnings.length - 3 !== 1 ? "s" : ""}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* All Clear */}
        {!hasHealthProblems && healthOverview && (
          <Card className="border-green-500/50 bg-green-500/5">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
                <div>
                  <div
                    data-content-role="status"
                    data-content-label="all systems healthy"
                    className="font-medium"
                  >
                    All Systems Healthy
                  </div>
                  <div
                    data-content-role="description"
                    data-content-label="health status detail"
                    className="text-sm text-muted-foreground"
                  >
                    No issues detected
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Activity Section */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold px-1">Activity</h2>

          {/* New Users Today */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-500/10">
                    <UserPlus className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <div
                      data-content-role="metric"
                      data-content-label="new users today"
                      className="text-2xl font-bold"
                    >
                      {analytics?.new_users_today ?? "–"}
                    </div>
                    <div
                      data-content-role="label"
                      data-content-label="new users today label"
                      className="text-sm text-muted-foreground"
                    >
                      New Users Today
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* New Users This Week */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-500/10">
                    <Users className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <div
                      data-content-role="metric"
                      data-content-label="new users this week"
                      className="text-2xl font-bold"
                    >
                      {analytics?.new_users_week ?? "–"}
                    </div>
                    <div
                      data-content-role="label"
                      data-content-label="new users this week label"
                      className="text-sm text-muted-foreground"
                    >
                      New Users This Week
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Daily Active Users */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-500/10">
                    <Activity className="h-5 w-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <div
                      data-content-role="metric"
                      data-content-label="daily active users"
                      className="text-2xl font-bold"
                    >
                      {analytics?.dau ?? "–"}
                    </div>
                    <div
                      data-content-role="label"
                      data-content-label="active users label"
                      className="text-sm text-muted-foreground"
                    >
                      Active Users (24h)
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Sessions Today */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-orange-500/10">
                    <Activity className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div>
                    <div
                      data-content-role="metric"
                      data-content-label="sessions today"
                      className="text-2xl font-bold"
                    >
                      {analytics?.total_sessions_today ?? "–"}
                    </div>
                    <div
                      data-content-role="label"
                      data-content-label="sessions today label"
                      className="text-sm text-muted-foreground"
                    >
                      Sessions Today
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Account Upgrades - Placeholder */}
          <Card className="opacity-50">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-yellow-500/10">
                    <TrendingUp className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                  </div>
                  <div>
                    <div
                      data-content-role="metric"
                      data-content-label="account upgrades"
                      className="text-2xl font-bold"
                    >
                      –
                    </div>
                    <div
                      data-content-role="label"
                      data-content-label="account upgrades label"
                      className="text-sm text-muted-foreground"
                    >
                      Account Upgrades (Coming Soon)
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Last Updated */}
        <div
          data-content-role="description"
          data-content-label="auto-refresh note"
          className="text-xs text-center text-muted-foreground pt-2"
        >
          Auto-refresh every 60 seconds
        </div>
      </div>
    </div>
  );
}
