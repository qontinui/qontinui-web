export interface ConflictChange {
  field: string;
  local_value: unknown;
  remote_value: unknown;
  base_value?: unknown;
  conflicted: boolean;
}

export interface Conflict {
  id: string;
  resource_type: string;
  resource_id: string;
  resource_name: string;
  local_version: number;
  remote_version: number;
  local_user_id: string;
  local_user_name: string;
  remote_user_id: string;
  remote_user_name: string;
  changes: ConflictChange[];
  timestamp: Date | string;
}

export type ViewMode = "split" | "unified";

export type MergeChoices = Record<string, "local" | "remote">;

export interface ConflictResolutionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conflicts: Conflict[];
  currentConflictIndex?: number;
  onResolve: (
    conflictId: string,
    resolution: "local" | "remote" | "merge",
    mergedData?: Record<string, unknown>
  ) => Promise<void>;
  onResolveAll: (resolution: "local" | "remote") => Promise<void>;
}
