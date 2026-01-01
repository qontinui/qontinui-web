/**
 * Discovery Types
 * Types for pending discoveries from runners that users can review and accept/reject
 */

export type DiscoveryType =
  | "new_element"
  | "new_transition"
  | "timing_update"
  | "flaky_detection"
  | "unexpected_element";

export type DiscoveryStatus = "pending" | "accepted" | "rejected";

export interface Discovery {
  id: string;
  user_id: string;
  project_id: string;
  runner_id: string;
  runner_name: string | null;
  config_id: string;
  config_name: string | null;
  discovery_type: DiscoveryType;
  title: string;
  description: string | null;
  discovery_data: Record<string, unknown>;
  evidence: {
    runs_observed: number;
    first_seen: string;
    last_seen: string;
    confidence_avg?: number;
    sample_screenshots?: string[];
  };
  confidence: number;
  runs_observed: number;
  status: DiscoveryStatus;
  reviewed_at: string | null;
  reviewed_by_id: string | null;
  user_notes: string | null;
  applied_to_config: boolean;
  created_at: string;
  updated_at: string;
}

export interface DiscoveryFilters {
  status?: DiscoveryStatus;
  project_id?: string;
  discovery_type?: DiscoveryType;
}

export interface DiscoveriesResponse {
  discoveries: Discovery[];
  total: number;
  limit: number;
  offset: number;
}

export interface PendingCountResponse {
  count: number;
}
