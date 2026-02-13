// =============================================================================
// API Response Types
// =============================================================================

import type { Check } from "./library";

export interface ParsedCurlResponse {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
  content_type?: string;
}

export interface ApiRequestTestResult {
  success: boolean;
  status_code: number;
  status_text: string;
  response_headers?: Record<string, string>;
  response_time_ms: number;
  response_body_type?: string;
  response_body?: string;
  response_size_bytes?: number;
  error?: string;
}

export interface GenerateChecksResponse {
  success: boolean;
  suggested_checks?: {
    check?: Partial<Check>;
    name?: string;
    command?: string;
    reason?: string;
  }[];
  error?: string;
}
