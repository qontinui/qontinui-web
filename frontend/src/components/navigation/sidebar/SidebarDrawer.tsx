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
  /**
   * Resolves where focus goes when the drawer closes. Called at close time —
   * a ref would not do, because on the tablet layout the control that opened
   * the drawer is the rail's own collapse toggle, which is unmounted while
   * the drawer holds the menu and re-created when it closes.
   *
   * Radix's own restore is not enough either way: it returns focus to
   * whatever was focused at OPEN time, which is a detached node in that
   * tablet case, and on a phone is the document body, because iOS Safari
   * does not focus a `<button>` on tap. Both land a keyboard or
   * screen-reader user at the top of the page instead of back on the control
   * they used.
   */
  getRestoreFocusTarget?: () => HTMLElement | null;
}

export function SidebarDrawer({
  open,
  onOpenChange,
  children,
  className,
  getRestoreFocusTarget,
}: SidebarDrawerProps) {
  const handleCloseAutoFocus = React.useCallback(
    (event: Event) => {
      const target = getRestoreFocusTarget?.();
      if (!target) return;
      event.preventDefault();
      target.focus();
    },
    [getRestoreFocusTarget]
  );

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
            // Entry only, for the reason given on the panel below.
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "motion-reduce:animate-none"
          )}
        />
        <DialogPrimitive.Content
          id={SIDEBAR_DRAWER_ID}
          data-sidebar="true"
          data-tutorial-id="sidebar-main"
          data-ui-bridge-id="shell.sidebar-drawer"
          // Radix makes the rest of the page inert (`aria-hidden` on the
          // siblings, pointer events blocked) but does not say so on the
          // panel itself, and a screen reader reads the state, not the
          // implementation.
          aria-modal="true"
          onCloseAutoFocus={handleCloseAutoFocus}
          className={cn(
            // `max-w-[85vw]` leaves a strip of the page visible at 390px, so
            // the backdrop is an obvious thing to tap.
            "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col",
            "border-r border-border-subtle bg-surface-canvas shadow-xl",
            // Entry only. `UnifiedSidebar` stops rendering this component the
            // moment the drawer closes — it has to, because the menu it holds
            // moves back into the inline rail — so Radix's exit presence never
            // runs and a `data-[state=closed]` class here would be dead code.
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-left",
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
