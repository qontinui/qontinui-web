import { cn } from "@/lib/utils";
import { HelpButton } from "../HelpButton";
import { UserMenu, type UserMenuProps } from "../UserMenu";
import { CollapseToggle } from "../CollapseToggle";

interface SidebarFooterProps extends Omit<UserMenuProps, "isCollapsed"> {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export function SidebarFooter({
  isCollapsed,
  user,
  onLogout,
  onExport,
  onImport,
  onDocs,
  onToggleCollapse,
}: SidebarFooterProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col gap-1 border-t border-border-subtle p-2",
        isCollapsed && "items-center"
      )}
    >
      <HelpButton isCollapsed={isCollapsed} />
      <UserMenu
        isCollapsed={isCollapsed}
        user={user}
        onLogout={onLogout}
        onExport={onExport}
        onImport={onImport}
        onDocs={onDocs}
      />
      <CollapseToggle isCollapsed={isCollapsed} onToggle={onToggleCollapse} />
    </div>
  );
}
