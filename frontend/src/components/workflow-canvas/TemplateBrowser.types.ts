import type { Workflow } from "@/lib/action-schema/action-types";
import type {
  WorkflowTemplate,
  TemplateCategory,
} from "@/services/workflow-templates";

export interface TemplateBrowserProps {
  onSelectTemplate: (workflow: Workflow, template: WorkflowTemplate) => void;
  onClose?: () => void;
  currentWorkflow?: Workflow;
}

export interface TemplateCardProps {
  template: WorkflowTemplate;
  onUse: () => void;
  onShowDetails: () => void;
}

export interface TemplateDetailsDialogProps {
  template: WorkflowTemplate;
  onClose: () => void;
  onUse: () => void;
}

export interface SaveTemplateDialogProps {
  onSave: (
    name: string,
    description: string,
    category: TemplateCategory,
    tags: string[]
  ) => void;
  onClose: () => void;
}

export interface WorkflowPreviewProps {
  workflow: Workflow;
  large?: boolean;
}

export type CategoryCounts = Record<TemplateCategory | "all", number>;
