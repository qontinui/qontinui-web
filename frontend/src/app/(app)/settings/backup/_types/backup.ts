export const CATEGORY_LABELS: Record<string, string> = {
  flows: "Flows",
  flow_executions: "Flow Executions",
  checkpoints: "Checkpoints",
  learning_outcomes: "Learning Outcomes",
  learning_patterns: "Learning Patterns",
  settings: "Settings",
  prompts: "Prompts",
  unified_workflows: "Unified Workflows",
  verification_tests: "Verification Tests",
  task_hooks: "Task Hooks",
  scheduled_tasks: "Scheduled Tasks",
  saved_api_requests: "Saved API Requests",
  configs: "Configurations",
};

export const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS);

export function createDefaultOptions(): Record<string, boolean> {
  const options: Record<string, boolean> = {};
  for (const key of ALL_CATEGORIES) {
    options[key] = true;
  }
  return options;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
  details: Record<
    string,
    { imported: number; skipped: number; errors: number }
  >;
}

export interface ImportOptions {
  conflict_resolution: string;
  categories: Record<string, boolean>;
}
