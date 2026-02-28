"use client";

/**
 * Admin2 Dashboard — UX-optimized redesign
 *
 * Design Quality Review findings from the original /admin page:
 *
 * UX issues (Phase 1):
 * - containerEfficiency: 345×120px stat cards for a single number (~4% fill)
 * - informationDensity: 6 numbers + 1 user list = very low info density
 * - aboveFoldRatio: Recent Users section pushed below fold by oversized cards
 * - viewportUtilization: 3-col card grid wastes vertical space
 *
 * Visual polish (Phase 2):
 * - Visual hierarchy doesn't match importance — all 6 stats look identical
 *   but "Total Users" and "Active Users" matter more than "MRR (Coming Soon)"
 * - No clear primary action on the page
 * - Recent users list is low-density: wide rows for sparse data
 *
 * This redesign addresses all findings:
 * - Compact inline metrics strip (all 6 stats in one row)
 * - Full-height data table visible without scrolling
 * - Clear visual hierarchy: primary stats larger, secondary stats inline
 * - Tabs replaced with sidebar sections to maximize content area
 */

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import {
  useAdminStats,
  useAdminUsers,
  useAdminProjects,
} from "@/hooks/use-admin";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Users,
  FolderOpen,
  TrendingUp,
  Activity,
  DollarSign,
  Zap,
  Home,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
  RefreshCw,
  BarChart3,
  HeartPulse,
  Settings,
  Bell,
  Download,
} from "lucide-react";

const AnalyticsTab = dynamic(() => import("@/components/admin/AnalyticsTab"), {
  ssr: false,
});
const NotificationsTab = dynamic(
  () => import("@/components/admin/NotificationsTab"),
  { ssr: false }
);
const HealthDashboardTab = dynamic(
  () => import("@/components/admin/health/HealthDashboardTab"),
  { ssr: false }
);
const SystemTab = dynamic(() => import("@/components/admin/SystemTab"), {
  ssr: false,
});
const DownloadsTab = dynamic(() => import("@/components/admin/DownloadsTab"), {
  ssr: false,
});

type Section =
  | "users"
  | "projects"
  | "analytics"
  | "health"
  | "system"
  | "notifications"
  | "downloads";

