'use client';

import type React from "react";
import { AuthProvider } from "@/contexts/auth-context";
import { AutomationProvider } from "@/contexts/automation-context";
import { OrganizationProvider } from "@/contexts/organization-context";
import { SidebarProvider, useSidebar } from "@/contexts/sidebar-context";
import { OfflineIndicator } from "@/components/offline-indicator";
import { OnboardingTour } from "@/components/onboarding-tour";
import { UnifiedSidebar } from "@/components/navigation";
import { cn } from "@/lib/utils";

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
      <OnboardingTour />
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
      {/* Temporarily disabled - causing 30s timeout on /organizations endpoint */}
      {/* <OrganizationProvider> */}
        <SidebarProvider>
          <AutomationProvider>
            <AppLayoutContent>
              {children}
            </AppLayoutContent>
          </AutomationProvider>
        </SidebarProvider>
      {/* </OrganizationProvider> */}
    </AuthProvider>
  );
}
