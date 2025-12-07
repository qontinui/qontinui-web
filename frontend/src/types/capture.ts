/**
 * TypeScript types for Manual Capture Sessions
 *
 * These types define the structure for captured video sessions with synchronized
 * input events for the Capture Viewer feature.
 */

// Input Event Types (matches backend InputEventType enum)

export type InputEventType =
  | "mouse_move"
  | "mouse_click"
  | "mouse_down"
  | "mouse_up"
  | "mouse_scroll"
  | "mouse_drag"
  | "key_press"
  | "key_down"
  | "key_up";

// Backend API response format
export interface InputEventApi {
  id: number;
  timestamp_ms: number;
  event_type: string;
  mouse_x?: number;
  mouse_y?: number;
  mouse_button?: number;
  scroll_dx?: number;
  scroll_dy?: number;
  key_code?: string;
  key_name?: string;
  shift_pressed?: boolean;
  ctrl_pressed?: boolean;
  alt_pressed?: boolean;
  meta_pressed?: boolean;
}

// Frontend-friendly format
export interface InputEvent {
  id: number;
  timestamp: number; // Time in seconds from start of video
  timestampMs: number; // Time in milliseconds
  eventType: InputEventType;
  x?: number; // X coordinate for mouse/scroll events
  y?: number; // Y coordinate for mouse/scroll events
  button?: number; // Mouse button: 1=left, 2=middle, 3=right
  scrollDx?: number;
  scrollDy?: number;
  key?: string; // Key name for keyboard events
  keyCode?: string;
  modifiers: string[]; // Modifier keys: 'ctrl', 'shift', 'alt', 'meta'
}

// Capture Session Types

export interface CaptureSessionStats {
  totalEvents: number;
  mouseClicks: number;
  mouseMoves: number;
  keyPresses: number;
  scrolls: number;
  dragOperations: number;
}

// Backend API response format
export interface CaptureSessionApi {
  id: number;
  session_id: string;
  started_at: string;
  ended_at?: string;
  duration_ms?: number;
  video_width: number;
  video_height: number;
  video_fps: number;
  total_frames?: number;
  is_complete: boolean;
  is_processed: boolean;
  workflow_id?: number;
  project_id?: number;
  notes?: string;
  tags?: string[];
}

// Frontend-friendly format
export interface CaptureSession {
  id: number;
  sessionId: string;
  projectId?: number;
  workflowId?: number;
  name: string;
  description?: string;
  videoUrl: string;
  duration: number; // Duration in seconds
  durationMs: number; // Duration in milliseconds
  videoWidth: number;
  videoHeight: number;
  videoFps: number;
  totalFrames?: number;
  isComplete: boolean;
  isProcessed: boolean;
  createdAt: string; // ISO timestamp (started_at)
  endedAt?: string;
  notes?: string;
  tags: string[];
  stats: CaptureSessionStats;
}

// Screenshot Request Types

export interface ScreenshotFilter {
  eventTypes: string[]; // Which event types to capture
  buttons: string[]; // Which mouse buttons (for click events)
  maxCount: number; // Maximum number of screenshots to generate
  includeAfterDelayMs?: number; // Also capture after this delay
}

export interface ScreenshotRequest {
  id: string;
  sessionId: string;
  filter: ScreenshotFilter;
  status: "pending" | "processing" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
  screenshotUrls?: string[];
  error?: string;
}

// API Response Types

