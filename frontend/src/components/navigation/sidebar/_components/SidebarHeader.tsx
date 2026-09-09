import Image from "next/image";
import { cn } from "@/lib/utils";
import { useSlotComponent } from "@/lib/extension-slots";
import { ErrorBoundary } from "@/components/error-boundary";
import type {
  OrganizationSwitcherProps,
  SwitcherOrganization,
} from "@/lib/cloud-component-slots";
import { ProductModeSwitcher } from "./ProductModeSwitcher";

type SwitcherOrg = SwitcherOrganization;

interface SidebarHeaderProps {
  isCollapsed: boolean;
  mounted: boolean;
  loading: boolean;
  switcherOrganizations: SwitcherOrg[];
  switcherCurrentOrg: SwitcherOrg | null;
  onOrganizationChange: (orgId: string) => void;
  onCreateOrganization: () => void;
}

export function SidebarHeader({
  isCollapsed,
  mounted,
  loading,
  switcherOrganizations,
  switcherCurrentOrg,
  onOrganizationChange,
  onCreateOrganization,
}: SidebarHeaderProps) {
  // Resolves to cloud-control's real switcher in composed deploys, or
  // `undefined` in OSS-only — in which case the entire wrapper section
  // below is skipped (no empty bordered container). `useSlotComponent`
  // subscribes to the registry, so a `registerCloudExtensions` call that
  // lands after this header first renders re-renders it; a bare per-render
  // read would only resolve if something else happened to re-render us.
  //
  // Rendered behind an ErrorBoundary below for the reason spelled out on
  // `CreateOrganizationDialogSlot` in `../UnifiedSidebar.tsx`: a slot
  // component is foreign code the host cannot typecheck against its own
  // provider tree, so it can throw for reasons the host never sees. This
  // site carries the largest blast radius of the four — the sidebar is on
  // every authenticated page, so an unguarded throw here reaches the root
  // boundary in `app/layout.tsx` and white-screens all of them, which is
  // the shape of the 2026-08-26 outage.
  const OrganizationSwitcher =
    useSlotComponent<OrganizationSwitcherProps>("organizationSwitcher");

  return (
    <>
      <div
        className={cn(
          "relative flex flex-col p-2 border-b border-border-subtle",
          isCollapsed && "items-center"
        )}
      >
        {isCollapsed ? (
          <Image
            src="/q-logo.png"
            alt="Qontinui"
            width={32}
            height={32}
            className="h-8 w-auto"
            style={{ width: "auto" }}
          />
        ) : (
          <div className="flex items-center gap-1">
            <Image
              src="/q-logo.png"
              alt="Qontinui"
              width={28}
              height={28}
              className="h-7 w-auto"
              style={{ width: "auto" }}
            />
            <span className="text-xl font-bold bg-gradient-to-r from-brand-primary to-brand-secondary bg-clip-text text-transparent">
              ontinui
            </span>
          </div>
        )}
      </div>

      <div
        className={cn(
          "px-2 py-1.5 border-b border-border-subtle",
          isCollapsed && "flex justify-center"
        )}
      >
        <ProductModeSwitcher isCollapsed={isCollapsed} />
      </div>

      {!isCollapsed && OrganizationSwitcher && (
        // The boundary wraps the WRAPPER, not just the switcher: a throw
        // then leaves no empty bordered container, which is the same shape
        // the OSS-only build renders. The fallback must be a truthy node —
        // `ErrorBoundary` tests `if (this.props.fallback)`, so `null` falls
        // through to its full-page error card.
        <ErrorBoundary fallback={<></>}>
          <div className="px-2 py-1.5 border-b border-border-subtle">
            {mounted ? (
              <OrganizationSwitcher
                organizations={switcherOrganizations}
                currentOrganization={switcherCurrentOrg}
                onOrganizationChange={onOrganizationChange}
                onCreateOrganization={onCreateOrganization}
                loading={loading}
                className="bg-surface-raised/50 border-border-default hover:bg-surface-raised hover:border-border-default"
              />
            ) : (
              <div className="h-8 w-full rounded-md bg-surface-raised/50 border border-border-default animate-pulse" />
            )}
          </div>
        </ErrorBoundary>
      )}
    </>
  );
}
