import type { HookTrigger, HookActionType } from "@/lib/runner";
import { Terminal, Globe, MessageSquare, Bell } from "lucide-react";

export const TRIGGERS: {
  value: HookTrigger;
  label: string;
  description: string;
  color: string;
}[] = [
  {
    value: "pre_execution",
    label: "Pre-Execution",
    description: "Before task execution starts",
    color: "text-blue-400 border-blue-500/30 bg-blue-500/5",
  },
  {
    value: "post_execution",
    label: "Post-Execution",
    description: "After task execution completes",
    color: "text-green-400 border-green-500/30 bg-green-500/5",
  },
  {
    value: "on_error",
    label: "On Error",
    description: "When an error occurs",
    color: "text-red-400 border-red-500/30 bg-red-500/5",
  },
  {
    value: "on_verification_fail",
    label: "On Verification Fail",
    description: "When verification fails",
    color: "text-orange-400 border-orange-500/30 bg-orange-500/5",
  },
  {
    value: "on_complete",
    label: "On Complete",
    description: "When task completes successfully",
    color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5",
  },
  {
    value: "pre_iteration",
    label: "Pre-Iteration",
    description: "Before each iteration",
    color: "text-cyan-400 border-cyan-500/30 bg-cyan-500/5",
  },
  {
    value: "post_iteration",
    label: "Post-Iteration",
    description: "After each iteration",
    color: "text-purple-400 border-purple-500/30 bg-purple-500/5",
  },
];

export const ACTION_TYPES: {
  value: HookActionType;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
}[] = [
  {
    value: "command",
    label: "Shell Command",
    description: "Execute a shell command on the local system",
    icon: Terminal,
    color: "text-green-400",
  },
  {
    value: "webhook",
    label: "Webhook",
    description: "Send an HTTP request to a URL",
    icon: Globe,
    color: "text-blue-400",
  },
  {
    value: "log",
    label: "Log Message",
    description: "Log a message to the application logs",
    icon: MessageSquare,
    color: "text-amber-400",
  },
  {
    value: "notification",
    label: "System Notification",
    description: "Send a system notification",
    icon: Bell,
    color: "text-purple-400",
  },
];

export const CONDITION_VARIABLES = [
  { value: "task_run_id", label: "Task Run ID" },
  { value: "task_name", label: "Task Name" },
  { value: "iteration", label: "Iteration" },
  { value: "status", label: "Status" },
  { value: "error", label: "Error" },
];

export const CONDITION_OPERATORS = [
  { value: "eq", label: "equals" },
  { value: "ne", label: "not equals" },
  { value: "gt", label: "greater than" },
  { value: "lt", label: "less than" },
  { value: "gte", label: "greater or equal" },
  { value: "lte", label: "less or equal" },
  { value: "contains", label: "contains" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "matches", label: "matches regex" },
];
