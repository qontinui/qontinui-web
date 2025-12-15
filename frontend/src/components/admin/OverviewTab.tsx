"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Users,
  FolderOpen,
  TrendingUp,
  Activity,
  DollarSign,
  Zap,
  ShieldAlert,
  AlertCircle,
} from "lucide-react";
import { useAdminStats, useAdminUsers } from "@/hooks/use-admin";
import { Button } from "@/components/ui/button";

export default function OverviewTab() {
  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
    refetch: refetchStats,
  } = useAdminStats();
  const {
    data: users = [],
    isLoading: usersLoading,
    error: usersError,
  } = useAdminUsers({ limit: 10 });

  const loading = statsLoading || usersLoading;
  const error = statsError || usersError;

  if (loading) {
    return (
      <div className="text-center text-muted-foreground py-12">
        Loading overview...
      </div>
    );
  }

  if (error) {
    const is403 = error.message?.includes("403");
    const is500 =
      error.message?.includes("500") || error.message?.includes("Server");

    return (
      <Card className="bg-card border-border">
        <CardContent className="flex flex-col items-center justify-center py-12">
          {is403 ? (
            <>
              <ShieldAlert className="h-12 w-12 text-yellow-500 mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                Admin Access Required
              </h3>
              <p className="text-muted-foreground text-center max-w-md mb-4">
                You don&apos;t have admin privileges. Contact a superuser to grant
                you admin access, or use the bootstrap endpoint if this is a
                fresh installation.
              </p>
              <code className="text-xs bg-muted px-3 py-2 rounded mb-4">
                POST /api/v1/admin/bootstrap-first-admin?email=your@email.com
              </code>
            </>
          ) : is500 ? (
            <>
              <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
              <h3 className="text-lg font-semibold mb-2">Server Error</h3>
              <p className="text-muted-foreground text-center max-w-md mb-4">
                The backend server is unavailable or encountered an error.
                Please ensure the server is running.
              </p>
            </>
          ) : (
            <>
              <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
              <h3 className="text-lg font-semibold mb-2">Error Loading Data</h3>
              <p className="text-muted-foreground text-center max-w-md mb-4">
                {error.message}
              </p>
            </>
          )}
          <Button onClick={() => refetchStats()} variant="outline">
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!stats) {
    return (
      <div className="text-center text-muted-foreground py-12">
        No data available
      </div>
    );
  }

  const activationRate =
    stats.total_users > 0
      ? ((stats.active_users / stats.total_users) * 100).toFixed(1)
      : 0;

  return (
    <div className="space-y-6">
      {/* Key Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total_users}</div>
            <p className="text-xs text-muted-foreground">
              +{stats.new_users_week} this week
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              New Users (30d)
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.new_users_month}</div>
            <p className="text-xs text-muted-foreground">Last 30 days</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Users</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.active_users}</div>
            <p className="text-xs text-muted-foreground">
              {activationRate}% activation rate
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Projects
            </CardTitle>
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total_projects}</div>
            <p className="text-xs text-muted-foreground">
              +{stats.projects_week} this week
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Avg Projects/User
            </CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.total_users > 0
                ? (stats.total_projects / stats.total_users).toFixed(1)
                : 0}
            </div>
            <p className="text-xs text-muted-foreground">Per registered user</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              MRR (Coming Soon)
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">$0</div>
            <p className="text-xs text-muted-foreground">
              Monthly recurring revenue
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Users */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Recent Users</CardTitle>
          <CardDescription>Latest 10 registered users</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {users.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{user.username}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                      {user.subscription_tier}
                    </span>
                    {!user.email_verified && (
                      <span className="text-xs text-yellow-500">
                        (unverified)
                      </span>
                    )}
                    {!user.is_active && (
                      <span className="text-xs text-red-500">(inactive)</span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {user.email}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium">
                    {user.project_count} projects
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {user.created_at
                      ? `Joined ${new Date(user.created_at).toLocaleDateString()}`
                      : "Join date unknown"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
