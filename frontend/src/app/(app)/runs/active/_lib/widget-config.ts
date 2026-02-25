import type { CurrentExecutionStepsResponse } from "@/lib/runner";
import {
  Clock,
  MessageSquare,
  Bug,
  ShieldCheck,
  Gauge,
  Terminal,
  Monitor,
  GitBranch,
} from "lucide-react";

export type WidgetId =
  | "timeline"
  | "flow-execution"
  | "command"
  | "ui-bridge"
  | "ai-conversation"
  | "verification"
  | "findings"
  | "status";

export interface WidgetConfig {
  id: WidgetId;
  label: string;
  icon: typeof Clock;
  accentColor: string;
  textColor: string;
  bgColor: string;
  borderColor: string;
  priority: number;
}

export const WIDGET_CONFIGS: WidgetConfig[] = [
  {
    id: "timeline",
    label: "Timeline",
    icon: Clock,
    accentColor: "cyan",
    textColor: "text-cyan-400",
    bgColor: "bg-cyan-500/10",
    borderColor: "border-cyan-500/40",
    priority: 5,
  },
  {
    id: "flow-execution",
    label: "Flow Execution",
    icon: GitBranch,
    accentColor: "rose",
    textColor: "text-rose-400",
    bgColor: "bg-rose-500/10",
    borderColor: "border-rose-500/40",
    priority: 8,
  },
  {
    id: "command",
    label: "Commands",
    icon: Terminal,
    accentColor: "slate",
    textColor: "text-slate-400",
    bgColor: "bg-slate-500/10",
    borderColor: "border-slate-500/40",
    priority: 12,
  },
  {
    id: "ui-bridge",
    label: "UI Bridge",
    icon: Monitor,
    accentColor: "emerald",
    textColor: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/40",
    priority: 14,
  },
  {
    id: "ai-conversation",
    label: "AI Conversation",
    icon: MessageSquare,
    accentColor: "green",
    textColor: "text-green-400",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/40",
    priority: 20,
  },
  {
    id: "verification",
    label: "Verification",
    icon: ShieldCheck,
    accentColor: "teal",
    textColor: "text-teal-400",
    bgColor: "bg-teal-500/10",
    borderColor: "border-teal-500/40",
    priority: 25,
  },
  {
    id: "findings",
    label: "Findings",
    icon: Bug,
    accentColor: "amber",
    textColor: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/40",
    priority: 30,
  },
  {
    id: "status",
    label: "Execution Status",
    icon: Gauge,
    accentColor: "cyan",
    textColor: "text-cyan-400",
    bgColor: "bg-cyan-500/10",
    borderColor: "border-cyan-500/40",
    priority: 35,
  },
];

export function getWidgetConfig(id: WidgetId): WidgetConfig {
  return WIDGET_CONFIGS.find((w) => w.id === id)!;
}

/** Step types that map to the unified "command" widget */
const commandStepTypes = [
  "command",
  "shell_command",
  "shell",
  "check",
  "check_group",
  "test",
  "api_request",
  "api_call",
  "http_request",
  "http",
  "mcp_call",
  "mcp",
  "tool_call",
  "script",
  "python",
  "node",
  "script_execution",
  "bash",
  "cmd",
  "powershell",
];

/** Step types that map to the "ui-bridge" widget */
const uiBridgeStepTypes = ["ui_bridge", "uibridge"];

/** Step types that map to the "verification" widget */
const verificationStepTypes = [
  "playwright",
  "verification",
  "error_check",
  "log_check",
  "repo_test",
];

/** Step types that map to the "flow-execution" widget */
const flowStepTypes = ["flow", "flow_execution", "state_machine"];

export function detectWidgets(
  stepsData: CurrentExecutionStepsResponse | null
): WidgetId[] {
  // Always-present widgets
  const widgets: WidgetId[] = [
    "timeline",
    "ai-conversation",
    "status",
    "findings",
  ];

  if (!stepsData?.executions) {
    return widgets.sort(
      (a, b) => getWidgetConfig(a).priority - getWidgetConfig(b).priority
    );
  }

  const stepTypes = new Set(
    stepsData.executions.map((e) => e.step_type.toLowerCase())
  );

  if (commandStepTypes.some((t) => stepTypes.has(t))) {
    widgets.push("command");
  }

  if (uiBridgeStepTypes.some((t) => stepTypes.has(t))) {
    widgets.push("ui-bridge");
  }

  if (
    verificationStepTypes.some((t) => stepTypes.has(t)) ||
    [...stepTypes].some(
      (t) => t.includes("check") || t.includes("verification")
    )
  ) {
    widgets.push("verification");
  }

  if (flowStepTypes.some((t) => stepTypes.has(t))) {
    widgets.push("flow-execution");
  }

  // Ensure minimum widget set when few detected
  if (widgets.length <= 4) {
    if (!widgets.includes("command")) widgets.push("command");
    if (!widgets.includes("verification")) widgets.push("verification");
  }

  const unique = [...new Set(widgets)];
  return unique.sort(
    (a, b) => getWidgetConfig(a).priority - getWidgetConfig(b).priority
  );
}
