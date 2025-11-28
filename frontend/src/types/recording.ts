/**
 * TypeScript types for Recording-based State Discovery
 *
 * These types match the backend API schemas for automated state structure
 * creation from annotated recordings.
 */

// Enums

export type RecordingStatus =
  | "uploaded"
  | "validating"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export type ProcessingPhase =
  | "frame_analysis"
  | "state_identification"
  | "interaction_processing"
  | "transition_discovery"
  | "state_machine_assembly"
  | "optimization"
  | "completed";

export type InteractionType = "click" | "drag" | "key" | "scroll" | "hover";

// Recording Types

export interface RecordingStats {
  total_frames: number;
  total_interactions: number;
  total_context_events: number;
  duration_seconds: number;
  frame_rate: number;
  discovered_states: number;
  discovered_transitions: number;
  discovered_workflows: number;
}

export interface Recording {
  id: string;
  project_id: string;
  created_by_id: string;
  name: string;
  description?: string;
  tags: string[];
  status: RecordingStatus;
  processing_phase?: ProcessingPhase;
  processing_progress: number; // 0.0 to 1.0
  created_at: string; // ISO timestamp
  updated_at: string;
  recording_start_time: string;
  recording_end_time: string;
  stats: RecordingStats;
  validation_errors: string[];
  validation_warnings: string[];
  confidence?: number;
}

export interface RecordingListResponse {
  recordings: Recording[];
  total: number;
  page: number;
  page_size: number;
}

// Frame Types

export interface RecordingFrame {
  id: string;
  recording_id: string;
  frame_number: number;
  timestamp: string;
  relative_time_ms: number;
  image_url?: string;
  width: number;
  height: number;
  perceptual_hash?: string;
  cluster_id?: number;
  state_id?: string;
  window_title?: string;
  url?: string;
}

// Processing Types

export interface ProcessingJobStatus {
  recording_id: string;
  status: RecordingStatus;
  phase?: ProcessingPhase;
  progress: number;
  started_at?: string;
  estimated_completion?: string;
  error?: string;
}

export interface ProcessingLogEntry {
  timestamp: string;
  phase: ProcessingPhase;
  level: string; // 'info' | 'warning' | 'error'
  message: string;
  data?: Record<string, any>;
  progress?: number;
}

// Discovered State Types

export interface DiscoveredStateImage {
  id: string;
  name: string;
  patterns: Array<{
    id: string;
    searchRegions: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
    fixed: boolean;
    similarity: number;
  }>;
  shared: boolean;
  stabilityScore?: number;
}

export interface DiscoveredStateRegion {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiscoveredStateLocation {
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface DiscoveredStateString {
  id: string;
  name: string;
  value: string;
  identifier: boolean;
}

export interface DiscoveredState {
  id: string;
  recording_id: string;
  name: string;
  description?: string;
  cluster_id?: number;
  state_images: DiscoveredStateImage[];
  regions: DiscoveredStateRegion[];
  locations: DiscoveredStateLocation[];
  strings: DiscoveredStateString[];
  frame_count: number;
  position_x?: number;
  position_y?: number;
  is_initial: boolean;
  is_error_state: boolean;
  confidence?: number;
  user_edited: boolean;
  user_approved: boolean;
  converted_to_state_id?: string;
}

// Discovered Transition Types

export interface DiscoveredWorkflow {
  id: string;
  name: string;
  version: string;
  format: string;
  actions: WorkflowAction[];
  connections: Record<string, string[]>;
  initialStateIds?: string[];
}

export interface WorkflowAction {
  id: string;
  type: string;
  [key: string]: any; // Additional properties based on action type
}

export interface DiscoveredTransition {
  id: string;
  recording_id: string;
  from_state_id: string;
  to_state_id?: string;
  activate_state_ids: string[];
  deactivate_state_ids: string[];
  stays_visible: boolean;
  trigger_type?: string;
  trigger_description?: string;
  latency_ms?: number;
  recommended_timeout_ms?: number;
  workflow?: DiscoveredWorkflow;
  workflow_name?: string;
  confidence?: number;
  user_edited: boolean;
  user_approved: boolean;
  converted_to_transition_id?: string;
}

// State Structure Types

export interface DiscoveredStateStructure {
  recording_id: string;
  states: DiscoveredState[];
  transitions: DiscoveredTransition[];
  stats: {
    total_states: number;
    total_transitions: number;
    high_confidence_states: number;
    medium_confidence_states: number;
    low_confidence_states: number;
    approved_states: number;
    approved_transitions: number;
  };
  confidence?: number;
}

// Upload Types

export interface UploadResponse {
  success: boolean;
  recording_id: string;
  uploaded_at: string;
  size_bytes: number;
  frame_count: number;
  interaction_count: number;
  status: RecordingStatus;
  validation_errors: string[];
  validation_warnings: string[];
  message?: string;
}

export interface RecordingError {
  success: false;
  error: string;
  message: string;
  details?: Record<string, any>;
}

// Review & Acceptance Types

export interface StateReviewUpdate {
  user_approved: boolean;
  user_notes?: string;
  modifications?: Record<string, any>;
}

export interface TransitionReviewUpdate {
  user_approved: boolean;
  user_notes?: string;
  modifications?: Record<string, any>;
}

export interface AcceptanceRequest {
  action: "accept" | "accept_selected" | "modify" | "discard";
  selected_state_ids?: string[];
  selected_transition_ids?: string[];
  modifications?: Record<string, any>;
}

export interface AcceptanceResponse {
  success: boolean;
  message: string;
  created_states: string[];
  created_transitions: string[];
  created_workflows: string[];
  errors: string[];
}

// UI-specific Types

export interface RecordingUploadProgress {
  file: File;
  progress: number; // 0-100
  status: "pending" | "uploading" | "processing" | "complete" | "error";
  error?: string;
  recording_id?: string;
}

export interface StateNodeData {
  state: DiscoveredState;
  selected: boolean;
  approved: boolean;
}

export interface TransitionEdgeData {
  transition: DiscoveredTransition;
  selected: boolean;
  approved: boolean;
}

// Helper type for phase display
export const ProcessingPhaseLabels: Record<ProcessingPhase, string> = {
  frame_analysis: "Analyzing Frames",
  state_identification: "Identifying States",
  interaction_processing: "Processing Interactions",
  transition_discovery: "Discovering Transitions",
  state_machine_assembly: "Assembling State Machine",
  optimization: "Optimizing",
  completed: "Complete",
};

// Helper type for status display
export const RecordingStatusLabels: Record<RecordingStatus, string> = {
  uploaded: "Uploaded",
  validating: "Validating",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

// Helper type for confidence colors
export type ConfidenceLevel = "high" | "medium" | "low";

export function getConfidenceLevel(confidence?: number): ConfidenceLevel {
  if (!confidence) return "low";
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}

export function getConfidenceColor(level: ConfidenceLevel): string {
  switch (level) {
    case "high":
      return "text-green-600 bg-green-50";
    case "medium":
      return "text-yellow-600 bg-yellow-50";
    case "low":
      return "text-red-600 bg-red-50";
  }
}
