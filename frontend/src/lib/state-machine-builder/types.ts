// =============================================================================
// State Machine Builder Types
// =============================================================================

/** Element fingerprint from UI Bridge discovery */
export interface ElementFingerprint {
  hash: string;
  role: string;
  tagName: string;
  positionZone: string;
  landmarkContext: string;
  accessibleName?: string;
}

/** Element within a state */
export interface UIBridgeElement {
  id: string;
  type: string;
  label: string;
  fingerprint?: {
    hash: string;
    role: string;
    tagName: string;
    positionZone: string;
    landmarkContext: string;
    accessibleName?: string;
  };
}

/** State in the builder */
export interface UIBridgeState {
  id: string;
  name: string;
  description?: string;
  fingerprints: string[];
  isGlobal?: boolean;
  isModal?: boolean;
  positionZone?: string;
  landmarkContext?: string;
  elements?: UIBridgeElement[];
  confidence?: number;
  observationCount?: number;
}

/** Transition between states */
export interface UIBridgeTransition {
  id: string;
  from: string;
  to: string;
  action: {
    type: string;
    element?: string;
    params?: Record<string, unknown>;
  };
  count?: number;
}

/** Discovered state from fingerprint analysis */
export interface DiscoveredState {
  stateId: string;
  name: string;
  fingerprintHashes: string[];
  isGlobal: boolean;
  isModal: boolean;
  positionZone: string;
  landmarkContext: string;
  confidence: number;
  observationCount: number;
}

/** Discovered transition */
export interface DiscoveredTransition {
  fromStateId: string;
  toStateId: string;
  actionType: string;
  count: number;
}

/** Discovery statistics */
export interface DiscoveryStatistics {
  totalCaptures: number;
  uniqueFingerprints: number;
  statesFound: number;
  transitionsFound: number;
}

/** Result from fingerprint discovery */
export interface FingerprintDiscoveryResult {
  states: DiscoveredState[];
  transitions: DiscoveredTransition[];
  statistics: DiscoveryStatistics;
  fingerprintDetails: Record<string, ElementFingerprint>;
}

/** Exported automation config format */
export interface UIBridgeConfig {
  name: string;
  version: string;
  description?: string;
  exportedAt: string;
  source: "state-discovery";
  metadata: {
    sessionId?: string;
    totalCaptures?: number;
    totalFingerprints?: number;
  };
  states: UIBridgeState[];
  transitions: UIBridgeTransition[];
  fingerprintDetails?: Record<string, ElementFingerprint>;
}

// =============================================================================
// Builder State
// =============================================================================

export type BuilderMode = "discover" | "edit" | "view";

/** Undo/redo snapshot */
export interface Snapshot {
  states: UIBridgeState[];
  transitions: UIBridgeTransition[];
}

/** Main builder state */
export interface BuilderState {
  // Core data
  states: UIBridgeState[];
  transitions: UIBridgeTransition[];
  fingerprintDetails: Record<string, ElementFingerprint>;
  configName: string;

  // Server persistence
  configId: string | null;

  // Selection
  selectedStateId: string | null;
  selectedTransitionId: string | null;

  // Discovery
  explorationJobId: string | null;
  discoveryResult: FingerprintDiscoveryResult | null;
  pendingStates: UIBridgeState[];

  // Edit tracking
  isDirty: boolean;
  undoStack: Snapshot[];
  redoStack: Snapshot[];

  // Mode
  mode: BuilderMode;
}

// =============================================================================
// API Types
// =============================================================================

/** Extension status response */
export interface ExtensionStatusResponse {
  connected: boolean;
  tab_id?: number;
  tab_url?: string;
  tab_title?: string;
  last_pong_ago_sec?: number;
  connection_age_sec?: number;
  reconnect_count?: number;
}

/** Start exploration request */
export interface StartExplorationRequest {
  target_type?: "web";
  connection_url: string;
  max_depth?: number;
  max_elements_per_page?: number;
  max_total_elements?: number;
  action_delay_ms?: number;
  blocked_keywords?: string[];
  safe_keywords?: string[];
  blocked_selectors?: string[];
  capture_screenshots?: boolean;
  run_state_discovery?: boolean;
}

/** Exploration status response */
export interface ExplorationStatusData {
  status: "running" | "complete" | "error" | "stopped";
  phase?: string;
  elements_discovered?: number;
  pages_visited?: number;
  current_url?: string;
  error?: string;
  progress_pct?: number;
}

/** Exploration result data */
export interface ExplorationResultData {
  state_discovery_result?: FingerprintDiscoveryResult;
  elements_discovered?: number;
  pages_visited?: number;
  duration_seconds?: number;
}

// =============================================================================
// Action Types
// =============================================================================

export type BuilderAction =
  // State-modifying (push to undo stack)
  | { type: "ADD_STATE"; state: UIBridgeState }
  | { type: "UPDATE_STATE"; id: string; updates: Partial<UIBridgeState> }
  | { type: "DELETE_STATE"; id: string }
  | { type: "ADD_TRANSITION"; transition: UIBridgeTransition }
  | {
      type: "UPDATE_TRANSITION";
      id: string;
      updates: Partial<UIBridgeTransition>;
    }
  | { type: "DELETE_TRANSITION"; id: string }
  | { type: "ACCEPT_DISCOVERED_STATE"; stateId: string }
  | { type: "REJECT_DISCOVERED_STATE"; stateId: string }
  | { type: "ACCEPT_ALL" }
  | { type: "LOAD_CONFIG"; config: UIBridgeConfig }
  | { type: "RESET" }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "MERGE_DISCOVERY_RESULT"; result: FingerprintDiscoveryResult }
  // Non-modifying
  | { type: "SELECT_STATE"; id: string | null }
  | { type: "SELECT_TRANSITION"; id: string | null }
  | { type: "SET_MODE"; mode: BuilderMode }
  | { type: "SET_EXPLORATION_JOB_ID"; jobId: string | null }
  | {
      type: "SET_DISCOVERY_RESULT";
      result: FingerprintDiscoveryResult | null;
    }
  | { type: "SET_PENDING_STATES"; states: UIBridgeState[] }
  | { type: "SET_CONFIG_NAME"; name: string }
  | { type: "SET_CONFIG_ID"; configId: string | null }
  | { type: "MARK_SAVED" };

// =============================================================================
// Validation
// =============================================================================

/** Type guard for imported UIBridgeConfig JSON */
export function isValidUIBridgeConfig(obj: unknown): obj is UIBridgeConfig {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  if (!Array.isArray(o.states)) return false;
  for (const s of o.states) {
    if (!s || typeof s !== "object") return false;
    const st = s as Record<string, unknown>;
    if (typeof st.id !== "string" || typeof st.name !== "string") return false;
    if (!Array.isArray(st.fingerprints)) return false;
  }
  if (o.transitions !== undefined && !Array.isArray(o.transitions))
    return false;
  return true;
}
