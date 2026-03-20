/**
 * Explorer Panel Components
 *
 * Reusable panel components for state/element explorer views.
 * Used by StateExplorerView and PlaywrightStateExplorerView.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { LucideIcon } from "lucide-react";

export type ExplorerPanelAccent = "primary" | "secondary" | "success";

interface ExplorerPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Color accent for the panel
   */
  accent?: ExplorerPanelAccent;
  /**
   * Width class for the panel (e.g., "w-[16%]", "flex-1")
   */
  width?: string;
}

/**
 * Explorer panel container with accent color
 */
export function ExplorerPanel({
  accent = "primary",
  width,
  className,
  children,
  ...props
}: ExplorerPanelProps) {
  return (
    <div
      className={cn(
        "explorer-panel",
        `explorer-panel-${accent}`,
        width,
        "h-full",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface ExplorerPanelHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Panel title
   */
  title: string;
  /**
   * Optional icon component
   */
  icon?: LucideIcon;
  /**
   * Color accent (should match parent panel)
   */
  accent?: ExplorerPanelAccent;
  /**
   * Optional actions to render on the right side
   */
  actions?: React.ReactNode;
}

const accentIconColors = {
  primary: "text-brand-primary",
  secondary: "text-brand-secondary",
  success: "text-brand-success",
};

/**
 * Explorer panel header with icon and title
 */
export function ExplorerPanelHeader({
  title,
  icon: Icon,
  accent = "primary",
  actions,
  className,
  children,
  ...props
}: ExplorerPanelHeaderProps) {
  return (
    <div className={cn("explorer-panel-header", className)} {...props}>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {Icon && (
          <Icon className={cn("w-4 h-4 shrink-0", accentIconColors[accent])} />
        )}
        <h3
          className={cn(
            "explorer-panel-header-title",
            accentIconColors[accent]
          )}
        >
          {title}
        </h3>
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0">{actions}</div>
      )}
      {children}
    </div>
  );
}

interface ExplorerPanelContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Whether to enable scrolling
   */
  scrollable?: boolean;
  /**
   * Padding inside the content area
   */
  padding?: "none" | "sm" | "md";
}

/**
 * Explorer panel content area with optional scrolling
 */
export function ExplorerPanelContent({
  scrollable = true,
  padding = "sm",
  className,
  children,
  ...props
}: ExplorerPanelContentProps) {
  const paddingClasses = {
    none: "",
    sm: "p-3",
    md: "p-4",
  };

  if (scrollable) {
    return (
      <div
        className={cn("explorer-panel-content", "overflow-hidden", className)}
      >
        <ScrollArea className="h-full w-full">
          <div className={paddingClasses[padding]} {...props}>
            {children}
          </div>
        </ScrollArea>
      </div>
    );
  }

  // When scrollable=false, children manage their own scrolling.
  // For padding="none", skip the wrapper to allow children with overflow-auto
  // to scroll properly. The explorer-panel-content class provides flex-1 min-h-0.
  // overflow-hidden is needed for absolute positioned children (inset: 0) to work correctly.
  if (padding === "none") {
    return (
      <div
        className={cn("explorer-panel-content", "overflow-hidden", className)}
        {...props}
      >
        {children}
      </div>
    );
  }

  // When padding is needed, add a wrapper with the padding class
  return (
    <div className={cn("explorer-panel-content", "flex flex-col", className)}>
      <div
        className={cn("flex-1 min-h-0 flex flex-col", paddingClasses[padding])}
        {...props}
      >
        {children}
      </div>
    </div>
  );
}

interface ExplorerPanelGridProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Number of columns in the grid
   */
  columns?: 1 | 2 | 3;
  /**
   * Gap between grid items
   */
  gap?: "sm" | "md";
}

/**
 * Grid layout for panel content items
 */
export function ExplorerPanelGrid({
  columns = 2,
  gap = "sm",
  className,
  children,
  ...props
}: ExplorerPanelGridProps) {
  const columnClasses = {
    1: "grid-cols-1",
    2: "grid-cols-2",
    3: "grid-cols-3",
  };

  const gapClasses = {
    sm: "gap-2",
    md: "gap-3",
  };

  return (
    <div
      className={cn("grid", columnClasses[columns], gapClasses[gap], className)}
      {...props}
    >
      {children}
    </div>
  );
}

interface ExplorerPanelListProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Gap between list items
   */
  gap?: "sm" | "md";
}

/**
 * Vertical list layout for panel content items
 */
