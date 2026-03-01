import type { SavedApiRequest } from "@/lib/runner/types/library";

export type TestType = "python_script" | "playwright_cdp";

export type OrchestratorPhase =
  | "selection"
  | "planning"
  | "execution"
  | "generation";

export interface VariableExtraction {
  variable_name: string;
  json_path: string;
  default_value?: string;
}

export interface VariableMappingInfo {
  variable_name: string;
  source_step: number;
  json_path: string;
  used_in_steps: number[];
  description: string;
}

export interface VerificationSuggestion {
  condition: string;
  description: string;
  json_path?: string;
  step_index: number;
}

export interface OrchestrationStep {
  step_index: number;
  name: string;
  request_id: string;
  extractions: VariableExtraction[];
  depends_on: number[];
  purpose: string;
  url_template: string;
  body_template?: string;
}

export interface OrchestrationPlan {
  id: string;
  request: {
    request_ids: string[];
    test_description: string;
    context?: string;
  };
  steps: OrchestrationStep[];
  variable_mappings: VariableMappingInfo[];
  verification_suggestions: VerificationSuggestion[];
  explanation: string;
  created_at: string;
}

export interface ExecutedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface ExecutedResponse {
  status_code: number;
  headers: Record<string, string>;
  body: unknown;
  content_type?: string;
  size_bytes: number;
}

export interface StepExecutionResult {
  step_index: number;
  step_name: string;
  request: ExecutedRequest;
  response: ExecutedResponse;
  extracted_variables: Record<string, unknown>;
  success: boolean;
  error?: string;
  duration_ms: number;
}

export interface OrchestrationExecutionResult {
  plan_id: string;
  step_results: StepExecutionResult[];
  all_variables: Record<string, unknown>;
  success: boolean;
  failed_at_step?: number;
  total_duration_ms: number;
  started_at: string;
  completed_at: string;
}

export interface TestStep {
  step_number: number;
  action: string;
  expected: string;
  step_type: "setup" | "request" | "assertion" | "cleanup";
}

export interface GeneratedTest {
  name: string;
  description: string;
  code: string;
  test_type: string;
  explanation: string;
  steps: TestStep[];
}

export interface TestOrchestratorProps {
  /** Callback when test code is generated and applied */
  onTestGenerated?: (code: string, testType: TestType) => void;
  /** Optional className for the root element */
  className?: string;
}

export interface SelectionPhaseProps {
  requests: SavedApiRequest[];
  selectedIds: Set<string>;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  loadingRequests: boolean;
  totalAvailable: number;
  testDescription: string;
  onDescriptionChange: (d: string) => void;
  additionalContext: string;
  onContextChange: (c: string) => void;
  testType: TestType;
  onTestTypeChange: (t: TestType) => void;
}

export interface PlanningPhaseProps {
  plan: OrchestrationPlan | null;
  planning: boolean;
  selectedCount: number;
}

export interface ExecutionPhaseProps {
  plan: OrchestrationPlan | null;
  executionResult: OrchestrationExecutionResult | null;
  executing: boolean;
  currentStepIndex: number;
}

export interface GenerationPhaseProps {
  generatedTest: GeneratedTest | null;
  generating: boolean;
  testType: TestType;
  onCopyCode: () => void;
}

export interface PlanVisualizationProps {
  plan: OrchestrationPlan;
  currentStepIndex: number;
  isExecuting?: boolean;
}

export interface ExecutionLogProps {
  result: OrchestrationExecutionResult;
}

export interface TestStepsPreviewProps {
  steps: TestStep[];
}
