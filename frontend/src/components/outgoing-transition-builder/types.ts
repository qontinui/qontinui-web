export interface OutgoingTransitionBuilderProps {
  preselectedWorkflow?: string;
  preselectedOriginState?: string;
  onClose?: () => void;
}

export interface TransitionBuilderState {
  fromState: string;
  staysVisible: boolean;
  activateStates: string[];
  deactivateStates: string[];
  selectedWorkflows: string[];
  workflowCategoryFilter: string;
}
