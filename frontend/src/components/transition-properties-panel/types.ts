import type { Workflow } from "@/lib/action-schema/action-types";

export interface State {
  id: string;
  name: string;
  description: string;
}

export interface OutgoingTransition {
  id: string;
  type: "OutgoingTransition";
  fromState: string;
  toState?: string;
  activateStates: string[];
  staysVisible: boolean;
  deactivateStates: string[];
  workflows: string[];
  timeout?: number;
  retryCount?: number;
}

export interface IncomingTransition {
  id: string;
  type: "IncomingTransition";
  toState: string;
  workflows: string[];
  timeout?: number;
  retryCount?: number;
}

export type Transition = OutgoingTransition | IncomingTransition;

export interface TransitionPropertiesPanelProps {
  transition: Transition;
  states: State[];
  processes: Workflow[];
  updateTransition: (updates: Partial<Transition>) => void;
  deleteTransition: (transitionId: string) => void;
}
