import React from "react";
import type { OrgSkill } from "@/services/skill-sharing-service";
import { ApprovalBadge } from "./ApprovalBadge";

export function SkillMetadata({ skill }: { skill: OrgSkill }) {
  return (
    <>
      {skill.version && skill.version !== "1.0.0" && (
        <span className="text-xs text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded">
          v{skill.version}
        </span>
      )}
      {skill.author && (
        <span className="text-xs text-zinc-500">by {skill.author.name}</span>
      )}
      {skill.approval_status && (
        <ApprovalBadge status={skill.approval_status} />
      )}
      {(skill.usage_count ?? 0) > 0 && (
        <span className="text-xs text-zinc-600">
          {skill.usage_count} {skill.usage_count === 1 ? "use" : "uses"}
        </span>
      )}
    </>
  );
}
