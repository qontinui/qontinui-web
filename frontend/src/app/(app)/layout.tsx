"use client";

import React, { Suspense, useEffect } from "react";
import nextDynamic from "next/dynamic";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AutomationProvider } from "@/contexts/automation-context/AutomationProviderV2";
import { OrganizationProvider } from "@/contexts/organization-context";
import { RealtimeConnectionsProvider } from "@/contexts/realtime-connections-context";
import { ActiveRunnerProvider } from "@/contexts/active-runner-context";
import { TenantProvider } from "@/contexts/tenant-context";
import { SidebarProvider, useSidebar } from "@/contexts/sidebar-context";
import { TabStateProvider } from "@/contexts/tab-state-context";
import { ProductModeProvider } from "@/contexts/product-mode-context";
import { AdvancedAutomationProvider } from "@/contexts/advanced-automation-context";
import { AppInitializer } from "@/components/offline/AppInitializer";
import { CloudProviders } from "@/components/CloudProviders";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BetaBannerSlot } from "@/components/cloud-slots/BetaBannerSlot";
import { useAuth } from "@/contexts/auth-context";
import { MentionRealtimeSubscriber } from "@/app/(app)/strategy/_components/MentionRealtimeSubscriber";
import { HelperRedirectGate } from "@/components/helper-portal/HelperRedirectGate";
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
// §4.5 — "AI in control" banner. Top of every authenticated page when
// the relay has issued >=1 command in the last 30s. SSR-disabled
// because activity detection relies on sessionStorage + browser
// timers; lazy-load also keeps the marketing layout out of the
// banner's dependency closure.
const CoPilotActiveBanner = nextDynamic(
  () =>
    import("@/components/co-pilot/CoPilotActiveBanner").then((m) => ({
      default: m.CoPilotActiveBanner,
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

function AuthLoadingShell() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
        <div className="text-lg text-muted-foreground">Loading...</div>
      </div>
    </div>
  );
}

/**
 * Bounces unauthenticated visitors to `/login`, and renders
 * `AuthLoadingShell` in place of `children` until `useAuth()` has resolved.
 *
 * THIS GATE IS LOAD-BEARING FOR SOMETHING OTHER THAN AUTH. `useAuth()`
 * reports `loading` on the server always, so `children` — and therefore
 * `<CloudProviders>` just below — are never part of the server render or of
 * the HYDRATION render. That is what keeps the composed build off the
 * whole-tree remount: `useSyncExternalStore` must read `getServerSnapshot`
 * when hydrating, and `useSlotProviders`' is an empty array, so a
 * `CloudProviders` present at hydration would mount zero providers and then
 * swap to the real snapshot — changing the element type at that position and
 * making React tear down and rebuild the entire authenticated tree, on every
 * page load.
 *
 * So making auth resolve synchronously — an SSR cookie read, a
 * `localStorage` seed, an optimistic `loading: false` — is not a local
 * change. It reintroduces that remount with no visible connection to
 * extension slots. `components/CloudProviders.tsx`,
 * `lib/extension-slots.ts` and `docs/composed-cloud-build.md` carry the full
 * argument; `CloudProviders.test.tsx` pins both the remount itself and this
 * file's structure.
 */
function AppAuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (loading) return;
    if (user) return;
    const query = searchParams?.toString();
    const next = query ? `${pathname}?${query}` : pathname;
    router.replace(`/login?next=${encodeURIComponent(next ?? "/")}`);
  }, [loading, user, pathname, searchParams, router]);

  if (loading || !user) {
    return <AuthLoadingShell />;
  }

  return (
    <>
      {/* Helper-task portal lock-in: helper-only users are bounced from
          every (app) route to /help (helper-task-queue plan Phase 1.4). */}
      <HelperRedirectGate />
      {children}
    </>
  );
}

function AppLayoutContent({ children }: { children: React.ReactNode }) {
  const { isCollapsed } = useSidebar();
  const { user } = useAuth();

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* §4.5 "AI in control" banner — fixed-top, z-9999, only renders
          when the co-pilot is actively driving the tab. The component
          itself is wrapped in data-bridge-invisible so the SDK auto-
          register's ancestor walk skips it (bridge can't click its own
          Stop button + silence the indicator). */}
      <Suspense fallback={null}>
        <CoPilotActiveBanner />
      </Suspense>
      <Suspense fallback={<SidebarSkeleton isCollapsed={isCollapsed} />}>
        <UnifiedSidebar />
      </Suspense>
      <div
        className={cn(
          // `min-w-0`: this is a flex child of the row above; without it the
          // default `min-width: auto` keeps it from shrinking below its
          // content's intrinsic width, so a page with wide content (e.g.
          // /operations) pushes the wrapper past the viewport and the root
          // `overflow-hidden` clips the right edge — stranding off-screen
          // controls with no scroll escape. `min-w-0` lets it shrink to the
          // available width so page content fits instead of overflowing.
          "flex-1 flex flex-col min-h-0 min-w-0 transition-all duration-300",
          isCollapsed ? "ml-16" : "ml-64"
        )}
      >
        <BetaBannerSlot />
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
    <AppAuthGate>
      {/* Providers the composed cloud build contributes, mounted around the
          whole authenticated tree. No-op in OSS-only builds. This sits OUTSIDE
          the OSS `OrganizationProvider` because the two supply DIFFERENT
          context objects — cloud-control's components read cloud-control's
          context, OSS components read the stub — and both must be present in a
          composed build. See `components/CloudProviders.tsx`. */}
      <CloudProviders>
        <OrganizationProvider>
          <RealtimeConnectionsProvider>
            <ActiveRunnerProvider>
              <TenantProvider>
                <SidebarProvider>
                  <ProductModeProvider>
                    <AdvancedAutomationProvider>
                      <AutomationProvider>
                        <TabStateProvider>
                          <AppInitializer>
                            {/* Radix Tooltip.Root (our `Tooltip`) throws
                          "must be used within TooltipProvider" at render under
                          @radix-ui/react-tooltip's Provider invariant. Mount a
                          single app-shell-level provider so every authenticated
                          page's tooltips work — without it, any page that
                          renders a Tooltip without its own local provider (e.g.
                          /operations via CiStatusPanel/FleetOverview) crashes
                          into the ErrorBoundary and shows no content. */}
                            <TooltipProvider>
                              <AppLayoutContent>{children}</AppLayoutContent>
                            </TooltipProvider>
                          </AppInitializer>
                        </TabStateProvider>
                      </AutomationProvider>
                    </AdvancedAutomationProvider>
                  </ProductModeProvider>
                </SidebarProvider>
              </TenantProvider>
            </ActiveRunnerProvider>
          </RealtimeConnectionsProvider>
        </OrganizationProvider>
      </CloudProviders>
    </AppAuthGate>
  );
}
