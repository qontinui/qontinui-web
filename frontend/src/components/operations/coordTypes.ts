// ============================================================================
// qontinui-coord types — mirror StatusRow from
// qontinui-coord/src/status.rs:75. Kept local to /components/operations
// because this is the only consumer in the web frontend today.
// ============================================================================

export interface MachineStatusRow {
  machine_id: string;
  hostname: string | null;
  current_task: string | null;
  current_repo: string | null;
  current_branch: string | null;
  free_text: string | null;
  details: Record<string, unknown>;
  updated_at: string;
}

export interface MachineStatusResponse {
  machines: MachineStatusRow[];
  count: number;
}