export function ExplorerPanelList({
  gap = "sm",
  className,
  children,
  ...props
}: ExplorerPanelListProps) {
  const gapClasses = {
    sm: "space-y-2",
    md: "space-y-3",
  };

  return (
    <div className={cn(gapClasses[gap], className)} {...props}>
      {children}
    </div>
  );
}

interface ExplorerPanelItemProps extends React.HTMLAttributes<HTMLButtonElement> {
  /**
   * Whether the item is selected
   */
  selected?: boolean;
  /**
   * Whether the item is hovered (for external hover state control)
   */
  hovered?: boolean;
  /**
   * Color accent for selection highlight
   */
  accent?: ExplorerPanelAccent;
}

/**
 * Selectable item within a panel
 */
export function ExplorerPanelItem({
  selected = false,
  hovered = false,
  accent = "primary",
  className,
  children,
  ...props
}: ExplorerPanelItemProps) {
  const accentColors = {
    primary: {
      selected:
        "border-brand-primary bg-brand-primary/20 shadow-[0_0_15px_rgba(74,144,217,0.2)]",
      hovered: "border-brand-primary/50 bg-brand-primary/10",
      default:
        "border-border-subtle bg-surface-canvas/50 hover:border-brand-primary/40 hover:bg-brand-primary/5",
    },
    secondary: {
      selected:
        "border-brand-secondary bg-brand-secondary/20 shadow-[0_0_15px_rgba(139,107,181,0.2)]",
      hovered: "border-brand-secondary/50 bg-brand-secondary/10",
      default:
        "border-border-subtle bg-surface-canvas/50 hover:border-brand-secondary/40 hover:bg-brand-secondary/5",
    },
    success: {
      selected:
        "border-brand-success bg-brand-success/20 shadow-[0_0_15px_rgba(77,184,157,0.2)]",
      hovered: "border-brand-success/50 bg-brand-success/10",
      default:
        "border-border-subtle bg-surface-canvas/50 hover:border-brand-success/40 hover:bg-brand-success/5",
    },
  };

  const colors = accentColors[accent];

  return (
    <button
      className={cn(
        "w-full p-3 rounded-lg border text-left transition-all",
        selected ? colors.selected : hovered ? colors.hovered : colors.default,
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

interface ExplorerPanelThumbnailProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Whether the thumbnail is selected
   */
  selected?: boolean;
  /**
   * Whether the thumbnail is hovered
   */
  hovered?: boolean;
  /**
   * Color accent for selection highlight
   */
  accent?: ExplorerPanelAccent;
  /**
   * Aspect ratio of the thumbnail
   */
  aspectRatio?: "video" | "square";
}

/**
 * Thumbnail container for images/screenshots
 */
export function ExplorerPanelThumbnail({
  selected = false,
  hovered = false,
  accent = "primary",
  aspectRatio = "video",
  className,
  children,
  onClick,
  ...props
}: ExplorerPanelThumbnailProps) {
  const accentColors = {
    primary: {
      selected:
        "border-brand-primary shadow-[0_0_15px_rgba(74,144,217,0.2)] ring-1 ring-brand-primary/50",
      hovered: "border-brand-primary/50",
      default: "border-border-subtle hover:border-brand-primary/40",
    },
    secondary: {
      selected:
        "border-brand-secondary shadow-[0_0_15px_rgba(139,107,181,0.2)] ring-1 ring-brand-secondary/50",
      hovered: "border-brand-secondary/50",
      default: "border-border-subtle hover:border-brand-secondary/40",
    },
    success: {
      selected:
        "border-brand-success shadow-[0_0_15px_rgba(77,184,157,0.2)] ring-1 ring-brand-success/50",
      hovered: "border-brand-success/50",
      default: "border-border-subtle hover:border-brand-success/40",
    },
  };

  const aspectClasses = {
    video: "aspect-video",
    square: "aspect-square",
  };

  const colors = accentColors[accent];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(e as unknown as React.MouseEvent<HTMLDivElement>); } }}
      className={cn(
        "rounded-lg border cursor-pointer transition-all overflow-hidden",
        aspectClasses[aspectRatio],
        selected ? colors.selected : hovered ? colors.hovered : colors.default,
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface ExplorerPanelEmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Message to display
   */
  message: string;
  /**
   * Optional icon component
   */
  icon?: LucideIcon;
}

/**
 * Empty state placeholder for panels
 */
export function ExplorerPanelEmptyState({
  message,
  icon: Icon,
  className,
  ...props
}: ExplorerPanelEmptyStateProps) {
  return (
    <div className={cn("empty-state", className)} {...props}>
      {Icon && <Icon className="empty-state-icon" />}
      <p className="text-xs font-mono uppercase tracking-widest">{message}</p>
    </div>
  );
}
