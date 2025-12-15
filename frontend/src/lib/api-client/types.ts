/**
 * Type helpers for the auto-generated OpenAPI types
 *
 * This file provides convenient type aliases and utilities for working with
 * the auto-generated types from the OpenAPI schema.
 *
 * Usage:
 *   import type { User, Project, ApiResponse } from '@/lib/api-client/types'
 */

import type { paths, components } from "./generated-types";

// ============================================================================
// Component Schemas (Models)
// ============================================================================

export type User = components["schemas"]["UserRead"];
export type UserCreate = components["schemas"]["UserCreate"];
export type UserUpdate = components["schemas"]["UserUpdate"];

export type Project = components["schemas"]["Project"];
export type ProjectCreate = components["schemas"]["ProjectCreate"];
export type ProjectUpdate = components["schemas"]["ProjectUpdate"];

export type BearerResponse = components["schemas"]["BearerResponse"];
export type ErrorModel = components["schemas"]["ErrorModel"];
export type HTTPValidationError = components["schemas"]["HTTPValidationError"];

export type StorageQuotaResponse =
  components["schemas"]["StorageQuotaResponse"];
export type UserProfileResponse = components["schemas"]["UserProfileResponse"];
export type UserProfileUpdate = components["schemas"]["UserProfileUpdate"];
export type ActivityLogResponse = components["schemas"]["ActivityLogResponse"];

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
 * Helper type to extract the response type from an API operation
 *
 * Usage:
 *   type Projects = ApiResponse<'get', '/api/v1/projects/'>
 */
export type ApiResponse<
  Method extends string,
  Route extends keyof paths,
> = Route extends keyof paths
  ? Method extends keyof paths[Route]
    ? paths[Route][Method] extends {
        responses: { 200: { content: { "application/json": infer T } } };
      }
      ? T
      : never
    : never
  : never;

/**
 * Helper type to extract the request body type from an API operation
 *
 * Usage:
 *   type CreateProjectBody = ApiRequestBody<'post', '/api/v1/projects/'>
 */
export type ApiRequestBody<
  Method extends string,
  Route extends keyof paths,
> = Route extends keyof paths
  ? Method extends keyof paths[Route]
    ? paths[Route][Method] extends {
        requestBody: { content: { "application/json": infer T } };
      }
      ? T
      : never
    : never
  : never;

// ============================================================================
// Convenience type aliases for common operations
// ============================================================================

// Auth operations
export type LoginRequest = ApiRequestBody<"post", "/api/v1/auth/jwt/login">;
export type LoginResponse = ApiResponse<"post", "/api/v1/auth/jwt/login">;
export type RegisterRequest = ApiRequestBody<"post", "/api/v1/auth/register">;
export type RegisterResponse = ApiResponse<"post", "/api/v1/auth/register">;

// User operations
export type CurrentUser = ApiResponse<"get", "/api/v1/auth/users/me">;
export type UpdateUserRequest = ApiRequestBody<
  "patch",
  "/api/v1/auth/users/me"
>;

// Project operations
export type ProjectsList = ApiResponse<"get", "/api/v1/projects/">;
export type SingleProject = ApiResponse<"get", "/api/v1/projects/{project_id}">;
export type CreateProjectRequest = ApiRequestBody<"post", "/api/v1/projects/">;
export type UpdateProjectRequest = ApiRequestBody<
  "put",
  "/api/v1/projects/{project_id}"
>;

// ============================================================================
// Utility types for better type safety
// ============================================================================

/**
 * Extract all available paths
 */
export type ApiPaths = keyof paths;

/**
 * Extract all available operations
 */
export type ApiOperations = {
  [P in ApiPaths]: keyof paths[P];
}[ApiPaths];

/**
 * Helper to create a type-safe API client method signature
 */
export type ApiMethod<
  Method extends string,
  Path extends ApiPaths,
> = paths[Path] extends { [K in Method]: infer Operation }
  ? Operation extends {
      responses: { 200: { content: { "application/json": infer Response } } };
      requestBody?: { content: { "application/json": infer Body } };
      parameters?: { path?: infer PathParams; query?: infer QueryParams };
    }
    ? (
        params: (PathParams extends Record<string, unknown> ? PathParams : {}) &
          (QueryParams extends Record<string, unknown>
            ? { query?: QueryParams }
            : {}),
        body?: Body
      ) => Promise<Response>
    : never
  : never;

// ============================================================================
// Type guards
// ============================================================================

/**
 * Type guard to check if a response is an error
 */
export function isApiError(response: unknown): response is ErrorModel {
  return (
    typeof response === "object" && response !== null && "detail" in response
  );
}

/**
 * Type guard to check if a response is a validation error
 */
export function isValidationError(
  response: unknown
): response is HTTPValidationError {
  return (
    typeof response === "object" &&
    response !== null &&
    "detail" in response &&
    Array.isArray((response as unknown).detail)
  );
}
