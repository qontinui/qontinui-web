/**
 * Type aliases over the auto-generated OpenAPI types
 *
 * Holds only the aliases something imports. Add one here when a consumer
 * needs it rather than pre-declaring the whole schema.
 *
 * Usage:
 *   import type { User, Project } from '@/lib/api-client/types'
 */

import type { components } from "./generated-types";

export type User = components["schemas"]["UserRead"];
export type UserUpdate = components["schemas"]["UserUpdate"];

// Extend Project type with version field (not in generated types but returned by backend)
type ProjectBase = components["schemas"]["Project"];
export type Project = ProjectBase & {
  /** Server version for optimistic concurrency control */
  version: number;
};
export type ProjectCreate = components["schemas"]["ProjectCreate"];
export type ProjectUpdate = components["schemas"]["ProjectUpdate"];
