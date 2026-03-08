"use client";

import { useState, lazy, Suspense } from "react";
import {
  useAdminStats,
  useAdminUsers,
  useAdminProjects,
} from "@/hooks/use-admin";
import { useAdminGuard, type Section } from "./_hooks/useAdminGuard";
import { AdminHeader } from "./_components/AdminHeader";
import { MetricsStrip } from "./_components/MetricsStrip";
import { SectionTabs } from "./_components/SectionTabs";
import { UsersTable } from "./_components/UsersTable";
import { ProjectsTable } from "./_components/ProjectsTable";

const AnalyticsSection = lazy(() => import("./AnalyticsSection"));
const NotificationsSection = lazy(() => import("./NotificationsSection"));
const HealthSection = lazy(() => import("./HealthSection"));
const SystemSection = lazy(() => import("./SystemSection"));
const DownloadsSection = lazy(() => import("./DownloadsSection"));

export default function AdminDashboard() {
  const { user, authLoading } = useAdminGuard();
  const [activeSection, setActiveSection] = useState<Section>("overview");

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

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-text-muted">Loading...</div>
      </div>
    );
  }

  if (!user?.is_superuser) return null;

  const loading = statsLoading || usersLoading || projectsLoading;

  const handleRefresh = () => {
    refetchStats();
    refetchUsers();
    refetchProjects();
  };

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <AdminHeader loading={loading} onRefresh={handleRefresh} />
      <MetricsStrip stats={stats} />

      <div className="flex-1 flex flex-col min-h-0">
        <SectionTabs
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          userCount={users.length}
          projectCount={projects.length}
        />

        <div className="flex-1 overflow-y-auto">
          {activeSection === "overview" && <MetricsStrip stats={stats} />}
          {activeSection === "users" && (
            <UsersTable users={users} loading={usersLoading} />
          )}
          {activeSection === "projects" && (
            <ProjectsTable projects={projects} loading={projectsLoading} />
          )}
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                Loading...
              </div>
            }
          >
            {activeSection === "analytics" && <AnalyticsSection />}
            {activeSection === "health" && <HealthSection />}
            {activeSection === "system" && <SystemSection />}
            {activeSection === "notifications" && <NotificationsSection />}
            {activeSection === "downloads" && <DownloadsSection />}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
