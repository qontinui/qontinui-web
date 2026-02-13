/**
 * API Client Module
 *
 * Barrel export for the API client, types, and generated types.
 */

// Client singleton
export { apiClient } from "./client";

// Re-export types from api-types for backward compatibility
export type {
  FindingCategoryActionType,
  FindingCategoryConfig,
  FindingCategoryConfigCreate,
  FindingCategoryConfigUpdate,
  StepTypeConfig,
  StepTypeConfigCreate,
  StepTypeConfigUpdate,
  GuiActionTypeConfig,
  GuiActionTypeConfigCreate,
  GuiActionTypeConfigUpdate,
  WorkflowPhaseConfig,
  WorkflowPhaseConfigUpdate,
  WorkflowPhase,
  ImageUploadResponse,
  ImageProcessingStatus,
} from "./api-types";

// Re-export types from types.ts for backward compatibility
export type {
  User,
  Project,
  UserUpdate,
  ProjectCreate,
  ProjectUpdate,
} from "./types";
