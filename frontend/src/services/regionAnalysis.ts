/**
 * Region Analysis API service
 */

import axios from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GridMetadata {
  rows: number;
  cols: number;
  cells: Array<{
    row: number;
    col: number;
    bounding_box: BoundingBox;
  }>;
  cell_width: number;
  cell_height: number;
  horizontal_spacing?: number;
  vertical_spacing?: number;
}

export interface DetectedRegion {
  bounding_box: BoundingBox;
  confidence: number;
  region_type: string;
  label?: string;
  screenshot_index: number;
  metadata: Record<string, unknown>;
  grid_metadata?: GridMetadata;
}

export interface RegionAnalyzerResult {
  analyzer_type: string;
  analyzer_name: string;
  regions: DetectedRegion[];
  confidence: number;
  metadata: Record<string, unknown>;
}

export interface FusedRegion {
  bounding_box: BoundingBox;
  confidence: number;
  sources: string[];
  source_confidences: Record<string, number>;
  votes: number;
  region_type?: string;
  label?: string;
  screenshot_index: number;
  metadata: Record<string, unknown>;
  grid_metadata?: GridMetadata;
}

export interface RegionAnalyzerInfo {
  name: string;
  type: string;
  version: string;
  supports_multi_screenshot: boolean;
  required_screenshots: number;
  default_parameters: Record<string, unknown>;
  detects_grids: boolean;
}

export interface RegionAnalysisResponse {
  analysis_job_id?: string;
  annotation_set_id: string;
  analyzer_results: RegionAnalyzerResult[];
  fused_regions?: FusedRegion[];
  fusion_stats?: {
    total_regions: number;
    avg_confidence: number;
    multi_vote_regions: number;
    total_grid_cells: number;
  };
  analyzer_statistics: Record<string, unknown>;
  status: string;
  error_message?: string;
}

export interface RegionAnalysisJob {
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
  total_regions_found: number;
  total_fused_regions: number;
  total_grid_cells: number;
  analyzer_statistics?: Record<string, unknown>;
  created_at: string;
  created_by_id: string;
}

export interface RegionAnalysisJobDetail extends RegionAnalysisJob {
  fused_regions: FusedRegion[];
}

export interface RegionAnalysisRequest {
  annotation_set_id: string;
  analyzer_names?: string[];
  analyzer_configs?: Record<string, Record<string, unknown>>;
  parallel?: boolean;
  fuse_results?: boolean;
  overlap_threshold?: number;
  save_to_database?: boolean;
}

export interface QuickRegionAnalysisRequest {
  annotation_set_id: string;
  analyzers?: string[];
  fuse_results?: boolean;
}

/**
 * Get list of available region analyzers
 */
export async function listRegionAnalyzers(
  token: string
): Promise<RegionAnalyzerInfo[]> {
  const response = await axios.get(
    `${API_URL}/api/v1/region-analysis/analyzers`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  return response.data.analyzers;
}

/**
 * Run full region analysis with database storage
 */
export async function runRegionAnalysis(
  request: RegionAnalysisRequest,
  token: string
): Promise<RegionAnalysisResponse> {
  const response = await axios.post(
    `${API_URL}/api/v1/region-analysis/analyze`,
    request,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  return response.data;
}

/**
 * Run quick region analysis without database storage
 */
export async function runQuickRegionAnalysis(
  request: QuickRegionAnalysisRequest,
  token: string
): Promise<RegionAnalysisResponse> {
  const response = await axios.post(
    `${API_URL}/api/v1/region-analysis/analyze/quick`,
    request,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  return response.data;
}

/**
 * List region analysis jobs
 */
export async function listRegionAnalysisJobs(
  token: string,
  params?: {
    annotation_set_id?: string;
    status?: string;
    page?: number;
    page_size?: number;
  }
): Promise<{
  jobs: RegionAnalysisJob[];
  total: number;
  page: number;
  page_size: number;
}> {
  const response = await axios.get(`${API_URL}/api/v1/region-analysis/jobs`, {
    params,
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data;
}

/**
 * Get detailed region analysis job results
 */
export async function getRegionAnalysisJob(
  jobId: string,
  token: string
): Promise<RegionAnalysisJobDetail> {
  const response = await axios.get(
    `${API_URL}/api/v1/region-analysis/jobs/${jobId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  return response.data;
}

/**
 * Delete region analysis job
 */
export async function deleteRegionAnalysisJob(
  jobId: string,
  token: string
): Promise<void> {
  await axios.delete(`${API_URL}/api/v1/region-analysis/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}
