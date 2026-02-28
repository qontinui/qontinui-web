"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  Download,
  CheckCircle,
  AlertCircle,
  Activity,
  Database,
  Server,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { healthService } from "@/services/admin/health-service";

const REFRESH_INTERVAL = 30000;

export default function HealthSection() {
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);

  const {
    data: overview,
    isLoading: overviewLoading,
    refetch: refetchOverview,
  } = useQuery({
    queryKey: ["admin", "health", "overview"],
    queryFn: () => healthService.getHealthOverview(),
    refetchInterval: autoRefresh ? REFRESH_INTERVAL : false,
  });

  const {
    data: redis,
    isLoading: redisLoading,
    refetch: refetchRedis,
  } = useQuery({
    queryKey: ["admin", "health", "redis"],
    queryFn: () => healthService.getRedisStatus(),
    refetchInterval: autoRefresh ? REFRESH_INTERVAL : false,
  });

  const {
    data: warnings,
    isLoading: warningsLoading,
    refetch: refetchWarnings,
  } = useQuery({
    queryKey: ["admin", "health", "security-warnings"],
    queryFn: () => healthService.getSecurityWarnings(),
    refetchInterval: autoRefresh ? REFRESH_INTERVAL : false,
  });

  const {
    data: sessions,
    isLoading: sessionsLoading,
    refetch: refetchSessions,
  } = useQuery({
    queryKey: ["admin", "health", "sessions"],
    queryFn: () => healthService.getSessionStats(),
    refetchInterval: autoRefresh ? REFRESH_INTERVAL : false,
  });

  const {
    data: metrics,
    isLoading: metricsLoading,
    refetch: refetchMetrics,
  } = useQuery({
    queryKey: ["admin", "health", "system-metrics"],
    queryFn: () => healthService.getSystemMetrics(),
    refetchInterval: autoRefresh ? REFRESH_INTERVAL : false,
  });

  const isLoading =
    overviewLoading ||
    redisLoading ||
    warningsLoading ||
    sessionsLoading ||
    metricsLoading;

  useEffect(() => {
    if (!isLoading) setLastUpdated(new Date());
  }, [isLoading, overview, redis, warnings, sessions, metrics]);

  const handleRefresh = () => {
    toast.promise(
      Promise.all([
        refetchOverview(),
        refetchRedis(),
        refetchWarnings(),
        refetchSessions(),
        refetchMetrics(),
      ]),
      {
        loading: "Refreshing...",
        success: "Health data refreshed",
        error: "Failed to refresh",
      }
    );
  };

  const handleExportJSON = async () => {
    try {
      const data = await healthService.exportHealthReport();
      healthService.downloadHealthReportJSON(data);
      toast.success("Exported as JSON");
    } catch {
      toast.error("Export failed");
    }
  };

  const handleExportCSV = async () => {
    try {
      const data = await healthService.exportHealthReport();
      healthService.downloadHealthReportCSV(data);
      toast.success("Exported as CSV");
    } catch {
      toast.error("Export failed");
    }
  };

  const statusBadge = (
    status: "healthy" | "degraded" | "down" | "disabled"
  ) => {
    const map = {
      healthy: { cls: "bg-green-500/10 text-green-500", Icon: CheckCircle },
      degraded: {
        cls: "bg-yellow-500/10 text-yellow-500",
        Icon: AlertCircle,
      },
      down: { cls: "bg-red-500/10 text-red-500", Icon: AlertCircle },
      disabled: { cls: "bg-muted text-muted-foreground", Icon: AlertCircle },
    };
    const { cls, Icon } = map[status];
    return (
      <Badge className={`${cls} text-xs`}>
        <Icon className="h-3 w-3 mr-1" />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const formatUptime = (hours: number) => {
    if (hours < 24) return `${Math.round(hours)}h`;
    const days = Math.floor(hours / 24);
    return `${days}d ${Math.round(hours % 24)}h`;
  };

  return (
    <div className="flex flex-col">
      {/* Actions bar */}
      <div className="flex items-center justify-between px-6 py-2 border-b border-border bg-muted/50">
        <span className="text-xs text-muted-foreground">
          Updated: {lastUpdated.toLocaleTimeString()}
          {autoRefresh &&
            ` \u00b7 Auto-refresh every ${REFRESH_INTERVAL / 1000}s`}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className={`h-7 text-xs ${autoRefresh ? "text-green-500" : ""}`}
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {autoRefresh ? "Auto On" : "Auto Off"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={handleRefresh}
            disabled={isLoading}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
            />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={handleExportJSON}
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            JSON
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={handleExportCSV}
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            CSV
          </Button>
        </div>
      </div>

      {/* Overview status strip */}
      <SectionLabel label="Service Overview" />
      {overview ? (
        <div className="grid grid-cols-4 gap-px bg-border">
          <StatusCell
            icon={<Server className="h-3.5 w-3.5" />}
            label="API"
            badge={statusBadge(overview.api_status)}
            sub={`Uptime: ${formatUptime(overview.uptime_hours)}`}
          />
          <StatusCell
            icon={<Database className="h-3.5 w-3.5" />}
            label="Database"
            badge={statusBadge(overview.database_status)}
          />
          <StatusCell
            icon={<Database className="h-3.5 w-3.5" />}
            label="Redis"
            badge={statusBadge(overview.redis_status)}
          />
          <StatusCell
            icon={<Activity className="h-3.5 w-3.5" />}
            label="Overall"
            badge={statusBadge(overview.overall_status)}
            sub={`${overview.active_sessions} sessions \u00b7 ${overview.critical_alerts} alerts`}
          />
        </div>
      ) : (
        <LoadingRow />
      )}

      {/* Redis Details */}
      <SectionLabel label="Redis" />
      {redis ? (
        <div className="grid grid-cols-4 gap-px bg-border">
          <Cell
            label="Mode"
            value={redis.mode}
            sub={redis.connected ? "Connected" : "Disconnected"}
          />
          <Cell
            label="Memory"
            value={`${(redis.memory_percent ?? 0).toFixed(1)}%`}
            sub={`${(redis.memory_usage_mb ?? 0).toFixed(0)} / ${(redis.memory_limit_mb ?? 0).toFixed(0)} MB`}
            bar={redis.memory_percent ?? 0}
          />
          <Cell
            label="Keys"
            value={redis.total_keys ?? 0}
            sub={`Hit rate: ${(redis.hit_rate ?? 0).toFixed(1)}%`}
          />
          <Cell
            label="Clients"
            value={redis.connected_clients ?? 0}
            sub={`Uptime: ${formatUptime((redis.uptime_seconds ?? 0) / 3600)}`}
          />
        </div>
      ) : (
        <LoadingRow />
      )}

      {/* System Resources */}
      <SectionLabel label="System Resources" />
      {metrics ? (
        <>
          <div className="grid grid-cols-3 gap-px bg-border">
            <Cell
              label="CPU"
              value={`${(metrics.cpu_usage ?? 0).toFixed(1)}%`}
              bar={metrics.cpu_usage ?? 0}
            />
            <Cell
              label="Memory"
              value={`${(metrics.memory?.usage_percent ?? 0).toFixed(1)}%`}
              sub={`${(metrics.memory?.used_mb ?? 0).toFixed(0)} / ${(metrics.memory?.total_mb ?? 0).toFixed(0)} MB`}
              bar={metrics.memory?.usage_percent ?? 0}
            />
            <Cell
              label="Storage"
              value={`${(metrics.storage?.usage_percent ?? 0).toFixed(1)}%`}
              sub={`${(metrics.storage?.used_gb ?? 0).toFixed(1)} / ${(metrics.storage?.total_gb ?? 0).toFixed(1)} GB`}
              bar={metrics.storage?.usage_percent ?? 0}
            />
          </div>
          <div className="bg-background px-6 py-3 border-b border-border">
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-xs text-muted-foreground">DB Active</span>
                <div className="font-semibold tabular-nums">
                  {metrics.database_connections?.active ?? 0}
                </div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">DB Idle</span>
                <div className="font-semibold tabular-nums">
                  {metrics.database_connections?.idle ?? 0}
                </div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">DB Max</span>
                <div className="font-semibold tabular-nums">
                  {metrics.database_connections?.max ?? 0}
                </div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Backup</span>
                <div className="text-sm flex items-center gap-1">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  {metrics.last_backup
                    ? new Date(metrics.last_backup).toLocaleDateString()
                    : "None"}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <LoadingRow />
      )}

      {/* Sessions */}
      <SectionLabel label="Sessions" />
      {sessions ? (
        <div className="grid grid-cols-4 gap-px bg-border">
          <Cell
            label="Active"
            value={sessions.total_active_sessions}
            sub={`${sessions.active_users_now} users online`}
          />
          <Cell
            label="Standard"
            value={sessions.standard_sessions ?? 0}
            sub={`${(100 - (sessions.remember_me_percentage ?? 0)).toFixed(0)}%`}
          />
          <Cell
            label="Remember Me"
            value={sessions.remember_me_sessions ?? 0}
            sub={`${(sessions.remember_me_percentage ?? 0).toFixed(0)}%`}
          />
          <Cell
            label="Today"
            value={sessions.sessions_today ?? 0}
            sub={`Avg ${(sessions.average_session_duration_minutes ?? 0).toFixed(0)}m`}
          />
        </div>
      ) : (
        <LoadingRow />
      )}

      {/* Security Warnings */}
      <SectionLabel
        label={`Security Warnings${warnings ? ` (${warnings.length})` : ""}`}
      />
      {warnings && warnings.length > 0 ? (
        <table className="w-full text-sm">
          <thead className="bg-muted/80">
            <tr className="text-left text-xs text-muted-foreground uppercase tracking-wider">
              <th className="px-6 py-2 font-medium">Time</th>
              <th className="px-3 py-2 font-medium">Severity</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Message</th>
              <th className="px-3 py-2 font-medium">User</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {warnings.slice(0, 20).map((w) => (
              <tr key={w.id} className="hover:bg-muted/30">
                <td className="px-6 py-2 text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(w.timestamp).toLocaleString()}
                </td>
                <td className="px-3 py-2">
                  <SeverityBadge severity={w.severity} />
                </td>
                <td className="px-3 py-2 text-xs">
                  {w.type.replace(/_/g, " ")}
                </td>
                <td className="px-3 py-2 text-sm">{w.message}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {w.user_email || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="px-6 py-4 text-sm text-muted-foreground">
          {warnings ? "No security warnings." : "Loading..."}
        </div>
      )}

      {/* Critical alert banner */}
      {overview && overview.critical_alerts > 0 && (
        <div className="mx-6 my-3 p-3 rounded-md bg-red-500 text-white text-sm">
          <span className="font-medium">
            {overview.critical_alerts} critical{" "}
            {overview.critical_alerts === 1 ? "alert" : "alerts"}
          </span>{" "}
          require immediate attention
        </div>
      )}
    </div>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="px-6 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border bg-muted/50">
      {label}
    </div>
  );
}

function LoadingRow() {
  return (
    <div className="px-6 py-4 text-sm text-muted-foreground">Loading...</div>
  );
}

function StatusCell({
  icon,
  label,
  badge,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  badge: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="bg-background px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-xs text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className="mb-0.5">{badge}</div>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

function Cell({
  label,
  value,
  sub,
  bar,
}: {
  label: string;
  value: string | number;
  sub?: string;
  bar?: number;
}) {
  const barColor = (pct: number) =>
    pct > 80 ? "bg-red-500" : pct > 60 ? "bg-yellow-500" : "bg-green-500";

  return (
    <div className="bg-background px-4 py-3">
      <span className="text-xs text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      {bar !== undefined && (
        <div className="w-full bg-muted rounded-full h-1.5 mt-1.5">
          <div
            className={`h-1.5 rounded-full ${barColor(bar)}`}
            style={{ width: `${Math.min(bar, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function SeverityBadge({
  severity,
}: {
  severity: "low" | "medium" | "high" | "critical";
}) {
  const map = {
    low: "text-blue-500 border-blue-500/30",
    medium: "text-yellow-500 border-yellow-500/30",
    high: "text-orange-500 border-orange-500/30",
    critical: "text-red-500 border-red-500/30",
  };
  return (
    <Badge variant="outline" className={`text-xs ${map[severity]}`}>
      {severity}
    </Badge>
  );
}
