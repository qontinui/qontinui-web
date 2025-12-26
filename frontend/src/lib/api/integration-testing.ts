// lib/api/integration-testing.ts
// API client for Integration Testing feature (mock mode testing with historical data)

import type {
  MockExecutionRequest,
  MockExecutionResponse,
  StateScreenshotListResponse,
} from "@/types/integration-testing";

/**
 * Get authorization headers from localStorage
 * Returns empty object if no token (auth will use httpOnly cookies)
 */
function getAuthHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("auth_token");
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

/**
 * Execute a mock workflow using historical data.
 * This is used for Config Testing (workflow validation).
 */
export async function executeMockWorkflow(
  request: MockExecutionRequest
): Promise<MockExecutionResponse> {
  const response = await fetch("/api/integration-testing/execute", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    credentials: "include",
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Mock execution failed");
  }

  return response.json();
}

/**
 * Get screenshots for a snapshot run, optionally filtered by active states.
 */
export async function getStateScreenshots(
  runId: string,
  activeStates?: string[]
): Promise<StateScreenshotListResponse> {
  const params = new URLSearchParams();
  if (activeStates && activeStates.length > 0) {
    params.set("active_states", activeStates.join(","));
  }

  const response = await fetch(
    `/api/integration-testing/snapshots/${runId}/screenshots?${params}`,
    {
      headers: getAuthHeaders(),
      credentials: "include",
    }
  );

  if (!response.ok) {
    throw new Error("Failed to get screenshots");
  }

  return response.json();
}

/**
 * Get the URL for a specific screenshot.
 */
export function getScreenshotUrl(
  runId: string,
  screenshotPath: string
): string {
  return `/api/integration-testing/snapshots/${runId}/screenshot/${screenshotPath}`;
}

// PDF Report Types
export interface PDFReportOptions {
  executionResult: unknown;
  screenshotsDir: string;
  includeScreenshots?: boolean;
  includeCoverage?: boolean;
  includeTimeline?: boolean;
  includeRecommendations?: boolean;
  includeAppendices?: boolean;
  screenshotQuality?: "low" | "medium" | "high";
  pageSize?: "letter" | "a4";
  title?: string;
}

/**
 * Generate a PDF report for config test execution results.
 * Returns the PDF as a Blob for download.
 */
export async function generatePDFReport(
  options: PDFReportOptions
): Promise<Blob> {
  const response = await fetch("/api/integration-testing/reports/pdf", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    credentials: "include",
    body: JSON.stringify({
      execution_result: options.executionResult,
      screenshots_dir: options.screenshotsDir,
      include_screenshots: options.includeScreenshots ?? true,
      include_coverage: options.includeCoverage ?? true,
      include_timeline: options.includeTimeline ?? true,
      include_recommendations: options.includeRecommendations ?? true,
      include_appendices: options.includeAppendices ?? true,
      screenshot_quality: options.screenshotQuality ?? "medium",
      page_size: options.pageSize ?? "letter",
      title: options.title,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "PDF generation failed");
  }

  return response.blob();
}
