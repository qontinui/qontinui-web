import {
  Users,
  Activity,
  TrendingUp,
  FolderOpen,
  Zap,
  DollarSign,
} from "lucide-react";
import type { AdminStats } from "@/hooks/use-admin";
import { MetricCell } from "./MetricCell";

interface MetricsStripProps {
  stats: AdminStats | undefined;
}

export function MetricsStrip({ stats }: MetricsStripProps) {
  const activationRate =
    stats && stats.total_users > 0
      ? ((stats.active_users / stats.total_users) * 100).toFixed(1)
      : "0";

  const avgProjectsPerUser =
    stats && stats.total_users > 0
      ? (stats.total_projects / stats.total_users).toFixed(1)
      : "0";

  return (
    <div className="grid grid-cols-6 gap-px bg-border shrink-0">
      <MetricCell
        icon={<Users className="h-3.5 w-3.5" />}
        label="Users"
        value={stats?.total_users ?? "\u2014"}
        sub={`+${stats?.new_users_week ?? 0} this week`}
        trend={stats?.new_users_week ? "up" : undefined}
        primary
        uiId="admin-metric-users"
      />
      <MetricCell
        icon={<Activity className="h-3.5 w-3.5" />}
        label="Active"
        value={stats?.active_users ?? "\u2014"}
        sub={`${activationRate}% rate`}
        trend={Number(activationRate) > 50 ? "up" : "down"}
        primary
        uiId="admin-metric-active"
      />
      <MetricCell
        icon={<TrendingUp className="h-3.5 w-3.5" />}
        label="New (30d)"
        value={stats?.new_users_month ?? "\u2014"}
        sub="Last 30 days"
        uiId="admin-metric-new"
      />
      <MetricCell
        icon={<FolderOpen className="h-3.5 w-3.5" />}
        label="Projects"
        value={stats?.total_projects ?? "\u2014"}
        sub={`+${stats?.projects_week ?? 0} this week`}
        uiId="admin-metric-projects"
      />
      <MetricCell
        icon={<Zap className="h-3.5 w-3.5" />}
        label="Avg/User"
        value={avgProjectsPerUser}
        sub="Projects per user"
        uiId="admin-metric-avg"
      />
      <MetricCell
        icon={<DollarSign className="h-3.5 w-3.5" />}
        label="MRR"
        value="$0"
        sub="Coming soon"
        muted
        uiId="admin-metric-mrr"
      />
    </div>
  );
}
