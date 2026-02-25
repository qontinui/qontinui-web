export type WidgetType =
  | "ai-conversation"
  | "execution-timeline"
  | "findings"
  | "verification"
  | "execution-status"
  | "command"
  | "ui-bridge"
  | "flow-execution";

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
  "execution-status": {
    type: "execution-status",
    label: "Status",
    icon: "Gauge",
    color: "#06B6D4",
    priority: 5,
  },
  command: {
    type: "command",
    label: "Commands",
    icon: "Terminal",
    color: "#64748B",
    priority: 6,
  },
  "ui-bridge": {
    type: "ui-bridge",
    label: "UI Bridge",
    icon: "Monitor",
    color: "#10B981",
    priority: 7,
  },
  "flow-execution": {
    type: "flow-execution",
    label: "Flow Execution",
    icon: "GitBranch",
    color: "#F43F5E",
    priority: 8,
  },
};
