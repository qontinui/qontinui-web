"use client";

/**
 * The overlay sheet that carries the full sidebar menu below `lg`.
 *
 * Radix Dialog rather than a hand-rolled sheet, and rather than a new
 * dependency: `@radix-ui/react-dialog` is already here (see
 * `components/ui/dialog.tsx`) and supplies the four things a menu overlay has
 * to get right — a focus trap, Escape, `aria-modal` with the rest of the page
 * inert, and returning focus to whatever opened it.
 *
 * It is NOT built on `components/ui/dialog.tsx`'s `DialogContent`: that one is
 * a centred, rounded, padded box with its own close button. This is an
 * edge-anchored, full-height, unpadded sheet, so it composes the same
 * primitives directly instead of fighting a dozen utility classes.
 *
 * The sidebar content is MOVED here rather than duplicated — `UnifiedSidebar`
 * renders its body either inside the inline `<aside>` or inside this sheet,
 * never both. Two copies would mean two `data-tutorial-id="sidebar-main"`
 * anchors and two of every `data-ui-bridge-id` beneath them.
 */

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

/**
 * The drawer panel's DOM id. The phone top bar's menu button points at it
 * with `aria-controls`, so it is exported rather than spelled twice.
 */
export const SIDEBAR_DRAWER_ID = "shell-sidebar-drawer";

export interface SidebarDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
}

export function SidebarDrawer({
  open,
  onOpenChange,
  children,
  className,
}: SidebarDrawerProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-ui-bridge-id="shell.sidebar-drawer-backdrop"
          className={cn(
            // z-40 under the z-50 panel, and under the z-50 dropdown and
            // popover portals the menu's own project selector and user menu
            // open from inside it.
            "fixed inset-0 z-40 bg-black/50",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
            "motion-reduce:animate-none"
          )}
        />
        <DialogPrimitive.Content
          id={SIDEBAR_DRAWER_ID}
          data-sidebar="true"
          data-tutorial-id="sidebar-main"
          data-ui-bridge-id="shell.sidebar-drawer"
          className={cn(
            // `max-w-[85vw]` leaves a strip of the page visible at 390px, so
            // the backdrop is an obvious thing to tap.
            "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col",
            "border-r border-border-subtle bg-surface-canvas shadow-xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left",
            "motion-reduce:animate-none",
            className
          )}
        >
          {/* Radix requires a title and warns without a description. Both are
              screen-reader-only: the panel's visible heading is the Qontinui
              mark the sidebar header already draws. */}
          <DialogPrimitive.Title className="sr-only">
            Main menu
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Site navigation, the project selector and your account.
          </DialogPrimitive.Description>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
