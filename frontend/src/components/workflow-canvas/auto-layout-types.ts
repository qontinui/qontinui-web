import { LayoutStyle } from "@/lib/workflow-layout/auto-layout";
import { LayoutOptions } from "@/services/layout-service";

export interface AutoLayoutPanelProps {
  workflow: import("@/lib/action-schema/action-types").Workflow;
  onApplyLayout: (
    workflow: import("@/lib/action-schema/action-types").Workflow,
    animated: boolean
  ) => void;
  onClose?: () => void;
}

export interface LayoutPreset {
  id: string;
  name: string;
  description: string;
  category: "compact" | "spacious" | "balanced" | "custom";
  style: LayoutStyle;
  options: LayoutOptions;
}

export interface LayoutStyleInfo {
  name: string;
  description: string;
  icon: string;
  bestFor: string[];
}
