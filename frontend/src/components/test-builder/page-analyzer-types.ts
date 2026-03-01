/** Bounding box for detected elements */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Detected element from page analysis */
export interface DetectedElement {
  id: string;
  label: string;
  element_type: string;
  text_content?: string;
  bounding_box: BoundingBox;
  confidence: number;
  selector?: string;
  attributes: Record<string, unknown>;
}

/** Page analysis result (from Playwright or Vision) */
export interface PageAnalysis {
  screenshot_base64?: string;
  annotated_screenshot_base64?: string;
  elements: DetectedElement[];
  source: "playwright" | "vision" | "ui_bridge";
  captured_at: string;
  monitor_index?: number;
  url?: string;
}

/** UI Bridge snapshot element */
export interface UIBridgeElement {
  id: string;
  tag: string;
  role?: string;
  text?: string;
  label?: string;
  placeholder?: string;
  className?: string;
  attributes?: Record<string, string>;
  rect?: { x: number; y: number; width: number; height: number };
  children?: UIBridgeElement[];
}

/** UI Bridge snapshot result */
export interface UIBridgeSnapshot {
  url: string;
  title: string;
  elements: UIBridgeElement[];
  timestamp: string;
}

/** API request analysis result */
export interface ApiRequestAnalysis {
  id: string;
  request_name: string;
  method: string;
  url: string;
  response: unknown;
  status_code?: number;
  duration_ms?: number;
  executed_at: string;
  error?: string;
}

/** Step output from a workflow execution */
export interface StepOutput {
  id: string;
  step_type: string;
  step_name: string;
  executed_at: string;
  duration_ms: number;
  success: boolean;
  error?: string;
  command?: string;
  exit_code?: number;
  stdout?: string;
  stderr?: string;
}

/** Live browser element from UI Bridge SDK */
export interface LiveBrowserElement {
  id: string;
  tagName: string;
  type: string;
  text?: string;
  label?: string;
  value?: string;
  checked?: boolean;
  visible: boolean;
  enabled: boolean;
  bounds: BoundingBox;
}

/** Live browser analysis data */
export interface LiveBrowserAnalysis {
  elements: LiveBrowserElement[];
  url: string;
  title: string;
  captured_at: string;
}

/** Analysis source type */
export type AnalysisSourceType =
  | "ui_bridge"
  | "vision"
  | "api_request"
  | "step_output";

/** A single collected analysis */
export type CollectedAnalysis =
  | { type: "ui_bridge"; id: string; name: string; data: UIBridgeSnapshot }
  | { type: "vision"; id: string; name: string; data: PageAnalysis }
  | { type: "api_request"; id: string; name: string; data: ApiRequestAnalysis }
  | { type: "step_output"; id: string; name: string; data: StepOutput };

/** All collected analyses for AI test generation */
export interface CollectedAnalysisSet {
  analyses: CollectedAnalysis[];
  collected_at: string;
}

/** Combined analysis data for the parent component */
export type AnalysisData =
  | { type: "single"; data: PageAnalysis }
  | { type: "collected"; data: CollectedAnalysisSet };

/** Saved API request from the runner library */
export interface SavedApiRequest {
  id: string;
  name: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  body_content_type?: string;
}

/** Task run summary */
export interface TaskRunSummary {
  id: string;
  task_name?: string;
  workflow_name?: string;
  status: string;
  created_at: string;
}

/** Props for the PageAnalyzer component */
export interface PageAnalyzerProps {
  /** Called when analysis data is ready for consumption */
  onAnalysisComplete: (analysis: AnalysisData) => void;
  /** Called when an error occurs */
  onError?: (error: string) => void;
  /** Initial analyses to restore when component mounts */
  initialAnalyses?: CollectedAnalysis[];
}
