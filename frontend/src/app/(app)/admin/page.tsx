"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  LayoutDashboard,
  Users,
  FolderOpen,
  TrendingUp,
  Server,
  Home,
  Activity,
  Network,
  Smartphone,
  Bell,
  Download,
} from "lucide-react";

// Dynamic imports for admin tabs - these are loaded only when accessed
const OverviewTab = dynamic(() => import("@/components/admin/OverviewTab"), {
  loading: () => (
    <div className="flex items-center justify-center h-64">
      Loading Overview...
    </div>
  ),
});

const UsersTab = dynamic(() => import("@/components/admin/UsersTab"), {
  loading: () => (
    <div className="flex items-center justify-center h-64">
      Loading Users...
    </div>
  ),
});

const ProjectsTab = dynamic(() => import("@/components/admin/ProjectsTab"), {
  loading: () => (
    <div className="flex items-center justify-center h-64">
      Loading Projects...
    </div>
  ),
});

const AnalyticsTab = dynamic(() => import("@/components/admin/AnalyticsTab"), {
  loading: () => (
    <div className="flex items-center justify-center h-64">
      Loading Analytics...
    </div>
  ),
});

const SystemTab = dynamic(() => import("@/components/admin/SystemTab"), {
  loading: () => (
    <div className="flex items-center justify-center h-64">
      Loading System Info...
    </div>
  ),
});

const HealthDashboardTab = dynamic(
  () => import("@/components/admin/health/HealthDashboardTab"),
  {
    loading: () => (
      <div className="flex items-center justify-center h-64">
        Loading Health Dashboard...
      </div>
    ),
  }
);

const NotificationsTab = dynamic(
  () => import("@/components/admin/NotificationsTab"),
  {
    loading: () => (
      <div className="flex items-center justify-center h-64">
        Loading Notifications...
      </div>
    ),
  }
);

const DownloadsTab = dynamic(() => import("@/components/admin/DownloadsTab"), {
  loading: () => (
    <div className="flex items-center justify-center h-64">
      Loading Downloads...
    </div>
  ),
});

export default function AdminDashboard() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
      return;
    }

    if (!authLoading && user && !user.is_superuser) {
      toast.error("Access denied - Admin privileges required");
      router.push("/dashboard");
      return;
    }
  }, [user, authLoading, router]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-text-muted">Loading...</div>
      </div>
    );
  }

  if (!user?.is_superuser) {
    return null;
  }

  return (
    <div
      className="min-h-screen bg-background p-6"
      data-ui-id="admin-page-dashboard"
    >
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold mb-2">Admin Dashboard</h1>
              <p className="text-muted-foreground">
                Manage users, projects, and monitor system health
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => router.push("/admin/architecture")}
                className="flex items-center gap-2"
                data-ui-id="admin-page-architecture-btn"
              >
                <Network className="h-4 w-4" />
                Architecture
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push("/admin/mobile")}
                className="flex items-center gap-2"
                data-ui-id="admin-page-mobile-btn"
              >
                <Smartphone className="h-4 w-4" />
                Mobile
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push("/dashboard")}
                className="flex items-center gap-2"
                data-ui-id="admin-page-dashboard-btn"
              >
                <Home className="h-4 w-4" />
                Dashboard
              </Button>
            </div>
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="space-y-6"
          data-ui-id="admin-page-tabs"
        >
          <TabsList className="grid w-full grid-cols-8 lg:w-auto lg:inline-grid">
            <TabsTrigger
              value="overview"
              className="flex items-center gap-2"
              data-ui-id="admin-page-overview-tab"
            >
              <LayoutDashboard className="h-4 w-4" />
              <span className="hidden sm:inline" data-content-role="label">
                Overview
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="users"
              className="flex items-center gap-2"
              data-ui-id="admin-page-users-tab"
            >
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline" data-content-role="label">
                Users
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="projects"
              className="flex items-center gap-2"
              data-ui-id="admin-page-projects-tab"
            >
              <FolderOpen className="h-4 w-4" />
              <span className="hidden sm:inline" data-content-role="label">
                Projects
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="analytics"
              className="flex items-center gap-2"
              data-ui-id="admin-page-analytics-tab"
            >
              <TrendingUp className="h-4 w-4" />
              <span className="hidden sm:inline" data-content-role="label">
                Analytics
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="notifications"
              className="flex items-center gap-2"
              data-ui-id="admin-page-notifications-tab"
            >
              <Bell className="h-4 w-4" />
              <span className="hidden sm:inline" data-content-role="label">
                Notifications
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="health"
              className="flex items-center gap-2"
              data-ui-id="admin-page-health-tab"
            >
              <Activity className="h-4 w-4" />
              <span className="hidden sm:inline" data-content-role="label">
                Health
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="system"
              className="flex items-center gap-2"
              data-ui-id="admin-page-system-tab"
            >
              <Server className="h-4 w-4" />
              <span className="hidden sm:inline" data-content-role="label">
                System
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="downloads"
              className="flex items-center gap-2"
              data-ui-id="admin-page-downloads-tab"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline" data-content-role="label">
                Downloads
              </span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <OverviewTab />
          </TabsContent>

          <TabsContent value="users" className="space-y-6">
            <UsersTab />
          </TabsContent>

          <TabsContent value="projects" className="space-y-6">
            <ProjectsTab />
          </TabsContent>

          <TabsContent value="analytics" className="space-y-6">
            <AnalyticsTab />
          </TabsContent>

          <TabsContent value="notifications" className="space-y-6">
            <NotificationsTab />
          </TabsContent>

          <TabsContent value="health" className="space-y-6">
            <HealthDashboardTab />
          </TabsContent>

          <TabsContent value="system" className="space-y-6">
            <SystemTab />
          </TabsContent>

          <TabsContent value="downloads" className="space-y-6">
            <DownloadsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
