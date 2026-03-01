export interface Process {
  id: string;
  name: string;
  description: string;
  actions: Action[];
}

export interface Action {
  id: string;
  type: // Pure mouse actions
    | "MOUSE_MOVE"
    | "MOUSE_DOWN"
    | "MOUSE_UP"
    | "MOUSE_SCROLL"
    // Pure keyboard actions
    | "KEY_DOWN"
    | "KEY_UP"
    | "KEY_PRESS"
    | "HOTKEY"
    // Combined mouse actions
    | "CLICK"
    | "DOUBLE_CLICK"
    | "RIGHT_CLICK"
    | "DRAG"
    | "SCROLL"
    // Combined keyboard actions
    | "TYPE"
    // Control flow actions
    | "IF"
    | "LOOP"
    // Other actions
    | "FIND"
    | "FIND_STATE"
    | "VANISH"
    | "RAG_FIND"
    | "GO_TO_STATE"
    | "RUN_WORKFLOW";
  config: Record<string, unknown>;
}

export interface ActionEditorProps {
  process: Process;
  selectedAction: Action | null;
  onSelectAction: (action: Action) => void;
  onUpdateProcess: (process: Process) => void;
}

export interface StateType {
  id: string;
  name: string;
  stateImages?: Array<{ id: string; name: string }>;
  strings?: Array<{ id: string; value: string; name?: string }>;
}

export interface WorkflowType {
  id: string;
  name: string;
}

export interface ImageType {
  id: string;
  name: string;
}
