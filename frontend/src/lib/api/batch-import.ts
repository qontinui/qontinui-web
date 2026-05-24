/**
 * Batch Import API Client
 *
 * Functions for batch importing annotations from server directories.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export interface FileInfo {
  filename: string;
  path: string;
  size: number;
  format: string | null;
}

export interface ListFilesResponse {
  directory: string;
  files: FileInfo[];
  total_count: number;
  supported_count: number;
}

export interface BatchImportRequest {
  directory: string;
  format?: "auto" | "coco" | "yolo" | "csv";
  recursive?: boolean;
  screenshot_width?: number;
  screenshot_height?: number;
  skip_duplicates?: boolean;
}

export interface ImportedElement {
  id: string;
  label: string;
  element_type: string;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
  is_ground_truth: boolean;
  description?: string;
  reasoning?: string;
}

export interface FileImportResult {
  filename: string;
  status: "success" | "error" | "skipped";
  element_count: number;
  error?: string;
  format?: string;
}

export interface BatchImportResponse {
  success: boolean;
  total_files: number;
  successful_files: number;
  failed_files: number;
  skipped_files: number;
  total_elements: number;
  elements: ImportedElement[];
  file_results: FileImportResult[];
}

/**
 * List files in a server directory that can be imported.
 */
export async function listImportableFiles(
  directory: string,
  recursive: boolean = false,
  token?: string
): Promise<ListFilesResponse> {
  const params = new URLSearchParams({
    directory,
    recursive: String(recursive),
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(
    `${API_BASE}/api/v1/annotations/import/list-files?${params}`,
    { headers }
  );

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: "Unknown error" }));
    throw new Error(error.detail || `Failed to list files: ${response.status}`);
  }

  return response.json();
}

/**
 * Batch import annotations from a server directory.
 */
export async function batchImportFromServer(
  request: BatchImportRequest,
  token?: string
): Promise<BatchImportResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}/api/v1/annotations/import/batch`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      directory: request.directory,
      format: request.format || "auto",
      recursive: request.recursive ?? false,
      screenshot_width: request.screenshot_width || 1920,
      screenshot_height: request.screenshot_height || 1080,
      skip_duplicates: request.skip_duplicates ?? true,
    }),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: "Unknown error" }));
    throw new Error(error.detail || `Batch import failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Format file size for display.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
