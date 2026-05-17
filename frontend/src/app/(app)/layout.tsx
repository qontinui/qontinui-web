"use client";

import React, { Suspense } from "react";
import nextDynamic from "next/dynamic";
import { AutomationProvider } from "@/contexts/automation-context/AutomationProviderV2";
import { OrganizationProvider } from "@/contexts/organization-context";
import { RealtimeConnectionsProvider } from "@/contexts/realtime-connections-context";
import { ActiveRunnerProvider } from "@/contexts/active-runner-context";
import { SidebarProvider, useSidebar } from "@/contexts/sidebar-context";
import { TabStateProvider } from "@/contexts/tab-state-context";
import { ProductModeProvider } from "@/contexts/product-mode-context";
import { AppInitializer } from "@/components/offline/AppInitializer";
import { BetaBanner } from "@/components/beta-banner";
import { useAuth } from "@/contexts/auth-context";
import { MentionRealtimeSubscriber } from "@/app/(app)/strategy/_components/MentionRealtimeSubscriber";
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
const RecordingIndicator = nextDynamic(
  () =>
    import("@/components/ui-bridge/RecordingIndicator").then((m) => ({
      default: m.RecordingIndicator,
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
  const { user } = useAuth();

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
      <Suspense fallback={null}>
        <RecordingIndicator />
      </Suspense>
      {/* Strategy Phase 2.5 — headless subscriber for the
          per-user mention WS channel. Mounted once at the app-
          shell level so the badge updates anywhere in the app. */}
      <MentionRealtimeSubscriber userId={user?.id ?? null} />
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
        <ActiveRunnerProvider>
          <SidebarProvider>
            <ProductModeProvider>
              <AutomationProvider>
                <TabStateProvider>
                  <AppInitializer>
                    <AppLayoutContent>{children}</AppLayoutContent>
                  </AppInitializer>
                </TabStateProvider>
              </AutomationProvider>
            </ProductModeProvider>
          </SidebarProvider>
        </ActiveRunnerProvider>
      </RealtimeConnectionsProvider>
    </OrganizationProvider>
  );
}
