import type { HookTrigger, HookActionType } from "@/lib/runner";
import { TRIGGERS, ACTION_TYPES } from "./constants";

export function getTriggerInfo(trigger: HookTrigger) {
  return TRIGGERS.find((t) => t.value === trigger) ?? TRIGGERS[0]!;
}

export function getActionTypeInfo(actionType: HookActionType) {
  return ACTION_TYPES.find((a) => a.value === actionType) ?? ACTION_TYPES[0]!;
}

export function getTriggerBadgeVariant(trigger: HookTrigger) {
  switch (trigger) {
    case "pre_execution":
      return "info" as const;
    case "post_execution":
      return "success" as const;
    case "on_error":
      return "destructive" as const;
    case "on_verification_fail":
      return "warning" as const;
    case "on_complete":
      return "success" as const;
    case "pre_iteration":
      return "secondary" as const;
    case "post_iteration":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

export function getActionSummary(
  actionType: HookActionType,
  config: Record<string, unknown>
): string {
  switch (actionType) {
    case "command":
      return String(config.command ?? "").slice(0, 60);
    case "webhook":
      return `${config.method ?? "POST"} ${String(config.url ?? "").slice(0, 50)}`;
    case "log":
      return `[${config.level ?? "info"}] ${String(config.message ?? "").slice(0, 50)}`;
    case "notification":
      return String(config.title ?? "").slice(0, 60);
    default:
      return "";
  }
}