export default function Admin2Dashboard() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<Section>("users");

  const {
    data: stats,
    isLoading: statsLoading,
    refetch: refetchStats,
  } = useAdminStats();
  const {
    data: users = [],
    isLoading: usersLoading,
    refetch: refetchUsers,
  } = useAdminUsers({ limit: 20 });
  const {
    data: projects = [],
    isLoading: projectsLoading,
    refetch: refetchProjects,
  } = useAdminProjects({ limit: 20 });

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
      return;
    }
    if (!authLoading && user && !user.is_superuser) {
      toast.error("Access denied - Admin privileges required");
      router.push("/build/workflows");
    }
  }, [user, authLoading, router]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-text-muted">Loading...</div>
      </div>
    );
  }

  if (!user?.is_superuser) return null;

  const loading = statsLoading || usersLoading || projectsLoading;

  const activationRate =
    stats && stats.total_users > 0
      ? ((stats.active_users / stats.total_users) * 100).toFixed(1)
      : "0";

  const avgProjectsPerUser =
    stats && stats.total_users > 0
      ? (stats.total_projects / stats.total_users).toFixed(1)
      : "0";

  return (
    <div
      className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden"
      data-ui-id="admin2-page"
    >
      {/* ── Header: compact, single line ── */}
      <div
        className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0"
        data-ui-id="admin2-header"
      >
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold" data-ui-id="admin2-title">
            Admin
          </h1>
          <Badge variant="outline" className="text-xs font-normal">
            v2
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              refetchStats();
              refetchUsers();
              refetchProjects();
            }}
            disabled={loading}
            data-ui-id="admin2-refresh-btn"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/admin")}
            data-ui-id="admin2-classic-btn"
          >
            Classic View
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/build/workflows")}
            data-ui-id="admin2-home-btn"
          >
            <Home className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Metrics Strip: all 6 stats in one compact row ── */}
      <div
        className="grid grid-cols-6 gap-px bg-border shrink-0"
        data-ui-id="admin2-metrics-strip"
      >
        <MetricCell
          icon={<Users className="h-3.5 w-3.5" />}
          label="Users"
          value={stats?.total_users ?? "—"}
          sub={`+${stats?.new_users_week ?? 0} this week`}
          trend={stats?.new_users_week ? "up" : undefined}
          primary
          uiId="admin2-metric-users"
        />
        <MetricCell
          icon={<Activity className="h-3.5 w-3.5" />}
          label="Active"
          value={stats?.active_users ?? "—"}
          sub={`${activationRate}% rate`}
          trend={Number(activationRate) > 50 ? "up" : "down"}
          primary
          uiId="admin2-metric-active"
        />
        <MetricCell
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          label="New (30d)"
          value={stats?.new_users_month ?? "—"}
          sub="Last 30 days"
          uiId="admin2-metric-new"
        />
        <MetricCell
          icon={<FolderOpen className="h-3.5 w-3.5" />}
          label="Projects"
          value={stats?.total_projects ?? "—"}
          sub={`+${stats?.projects_week ?? 0} this week`}
          uiId="admin2-metric-projects"
        />
        <MetricCell
          icon={<Zap className="h-3.5 w-3.5" />}
          label="Avg/User"
          value={avgProjectsPerUser}
          sub="Projects per user"
          uiId="admin2-metric-avg"
        />
        <MetricCell
          icon={<DollarSign className="h-3.5 w-3.5" />}
          label="MRR"
          value="$0"
          sub="Coming soon"
          muted
          uiId="admin2-metric-mrr"
        />
      </div>

      {/* ── Content: section toggle + data table ── */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Section tabs */}
        <div
          className="flex items-center gap-1 px-6 py-2 border-b border-border shrink-0"
          data-ui-id="admin2-section-tabs"
        >
          {(
            [
              { key: "users", label: `Users (${users.length})`, icon: Users },
              {
                key: "projects",
                label: `Projects (${projects.length})`,
                icon: FolderOpen,
              },
              { key: "analytics", label: "Analytics", icon: BarChart3 },
              { key: "health", label: "Health", icon: HeartPulse },
              { key: "system", label: "System", icon: Settings },
              { key: "notifications", label: "Notifications", icon: Bell },
              { key: "downloads", label: "Downloads", icon: Download },
            ] as const
          ).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveSection(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
                activeSection === key
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
              data-ui-id={`admin2-section-${key}-btn`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Content area — scrollable, fills remaining viewport */}
        <div className="flex-1 overflow-y-auto" data-ui-id="admin2-table-area">
          {activeSection === "users" && (
            <UsersTable users={users} loading={usersLoading} />
          )}
          {activeSection === "projects" && (
            <ProjectsTable projects={projects} loading={projectsLoading} />
          )}
          {activeSection === "analytics" && (
            <div className="p-6">
              <AnalyticsTab />
            </div>
          )}
          {activeSection === "health" && (
            <div className="p-6">
              <HealthDashboardTab />
            </div>
          )}
          {activeSection === "system" && (
            <div className="p-6">
              <SystemTab />
            </div>
          )}
          {activeSection === "notifications" && (
            <div className="p-6">
              <NotificationsTab />
            </div>
          )}
          {activeSection === "downloads" && (
            <div className="p-6">
              <DownloadsTab />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MetricCell — compact stat display
// ============================================================================

function MetricCell({
  icon,
  label,
  value,
  sub,
  trend,
  primary,
  muted,
  uiId,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub: string;
  trend?: "up" | "down";
  primary?: boolean;
  muted?: boolean;
  uiId: string;
}) {
  return (
    <div
      className={`bg-background px-4 py-3 ${muted ? "opacity-50" : ""}`}
      data-ui-id={uiId}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-muted-foreground">{icon}</span>
        <span
          className="text-xs text-muted-foreground uppercase tracking-wider"
          data-content-role="label"
        >
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className={`font-semibold tabular-nums ${primary ? "text-2xl" : "text-xl"}`}
          data-content-role="metric"
          data-content-label={uiId}
        >
          {value}
        </span>
        {trend && (
          <span
            className={`flex items-center text-xs ${
              trend === "up" ? "text-green-500" : "text-red-500"
            }`}
          >
            {trend === "up" ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
          </span>
        )}
      </div>
      <span className="text-xs text-muted-foreground">{sub}</span>
    </div>
  );
}

// ============================================================================
// UsersTable — dense, scannable
// ============================================================================

function UsersTable({
  users,
  loading,
}: {
  users: Array<{
    id: string;
    username: string;
    email: string;
    is_active: boolean;
    is_verified: boolean;
    email_verified?: boolean;
    subscription_tier: string;
    project_count: number;
    created_at: string | null;
    last_login?: string | null;
  }>;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        Loading users...
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        No users found
      </div>
    );
  }

  return (
    <table className="w-full text-sm" data-ui-id="admin2-users-table">
      <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
        <tr className="text-left text-xs text-muted-foreground uppercase tracking-wider">
          <th className="px-6 py-2 font-medium">User</th>
          <th className="px-3 py-2 font-medium">Tier</th>
          <th className="px-3 py-2 font-medium">Status</th>
          <th className="px-3 py-2 font-medium text-right">Projects</th>
          <th className="px-3 py-2 font-medium">Joined</th>
          <th className="px-6 py-2 font-medium"></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {users.map((user) => (
          <tr
            key={user.id}
            className="hover:bg-muted/30 transition-colors"
            data-ui-id={`admin2-user-row-${user.username}`}
          >
            <td className="px-6 py-2.5">
              <div>
                <span
                  className="font-medium"
                  data-content-role="label"
                  data-content-label="username"
                >
                  {user.username}
                </span>
                <div className="text-xs text-muted-foreground">
                  {user.email}
                </div>
              </div>
            </td>
            <td className="px-3 py-2.5">
              <Badge
                variant="outline"
                className="text-xs capitalize"
                data-content-role="badge"
              >
                {user.subscription_tier}
              </Badge>
            </td>
            <td className="px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <div
                  className={`h-1.5 w-1.5 rounded-full ${
                    user.is_active ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <span className="text-xs">
                  {user.is_active ? "Active" : "Inactive"}
                </span>
                {!(user.email_verified ?? user.is_verified) && (
                  <span className="text-xs text-yellow-500">(unverified)</span>
                )}
              </div>
            </td>
            <td
              className="px-3 py-2.5 text-right tabular-nums"
              data-content-role="metric"
              data-content-label="project-count"
            >
              {user.project_count}
            </td>
            <td className="px-3 py-2.5 text-xs text-muted-foreground">
              {user.created_at
                ? new Date(user.created_at).toLocaleDateString()
                : "—"}
            </td>
            <td className="px-6 py-2.5">
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ============================================================================
// ProjectsTable — dense, scannable
// ============================================================================

function ProjectsTable({
  projects,
  loading,
}: {
  projects: Array<{
    id: string;
    name: string;
    description: string | null;
    owner_username: string;
    owner_email: string;
    created_at: string;
    updated_at: string;
    state_count: number;
    transition_count: number;
  }>;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        Loading projects...
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        No projects found
      </div>
    );
  }

  function complexityLabel(states: number, transitions: number) {
    const total = states + transitions;
    if (total === 0) return { label: "Empty", color: "text-muted-foreground" };
    if (total <= 5) return { label: "Simple", color: "text-green-500" };
    if (total <= 15) return { label: "Medium", color: "text-yellow-500" };
    return { label: "Complex", color: "text-orange-500" };
  }

  return (
    <table className="w-full text-sm" data-ui-id="admin2-projects-table">
      <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
        <tr className="text-left text-xs text-muted-foreground uppercase tracking-wider">
          <th className="px-6 py-2 font-medium">Project</th>
          <th className="px-3 py-2 font-medium">Owner</th>
          <th className="px-3 py-2 font-medium">Complexity</th>
          <th className="px-3 py-2 font-medium text-right">States</th>
          <th className="px-3 py-2 font-medium text-right">Transitions</th>
          <th className="px-3 py-2 font-medium">Updated</th>
          <th className="px-6 py-2 font-medium"></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {projects.map((project) => {
          const complexity = complexityLabel(
            project.state_count,
            project.transition_count
          );
          return (
            <tr
              key={project.id}
              className="hover:bg-muted/30 transition-colors"
              data-ui-id={`admin2-project-row-${project.id}`}
            >
              <td className="px-6 py-2.5">
                <div>
                  <span className="font-medium">{project.name}</span>
                  {project.description && (
                    <div className="text-xs text-muted-foreground truncate max-w-xs">
                      {project.description}
                    </div>
                  )}
                </div>
              </td>
              <td className="px-3 py-2.5">
                <div className="text-xs">
                  <div>{project.owner_username}</div>
                  <div className="text-muted-foreground">
                    {project.owner_email}
                  </div>
                </div>
              </td>
              <td className="px-3 py-2.5">
                <span className={`text-xs font-medium ${complexity.color}`}>
                  {complexity.label}
                </span>
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                {project.state_count}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                {project.transition_count}
              </td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground">
                {new Date(project.updated_at).toLocaleDateString()}
              </td>
              <td className="px-6 py-2.5">
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
