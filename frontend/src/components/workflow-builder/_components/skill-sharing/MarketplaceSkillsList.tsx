import React from "react";
import { SkillMetadata } from "./SkillMetadata";
import type { MarketplaceSkillsListProps } from "./types";

const MARKETPLACE_CATEGORIES = [
  { value: "", label: "All Categories" },
  { value: "custom", label: "Custom" },
  { value: "automation", label: "Automation" },
  { value: "testing", label: "Testing" },
  { value: "data", label: "Data" },
  { value: "integration", label: "Integration" },
  { value: "utility", label: "Utility" },
];

export function MarketplaceSkillsList({
  skills,
  total,
  search,
  category,
  actionInProgress,
  onSearchChange,
  onCategoryChange,
  onFork,
}: MarketplaceSkillsListProps) {
  return (
    <div className="space-y-3">
      <div className="flex gap-2 px-1">
        <input
          type="text"
          placeholder="Search skills..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="flex-1 px-2.5 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
        />
        <select
          value={category}
          onChange={(e) => onCategoryChange(e.target.value)}
          className="px-2 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:border-blue-500"
        >
          {MARKETPLACE_CATEGORIES.map((cat) => (
            <option key={cat.value} value={cat.value}>
              {cat.label}
            </option>
          ))}
        </select>
      </div>

      <p className="text-[10px] text-zinc-600 px-1">
        {total} skill{total !== 1 ? "s" : ""} available
      </p>

      {skills.length === 0 ? (
        <p className="text-sm text-zinc-500 py-4 text-center">
          {search || category
            ? "No skills match your filters."
            : "No community skills available yet."}
        </p>
      ) : (
        <div className="space-y-1">
          {skills.map((skill) => (
            <div
              key={skill.id}
              className="flex items-center px-3 py-2 rounded-md hover:bg-zinc-800/50"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm text-zinc-200">{skill.name}</span>
                  <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-blue-900/30 text-blue-400">
                    {skill.category}
                  </span>
                  <SkillMetadata skill={skill} />
                </div>
                <p className="text-xs text-zinc-500 truncate">
                  {skill.description}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 ml-3">
                <button
                  onClick={() => onFork(skill.id)}
                  disabled={actionInProgress === skill.id}
                  className="text-xs text-blue-400 hover:text-blue-300 px-2.5 py-1 rounded bg-blue-900/20 hover:bg-blue-900/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Fork this skill into your collection"
                >
                  {actionInProgress === skill.id ? "..." : "Fork"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