export interface CaptureSessionListResponse {
  sessions: CaptureSession[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CaptureSessionDetailResponse extends CaptureSession {
  // Additional fields returned by detail endpoint
  videoMetadata?: {
    format: string;
    codec: string;
    bitrate: number;
    fps: number;
  };
}

export interface ScreenshotRequestResponse {
  requestId: string;
  status: "processing" | "queued";
  estimatedCompletionTime?: string;
  message: string;
}

// Enums and Constants

export const InputEventTypeLabels: Record<InputEventType, string> = {
  mouse_move: "Move",
  mouse_click: "Click",
  mouse_down: "Mouse Down",
  mouse_up: "Mouse Up",
  mouse_scroll: "Scroll",
  mouse_drag: "Drag",
  key_press: "Key Press",
  key_down: "Key Down",
  key_up: "Key Up",
};

export const InputEventTypeColors: Record<InputEventType, string> = {
  mouse_move: "gray",
  mouse_click: "blue",
  mouse_down: "blue",
  mouse_up: "blue",
  mouse_scroll: "orange",
  mouse_drag: "purple",
  key_press: "green",
  key_down: "green",
  key_up: "gray",
};

// Helper Types for Components

export interface EventCluster {
  startTime: number;
  endTime: number;
  events: InputEvent[];
  density: number; // Events per second in this cluster
}

export interface VideoPlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  isFullscreen: boolean;
}

// Validation and Error Types

export interface CaptureSessionValidationError {
  field: string;
  message: string;
  code: string;
}

export interface CaptureSessionError {
  success: false;
  error: string;
  message: string;
  validationErrors?: CaptureSessionValidationError[];
}

// Utility Functions

/**
 * Format timestamp in seconds to MM:SS.mmm format
 */
export function formatTimestamp(seconds: number): string {
  if (!isFinite(seconds)) return "0:00.000";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${mins}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
}

/**
 * Format timestamp in seconds to human-readable format
 */
export function formatDuration(seconds: number): string {
  if (!isFinite(seconds)) return "0 seconds";
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(" ");
}

/**
 * Group events into time-based clusters
 */
export function clusterEvents(
  events: InputEvent[],
  clusterSizeSeconds: number = 1
): EventCluster[] {
  const clusters: { [key: number]: InputEvent[] } = {};

  events.forEach((event) => {
    const clusterIndex = Math.floor(event.timestamp / clusterSizeSeconds);
    if (!clusters[clusterIndex]) {
      clusters[clusterIndex] = [];
    }
    clusters[clusterIndex].push(event);
  });

  return Object.entries(clusters).map(([index, events]) => ({
    startTime: parseInt(index) * clusterSizeSeconds,
    endTime: (parseInt(index) + 1) * clusterSizeSeconds,
    events,
    density: events.length / clusterSizeSeconds,
  }));
}

/**
 * Filter events by type
 */
export function filterEventsByType(
  events: InputEvent[],
  types: InputEventType[]
): InputEvent[] {
  if (types.length === 0) return events;
  return events.filter((event) => types.includes(event.eventType));
}

/**
 * Get event statistics
 */
export function calculateEventStats(events: InputEvent[]): CaptureSessionStats {
  return {
    totalEvents: events.length,
    mouseClicks: events.filter((e) => e.eventType === "mouse_click").length,
    mouseMoves: events.filter((e) => e.eventType === "mouse_move").length,
    keyPresses: events.filter((e) =>
      ["key_press", "key_down"].includes(e.eventType)
    ).length,
    scrolls: events.filter((e) => e.eventType === "mouse_scroll").length,
    dragOperations: events.filter((e) => e.eventType === "mouse_drag").length,
  };
}

// Transform Functions

/**
 * Transform backend API input event to frontend format
 */
export function transformInputEvent(apiEvent: InputEventApi): InputEvent {
  const modifiers: string[] = [];
  if (apiEvent.shift_pressed) modifiers.push("shift");
  if (apiEvent.ctrl_pressed) modifiers.push("ctrl");
  if (apiEvent.alt_pressed) modifiers.push("alt");
  if (apiEvent.meta_pressed) modifiers.push("meta");

  return {
    id: apiEvent.id,
    timestamp: apiEvent.timestamp_ms / 1000,
    timestampMs: apiEvent.timestamp_ms,
    eventType: apiEvent.event_type as InputEventType,
    x: apiEvent.mouse_x,
    y: apiEvent.mouse_y,
    button: apiEvent.mouse_button,
    scrollDx: apiEvent.scroll_dx,
    scrollDy: apiEvent.scroll_dy,
    key: apiEvent.key_name,
    keyCode: apiEvent.key_code,
    modifiers,
  };
}

/**
 * Transform backend API capture session to frontend format
 */
export function transformCaptureSession(
  apiSession: CaptureSessionApi,
  events: InputEvent[] = []
): CaptureSession {
  const durationMs = apiSession.duration_ms || 0;
  const stats = calculateEventStats(events);

  return {
    id: apiSession.id,
    sessionId: apiSession.session_id,
    projectId: apiSession.project_id,
    workflowId: apiSession.workflow_id,
    name: `Capture ${apiSession.session_id.slice(0, 8)}`,
    description: apiSession.notes,
    videoUrl: `/api/v1/capture/video/${apiSession.session_id}`,
    duration: durationMs / 1000,
    durationMs,
    videoWidth: apiSession.video_width,
    videoHeight: apiSession.video_height,
    videoFps: apiSession.video_fps,
    totalFrames: apiSession.total_frames,
    isComplete: apiSession.is_complete,
    isProcessed: apiSession.is_processed,
    createdAt: apiSession.started_at,
    endedAt: apiSession.ended_at,
    notes: apiSession.notes,
    tags: apiSession.tags || [],
    stats,
  };
}

/**
 * Get display-friendly button name
 */
export function getButtonName(button?: number): string {
  switch (button) {
    case 1:
      return "Left";
    case 2:
      return "Middle";
    case 3:
      return "Right";
    default:
      return "";
  }
}
