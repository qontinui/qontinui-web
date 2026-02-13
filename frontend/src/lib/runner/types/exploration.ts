// =============================================================================
// Exploration Types
// =============================================================================

export interface AwasDiscoverResponse {
  success: boolean;
  manifest?: unknown;
  error?: string;
}

export interface AwasCheckSupportResponse {
  supported: boolean;
  version?: string;
  manifest_url?: string;
  error?: string;
}

export interface AwasActionInfo {
  id: string;
  name: string;
  description?: string;
  method?: string;
  endpoint?: string;
  intent?: string;
  parameters?: unknown;
}

export interface AwasExecuteResponse {
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface ExplorationStrategy {
  id: string;
  name: string;
  description: string;
}

export interface ExplorationReport {
  id: string;
  status: string;
  strategy?: string;
  config_path?: string;
  started_at?: string;
  completed_at?: string;
  duration_seconds?: number;
  states_visited?: number;
  transitions_tested?: number;
  failures?: number;
  coverage_pct?: number;
  details?: unknown;
}

export interface ContextAutoInclude {
  taskMentions?: string[];
  actionTypes?: string[];
  errorPatterns?: string[];
  filePatterns?: string[];
}

export interface ContextItem {
  id: string;
  name: string;
  content: string;
  category?: string;
  tags?: string[];
  scope?: string;
  enabled?: boolean;
  autoInclude?: ContextAutoInclude;
  createdAt?: string;
  modifiedAt?: string;
}
