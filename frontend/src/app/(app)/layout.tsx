"use client";

import type React from "react";
import { Suspense } from "react";
import nextDynamic from "next/dynamic";
import { AutomationProvider } from "@/contexts/automation-context/AutomationProviderV2";
import { OrganizationProvider } from "@/contexts/organization-context";
import { RealtimeConnectionsProvider } from "@/contexts/realtime-connections-context";
import { SidebarProvider, useSidebar } from "@/contexts/sidebar-context";
import { TabStateProvider } from "@/contexts/tab-state-context";
import { AppInitializer } from "@/components/offline/AppInitializer";
import { BetaBanner } from "@/components/beta-banner";
import { cn } from "@/lib/utils";

// Dynamic imports with ssr:false to avoid hydration mismatches
// (these components use browser APIs like localStorage, navigator, etc.)
const UnifiedSidebar = nextDynamic(
  () =>
    import("@/components/navigation").then((m) => ({
      default: m.UnifiedSidebar,
    })),
  { ssr: false }
);
const SyncQueueViewer = nextDynamic(
  () =>
    import("@/components/offline/SyncQueueViewer").then((m) => ({
      default: m.SyncQueueViewer,
    })),
  { ssr: false }
);
const SessionTimeoutWarning = nextDynamic(
  () =>
    import("@/components/session-timeout-warning").then((m) => ({
      default: m.SessionTimeoutWarning,
    })),
  { ssr: false }
);

function SidebarSkeleton({ isCollapsed }: { isCollapsed: boolean }) {
  return (
    <div
      className={cn(
        "fixed left-0 top-0 h-screen bg-surface-canvas border-r border-border-subtle",
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
      <Suspense fallback={null}>
        <SyncQueueViewer />
      </Suspense>
      <Suspense fallback={null}>
        <SessionTimeoutWarning />
      </Suspense>
    </div>
  );
}

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <OrganizationProvider>
      <RealtimeConnectionsProvider>
        <SidebarProvider>
          <AutomationProvider>
            <TabStateProvider>
              <AppInitializer>
                <AppLayoutContent>{children}</AppLayoutContent>
              </AppInitializer>
            </TabStateProvider>
          </AutomationProvider>
        </SidebarProvider>
      </RealtimeConnectionsProvider>
    </OrganizationProvider>
  );
}
