/**
 * PageLayout Component
 *
 * Standard page wrapper for scrollable content pages.
 * Handles proper height constraints and scrolling behavior.
 *
 * Features:
 * - Automatic scrolling with `overflow-y-auto`
 * - Optional max-width constraint
 * - Optional page header slot
 * - Consistent padding and spacing
 *
 * Usage:
 *   <PageLayout>
 *     <Content />
 *   </PageLayout>
 *
 *   <PageLayout maxWidth="lg" header={<PageHeader title="Dashboard" />}>
 *     <Content />
 *   </PageLayout>
 */

"use client";

import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type MaxWidth = "sm" | "md" | "lg" | "xl" | "2xl" | "full" | "none";

const maxWidthClasses: Record<MaxWidth, string> = {
  sm: "max-w-screen-sm",
  md: "max-w-screen-md",
  lg: "max-w-screen-lg",
  xl: "max-w-screen-xl",
  "2xl": "max-w-screen-2xl",
  full: "max-w-full",
  none: "",
};

export interface PageLayoutProps {
  /** Page content */
  children: ReactNode;
  /** Optional header element (rendered above scrollable content) */
  header?: ReactNode;
  /** Maximum width constraint for content */
  maxWidth?: MaxWidth;
  /** Additional padding around content */
  padding?: "none" | "sm" | "md" | "lg";
  /** Background color variant */
  background?: "canvas" | "raised" | "transparent";
  /** Additional class names */
  className?: string;
  /** Class names for the content container */
  contentClassName?: string;
}

const paddingClasses = {
  none: "",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

const backgroundClasses = {
  canvas: "bg-surface-canvas",
  raised: "bg-surface-raised",
  transparent: "bg-transparent",
};

/**
 * PageLayout provides a standard scrollable page structure.
 *
 * The component fills its parent container (`h-full`) and manages scrolling
 * internally, so parent containers must have proper height constraints.
 *
 * @example
 * // Basic usage
 * <PageLayout>
 *   <h1>Page Title</h1>
 *   <p>Page content...</p>
 * </PageLayout>
 *
 * @example
 * // With header and max width
 * <PageLayout
 *   maxWidth="xl"
 *   header={<PageHeader title="Dashboard" />}
 * >
 *   <DashboardContent />
 * </PageLayout>
 */
export const PageLayout = forwardRef<HTMLDivElement, PageLayoutProps>(
  (
    {
      children,
      header,
      maxWidth = "none",
      padding = "md",
      background = "canvas",
      className,
      contentClassName,
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        className={cn(
          // Fill parent and establish flex column
          "h-full flex flex-col min-h-0",
          // Background
          backgroundClasses[background],
          className
        )}
      >
        {/* Fixed header (non-scrolling) */}
        {header && <div className="shrink-0">{header}</div>}

        {/* Scrollable content area */}
        <div
          className={cn(
            "flex-1 min-h-0 overflow-y-auto",
            "scrollbar-dark",
            paddingClasses[padding],
            contentClassName
          )}
        >
          {/* Content container with optional max width */}
          <div
            className={cn(
              maxWidthClasses[maxWidth],
              maxWidth !== "none" && maxWidth !== "full" && "mx-auto"
            )}
          >
            {children}
          </div>
        </div>
      </div>
    );
  }
);

PageLayout.displayName = "PageLayout";

export default PageLayout;
