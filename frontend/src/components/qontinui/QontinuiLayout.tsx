import * as React from "react";
import { cn } from "@/lib/utils";
import { styles } from "@/config/theme";

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
export function QontinuiPage({ className, children, ...props }: QontinuiPageProps) {
  return (
    <div
      className={cn(
        "h-screen bg-[#0A0A0B] text-white flex flex-col overflow-hidden",
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
export function QontinuiHeader({ className, children, ...props }: QontinuiHeaderProps) {
  return (
    <header
      className={cn(styles.header, "px-6 py-4", className)}
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
        className={cn("text-2xl font-semibold text-white", className)}
        {...props}
      >
        {children}
      </h1>
      {subtitle && (
        <p className="text-gray-400 text-sm mt-1">{subtitle}</p>
      )}
    </div>
  );
}

interface QontinuiHeaderActionsProps extends React.ComponentProps<"div"> {}

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

interface QontinuiMainProps extends React.ComponentProps<"main"> {}

/**
 * Main content area with scrolling
 */
export function QontinuiMain({ className, children, ...props }: QontinuiMainProps) {
  return (
    <main
      className={cn("flex-1 overflow-auto bg-[#0A0A0B]", className)}
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
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "full";
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
      className={cn(maxWidthClasses[maxWidth as keyof typeof maxWidthClasses], "mx-auto p-6", className)}
      {...props}
    >
      {children}
    </div>
  );
}

interface QontinuiSidebarProps extends React.ComponentProps<"aside"> {}

/**
 * Themed sidebar with dark panel background
 */
export function QontinuiSidebar({ className, children, ...props }: QontinuiSidebarProps) {
  return (
    <aside
      className={cn(styles.sidebar, "w-64 p-4 overflow-y-auto", className)}
      {...props}
    >
      {children}
    </aside>
  );
}

interface QontinuiToolbarProps extends React.ComponentProps<"div"> {}

/**
 * Toolbar section (similar to header but can be used anywhere)
 */
export function QontinuiToolbar({ className, children, ...props }: QontinuiToolbarProps) {
  return (
    <div
      className={cn(styles.toolbar, "px-6 py-3", className)}
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
          {title && <h2 className="text-lg font-semibold text-white">{title}</h2>}
          {description && <p className="text-sm text-gray-400">{description}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * Example usage:
 *
 * <QontinuiPage>
 *   <QontinuiHeader>
 *     <div className="flex items-center justify-between">
 *       <QontinuiHeaderTitle subtitle="Manage your automation">
 *         My Page
 *       </QontinuiHeaderTitle>
 *       <QontinuiHeaderActions>
 *         <CreateButton>Create New</CreateButton>
 *       </QontinuiHeaderActions>
 *     </div>
 *   </QontinuiHeader>
 *
 *   <div className="flex flex-1 overflow-hidden">
 *     <QontinuiSidebar>
 *       Sidebar content
 *     </QontinuiSidebar>
 *
 *     <QontinuiMain>
 *       <QontinuiContainer>
 *         <QontinuiSection title="My Section" description="Section description">
 *           Content here
 *         </QontinuiSection>
 *       </QontinuiContainer>
 *     </QontinuiMain>
 *   </div>
 * </QontinuiPage>
 */
