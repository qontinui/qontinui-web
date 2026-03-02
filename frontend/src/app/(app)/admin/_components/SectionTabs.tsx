import {
  Users,
  FolderOpen,
  BarChart3,
  HeartPulse,
  Settings,
  Bell,
  Download,
} from "lucide-react";
import type { Section } from "../_hooks/useAdminGuard";

const SECTION_TABS = [
  { key: "users" as const, label: "Users", icon: Users },
  { key: "projects" as const, label: "Projects", icon: FolderOpen },
  { key: "analytics" as const, label: "Analytics", icon: BarChart3 },
  { key: "health" as const, label: "Health", icon: HeartPulse },
  { key: "system" as const, label: "System", icon: Settings },
  { key: "notifications" as const, label: "Notifications", icon: Bell },
  { key: "downloads" as const, label: "Downloads", icon: Download },
];

interface SectionTabsProps {
  activeSection: Section;
  onSectionChange: (section: Section) => void;
  userCount: number;
  projectCount: number;
}

export function SectionTabs({
  activeSection,
  onSectionChange,
  userCount,
  projectCount,
}: SectionTabsProps) {
  return (
    <div
      className="flex items-center gap-1 px-6 py-2 border-b border-border shrink-0"
      data-ui-id="admin-section-tabs"
    >
      {SECTION_TABS.map(({ key, label, icon: Icon }) => {
        let displayLabel = label;
        if (key === "users") displayLabel = `Users (${userCount})`;
        if (key === "projects") displayLabel = `Projects (${projectCount})`;

        return (
          <button
            key={key}
            onClick={() => onSectionChange(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeSection === key
                ? "bg-primary text-primary-foreground font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
            data-ui-id={`admin-section-${key}-btn`}
          >
            <Icon className="h-3.5 w-3.5" />
            {displayLabel}
          </button>
        );
      })}
    </div>
  );
}
