import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Qontinui page layout components
 * Pre-styled layout components following the dark theme aesthetic
 */

interface QontinuiPageProps extends React.ComponentProps<"div"> {
  children: React.ReactNode;
}

/**
 * Full-screen page container with dark canvas background
 */
export function QontinuiPage({
  className,
  children,
  ...props
}: QontinuiPageProps) {
  return (
    <div
      className={cn(
        "h-screen bg-surface-canvas text-white flex flex-col overflow-hidden",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface QontinuiHeaderProps extends React.ComponentProps<"header"> {
  children: React.ReactNode;
}

/**
 * Themed header with dark panel background and border
 */
export function QontinuiHeader({
  className,
  children,
  ...props
}: QontinuiHeaderProps) {
  return (
    <header
      className={cn("bg-surface-raised border-b border-border-subtle px-6 py-4", className)}
      {...props}
    >
      {children}
    </header>
  );
}

interface QontinuiHeaderTitleProps extends React.ComponentProps<"h1"> {
  /**
   * Optional subtitle below the title
   */
  subtitle?: string;
}

/**
 * Page title with optional subtitle
 */
export function QontinuiHeaderTitle({
  className,
  subtitle,
  children,
  ...props
}: QontinuiHeaderTitleProps) {
  return (
    <div>
      <h1
        className={cn("text-h2 text-foreground", className)}
        {...props}
      >
        {children}
      </h1>
      {subtitle && <p className="text-caption mt-1">{subtitle}</p>}
    </div>
  );
}

type QontinuiHeaderActionsProps = React.ComponentProps<"div">;

/**
 * Container for header actions (buttons, etc.)
 */
export function QontinuiHeaderActions({
  className,
  children,
  ...props
}: QontinuiHeaderActionsProps) {
  return (
    <div className={cn("flex items-center gap-3", className)} {...props}>
      {children}
    </div>
  );
}

type QontinuiMainProps = React.ComponentProps<"main">;

/**
 * Main content area with scrolling
 */
export function QontinuiMain({
  className,
  children,
  ...props
}: QontinuiMainProps) {
  return (
    <main
      className={cn("flex-1 overflow-auto bg-surface-canvas", className)}
      {...props}
    >
      {children}
    </main>
  );
}

interface QontinuiContainerProps extends React.ComponentProps<"div"> {
  /**
   * Maximum width of the container
   */
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "7xl" | "full";
}

/**
 * Centered container with max width
 */
export function QontinuiContainer({
  className,
  maxWidth = "7xl",
  children,
  ...props
}: QontinuiContainerProps) {
  const maxWidthClasses = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    "2xl": "max-w-2xl",
    full: "max-w-full",
    "7xl": "max-w-7xl",
  };

  return (
    <div
      className={cn(
        maxWidthClasses[maxWidth as keyof typeof maxWidthClasses],
        "mx-auto p-6",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

type QontinuiSidebarProps = React.ComponentProps<"aside">;

/**
 * Themed sidebar with dark panel background
 */
export function QontinuiSidebar({
  className,
  children,
  ...props
}: QontinuiSidebarProps) {
  return (
    <aside
      className={cn("bg-surface-raised/50 border-r border-border-subtle w-64 p-4 overflow-y-auto", className)}
      {...props}
    >
      {children}
    </aside>
  );
}

type QontinuiToolbarProps = React.ComponentProps<"div">;

/**
 * Toolbar section (similar to header but can be used anywhere)
 */
export function QontinuiToolbar({
  className,
  children,
  ...props
}: QontinuiToolbarProps) {
  return (
    <div
      className={cn("bg-surface-raised border-b border-border-subtle px-6 py-3", className)}
      {...props}
    >
      {children}
    </div>
  );
}

interface QontinuiSectionProps extends React.ComponentProps<"section"> {
  /**
   * Optional section title
   */
  title?: string;
  /**
   * Optional section description
   */
  description?: string;
}

/**
 * Content section with optional title and description
 */
export function QontinuiSection({
  className,
  title,
  description,
  children,
  ...props
}: QontinuiSectionProps) {
  return (
    <section className={cn("space-y-4", className)} {...props}>
      {(title || description) && (
        <div className="space-y-1">
          {title && (
            <h2 className="text-h3 text-foreground">{title}</h2>
          )}
          {description && (
            <p className="text-body-sm text-muted-foreground">{description}</p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}
