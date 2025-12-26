/**
 * Project Validator
 *
 * Handles validation of project IDs and URL parameters.
 * Extracts project ID from various sources (URL, context, localStorage).
 */

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether the project ID is valid */
  isValid: boolean;
  /** The normalized project ID (trimmed, etc.) */
  projectId: string | null;
  /** Source of the project ID */
  source: "url" | "context" | "storage" | "none";
  /** Error message if invalid */
  error?: string;
}

/**
 * UUID v4 regex pattern
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Numeric ID pattern (for legacy IDs)
 */
const NUMERIC_PATTERN = /^\d+$/;

/**
 * Validate a project ID string
 */
export function validateProjectId(projectId: unknown): ValidationResult {
  // Check for null/undefined
  if (projectId === null || projectId === undefined) {
    return {
      isValid: false,
      projectId: null,
      source: "none",
      error: "Project ID is null or undefined",
    };
  }

  // Check for string type
  if (typeof projectId !== "string") {
    return {
      isValid: false,
      projectId: null,
      source: "none",
      error: `Project ID must be a string, got ${typeof projectId}`,
    };
  }

  // Trim and check for empty
  const trimmed = projectId.trim();
  if (trimmed === "") {
    return {
      isValid: false,
      projectId: null,
      source: "none",
      error: "Project ID is empty after trimming",
    };
  }

  // Validate format (UUID or numeric)
  const isUUID = UUID_PATTERN.test(trimmed);
  const isNumeric = NUMERIC_PATTERN.test(trimmed);

  if (!isUUID && !isNumeric) {
    return {
      isValid: false,
      projectId: null,
      source: "none",
      error: `Invalid project ID format: ${trimmed}`,
    };
  }

  return {
    isValid: true,
    projectId: trimmed,
    source: "none", // Source will be set by caller
  };
}

/**
 * Extract and validate project ID from URL search params
 */
export function extractProjectIdFromUrl(
  searchParams: URLSearchParams | null
): ValidationResult {
  if (!searchParams) {
    return {
      isValid: false,
      projectId: null,
      source: "url",
      error: "No search params provided",
    };
  }

  const projectParam = searchParams.get("project");
  if (!projectParam) {
    return {
      isValid: false,
      projectId: null,
      source: "url",
    };
  }

  const result = validateProjectId(projectParam);
  return {
    ...result,
    source: "url",
  };
}

/**
 * Determine the effective project ID from multiple sources
 */
export function resolveProjectId(options: {
  urlProjectId: string | null;
  contextProjectId: string | null;
  storageProjectId?: string | null;
}): ValidationResult {
  const { urlProjectId, contextProjectId, storageProjectId } = options;

  // Priority 1: URL
  if (urlProjectId) {
    const result = validateProjectId(urlProjectId);
    if (result.isValid) {
      return { ...result, source: "url" };
    }
  }

  // Priority 2: Context
  if (contextProjectId) {
    const result = validateProjectId(contextProjectId);
    if (result.isValid) {
      return { ...result, source: "context" };
    }
  }

  // Priority 3: Storage
  if (storageProjectId) {
    const result = validateProjectId(storageProjectId);
    if (result.isValid) {
      return { ...result, source: "storage" };
    }
  }

  return {
    isValid: false,
    projectId: null,
    source: "none",
  };
}

/**
 * Check if two project IDs are different (for determining if save is needed)
 */
export function projectIdsDiffer(
  id1: string | null,
  id2: string | null
): boolean {
  if (id1 === null && id2 === null) return false;
  if (id1 === null || id2 === null) return true;
  return id1.trim() !== id2.trim();
}
