import React from "react";
import { SkillMetadata } from "./SkillMetadata";
import type { OrgSkillsListProps } from "./types";
import { DestructiveButton } from "@/components/ui/destructive-button";

export function OrgSkillsList({
  skills,
  actionInProgress,
  onFork,
  onApprove,
}: OrgSkillsListProps) {
  if (skills.length === 0) {
    return (
      <p className="text-sm text-zinc-500 py-4 text-center">
        No shared skills in this organization yet.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {skills.map((skill) => (
        <div
          key={skill.id}
          className="flex items-center px-3 py-2 rounded-md hover:bg-zinc-800/50"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm text-zinc-200">{skill.name}</span>
              <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-purple-900/30 text-purple-400">
                Shared
              </span>
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
              title="Fork this skill into your collection"
            >
              {actionInProgress === skill.id ? "..." : "Fork"}
            </button>
            {skill.approval_status !== "approved" && (
              <DestructiveButton
                onClick={() => onApprove(skill.id, "approved")}
                disabled={actionInProgress === skill.id}
                className="text-xs text-green-400 hover:text-green-300 px-2 py-1 rounded hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Approve this skill"
              >
                Approve
              </DestructiveButton>
            )}
            {skill.approval_status !== "rejected" && (
              <DestructiveButton
                onClick={() => onApprove(skill.id, "rejected")}
                disabled={actionInProgress === skill.id}
                className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Reject this skill"
              >
                Reject
              </DestructiveButton>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
