/**
 * Global Variables Type Definitions
 *
 * Types for managing project-scoped global variables that are shared
 * across all workflows in a project.
 */

export type VariableType = "string" | "number" | "boolean" | "object" | "array";

export interface GlobalVariable {
  name: string;
  value: unknown;
  type: VariableType;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CreateVariableRequest {
  name: string;
  value: unknown;
  description?: string;
}

export interface UpdateVariableRequest {
  value: unknown;
  description?: string;
}

export interface VariableValidationError {
  field: string;
  message: string;
}

export interface VariableImportExport {
  version: string;
  exported_at: string;
  variables: GlobalVariable[];
}
