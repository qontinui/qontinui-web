export interface DiscoveredState {
  state_id: string;
  screenshot_ids: number[];
  representative_screenshot_id: number;
  timestamp_first_seen: string;
  timestamp_last_seen: string;
  visit_count: number;
  input_events: number[];
  outgoing_transitions: StateTransition[];
  metadata: {
    screenshot_count: number;
    duration_seconds: number;
  };
}

export interface StateTransition {
  from_state_id: string;
  to_state_id: string;
  trigger_event_id: number;
  event_type: string;
  timestamp: string;
  confidence: number;
}

export interface StateDetectionResponse {
  session_id: string;
  total_states: number;
  total_transitions: number;
  states: DiscoveredState[];
  algorithm: string;
  parameters: Record<string, unknown>;
  processing_time_ms: number;
}

export interface StateDetectionViewerProps {
  sessionId?: string;
  onExport?: (states: DiscoveredState[]) => void;
  className?: string;
}
