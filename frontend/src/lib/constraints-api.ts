/**
 * Constraints API Client
 *
 * HTTP client for the constraint engine proxy endpoints on the FastAPI backend.
 * These endpoints proxy through to the runner's constraint engine and wrap
 * responses in { success: true, data: <T> } envelopes.
 *
 * Uses the same auth/CSRF pattern as the main ApiClient for consistency.
 */

import type {
  Constraint,
  ConstraintResult,
  ReadConfigResponse,
  ValidateConfigResponse,
  WriteConfigResponse,
} from "@qontinui/shared-types/constraints";
import { csrfService } from "@/services/csrf-service";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/** Build headers with credentials and CSRF token for mutation requests. */
function buildHeaders(method: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
    const csrfToken = csrfService.getToken();
    if (csrfToken) {
      headers["X-CSRF-Token"] = csrfToken;
    }
  }
  return headers;
}

/** Unwrap the runner's ApiResponse<T> envelope, returning the inner data. */
async function unwrapApiResponse<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (body.success && body.data !== undefined) {
    return body.data as T;
  }
  return body as T;
}

/**
 * Fetch active constraints for a project.
 *
 * Merges built-in constraints with project-level overrides and custom constraints
 * from constraints.toml.
 */
export async function fetchActiveConstraints(
  projectPath?: string
): Promise<Constraint[]> {
  const params = new URLSearchParams();
  if (projectPath) {
    params.set("project_path", projectPath);
  }
  const qs = params.toString();
  const url = `${API_BASE_URL}/api/v1/constraints/active${qs ? `?${qs}` : ""}`;

  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders("GET"),
    credentials: "include",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch active constraints: ${text}`);
  }
  return unwrapApiResponse<Constraint[]>(response);
}

/**
 * Fetch the raw TOML config content and file path.
 *
 * Returns an empty `toml` string and no `path` if no constraints.toml exists.
 */
export async function fetchConstraintConfig(
  projectPath?: string
): Promise<ReadConfigResponse> {
  const params = new URLSearchParams();
  if (projectPath) {
    params.set("project_path", projectPath);
  }
  const qs = params.toString();
  const url = `${API_BASE_URL}/api/v1/constraints/config${qs ? `?${qs}` : ""}`;

  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders("GET"),
    credentials: "include",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch constraint config: ${text}`);
  }
  return unwrapApiResponse<ReadConfigResponse>(response);
}

/**
 * Validate and write a TOML config string.
 *
 * The backend validates the TOML before writing. If validation fails,
 * `valid` will be false and `errors` will contain details.
 */
export async function saveConstraintConfig(
  toml: string,
  projectPath?: string
): Promise<WriteConfigResponse> {
  const url = `${API_BASE_URL}/api/v1/constraints/config`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders("POST"),
    credentials: "include",
    body: JSON.stringify({ toml, project_path: projectPath }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to save constraint config: ${text}`);
  }
  return unwrapApiResponse<WriteConfigResponse>(response);
}

/**
 * Validate a TOML config string without writing it.
 *
 * Useful for real-time validation in the editor before the user commits to saving.
 */
export async function validateConstraintConfig(
  toml: string
): Promise<ValidateConfigResponse> {
  const url = `${API_BASE_URL}/api/v1/constraints/validate`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders("POST"),
    credentials: "include",
    body: JSON.stringify({ toml }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to validate constraint config: ${text}`);
  }
  return unwrapApiResponse<ValidateConfigResponse>(response);
}

/**
 * Fetch constraint evaluation results for a specific task run.
 *
 * Optionally filter by iteration number.
 */
export async function fetchConstraintResults(
  taskRunId: string,
  iteration?: number
): Promise<ConstraintResult[]> {
  const params = new URLSearchParams();
  if (iteration !== undefined) {
    params.set("iteration", String(iteration));
  }
  const qs = params.toString();
  const url = `${API_BASE_URL}/api/v1/constraints/results/${encodeURIComponent(taskRunId)}${qs ? `?${qs}` : ""}`;

  const response = await fetch(url, {
    method: "GET",
    headers: buildHeaders("GET"),
    credentials: "include",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch constraint results: ${text}`);
  }
  return unwrapApiResponse<ConstraintResult[]>(response);
}
