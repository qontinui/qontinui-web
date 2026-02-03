/**
 * Unified State Machine Types
 *
 * These types represent the unified state machine format used for
 * model-based GUI automation, regardless of the discovery source.
 */

export type DiscoverySourceType =
  | "playwright"
  | "ui_bridge"
  | "recording"
  | "vision"
  | "manual";

/**
 * Bounding box for an image element
 */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Visual element within a state (image with bounding box)
 */
export interface StateImage {
  id: string;
  screenshotId?: string;
  screenshotUrl?: string;
  bbox: BoundingBox;
  pixelHash?: string;
  stateId?: string;
  elementType?: string;
  label?: string;
  confidence: number;
  metadata?: Record<string, unknown>;
}

/**
 * A discovered UI state (collection of co-occurring elements)
 */
export interface DiscoveredState {
  id: string;
  name: string;
  imageIds: string[];
  renderIds: string[];
  elementIds: string[];
  confidence: number;
  description?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Trigger for a state transition
 */
export interface TransitionTrigger {
  type: "click" | "type" | "scroll" | "hover" | "custom";
  imageId?: string;
  elementId?: string;
  selector?: string;
  value?: string;
}

/**
 * A transition between states
 */
export interface StateTransition {
  id: string;
  fromStateId: string;
  toStateId: string;
  trigger?: TransitionTrigger;
  confidence: number;
  metadata?: Record<string, unknown>;
}

/**
 * Complete state machine result from discovery
 */
export interface StateDiscoveryResult {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  sourceType: DiscoverySourceType;
  sourceSessionId?: string;
  discoveryStrategy?: string;
  images: StateImage[];
  states: DiscoveredState[];
  transitions: StateTransition[];
  elementToRenders: Record<string, string[]>;
  imageCount: number;
  stateCount: number;
  transitionCount: number;
  renderCount: number;
  uniqueElementCount: number;
  confidence: number;
  discoveryMetadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Summary of a state discovery result (for lists)
 */
export interface StateDiscoveryResultSummary {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  sourceType: DiscoverySourceType;
  discoveryStrategy?: string;
  imageCount: number;
  stateCount: number;
  transitionCount: number;
  confidence: number;
  createdAt: string;
}

/**
 * API response for listing results
 */
export interface StateDiscoveryResultListResponse {
  items: StateDiscoveryResultSummary[];
  total: number;
}

/**
 * Convert API response (snake_case) to frontend types (camelCase)
 */
export function toStateDiscoveryResult(data: Record<string, unknown>): StateDiscoveryResult {
  return {
    id: data.id as string,
    projectId: data.project_id as string,
    name: data.name as string,
    description: data.description as string | undefined,
    sourceType: data.source_type as DiscoverySourceType,
    sourceSessionId: data.source_session_id as string | undefined,
    discoveryStrategy: data.discovery_strategy as string | undefined,
    images: ((data.images as unknown[]) || []).map(toStateImage),
    states: ((data.states as unknown[]) || []).map(toDiscoveredState),
    transitions: ((data.transitions as unknown[]) || []).map(toStateTransition),
    elementToRenders: (data.element_to_renders as Record<string, string[]>) || {},
    imageCount: data.image_count as number,
    stateCount: data.state_count as number,
    transitionCount: data.transition_count as number,
    renderCount: data.render_count as number,
    uniqueElementCount: data.unique_element_count as number,
    confidence: data.confidence as number,
    discoveryMetadata: (data.discovery_metadata as Record<string, unknown>) || {},
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  };
}

export function toStateImage(data: unknown): StateImage {
  const d = data as Record<string, unknown>;
  return {
    id: d.id as string,
    screenshotId: d.screenshot_id as string | undefined,
    screenshotUrl: d.screenshot_url as string | undefined,
    bbox: d.bbox as BoundingBox,
    pixelHash: d.pixel_hash as string | undefined,
    stateId: d.state_id as string | undefined,
    elementType: d.element_type as string | undefined,
    label: d.label as string | undefined,
    confidence: (d.confidence as number) ?? 1.0,
    metadata: d.metadata as Record<string, unknown> | undefined,
  };
}

export function toDiscoveredState(data: unknown): DiscoveredState {
  const d = data as Record<string, unknown>;
  return {
    id: d.id as string,
    name: d.name as string,
    imageIds: (d.image_ids as string[]) || [],
    renderIds: (d.render_ids as string[]) || [],
    elementIds: (d.element_ids as string[]) || [],
    confidence: (d.confidence as number) ?? 1.0,
    description: d.description as string | undefined,
    metadata: d.metadata as Record<string, unknown> | undefined,
  };
}

export function toStateTransition(data: unknown): StateTransition {
  const d = data as Record<string, unknown>;
  const trigger = d.trigger as Record<string, unknown> | undefined;
  return {
    id: d.id as string,
    fromStateId: d.from_state_id as string,
    toStateId: d.to_state_id as string,
    trigger: trigger ? {
      type: trigger.type as TransitionTrigger["type"],
      imageId: trigger.image_id as string | undefined,
      elementId: trigger.element_id as string | undefined,
      selector: trigger.selector as string | undefined,
      value: trigger.value as string | undefined,
    } : undefined,
    confidence: (d.confidence as number) ?? 1.0,
    metadata: d.metadata as Record<string, unknown> | undefined,
  };
}

export function toStateDiscoveryResultSummary(data: Record<string, unknown>): StateDiscoveryResultSummary {
  return {
    id: data.id as string,
    projectId: data.project_id as string,
    name: data.name as string,
    description: data.description as string | undefined,
    sourceType: data.source_type as DiscoverySourceType,
    discoveryStrategy: data.discovery_strategy as string | undefined,
    imageCount: data.image_count as number,
    stateCount: data.state_count as number,
    transitionCount: data.transition_count as number,
    confidence: data.confidence as number,
    createdAt: data.created_at as string,
  };
}

/**
 * Source type display names
 */
export const SOURCE_TYPE_LABELS: Record<DiscoverySourceType, string> = {
  playwright: "Web Extraction",
  ui_bridge: "UI Bridge",
  recording: "Recording",
  vision: "Vision",
  manual: "Manual",
};

/**
 * Source type colors for badges
 */
export const SOURCE_TYPE_COLORS: Record<DiscoverySourceType, string> = {
  playwright: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  ui_bridge: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  recording: "bg-green-500/20 text-green-400 border-green-500/30",
  vision: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  manual: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};
