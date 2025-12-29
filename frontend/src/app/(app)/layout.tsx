"use client";

import type React from "react";
import { Suspense } from "react";
import { AuthProvider } from "@/contexts/auth-context";
import { AutomationProvider } from "@/contexts/automation-context/AutomationProviderV2";
import { OrganizationProvider } from "@/contexts/organization-context";
import { SidebarProvider, useSidebar } from "@/contexts/sidebar-context";
import { TabStateProvider } from "@/contexts/tab-state-context";
import { OfflineIndicator } from "@/components/offline/OfflineIndicator";
import { SyncQueueViewer } from "@/components/offline/SyncQueueViewer";
import { AppInitializer } from "@/components/offline/AppInitializer";
import { OnboardingTour } from "@/components/onboarding-tour";
import { SessionTimeoutWarning } from "@/components/session-timeout-warning";
import { UnifiedSidebar } from "@/components/navigation";
import { BetaBanner } from "@/components/beta-banner";
import { cn } from "@/lib/utils";
// Tutorial system imports - files pending restoration
// import { TutorialProvider } from "@/components/tutorial/integration/TutorialProvider";
// import { TutorialTrigger } from "@/components/tutorial/integration/TutorialTrigger";
// import { TutorialMenuButton } from "@/components/tutorial/TutorialMenuButton";
// import { allTutorials } from "@/data/tutorials";
// import "@/components/tutorial/integration/tutorial-targets.css";

export const dynamic = "force-dynamic";

function SidebarSkeleton({ isCollapsed }: { isCollapsed: boolean }) {
  return (
    <div
      className={cn(
        "fixed left-0 top-0 h-screen bg-[#0A0A0B] border-r border-gray-800/50",
        isCollapsed ? "w-16" : "w-64"
      )}
    />
  );
}

function AppLayoutContent({ children }: { children: React.ReactNode }) {
  const { isCollapsed } = useSidebar();

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Suspense fallback={<SidebarSkeleton isCollapsed={isCollapsed} />}>
        <UnifiedSidebar />
      </Suspense>
      <div
        className={cn(
          "flex-1 flex flex-col min-h-0 transition-all duration-300",
          isCollapsed ? "ml-16" : "ml-64"
        )}
      >
        <BetaBanner />
        <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
      </div>
      <OfflineIndicator />
      <SyncQueueViewer />
      <OnboardingTour />
      <SessionTimeoutWarning />
    </div>
  );
}

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AuthProvider>
      <OrganizationProvider>
        <SidebarProvider>
          <AutomationProvider>
            <TabStateProvider>
              <AppInitializer>
                <AppLayoutContent>{children}</AppLayoutContent>
              </AppInitializer>
            </TabStateProvider>
          </AutomationProvider>
        </SidebarProvider>
      </OrganizationProvider>
    </AuthProvider>
  );
}
