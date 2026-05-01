import Image from "next/image";
import { cn } from "@/lib/utils";
import { getComponent } from "@/lib/extension-slots";
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
  // below is skipped (no empty bordered container).
  const OrganizationSwitcher =
    getComponent<OrganizationSwitcherProps>("organizationSwitcher");

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
          />
        ) : (
          <div className="flex items-center gap-1">
            <Image
              src="/q-logo.png"
              alt="Qontinui"
              width={28}
              height={28}
              className="h-7 w-auto"
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
      )}
    </>
  );
}
