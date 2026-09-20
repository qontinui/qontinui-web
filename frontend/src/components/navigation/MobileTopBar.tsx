"use client";

/**
 * The phone-width top bar: a menu button, the Qontinui mark and the project
 * the page is about.
 *
 * It is exactly 44px tall (`h-11`) on purpose. 87 pages set their root to
 * `h-[calc(100vh-44px)]`, so a 44px bar above them makes those pages the
 * right height on a phone with no page edits. What the same 44px was for on
 * desktop — where nothing fills it — is unexplained and is a separate
 * follow-up; see plan `2026-09-19-app-shell-sidebar-responsive`.
 *
 * Hidden at `md` and up by CSS rather than by the layout band, so it costs
 * nothing at wider widths and cannot disagree with the sidebar about where
 * the breakpoint is.
 */

import Image from "next/image";
import { Menu } from "lucide-react";
import { useSidebar } from "@/contexts/sidebar-context";
import { useTenant } from "@/contexts/tenant-context";
import { SIDEBAR_DRAWER_ID } from "./sidebar/SidebarDrawer";

export function MobileTopBar() {
  const { drawerOpen, setDrawerOpen } = useSidebar();
  const { tenants, activeTenantId } = useTenant();

  const project = tenants.find((t) => t.id === activeTenantId);

  return (
    <div
      data-ui-bridge-id="shell.mobile-top-bar"
      className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface-canvas pr-3 md:hidden"
    >
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        aria-label="Open menu"
        aria-expanded={drawerOpen}
        aria-controls={SIDEBAR_DRAWER_ID}
        data-ui-bridge-id="shell.menu-button"
        // 44x44: the whole bar height, so the tap target is the full corner.
        className="flex size-11 shrink-0 items-center justify-center text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
      >
        <Menu className="size-5" aria-hidden />
      </button>
      <Image
        src="/q-logo.png"
        alt="Qontinui"
        width={24}
        height={24}
        className="h-6 w-auto"
        style={{ width: "auto" }}
      />
      {project && (
        <span
          className="min-w-0 truncate text-sm font-medium text-text-primary"
          data-ui-bridge-id="shell.mobile-top-bar.project-name"
        >
          {project.name}
        </span>
      )}
    </div>
  );
}
