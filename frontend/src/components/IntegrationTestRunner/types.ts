import type {
  TestRunSummary,
  TestResult,
  TestingState,
  MockMode,
} from "@/lib/runner-client";

export interface TestConfig {
  name: string;
  config_path?: string;
  assertions: Array<{
    type: string;
    target: string;
    expected?: string;
    timeout_seconds?: number;
  }>;
}

export interface NewAssertion {
  type: string;
  target: string;
  expected: string;
  timeout_seconds: number;
}

export interface IntegrationTestState {
  testRuns: TestRunSummary[];
  selectedRunId: string | null;
  testResults: TestResult[];
  loading: boolean;
  error: string | null;
  states: TestingState[];
  activeStates: string[];
  mockMode: MockMode;
  testConfig: TestConfig;
  newAssertion: NewAssertion;
  isRunnerConnected: boolean;
}

export interface IntegrationTestActions {
  setSelectedRunId: (id: string | null) => void;
  setError: (error: string | null) => void;
  setTestConfig: (config: TestConfig) => void;
  setNewAssertion: (assertion: NewAssertion) => void;
  loadTestRuns: () => Promise<void>;
  loadStates: () => Promise<void>;
  loadActiveStates: () => Promise<void>;
  startTestRun: () => Promise<void>;
  runAssertion: () => Promise<void>;
  handleSetMockMode: (mode: MockMode) => Promise<void>;
  endTestRun: () => Promise<void>;
  traverseToState: (stateName: string) => Promise<void>;
}
