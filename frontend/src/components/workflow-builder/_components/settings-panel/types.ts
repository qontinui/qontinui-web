import type { UnifiedWorkflow } from "@/types/unified-workflow";

export interface SettingRenderProps {
  workflow: UnifiedWorkflow;
  updateWorkflow: (updates: Partial<UnifiedWorkflow>) => void;
  selectClass: string;
}
