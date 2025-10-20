// lib/api/integration-testing.ts

import type {
  MockExecutionRequest,
  MockExecutionResponse,
  StateScreenshotListResponse,
} from '@/types/integration-testing';

export async function executeMockProcess(
  request: MockExecutionRequest
): Promise<MockExecutionResponse> {
  const response = await fetch('/api/integration-testing/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Mock execution failed');
  }

  return response.json();
}

export async function getStateScreenshots(
  runId: string,
  activeStates?: string[]
): Promise<StateScreenshotListResponse> {
  const params = new URLSearchParams();
  if (activeStates && activeStates.length > 0) {
    params.set('active_states', activeStates.join(','));
  }

  const response = await fetch(
    `/api/integration-testing/snapshots/${runId}/screenshots?${params}`
  );

  if (!response.ok) {
    throw new Error('Failed to get screenshots');
  }

  return response.json();
}

export function getScreenshotUrl(runId: string, screenshotPath: string): string {
  return `/api/integration-testing/snapshots/${runId}/screenshot/${screenshotPath}`;
}

// Video Export Types
export interface VideoExportOptions {
  frameDuration: number;
  quality: '480p' | '720p' | '1080p';
  includeOverlays: boolean;
  includeTimeline: boolean;
  includeText: boolean;
  smoothTransitions: boolean;
}

export interface VideoExportResponse {
  video_id: string;
  status: string;
  progress: number;
  video_url?: string;
  file_size?: number;
  duration_seconds?: number;
  error?: string;
}

export interface VideoExportStatus {
  video_id: string;
  status: string;
  progress: number;
  video_url?: string;
  file_size?: number;
  duration_seconds?: number;
  error?: string;
}

// Video Export Functions
export async function exportExecutionVideo(
  executionData: MockExecutionResponse,
  options: VideoExportOptions
): Promise<VideoExportResponse> {
  const response = await fetch('/api/integration-testing/export/video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      execution_data: executionData,
      frame_duration: options.frameDuration,
      quality: options.quality,
      include_overlays: options.includeOverlays,
      include_timeline: options.includeTimeline,
      include_text: options.includeText,
      smooth_transitions: options.smoothTransitions,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Video export failed');
  }

  return response.json();
}

export async function getVideoExportStatus(videoId: string): Promise<VideoExportStatus> {
  const response = await fetch(
    `/api/integration-testing/export/video/${videoId}/status`
  );

  if (!response.ok) {
    throw new Error('Failed to get video export status');
  }

  return response.json();
}

export async function downloadVideo(videoId: string): Promise<void> {
  const response = await fetch(
    `/api/integration-testing/export/video/${videoId}/download`
  );

  if (!response.ok) {
    throw new Error('Failed to download video');
  }

  // Create download link
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `execution_${videoId}.mp4`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

export async function deleteVideo(videoId: string): Promise<void> {
  const response = await fetch(
    `/api/integration-testing/export/video/${videoId}`,
    {
      method: 'DELETE',
    }
  );

  if (!response.ok) {
    throw new Error('Failed to delete video');
  }
}

// PDF Report Types
export interface PDFReportOptions {
  executionResult: any;
  screenshotsDir: string;
  includeScreenshots?: boolean;
  includeCoverage?: boolean;
  includeTimeline?: boolean;
  includeRecommendations?: boolean;
  includeAppendices?: boolean;
  screenshotQuality?: 'low' | 'medium' | 'high';
  pageSize?: 'letter' | 'a4';
  title?: string;
}

// PDF Report Functions
export async function generatePDFReport(
  options: PDFReportOptions
): Promise<Blob> {
  const response = await fetch('/api/integration-testing/reports/pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      execution_result: options.executionResult,
      screenshots_dir: options.screenshotsDir,
      include_screenshots: options.includeScreenshots ?? true,
      include_coverage: options.includeCoverage ?? true,
      include_timeline: options.includeTimeline ?? true,
      include_recommendations: options.includeRecommendations ?? true,
      include_appendices: options.includeAppendices ?? true,
      screenshot_quality: options.screenshotQuality ?? 'medium',
      page_size: options.pageSize ?? 'letter',
      title: options.title,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'PDF generation failed');
  }

  return response.blob();
}
