// =============================================================================
// Testing Types
// =============================================================================

export interface TestResult {
  id: number;
  test_name: string;
  status: string;
  duration_ms: number;
  timestamp: string;
  specs?: TestSpec[];
}

export interface TestSpec {
  name: string;
  status: string;
  duration_ms: number;
  error?: string;
}

export interface ExecutionSpan {
  id: number;
  task_run_id: number;
  name: string;
  phase: string;
  start_time: string;
  end_time?: string;
  duration_ms?: number;
  status: string;
}
