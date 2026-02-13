import type { CurrentExecutionStepsResponse } from "@/lib/runner";
import {
  Activity,
  Clock,
  MessageSquare,
  Bug,
  ShieldCheck,
  Gauge,
  Plug,
  Camera,
  Terminal,
  Globe,
  FileCode,
  GitBranch,
} from "lucide-react";

export type WidgetId =
  | "timeline"
  | "ai-conversation"
  | "screenshots"
  | "verification"
  | "findings"
  | "mcp-calls"
  | "status"
  | "shell-command"
  | "api-request"
  | "script"
  | "workflow-ref"
  | "flow-execution";

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
    id: "screenshots",
    label: "Screenshots",
    icon: Camera,
    accentColor: "blue",
    textColor: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/40",
    priority: 10,
  },
  {
    id: "verification",
    label: "Verification",
    icon: ShieldCheck,
    accentColor: "teal",
    textColor: "text-teal-400",
    bgColor: "bg-teal-500/10",
    borderColor: "border-teal-500/40",
    priority: 15,
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
    id: "mcp-calls",
    label: "MCP Calls",
    icon: Plug,
    accentColor: "violet",
    textColor: "text-violet-400",
    bgColor: "bg-violet-500/10",
    borderColor: "border-violet-500/40",
    priority: 24,
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
  {
    id: "shell-command",
    label: "Shell Commands",
    icon: Terminal,
    accentColor: "orange",
    textColor: "text-orange-400",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/40",
    priority: 22,
  },
  {
    id: "api-request",
    label: "API Requests",
    icon: Globe,
    accentColor: "sky",
    textColor: "text-sky-400",
    bgColor: "bg-sky-500/10",
    borderColor: "border-sky-500/40",
    priority: 23,
  },
  {
    id: "script",
    label: "Scripts",
    icon: FileCode,
    accentColor: "lime",
    textColor: "text-lime-400",
    bgColor: "bg-lime-500/10",
    borderColor: "border-lime-500/40",
    priority: 26,
  },
  {
    id: "workflow-ref",
    label: "Sub-Workflows",
    icon: GitBranch,
    accentColor: "pink",
    textColor: "text-pink-400",
    bgColor: "bg-pink-500/10",
    borderColor: "border-pink-500/40",
    priority: 28,
  },
  {
    id: "flow-execution",
    label: "Flow Execution",
    icon: Activity,
    accentColor: "rose",
    textColor: "text-rose-400",
    bgColor: "bg-rose-500/10",
    borderColor: "border-rose-500/40",
    priority: 32,
  },
];

export function getWidgetConfig(id: WidgetId): WidgetConfig {
  return WIDGET_CONFIGS.find((w) => w.id === id)!;
}

export function detectWidgets(
  stepsData: CurrentExecutionStepsResponse | null
): WidgetId[] {
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

  const guiTypes = [
    "screenshot",
    "click",
    "gui_action",
    "gui_automation",
    "action",
    "workflow",
  ];
  if (guiTypes.some((t) => stepTypes.has(t))) {
    widgets.push("screenshots");
  }

  const verificationTypes = [
    "playwright",
    "test",
    "check",
    "check_group",
    "verification",
    "error_check",
    "log_check",
    "shell",
    "gui_automation",
    "repo_test",
  ];
  if (
    verificationTypes.some((t) => stepTypes.has(t)) ||
    [...stepTypes].some((t) => t.includes("check") || t.includes("verification"))
  ) {
    widgets.push("verification");
  }

  const mcpTypes = ["mcp_call", "mcp", "tool_call"];
  if (mcpTypes.some((t) => stepTypes.has(t))) {
    widgets.push("mcp-calls");
  }

  const shellTypes = ["shell_command", "shell", "command", "bash"];
  if (shellTypes.some((t) => stepTypes.has(t))) {
    widgets.push("shell-command");
  }

  const apiTypes = ["api_request", "api_call", "http_request", "http"];
  if (apiTypes.some((t) => stepTypes.has(t))) {
    widgets.push("api-request");
  }

  const scriptTypes = ["script", "python", "node", "script_execution"];
  if (scriptTypes.some((t) => stepTypes.has(t))) {
    widgets.push("script");
  }

  const workflowRefTypes = ["workflow_ref", "sub_workflow", "workflow_call"];
  if (workflowRefTypes.some((t) => stepTypes.has(t))) {
    widgets.push("workflow-ref");
  }

  const flowTypes = ["flow", "flow_execution", "state_machine"];
  if (flowTypes.some((t) => stepTypes.has(t))) {
    widgets.push("flow-execution");
  }

  if (widgets.length <= 4) {
    if (!widgets.includes("screenshots")) widgets.push("screenshots");
    if (!widgets.includes("verification")) widgets.push("verification");
    if (!widgets.includes("mcp-calls")) widgets.push("mcp-calls");
  }

  const unique = [...new Set(widgets)];
  return unique.sort(
    (a, b) => getWidgetConfig(a).priority - getWidgetConfig(b).priority
  );
}
