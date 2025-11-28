import { Transition, State } from "@/contexts/automation-context/types";
import { Workflow } from "@/lib/action-schema/action-types";

export type ViewMode = "matrix" | "list" | "graph" | "statistics";

export interface TransitionFilters {
  searchQuery: string;
  fromState: string;
  toState: string;
  actionType: "all" | "with_workflow" | "without_workflow";
  hasWorkflow: string;
  showCircular: boolean;
  showBroken: boolean;
}

export interface TransitionValidation {
  circular: string[];
  brokenStateReferences: string[];
  missingWorkflows: string[];
  unreachableStates: string[];
  deadEndStates: string[];
}

export interface TransitionTemplate {
  id: string;
  name: string;
  description: string;
  type: "outgoing" | "incoming";
  config: Partial<Transition>;
}

export const DEFAULT_FILTERS: TransitionFilters = {
  searchQuery: "",
  fromState: "all",
  toState: "all",
  actionType: "all",
  hasWorkflow: "all",
  showCircular: false,
  showBroken: false,
};

export const BUILT_IN_TEMPLATES: TransitionTemplate[] = [
  {
    id: "template-1",
    name: "Basic Navigation",
    description: "Simple state-to-state navigation without workflows",
    type: "outgoing",
    config: {
      timeout: 5000,
      retryCount: 0,
      workflows: [],
    },
  },
  {
    id: "template-2",
    name: "Navigation with Action",
    description: "Navigation with a single workflow execution",
    type: "outgoing",
    config: {
      timeout: 10000,
      retryCount: 1,
      workflows: [],
    },
  },
  {
    id: "template-3",
    name: "Entry Setup",
    description: "Incoming transition for state initialization",
    type: "incoming",
    config: {
      timeout: 8000,
      retryCount: 0,
      workflows: [],
    },
  },
];

export const COLORS = {
  primary: "#00D9FF",
  success: "#00FF88",
  warning: "#FFB800",
  danger: "#FF4444",
  purple: "#BD00FF",
  gray: "#666666",
};
