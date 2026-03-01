import type { LucideIcon } from "lucide-react";
import {
  GitCompare,
  Globe,
  TestTube2,
  Activity,
  Monitor,
  Rocket,
  ListOrdered,
  Plug,
  Palette,
  Paintbrush,
} from "lucide-react";

// =============================================================================
// Auto-run localStorage signal
// =============================================================================

export const AUTO_RUN_AFTER_GENERATE_KEY = "auto-run-after-generate";
export interface AutoRunAfterGenerate {
  taskRunId: string;
  timestamp: number;
}

// =============================================================================
// Component Props
// =============================================================================

export interface AiGeneratePanelProps {
  onCreateManually: () => void;
  isCreatingManually: boolean;
  onNavigateToActiveRuns: (taskRunId: string) => void;
}

// =============================================================================
// Icon lookup map for template icons
// =============================================================================

export const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  GitCompare,
  Globe,
  TestTube2,
  Activity,
  Monitor,
  Rocket,
  ListOrdered,
  Plug,
  Palette,
  Paintbrush,
};

// =============================================================================
// Submission action type
// =============================================================================

export type SubmittingAction = "generate" | "generate-and-run" | null;
