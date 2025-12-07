import type {
  Organization,
  UserPresence,
  Lock,
  Comment,
  Activity,
  ResourceType,
} from "@/types/collaboration";
import type { PermissionLevel } from "@/lib/permissions";

// ============================================================================
// Shared Provider Props
// ============================================================================

export interface CollaborationProviderProps {
  children: React.ReactNode;
  projectId: string;
  workflowId?: string;
}

// ============================================================================
// Re-export collaboration types for convenience
// ============================================================================

export type {
  Organization,
  UserPresence,
  Lock,
  Comment,
  Activity,
  ResourceType,
  PermissionLevel,
};
