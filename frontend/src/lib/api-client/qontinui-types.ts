/**
 * Type helpers for the Qontinui API auto-generated types
 *
 * This file provides convenient type aliases for working with
 * the Qontinui pattern matching API.
 */

import type { paths, components } from "./qontinui-generated-types";

// ============================================================================
// Component Schemas (Models)
// ============================================================================

// These types are inferred from the OpenAPI schema components
export type OptimizePatternRequest =
  components["schemas"]["OptimizePatternRequest"];
export type OptimizePatternResponse =
  components["schemas"]["OptimizePatternResponse"];
export type CreateStateImageRequest =
  components["schemas"]["CreateStateImageRequest"];
export type RemoveBackgroundRequest =
  components["schemas"]["RemoveBackgroundRequest"];
export type RemoveBackgroundResponse =
  components["schemas"]["RemoveBackgroundResponse"];
export type ValidationResult = components["schemas"]["ValidationResult"];

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Helper type to extract response from API operations
 */
export type QontinuiApiResponse<
  Method extends keyof Route,
  Route extends keyof paths,
> = paths[Route][Method] extends {
  responses: { 200: { content: { "application/json": infer T } } };
}
  ? T
  : never;

/**
 * Helper type to extract request body from API operations
 */
export type QontinuiApiRequestBody<
  Method extends keyof Route,
  Route extends keyof paths,
> = paths[Route][Method] extends {
  requestBody: { content: { "application/json": infer T } };
}
  ? T
  : never;
