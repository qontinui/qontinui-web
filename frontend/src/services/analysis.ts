/**
 * Analysis API service
 */

import axios from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedElement {
  bounding_box: BoundingBox;
  confidence: number;
  label?: string;
  element_type?: string;
  screenshot_index: number;
  metadata: Record<string, unknown>;
}

export interface AnalyzerResult {
  analyzer_type: string;
  analyzer_name: string;
  elements: DetectedElement[];
  confidence: number;
  metadata: Record<string, unknown>;
}

export interface FusedElement {
  bounding_box: BoundingBox;
  confidence: number;
  sources: string[];
  source_confidences: Record<string, number>;
  votes: number;
  label?: string;
  element_type?: string;
  screenshot_index: number;
  metadata: Record<string, unknown>;
}

export interface AnalyzerInfo {
  name: string;
  type: string;
  version: string;
  supports_multi_screenshot: boolean;
  required_screenshots: number;
  default_parameters: Record<string, unknown>;
}

export interface AnalysisResponse {
  analysis_job_id?: string;
  annotation_set_id: string;
  analyzer_results: AnalyzerResult[];
  fused_elements?: FusedElement[];
  fusion_stats?: {
    total_elements: number;
    avg_confidence: number;
    multi_vote_elements: number;
  };
  analyzer_statistics: Record<string, unknown>;
  status: string;
  error_message?: string;
}

export interface AnalysisJob {
  id: string;
  annotation_set_id: string;
  analyzers_used: string[];
  parameters?: Record<string, unknown>;
  fusion_enabled: boolean;
  fusion_config?: Record<string, unknown>;
  status: string;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
  total_elements_found: number;
  total_fused_elements: number;
  analyzer_statistics?: Record<string, unknown>;
  created_at: string;
  created_by_id: string;
}

export interface AnalysisJobDetail extends AnalysisJob {
  fused_elements: FusedElement[];
}

export interface AnalysisRequest {
  annotation_set_id: string;
  analyzer_names?: string[];
  analyzer_configs?: Record<string, Record<string, unknown>>;
  parallel?: boolean;
  fuse_results?: boolean;
  overlap_threshold?: number;
  save_to_database?: boolean;
}

export interface QuickAnalysisRequest {
  annotation_set_id: string;
  analyzers?: string[];
  fuse_results?: boolean;
}

/**
 * Get list of available analyzers
 */
export async function listAnalyzers(token: string): Promise<AnalyzerInfo[]> {
  const response = await axios.get(`${API_URL}/api/v1/analysis/analyzers`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data.analyzers;
}

/**
 * Run full analysis with database storage
 */
export async function runAnalysis(
  request: AnalysisRequest,
  token: string
): Promise<AnalysisResponse> {
  const response = await axios.post(
    `${API_URL}/api/v1/analysis/analyze`,
    request,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  return response.data;
}

/**
 * Run quick analysis without database storage
 */
export async function runQuickAnalysis(
  request: QuickAnalysisRequest,
  token: string
): Promise<AnalysisResponse> {
  const response = await axios.post(
    `${API_URL}/api/v1/analysis/analyze/quick`,
    request,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  return response.data;
}

/**
 * List analysis jobs
 */
export async function listAnalysisJobs(
  token: string,
  params?: {
    annotation_set_id?: string;
    status?: string;
    page?: number;
    page_size?: number;
  }
): Promise<{
  jobs: AnalysisJob[];
  total: number;
  page: number;
  page_size: number;
}> {
  const response = await axios.get(`${API_URL}/api/v1/analysis/jobs`, {
    params,
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data;
}

/**
 * Get detailed analysis job results
 */
export async function getAnalysisJob(
  jobId: string,
  token: string
): Promise<AnalysisJobDetail> {
  const response = await axios.get(`${API_URL}/api/v1/analysis/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data;
}

/**
 * Delete analysis job
 */
export async function deleteAnalysisJob(
  jobId: string,
  token: string
): Promise<void> {
  await axios.delete(`${API_URL}/api/v1/analysis/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}
