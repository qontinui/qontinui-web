import React from "react";
import type { SkillSharingTabsProps, SkillSharingTab } from "./types";

const TABS: { key: SkillSharingTab; label: string }[] = [
  { key: "my-skills", label: "My Skills" },
  { key: "org-skills", label: "Organization" },
  { key: "marketplace", label: "Marketplace" },
];

export function SkillSharingTabs({
  tab,
  onTabChange,
  hasOrganization,
}: SkillSharingTabsProps) {
  return (
    <div className="flex gap-2 border-b border-zinc-800 px-1">
      {TABS.map(({ key, label }) => (
        <button
          key={key}
          className={`px-3 py-1.5 text-xs rounded-t transition-colors ${
            tab === key
              ? "bg-zinc-800 text-zinc-200 border-b-2 border-blue-500"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
          onClick={() => onTabChange(key)}
          disabled={key === "org-skills" && !hasOrganization}
          title={
            key === "org-skills" && !hasOrganization
              ? "Join an organization to browse shared skills"
              : undefined
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}
