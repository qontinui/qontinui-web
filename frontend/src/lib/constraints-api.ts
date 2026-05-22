/**
 * Constraints API Client
 *
 * HTTP client for the constraint engine proxy endpoints on the FastAPI backend.
 * These endpoints proxy through to the runner's constraint engine and wrap
 * responses in { success: true, data: <T> } envelopes.
 *
 * Goes through httpClient.fetch so Authorization: Bearer is attached in
 * remote/staging mode and HttpOnly cookies still ride along in local mode.
 */

import type {
  Constraint,
  ConstraintResult,
  ReadConfigResponse,
  ValidateConfigResponse,
  WriteConfigResponse,
} from "@qontinui/shared-types/constraints";
import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";

const API = `${ApiConfig.API_BASE_URL}/api/v1/constraints`;

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
  const url = `${API}/active${qs ? `?${qs}` : ""}`;

  const response = await httpClient.fetch(url);
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
  const url = `${API}/config${qs ? `?${qs}` : ""}`;

  const response = await httpClient.fetch(url);
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
  const response = await httpClient.fetch(`${API}/config`, {
    method: "POST",
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
  const response = await httpClient.fetch(`${API}/validate`, {
    method: "POST",
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
  const url = `${API}/results/${encodeURIComponent(taskRunId)}${qs ? `?${qs}` : ""}`;

  const response = await httpClient.fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch constraint results: ${text}`);
  }
  return unwrapApiResponse<ConstraintResult[]>(response);
}
