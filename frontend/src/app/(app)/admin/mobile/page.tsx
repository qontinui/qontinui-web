"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  UserPlus,
  Users,
  Activity,
  TrendingUp,
  CheckCircle,
  XCircle,
  AlertTriangle,
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
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Loading...</div>
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
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/admin")}
          >
            Admin
          </Button>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-lg font-semibold">Mobile Dashboard</h1>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={isLoading}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
          />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {hasHealthProblems && (
          <>
            <div className="px-6 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border bg-muted/50">
              Health Alerts
            </div>
            <div className="border-b border-border">
              {healthOverview &&
                healthOverview.overall_status !== "healthy" && (
                  <div className="flex items-start gap-3 px-6 py-3 border-b border-border">
                    <XCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
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

              {criticalWarnings.slice(0, 3).map((warning) => (
                <div
                  key={warning.id}
                  className="flex items-start gap-3 px-6 py-3 border-b border-border last:border-b-0"
                >
                  <AlertTriangle
                    className={`h-4 w-4 flex-shrink-0 mt-0.5 ${
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
                <div className="text-xs text-center text-muted-foreground py-2">
                  +{criticalWarnings.length - 3} more warning
                  {criticalWarnings.length - 3 !== 1 ? "s" : ""}
                </div>
              )}
            </div>
          </>
        )}

        {!hasHealthProblems && healthOverview && (
          <div className="flex items-center gap-3 px-6 py-3 border-b border-border">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <div>
              <div
                data-content-role="status"
                data-content-label="all systems healthy"
                className="font-medium text-sm"
              >
                All Systems Healthy
              </div>
              <div
                data-content-role="description"
                data-content-label="health status detail"
                className="text-xs text-muted-foreground"
              >
                No issues detected
              </div>
            </div>
          </div>
        )}

        <div className="px-6 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border bg-muted/50">
          Activity
        </div>
        <div className="grid grid-cols-2 gap-px bg-border">
          <div className="bg-background px-4 py-3">
            <div className="flex items-center gap-1.5 mb-1">
              <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">
                New Today
              </span>
            </div>
            <div
              data-content-role="metric"
              data-content-label="new users today"
              className="text-xl font-semibold tabular-nums"
            >
              {analytics?.new_users_today ?? "–"}
            </div>
          </div>
          <div className="bg-background px-4 py-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">
                New This Week
              </span>
            </div>
            <div
              data-content-role="metric"
              data-content-label="new users this week"
              className="text-xl font-semibold tabular-nums"
            >
              {analytics?.new_users_week ?? "–"}
            </div>
          </div>
          <div className="bg-background px-4 py-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Activity className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">
                Active (24h)
              </span>
            </div>
            <div
              data-content-role="metric"
              data-content-label="daily active users"
              className="text-xl font-semibold tabular-nums"
            >
              {analytics?.dau ?? "–"}
            </div>
          </div>
          <div className="bg-background px-4 py-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Activity className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">
                Sessions
              </span>
            </div>
            <div
              data-content-role="metric"
              data-content-label="sessions today"
              className="text-xl font-semibold tabular-nums"
            >
              {analytics?.total_sessions_today ?? "–"}
            </div>
          </div>
        </div>

        <div className="bg-background px-4 py-3 opacity-50 border-t border-border">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground uppercase tracking-wider">
              Upgrades
            </span>
          </div>
          <div
            data-content-role="metric"
            data-content-label="account upgrades"
            className="text-xl font-semibold tabular-nums"
          >
            –
          </div>
          <span
            data-content-role="label"
            data-content-label="account upgrades label"
            className="text-xs text-muted-foreground"
          >
            Coming Soon
          </span>
        </div>

        <div
          data-content-role="description"
          data-content-label="auto-refresh note"
          className="text-xs text-center text-muted-foreground py-3"
        >
          Auto-refresh every 60 seconds
        </div>
      </div>
    </div>
  );
}
