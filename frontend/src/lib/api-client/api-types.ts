/**
 * Hand-written API Types
 *
 * Types for API endpoints that don't have OpenAPI-generated types,
 * including finding categories, step types, GUI action types,
 * workflow phases, and image storage types.
 */

// ============================================================================
// Finding Category Types
// ============================================================================

export type FindingCategoryActionType =
  | "auto_fix"
  | "needs_user_input"
  | "manual"
  | "informational";

export interface FindingCategoryConfig {
  id: string;
  user_id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  is_built_in: boolean;
  default_action_type: FindingCategoryActionType;
  sort_order: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface FindingCategoryConfigCreate {
  slug: string;
  name: string;
  description?: string;
  icon: string;
  color: string;
  default_action_type: FindingCategoryActionType;
  sort_order: number;
  enabled?: boolean;
}

export interface FindingCategoryConfigUpdate {
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  default_action_type?: FindingCategoryActionType;
  sort_order?: number;
  enabled?: boolean;
}

// ============================================================================
// Workflow Step Type Config Types
// ============================================================================

export type WorkflowPhase = "setup" | "verification" | "agentic" | "completion";

export interface StepTypeConfig {
  id: string;
  user_id: string;
  step_type: string;
  phase: WorkflowPhase;
  label: string;
  description: string;
  icon: string;
  color: string;
  is_built_in: boolean;
  sort_order: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface StepTypeConfigCreate {
  step_type: string;
  phase: WorkflowPhase;
  label: string;
  description?: string;
  icon: string;
  color: string;
  sort_order: number;
  enabled?: boolean;
}

export interface StepTypeConfigUpdate {
  label?: string;
  description?: string;
  icon?: string;
  color?: string;
  sort_order?: number;
  enabled?: boolean;
}

// ============================================================================
// GUI Action Type Config Types
// ============================================================================

export interface GuiActionTypeConfig {
  id: string;
  user_id: string;
  action_type: string;
  label: string;
  description: string;
  icon: string;
  is_built_in: boolean;
  sort_order: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface GuiActionTypeConfigCreate {
  action_type: string;
  label: string;
  description?: string;
  icon: string;
  sort_order: number;
  enabled?: boolean;
}

export interface GuiActionTypeConfigUpdate {
  label?: string;
  description?: string;
  icon?: string;
  sort_order?: number;
  enabled?: boolean;
}

// ============================================================================
// Workflow Phase Config Types
// ============================================================================

export interface WorkflowPhaseConfig {
  id: string;
  user_id: string;
  phase: WorkflowPhase;
  label: string;
  description: string;
  color: string;
  is_built_in: boolean;
  sort_order: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkflowPhaseConfigUpdate {
  label?: string;
  description?: string;
  color?: string;
  sort_order?: number;
  enabled?: boolean;
}

// ============================================================================
// Image Storage Types
// ============================================================================

export interface ImageUploadResponse {
  image_id: string;
  s3_key: string;
  presigned_url: string;
  size: number;
  content_type: string;
  created_at: string;
  status: "processing" | "completed";
  job_id?: string | null;
  variants?: {
    original: string;
    thumb: string;
    medium: string;
    large: string;
  };
  presigned_urls?: {
    original: string;
    thumb: string;
    medium: string;
    large: string;
  };
  url?: string;
}

export interface ImageProcessingStatus {
  status: "processing" | "completed" | "failed";
  variants?: {
    original: string;
    thumb: string;
    medium: string;
    large: string;
  };
  presigned_urls?: {
    original: string;
    thumb: string;
    medium: string;
    large: string;
  };
  error?: string;
}
