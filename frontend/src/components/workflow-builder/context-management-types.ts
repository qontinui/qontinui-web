import type { ContextItem } from "@/lib/runner/types/exploration";

export type ContextScope = "project" | "user" | "builtin";

export interface AutoDetectResult {
  contextId: string;
  contextName: string;
  reason: string;
  matchedTrigger: string;
}

export interface IncludedContext {
  context: ContextItem;
  isAutoIncluded: boolean;
  autoIncludeReason?: string;
}

export const SCOPE_ORDER: ContextScope[] = ["builtin", "user", "project"];

export const SCOPE_VARIANT: Record<
  ContextScope,
  "info" | "success" | "default"
> = {
  builtin: "info",
  user: "success",
  project: "default",
};

export function groupByScope(
  items: ContextItem[]
): Record<ContextScope, ContextItem[]> {
  return {
    builtin: items.filter((c) => c.scope === "builtin"),
    user: items.filter((c) => c.scope === "user"),
    project: items.filter((c) => c.scope === "project"),
  };
}

export function evaluateAutoInclude(
  description: string,
  contexts: ContextItem[]
): AutoDetectResult[] {
  if (!description.trim()) return [];

  const descLower = description.toLowerCase();
  const results: AutoDetectResult[] = [];

  for (const ctx of contexts) {
    if (ctx.enabled === false) continue;
    const mentions = ctx.autoInclude?.taskMentions;
    if (!mentions || mentions.length === 0) continue;

    for (const mention of mentions) {
      if (mention && descLower.includes(mention.toLowerCase())) {
        results.push({
          contextId: ctx.id,
          contextName: ctx.name,
          reason: "taskMention",
          matchedTrigger: mention,
        });
        break;
      }
    }
  }

  return results;
}
