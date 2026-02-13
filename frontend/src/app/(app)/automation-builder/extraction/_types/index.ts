export type MainTab = "configuration" | "results";

export interface UIBridgeElement {
  id: string;
  name: string;
  type: string;
  render_ids: string[];
  tag_name?: string;
  text_content?: string;
  component_name?: string;
}

export interface DomainKnowledge {
  id: string;
  project_id: string | null;
  title: string;
  content: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface DiscoveredState {
  id: string;
  name: string;
  state_image_ids: string[];
  screenshot_ids: string[];
  confidence: number;
  description?: string;
  domain_knowledge?: DomainKnowledge[];
}

export interface UIBridgeDiscoveryResult {
  states: DiscoveredState[];
  elements: UIBridgeElement[];
  element_to_renders: Record<string, string[]>;
  render_count: number;
  unique_element_count: number;
  strategy_used?: string;
  strategy_metadata?: Record<string, unknown>;
}

export type DiscoveryStrategy = "auto" | "legacy" | "fingerprint";

export interface SavedConfig {
  id: string;
  name: string;
  description: string | null;
  render_count: number;
  element_count: number;
  created_at: string;
}

export interface SavedState {
  id: string;
  config_id: string;
  state_id: string;
  name: string;
  description: string | null;
  element_ids: string[];
  render_ids: string[];
  confidence: number;
  acceptance_criteria: string[];
  domain_knowledge?: DomainKnowledge[];
}

export interface RenderLogSession {
  session_id: string;
  first_timestamp: string;
  last_timestamp: string;
  snapshot_count: number;
  unique_pages: number;
  total_mutations: number;
}

export interface RenderLogEntry {
  id: number;
  session_id: string;
  timestamp: string;
  page_url: string;
  page_title: string | null;
  trigger: string;
  mutation_type: string | null;
  snapshot: Record<string, unknown>;
  element_count: number | null;
}

export interface WebExtractionProgressState {
  status: "idle" | "running" | "completed" | "failed";
  extractionId: string | null;
  statesFound: number;
  transitionsFound: number;
  pagesExtracted: number;
  errors: number;
  errorMessage?: string;
  elapsedSeconds?: number;
  startTime?: number;
}

export interface VisionExtractionProgressState {
  status: "idle" | "running" | "completed" | "failed";
  elementsDetected: number;
  errorMessage?: string;
  screenshotUrl?: string;
}
