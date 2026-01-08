/**
 * ScrollContainer Component
 *
 * Reusable scrollable container that properly handles the
 * `flex-1 min-h-0 overflow-auto` pattern for flexbox layouts.
 *
 * Features:
 * - Fixes common `min-h-screen` in `h-screen` issues
 * - Consistent scrollbar styling
 * - Optional fade edges for visual depth
 * - Horizontal and vertical scroll options
 *
 * Usage:
 *   <div className="h-full flex flex-col">
 *     <Header />
 *     <ScrollContainer>
 *       <LongContent />
 *     </ScrollContainer>
 *   </div>
 */

"use client";

import { forwardRef, type ReactNode, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface ScrollContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** Content to scroll */
  children: ReactNode;
  /** Scroll direction */
  direction?: "vertical" | "horizontal" | "both";
  /** Whether to show fade effect at edges */
  fade?: boolean;
  /** Fade position (for fade effect) */
  fadePosition?: "top" | "bottom" | "both";
  /** Padding inside the scroll container */
  padding?: "none" | "sm" | "md" | "lg";
  /** Whether to use custom scrollbar styling */
  customScrollbar?: boolean;
  /** Height behavior */
  height?: "flex" | "full" | "auto";
}

const paddingClasses = {
  none: "",
  sm: "p-2",
  md: "p-4",
  lg: "p-6",
};

const overflowClasses = {
  vertical: "overflow-y-auto overflow-x-hidden",
  horizontal: "overflow-x-auto overflow-y-hidden",
  both: "overflow-auto",
};

const heightClasses = {
  flex: "flex-1 min-h-0",
  full: "h-full",
  auto: "",
};

/**
 * ScrollContainer provides proper scrolling behavior in flexbox layouts.
 *
 * The key issue this solves: In a flex container with `h-screen`,
 * children that use `min-h-screen` will overflow. ScrollContainer
 * uses `flex-1 min-h-0` to fill available space and scroll properly.
 *
 * @example
 * // In a flex column layout
 * <div className="h-full flex flex-col">
 *   <header>Fixed Header</header>
 *   <ScrollContainer>
 *     <p>This content scrolls properly</p>
 *   </ScrollContainer>
 * </div>
 *
 * @example
 * // With fade effect
 * <ScrollContainer fade fadePosition="both">
 *   <LongList />
 * </ScrollContainer>
 */
export const ScrollContainer = forwardRef<HTMLDivElement, ScrollContainerProps>(
  (
    {
      children,
      direction = "vertical",
      fade = false,
      fadePosition = "both",
      padding = "none",
      customScrollbar = true,
      height = "flex",
      className,
      ...props
    },
    ref
  ) => {
    const showTopFade =
      fade && (fadePosition === "top" || fadePosition === "both");
    const showBottomFade =
      fade && (fadePosition === "bottom" || fadePosition === "both");

    return (
      <div
        ref={ref}
        className={cn(
          heightClasses[height],
          overflowClasses[direction],
          customScrollbar && "scrollbar-dark",
          paddingClasses[padding],
          "relative",
          className
        )}
        {...props}
      >
        {/* Top fade overlay */}
        {showTopFade && (
          <div
            className="pointer-events-none absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-surface-canvas to-transparent z-10"
            aria-hidden="true"
          />
        )}

        {children}

        {/* Bottom fade overlay */}
        {showBottomFade && (
          <div
            className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-surface-canvas to-transparent z-10"
            aria-hidden="true"
          />
        )}
      </div>
    );
  }
);

ScrollContainer.displayName = "ScrollContainer";

/**
 * ScrollArea is an alias for ScrollContainer with flex height.
 * Use when you need a scrollable area that fills remaining space.
 */
export const ScrollArea = forwardRef<
  HTMLDivElement,
  Omit<ScrollContainerProps, "height">
>((props, ref) => <ScrollContainer ref={ref} height="flex" {...props} />);

ScrollArea.displayName = "ScrollArea";

export default ScrollContainer;
