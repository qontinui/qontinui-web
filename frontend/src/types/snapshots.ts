// types/snapshots.ts

export interface ImportSnapshotRequest {
  snapshot_directory: string;
  workflow_id?: number;
  created_by?: number;
  tags?: string[];
  notes?: string;
}

export interface SnapshotRun {
  id: number;
  run_id: string;
  run_directory: string;
  start_time: string;
  end_time: string | null;
  duration_seconds: number | null;
  execution_mode: string;
  total_actions: number;
  successful_actions: number;
  failed_actions: number;
  total_screenshots: number;
  patterns_count: number;
  workflow_id: number | null;
  created_by: number | null;
  tags: string[] | null;
  notes: string | null;
}

export interface ImportSnapshotResponse {
  success?: boolean;
  snapshot_run?: SnapshotRun;
  error?: string;
}

export interface SnapshotListResponse {
  total: number;
  snapshots: SnapshotRun[];
}
