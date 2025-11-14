'use client';

import type React from "react";
import { AuthProvider } from "@/contexts/auth-context";
import { AutomationProvider } from "@/contexts/automation-context";
import { OrganizationProvider } from "@/contexts/organization-context";
import { SidebarProvider, useSidebar } from "@/contexts/sidebar-context";
import { OfflineIndicator } from "@/components/offline/OfflineIndicator";
import { SyncQueueViewer } from "@/components/offline/SyncQueueViewer";
import { AppInitializer } from "@/components/offline/AppInitializer";
import { OnboardingTour } from "@/components/onboarding-tour";
import { SessionTimeoutWarning } from "@/components/session-timeout-warning";
import { UnifiedSidebar } from "@/components/navigation";
import { cn } from "@/lib/utils";
// Tutorial system imports - files pending restoration
// import { TutorialProvider } from "@/components/tutorial/integration/TutorialProvider";
// import { TutorialTrigger } from "@/components/tutorial/integration/TutorialTrigger";
// import { TutorialMenuButton } from "@/components/tutorial/TutorialMenuButton";
// import { allTutorials } from "@/data/tutorials";
// import "@/components/tutorial/integration/tutorial-targets.css";

export const dynamic = 'force-dynamic'

function AppLayoutContent({ children }: { children: React.ReactNode }) {
  const { isCollapsed } = useSidebar()

  return (
    <div className="flex min-h-screen bg-background">
      <UnifiedSidebar />
      <main className={cn(
        "flex-1 transition-all duration-300",
        isCollapsed ? "ml-16" : "ml-64"
      )}>
        {children}
      </main>
      <OfflineIndicator />
      <SyncQueueViewer />
      <OnboardingTour />
      <SessionTimeoutWarning />
    </div>
  )
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
            <AppInitializer>
              <AppLayoutContent>
                {children}
              </AppLayoutContent>
            </AppInitializer>
          </AutomationProvider>
        </SidebarProvider>
      </OrganizationProvider>
    </AuthProvider>
  );
}
