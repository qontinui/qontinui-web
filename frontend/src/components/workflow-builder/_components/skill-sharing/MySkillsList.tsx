import React from "react";
import { SkillMetadata } from "./SkillMetadata";
import type { MySkillsListProps } from "./types";

export function MySkillsList({
  skills,
  togglingId,
  actionInProgress,
  hasOrg,
  onToggleShare,
  onFork,
}: MySkillsListProps) {
  if (skills.length === 0) {
    return (
      <p className="text-sm text-zinc-500 py-4 text-center">
        No custom skills yet. Create skills in the workflow builder to share
        them.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {skills.map((skill) => (
        <div
          key={skill.id}
          className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-zinc-800/50"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm text-zinc-200">{skill.name}</span>
              <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-zinc-800 text-zinc-500">
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
              className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Fork this skill"
            >
              {actionInProgress === skill.id ? "..." : "Fork"}
            </button>
            <button
              onClick={() => onToggleShare(skill.id, skill.is_shared)}
              disabled={togglingId === skill.id || !hasOrg}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                skill.is_shared
                  ? "bg-green-900/30 text-green-400 hover:bg-green-900/50"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
              title={
                !hasOrg
                  ? "Join an organization to share skills"
                  : skill.is_shared
                    ? "Click to unshare"
                    : "Click to share with organization"
              }
            >
              {togglingId === skill.id
                ? "..."
                : skill.is_shared
                  ? "Shared"
                  : "Share"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
