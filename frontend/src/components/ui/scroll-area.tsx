"use client";

import * as React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";

import { cn } from "@/lib/utils";

function ScrollArea({
  className,
  children,
  horizontal = false,
  fitWidth = false,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  /**
   * Opt in to horizontal scrolling. Default `false` keeps the historical
   * behaviour (`overflow-x-hidden` — sub-pixel overflow never produces a
   * stray horizontal scrollbar). When `true`, over-wide content becomes
   * horizontally scrollable and a horizontal scrollbar renders, so
   * interactive elements (e.g. action buttons in a wide panel) can never be
   * clipped off-screen with no way to reach them.
   */
  horizontal?: boolean;
  /**
   * Lay the children out at the viewport's width, so text wraps and a wide
   * table scrolls inside its own `overflow-x-auto` region. Radix wraps children
   * in a `display: table` div, which grows to its content's minimum width: one
   * wide table anywhere inside widens everything, and `overflow-x-hidden` then
   * cuts the excess off with no way to reach it. Use this for a page body, and
   * not together with `horizontal`, which needs that growth to have something
   * to scroll.
   */
  fitWidth?: boolean;
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative overflow-hidden flex flex-col", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className={cn(
          "!overflow-y-auto flex-1 min-h-0 w-full rounded-[inherit] focus-visible:ring-ring/50 transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1",
          horizontal ? "!overflow-x-auto" : "!overflow-x-hidden",
          fitWidth && "[&>div]:!block"
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      {horizontal && <ScrollBar orientation="horizontal" />}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none",
        orientation === "vertical" &&
          "h-full w-2.5 border-l border-l-transparent",
        orientation === "horizontal" &&
          "h-2.5 flex-col border-t border-t-transparent",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="bg-border-strong hover:bg-border-interactive relative flex-1 rounded-full"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollBar };
