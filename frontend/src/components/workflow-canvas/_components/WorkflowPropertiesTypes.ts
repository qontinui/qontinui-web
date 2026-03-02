import type { Workflow } from "@/lib/action-schema/action-types";

export interface WorkflowSectionProps {
  workflow: Workflow;
}

export type UpdateMetadataFn = (key: string, value: unknown) => void;
export type UpdateSettingsFn = (key: string, value: unknown) => void;
