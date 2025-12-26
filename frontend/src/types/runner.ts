/**
 * Runner Connection Types
 * Matches backend schemas for desktop runner management
 */

export interface RunnerConnection {
  id: number;
  runner_name: string;
  connected_at: string;
  disconnected_at: string | null;
  duration_seconds: number | null;
  ip_address: string | null;
  project_id: string | null;
  project_name?: string | null;
  ws_connected: boolean;
}

export interface ConnectionHistoryParams {
  limit?: number;
  offset?: number;
  search?: string;
  start_date?: string;
  end_date?: string;
}

export interface ConnectionHistoryResponse {
  connections: RunnerConnection[];
  total: number;
  active_count: number;
  limit: number;
  offset: number;
}
