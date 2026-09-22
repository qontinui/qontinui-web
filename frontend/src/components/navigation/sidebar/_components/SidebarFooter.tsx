import { cn } from "@/lib/utils";
import { UserMenu, type UserMenuProps } from "../UserMenu";
import { CollapseToggle } from "../CollapseToggle";
import { RunnerSelector } from "./RunnerSelector";

interface SidebarFooterProps extends Omit<UserMenuProps, "isCollapsed"> {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  /** Overrides the collapse control's wording — see `CollapseToggle`. */
  toggleLabel?: string;
  /** Set when the collapse control is the drawer's disclosure button. */
  toggleControlsDrawer?: { open: boolean; id: string };
}

/**
 * Two rows: identity (the user menu), then shell state — the runner status
 * line beside the collapse toggle. The footer is not a home for feature entry
 * points; it holds identity, shell state and at most one passive status line.
 * Collapsed, the same two rows stack into a single column of icons.
 */
export function SidebarFooter({
  isCollapsed,
  user,
  onLogout,
  onDocs,
  onToggleCollapse,
  toggleLabel,
  toggleControlsDrawer,
}: SidebarFooterProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col gap-1 border-t border-border-subtle p-2",
        isCollapsed && "items-center"
      )}
    >
      <UserMenu
        isCollapsed={isCollapsed}
        user={user}
        onLogout={onLogout}
        onDocs={onDocs}
      />
      <div
        data-ui-bridge-id="shell.sidebar-footer-status"
        className={cn(
          "flex gap-1",
          isCollapsed ? "flex-col items-center" : "items-center"
        )}
      >
        <div className={cn(!isCollapsed && "min-w-0 flex-1")}>
          <RunnerSelector isCollapsed={isCollapsed} />
        </div>
        <CollapseToggle
          isCollapsed={isCollapsed}
          onToggle={onToggleCollapse}
          label={toggleLabel}
          controlsDrawer={toggleControlsDrawer}
        />
      </div>
    </div>
  );
}
