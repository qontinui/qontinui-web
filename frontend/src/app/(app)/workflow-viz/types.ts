import type { Workflow } from "@/lib/action-schema/action-types";

export type WorkflowWithProject = Workflow & { projectName?: string };
