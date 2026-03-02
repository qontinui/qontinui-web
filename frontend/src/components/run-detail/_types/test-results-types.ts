import type { IndividualCheckResult, LoopResult } from "@/lib/runner-api";
import type { ComparisonResult } from "@/lib/runner/types/exploration";

export interface TestResultsTabProps {
  runId: string;
  loopResult?: LoopResult | null;
}

export interface NormalizedTestResult {
  id: string;
  name: string;
  status: "passed" | "failed" | "skipped";
  duration_ms?: number;
  assertions_passed?: number;
  assertions_total?: number;
  console_output?: string;
  page_snapshot?: string;
  error_message?: string;
  stack_trace?: string;
  screenshot_path?: string;
  source: "playwright" | "verification";
  step_type?: string;
  test_type?: string;
  check_results?: IndividualCheckResult[];
  comparison_result?: ComparisonResult;
}

export interface IterationGroup {
  iteration: number;
  all_passed: boolean;
  tests: NormalizedTestResult[];
  total_duration_ms: number;
}
