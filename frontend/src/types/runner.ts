/**
 * Runner Token Types
 * Matches backend schemas for desktop runner management
 */

export interface RunnerToken {
  id: string;
  name: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  is_revoked: boolean;
  last_ip_address: string | null;
  connection_count: number;
}

export interface RunnerTokenWithSecret extends RunnerToken {
  token: string; // Only present on creation
}

export interface RunnerConnection {
  id: number;
  runner_token_id: string | null; // null for JWT auth connections (not using runner token)
  runner_name: string;
  connected_at: string;
  disconnected_at: string | null;
  duration_seconds: number | null;
  ip_address: string | null;
  project_id: number | null;
  project_name?: string | null;
  ws_connected: boolean; // Whether the runner is WebSocket-connected and can receive commands
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

export interface CreateTokenRequest {
  name: string;
  expires_in_days?: number | null;
}

export interface ConnectionInfo {
  version: string;
  url: string;
  token: string;
  userId: string;
  projectId: number | null;
  createdAt: string;
  runnerTokenId?: string; // If using a dedicated runner token
}

export type TokenStatus = "active" | "expired" | "revoked";

export interface RunnerTokenCardProps {
  token: RunnerToken;
  onRevoke: (tokenId: string) => void;
  onDelete: (tokenId: string) => void;
  onViewConnections: (tokenId: string) => void;
}

export interface TestConnectionResponse {
  success: boolean;
  message: string;
  user_id: string;
  username: string;
  auth_method: "jwt" | "runner_token";
  token_name: string | null;
  connection_id: number;
  tested_at: string;
}
