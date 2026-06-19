import { cn } from "@/lib/utils";
import { HelpButton } from "../HelpButton";
import { UserMenu, type UserMenuProps } from "../UserMenu";
import { CollapseToggle } from "../CollapseToggle";
import { RunnerSelector } from "./RunnerSelector";
import { MentionNotificationsDropdown } from "@/app/(app)/strategy/_components/MentionNotificationsDropdown";

interface SidebarFooterProps extends Omit<UserMenuProps, "isCollapsed"> {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export function SidebarFooter({
  isCollapsed,
  user,
  onLogout,
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
      <RunnerSelector isCollapsed={isCollapsed} />
      {/* Strategy Phase 2.5 — bell + unread-mention dropdown. Sits
          adjacent to the user menu so it surfaces near the
          identity context. Hidden in the dropdown content when the
          user has no unread mentions (the trigger stays so the
          user can click to confirm "nothing here"). */}
      {user && (
        <MentionNotificationsDropdown isCollapsed={isCollapsed} />
      )}
      <HelpButton isCollapsed={isCollapsed} />
      <UserMenu
        isCollapsed={isCollapsed}
        user={user}
        onLogout={onLogout}
        onDocs={onDocs}
      />
      <CollapseToggle isCollapsed={isCollapsed} onToggle={onToggleCollapse} />
    </div>
  );
}
