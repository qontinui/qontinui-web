export type WidgetType =
  | "ai-conversation"
  | "execution-timeline"
  | "findings"
  | "verification"
  | "playwright"
  | "execution-status"
  | "gui-automation"
  | "api-requests"
  | "mcp-calls"
  | "shell-commands";

export interface WidgetDef {
  type: WidgetType;
  label: string;
  icon: string;
  color: string;
  priority: number;
}

export const WIDGET_DEFS: Record<WidgetType, WidgetDef> = {
  "ai-conversation": {
    type: "ai-conversation",
    label: "AI Conversation",
    icon: "MessageSquare",
    color: "#8B5CF6",
    priority: 1,
  },
  "execution-timeline": {
    type: "execution-timeline",
    label: "Timeline",
    icon: "Clock",
    color: "#3B82F6",
    priority: 2,
  },
  findings: {
    type: "findings",
    label: "Findings",
    icon: "Bug",
    color: "#EF4444",
    priority: 3,
  },
  verification: {
    type: "verification",
    label: "Verification",
    icon: "ShieldCheck",
    color: "#10B981",
    priority: 4,
  },
  playwright: {
    type: "playwright",
    label: "Playwright",
    icon: "TestTube2",
    color: "#F59E0B",
    priority: 5,
  },
  "execution-status": {
    type: "execution-status",
    label: "Status",
    icon: "Gauge",
    color: "#06B6D4",
    priority: 6,
  },
  "gui-automation": {
    type: "gui-automation",
    label: "GUI Automation",
    icon: "Eye",
    color: "#EC4899",
    priority: 7,
  },
  "api-requests": {
    type: "api-requests",
    label: "API Requests",
    icon: "Globe",
    color: "#14B8A6",
    priority: 8,
  },
  "mcp-calls": {
    type: "mcp-calls",
    label: "MCP Calls",
    icon: "Terminal",
    color: "#A855F7",
    priority: 9,
  },
  "shell-commands": {
    type: "shell-commands",
    label: "Shell",
    icon: "Code2",
    color: "#64748B",
    priority: 10,
  },
};
