/**
 * Constraints API Client
 *
 * HTTP client for the constraint engine proxy endpoints on the FastAPI backend.
 * These endpoints proxy through to the runner's constraint engine and wrap
 * responses in { success: true, data: <T> } envelopes.
 *
 * Every route is for platform admins only: a constraint's `command` check is
 * run by the runner's workflow loop on the backend's own host (coord finding
 * `5a6791e9-607c-4658-82e2-3b509e459996`). Anyone else gets the backend's
 * `require_admin` refusal, which {@link isConstraintsAdminRefusal} recognises
 * and the UI renders as {@link CONSTRAINTS_ADMIN_ONLY}, never as an empty
 * constraint list or a generic error.
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
import { isPlatformAdminRefusal } from "@/lib/api/fleet";

const API = `${ApiConfig.API_BASE_URL}/api/v1/constraints`;

/** What the constraints UI says in place of the constraints and their editors. */
export const CONSTRAINTS_ADMIN_ONLY =
  "Constraints are limited to platform administrators.";

/**
 * A failed `/api/v1/constraints` call: the readable sentence, plus the status
 * and parsed body it was read from, so a caller can tell the platform-admin
 * refusal apart from a failure (see {@link isConstraintsAdminRefusal}).
 */
export class ConstraintsApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ConstraintsApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Whether a failed constraints call is the backend's platform-admin refusal:
 * the caller is signed in but is not a platform admin. Only a
 * {@link ConstraintsApiError} carrying that exact refusal qualifies; any other
 * 403 (a proxy's, a WAF's) and any other failure is not it.
 */
export function isConstraintsAdminRefusal(err: unknown): boolean {
  return (
    err instanceof ConstraintsApiError &&
    isPlatformAdminRefusal(err.status, err.body)
  );
}

/** The readable sentence of a failed call's body, or `null` when it has none. */
function bodySentence(body: unknown): string | null {
  if (typeof body === "string") return body.trim() || null;
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  if (typeof record.detail === "string") return record.detail;
  return null;
}

/** Throw the failure of a call that did not answer 2xx. */
async function failed(response: Response, what: string): Promise<never> {
  const text = await response.text().catch(() => "");
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON (a proxy's HTML page): keep the text as the body.
  }
  const said = bodySentence(body) ?? `HTTP ${response.status}`;
  throw new ConstraintsApiError(
    `Failed to ${what}: ${said}`,
    response.status,
    body
  );
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
  const url = `${API}/active${qs ? `?${qs}` : ""}`;

  const response = await httpClient.fetch(url);
  if (!response.ok) {
    return failed(response, "fetch active constraints");
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
    return failed(response, "fetch constraint config");
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
    return failed(response, "save constraint config");
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
    // Safe to re-issue: `validate_constraint_config` only validates, writes nothing.
    idempotent: true,
  });
  if (!response.ok) {
    return failed(response, "validate constraint config");
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
    return failed(response, "fetch constraint results");
  }
  return unwrapApiResponse<ConstraintResult[]>(response);
}
