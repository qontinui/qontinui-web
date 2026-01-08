import { Transition } from "@/contexts/automation-context/types";

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

// Design system color values for JS style props
// These match the CSS variables in globals.css
export const COLORS = {
  primary: "#4A90D9", // brand-primary
  success: "#4DB89D", // brand-success
  warning: "#E5A853", // warning
  danger: "#E5534B", // error
  purple: "#8B6BB5", // brand-secondary
  gray: "#3A3A42", // border-default
};
