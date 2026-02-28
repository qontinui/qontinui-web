"use client";

import React, { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Server,
  Database,
  Cpu,
  Activity,
  HardDrive,
  Clock,
  AlertCircle,
  CheckCircle,
} from "lucide-react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";

interface SystemHealth {
  api_status: "healthy" | "degraded" | "down";
  database_status: "healthy" | "degraded" | "down";
  database_connections: {
    active: number;
    idle: number;
    max: number;
  };
  storage: {
    total_gb: number;
    used_gb: number;
    available_gb: number;
    usage_percent: number;
  };
  memory: {
    total_mb: number;
    used_mb: number;
    available_mb: number;
    usage_percent: number;
  };
  cpu_usage: number;
  uptime_hours: number;
  last_backup: string | null;
  recent_errors: Array<{
    timestamp: string;
    message: string;
    level: string;
  }>;
}

export default function SystemSection() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSystemHealth();
    const interval = setInterval(loadSystemHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadSystemHealth = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const response = await httpClient.fetch(
        `${apiUrl}/api/v1/admin/system/health`
      );
      if (response.ok) {
        setHealth(await response.json());
      } else {
        toast.error("Failed to load system health");
      }
    } catch {
      toast.error("Failed to load system health");
    } finally {
      setLoading(false);
    }
  };

  const formatUptime = (hours: number) => {
    if (hours < 24) return `${Math.round(hours)}h`;
    const days = Math.floor(hours / 24);
    const rem = Math.round(hours % 24);
    return `${days}d ${rem}h`;
  };

  const statusBadge = (status: "healthy" | "degraded" | "down") => {
    const map = {
      healthy: { cls: "bg-green-500/10 text-green-500", Icon: CheckCircle },
      degraded: { cls: "bg-yellow-500/10 text-yellow-500", Icon: AlertCircle },
      down: { cls: "bg-red-500/10 text-red-500", Icon: AlertCircle },
    };
    const { cls, Icon } = map[status];
    return (
      <Badge className={cls}>
        <Icon className="h-3 w-3 mr-1" />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        Loading system health...
      </div>
    );
  }

  if (!health) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Server className="h-8 w-8 mb-2" />
        <span className="text-sm">
          System monitoring will appear once health endpoints are configured.
        </span>
      </div>
    );
  }

  const connPct =
    (health.database_connections.active / health.database_connections.max) *
    100;

  return (
    <div className="flex flex-col">
      {/* Service Status */}
      <SectionLabel label="Service Status" />
      <div className="grid grid-cols-2 gap-px bg-border">
        <div className="bg-background px-4 py-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Server className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground uppercase tracking-wider">
              API
            </span>
          </div>
          <div className="flex items-center gap-2">
            {statusBadge(health.api_status)}
          </div>
          <span className="text-xs text-muted-foreground">
            Uptime: {formatUptime(health.uptime_hours)}
          </span>
        </div>
        <div className="bg-background px-4 py-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Database className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground uppercase tracking-wider">
              Database
            </span>
          </div>
          <div className="flex items-center gap-2">
            {statusBadge(health.database_status)}
          </div>
          <span className="text-xs text-muted-foreground">
            {health.database_connections.active} active /{" "}
            {health.database_connections.max} max
          </span>
        </div>
      </div>

      {/* Resource Usage */}
      <SectionLabel label="Resource Usage" />
      <div className="grid grid-cols-3 gap-px bg-border">
        <ResourceCell
          icon={<Cpu className="h-3.5 w-3.5" />}
          label="CPU"
          pct={health.cpu_usage}
          detail=""
        />
        <ResourceCell
          icon={<Activity className="h-3.5 w-3.5" />}
          label="Memory"
          pct={health.memory.usage_percent}
          detail={`${health.memory.used_mb.toFixed(0)} / ${health.memory.total_mb.toFixed(0)} MB`}
        />
        <ResourceCell
          icon={<HardDrive className="h-3.5 w-3.5" />}
          label="Storage"
          pct={health.storage.usage_percent}
          detail={`${health.storage.used_gb.toFixed(1)} / ${health.storage.total_gb.toFixed(1)} GB`}
        />
      </div>

      {/* Database Connections */}
      <SectionLabel label="Database Connections" />
      <div className="bg-background px-6 py-3">
        <div className="grid grid-cols-3 gap-4 mb-2">
          <div>
            <span className="text-xs text-muted-foreground">Active</span>
            <div className="text-lg font-semibold tabular-nums">
              {health.database_connections.active}
            </div>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Idle</span>
            <div className="text-lg font-semibold tabular-nums">
              {health.database_connections.idle}
            </div>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Max</span>
            <div className="text-lg font-semibold tabular-nums">
              {health.database_connections.max}
            </div>
          </div>
        </div>
        <div className="w-full bg-muted rounded-full h-1.5">
          <div
            className={`h-1.5 rounded-full ${barColor(connPct)}`}
            style={{ width: `${connPct}%` }}
          />
        </div>
      </div>

      {/* Backup Status */}
      <SectionLabel label="Backup Status" />
      <div className="bg-background px-6 py-3 flex items-center gap-2 text-sm">
        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
        {health.last_backup ? (
          <span>
            Last backup: {new Date(health.last_backup).toLocaleString()}
          </span>
        ) : (
          <span className="text-muted-foreground">No backup recorded</span>
        )}
      </div>

      {/* Recent Errors */}
      {health.recent_errors && health.recent_errors.length > 0 && (
        <>
          <SectionLabel
            label={`Recent Errors (${health.recent_errors.length})`}
          />
          <table className="w-full text-sm">
            <thead className="bg-muted/80">
              <tr className="text-left text-xs text-muted-foreground uppercase tracking-wider">
                <th className="px-6 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Level</th>
                <th className="px-3 py-2 font-medium">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {health.recent_errors.map((err, i) => (
                <tr key={i} className="hover:bg-muted/30">
                  <td className="px-6 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(err.timestamp).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant="outline"
                      className={
                        err.level === "error"
                          ? "text-red-500 border-red-500/30"
                          : "text-yellow-500 border-yellow-500/30"
                      }
                    >
                      {err.level}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">{err.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

const barColor = (pct: number) =>
  pct > 80 ? "bg-red-500" : pct > 60 ? "bg-yellow-500" : "bg-green-500";

function ResourceCell({
  icon,
  label,
  pct,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  pct: number;
  detail: string;
}) {
  return (
    <div className="bg-background px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-xs text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className="text-xl font-semibold tabular-nums">
        {pct.toFixed(1)}%
      </div>
      {detail && (
        <span className="text-xs text-muted-foreground">{detail}</span>
      )}
      <div className="w-full bg-muted rounded-full h-1.5 mt-1.5">
        <div
          className={`h-1.5 rounded-full ${barColor(pct)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
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
