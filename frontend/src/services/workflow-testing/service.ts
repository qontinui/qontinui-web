/**
 * Workflow Testing Service
 *
 * Core service class for the workflow testing framework.
 * Manages test cases, suites, execution, results, coverage, and persistence.
 */

import type { Workflow, Action } from "@/lib/action-schema/action-types";
import type {
  Assertion,
  AssertionResult,
  TestCase,
  TestCaseConfig,
  TestSuite,
  TestResult,
  TestStatistics,
  ActionCoverage,
  WorkflowCoverage,
  CoverageReport,
} from "./types";
import { createLogger } from "@/lib/logger";
const logger = createLogger("WorkflowTesting");

// ============================================================================
// Storage Keys
// ============================================================================

const STORAGE_KEYS = {
  TEST_CASES: "workflow-test-cases",
  TEST_SUITES: "workflow-test-suites",
  TEST_RESULTS: "workflow-test-results",
} as const;

// ============================================================================
// WorkflowTestingService Class
// ============================================================================

export class WorkflowTestingService {
  private testCases: Map<string, TestCase> = new Map();
  private testSuites: Map<string, TestSuite> = new Map();
  private testResults: Map<string, TestResult[]> = new Map();
  private runningTests: Map<string, AbortController> = new Map();

  constructor() {
    this.loadFromStorage();
  }

  // ==========================================================================
  // Test Case Management
  // ==========================================================================

  createTestCase(
    workflowId: string,
    config: TestCaseConfig,
    options?: {
      name?: string;
      description?: string;
      enabled?: boolean;
    }
  ): TestCase {
    const testCase: TestCase = {
      id: this.generateId("test"),
      name: options?.name || `Test Case ${this.testCases.size + 1}`,
      description: options?.description,
      workflowId,
      config,
      enabled: options?.enabled !== false,
      metadata: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    };

    this.testCases.set(testCase.id, testCase);
    this.saveToStorage();
    return testCase;
  }

  updateTestCase(
    testId: string,
    updates: Partial<Omit<TestCase, "id">>
  ): TestCase {
    const testCase = this.testCases.get(testId);
    if (!testCase) {
      throw new Error(`Test case not found: ${testId}`);
    }

    const updated: TestCase = {
      ...testCase,
      ...updates,
      id: testCase.id,
      metadata: {
        ...testCase.metadata,
        ...updates.metadata,
        updated: new Date().toISOString(),
      },
    };

    this.testCases.set(testId, updated);
    this.saveToStorage();
    return updated;
  }

  deleteTestCase(testId: string): boolean {
    if (!this.testCases.has(testId)) {
      return false;
    }

    this.testSuites.forEach((suite) => {
      if (suite.testCaseIds.includes(testId)) {
        this.removeTestFromSuite(suite.id, testId);
      }
    });

    this.testResults.delete(testId);
    this.testCases.delete(testId);
    this.saveToStorage();
    return true;
  }

  getTestCase(testId: string): TestCase | undefined {
    return this.testCases.get(testId);
  }

  getTestCasesForWorkflow(workflowId: string): TestCase[] {
    return Array.from(this.testCases.values()).filter(
      (test) => test.workflowId === workflowId
    );
  }

  getAllTestCases(): TestCase[] {
    return Array.from(this.testCases.values());
  }

  duplicateTestCase(testId: string, options?: { name?: string }): TestCase {
    const original = this.testCases.get(testId);
    if (!original) {
      throw new Error(`Test case not found: ${testId}`);
    }

    const duplicate: TestCase = {
      ...original,
      id: this.generateId("test"),
      name: options?.name || `${original.name} (Copy)`,
      metadata: {
        ...original.metadata,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    };

    this.testCases.set(duplicate.id, duplicate);
    this.saveToStorage();
    return duplicate;
  }

  // ==========================================================================
  // Test Suite Management
  // ==========================================================================

  createTestSuite(
    name: string,
    description?: string,
    testCaseIds: string[] = []
  ): TestSuite {
    const suite: TestSuite = {
      id: this.generateId("suite"),
      name,
      description,
      testCaseIds,
      executionOrder: "sequential",
      stopOnFailure: false,
      metadata: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    };

    this.testSuites.set(suite.id, suite);
    this.saveToStorage();
    return suite;
  }

  updateTestSuite(
    suiteId: string,
    updates: Partial<Omit<TestSuite, "id">>
  ): TestSuite {
    const suite = this.testSuites.get(suiteId);
    if (!suite) {
      throw new Error(`Test suite not found: ${suiteId}`);
    }

    const updated: TestSuite = {
      ...suite,
      ...updates,
      id: suite.id,
      metadata: {
        ...suite.metadata,
        ...updates.metadata,
        updated: new Date().toISOString(),
      },
    };

    this.testSuites.set(suiteId, updated);
    this.saveToStorage();
    return updated;
  }

  deleteTestSuite(suiteId: string): boolean {
    if (!this.testSuites.has(suiteId)) {
      return false;
    }

    this.testSuites.delete(suiteId);
    this.saveToStorage();
    return true;
  }

  getTestSuite(suiteId: string): TestSuite | undefined {
    return this.testSuites.get(suiteId);
  }

  getAllTestSuites(): TestSuite[] {
    return Array.from(this.testSuites.values());
  }

  addTestToSuite(suiteId: string, testCaseId: string): TestSuite {
    const suite = this.testSuites.get(suiteId);
    if (!suite) {
      throw new Error(`Test suite not found: ${suiteId}`);
    }

    if (!this.testCases.has(testCaseId)) {
      throw new Error(`Test case not found: ${testCaseId}`);
    }

    if (suite.testCaseIds.includes(testCaseId)) {
      return suite;
    }

    return this.updateTestSuite(suiteId, {
      testCaseIds: [...suite.testCaseIds, testCaseId],
    });
  }

  removeTestFromSuite(suiteId: string, testCaseId: string): TestSuite {
    const suite = this.testSuites.get(suiteId);
    if (!suite) {
      throw new Error(`Test suite not found: ${suiteId}`);
    }

    return this.updateTestSuite(suiteId, {
      testCaseIds: suite.testCaseIds.filter((id) => id !== testCaseId),
    });
  }

  // ==========================================================================
  // Test Execution (Mock Implementation)
  // ==========================================================================

  async runTestCase(testId: string, workflow?: Workflow): Promise<TestResult> {
    const testCase = this.testCases.get(testId);
    if (!testCase) {
      throw new Error(`Test case not found: ${testId}`);
    }

    if (!testCase.enabled) {
      throw new Error(`Test case is disabled: ${testId}`);
    }

    const startTime = new Date().toISOString();
    const abortController = new AbortController();
    this.runningTests.set(testId, abortController);

    try {
      await this.delay(100 + Math.random() * 500);

      if (abortController.signal.aborted) {
        throw new Error("Test execution was stopped");
      }

      const mockExecutionPath =
        workflow?.actions.slice(0, 3).map((a) => a.id) || [];
      const mockVariables = {
        ...testCase.config.inputs,
        result: "mock_result",
      };

      const assertionResults = testCase.config.assertions.map((assertion) =>
        this.evaluateAssertion(assertion, mockVariables)
      );

      const endTime = new Date().toISOString();
      const duration =
        new Date(endTime).getTime() - new Date(startTime).getTime();

      const allAssertionsPassed = assertionResults.every((r) => r.passed);
      const expectedBehaviorMet = true;

      const result: TestResult = {
        id: this.generateId("result"),
        testCaseId: testId,
        testCaseName: testCase.name,
        workflowId: testCase.workflowId,
        workflowName: workflow?.name,
        passed: allAssertionsPassed && expectedBehaviorMet,
        startTime,
        endTime,
        duration,
        assertions: assertionResults,
        executionPath: mockExecutionPath,
        finalState: {
          variables: mockVariables,
          activeStates: testCase.config.initialState?.activeStates || [],
        },
        actionsExecuted: mockExecutionPath.length,
        actionsSucceeded: mockExecutionPath.length,
      };

      this.saveTestResult(result);

      this.updateTestCase(testId, {
        metadata: {
          ...testCase.metadata,
          lastRun: endTime,
        },
      });

      return result;
    } catch (error) {
      const endTime = new Date().toISOString();
      const duration =
        new Date(endTime).getTime() - new Date(startTime).getTime();

      const result: TestResult = {
        id: this.generateId("result"),
        testCaseId: testId,
        testCaseName: testCase.name,
        workflowId: testCase.workflowId,
        workflowName: workflow?.name,
        passed: false,
        startTime,
        endTime,
        duration,
        assertions: [],
        error: error instanceof Error ? error.message : "Unknown error",
      };

      this.saveTestResult(result);
      return result;
    } finally {
      this.runningTests.delete(testId);
    }
  }

  async runTestSuite(
    suiteId: string,
    workflows?: Map<string, Workflow>
  ): Promise<TestResult[]> {
    const suite = this.testSuites.get(suiteId);
    if (!suite) {
      throw new Error(`Test suite not found: ${suiteId}`);
    }

    const results: TestResult[] = [];

    if (suite.executionOrder === "parallel") {
      const promises = suite.testCaseIds.map((testId) => {
        const testCase = this.testCases.get(testId);
        const workflow = testCase
          ? workflows?.get(testCase.workflowId)
          : undefined;
        return this.runTestCase(testId, workflow);
      });
      results.push(...(await Promise.all(promises)));
    } else {
      for (const testId of suite.testCaseIds) {
        const testCase = this.testCases.get(testId);
        const workflow = testCase
          ? workflows?.get(testCase.workflowId)
          : undefined;
        const result = await this.runTestCase(testId, workflow);
        results.push(result);

        if (!result.passed && suite.stopOnFailure) {
          break;
        }
      }
    }

    return results;
  }

  async runAllTests(workflows?: Map<string, Workflow>): Promise<TestResult[]> {
    const allTestIds = Array.from(this.testCases.keys());
    const results: TestResult[] = [];

    for (const testId of allTestIds) {
      const testCase = this.testCases.get(testId);
      if (testCase?.enabled) {
        const workflow = workflows?.get(testCase.workflowId);
        const result = await this.runTestCase(testId, workflow);
        results.push(result);
      }
    }

    return results;
  }

  async runTestsForWorkflow(
    workflowId: string,
    workflow?: Workflow
  ): Promise<TestResult[]> {
    const testCases = this.getTestCasesForWorkflow(workflowId);
    const results: TestResult[] = [];

    for (const testCase of testCases) {
      if (testCase.enabled) {
        const result = await this.runTestCase(testCase.id, workflow);
        results.push(result);
      }
    }

    return results;
  }

  stopTestExecution(testId: string): boolean {
    const controller = this.runningTests.get(testId);
    if (controller) {
      controller.abort();
      this.runningTests.delete(testId);
      return true;
    }
    return false;
  }

  isTestRunning(testId: string): boolean {
    return this.runningTests.has(testId);
  }

  // ==========================================================================
  // Assertions
  // ==========================================================================

  evaluateAssertion(assertion: Assertion, context: unknown): AssertionResult {
    try {
      const actualValue = assertion.path
        ? this.getValueByPath(context, assertion.path)
        : context;

      let passed = false;
      let error: string | undefined;

      switch (assertion.type) {
        case "equals":
          passed = this.deepEquals(actualValue, assertion.expected);
          if (!passed) {
            error = `Expected ${JSON.stringify(assertion.expected)}, got ${JSON.stringify(actualValue)}`;
          }
          break;

        case "notEquals":
          passed = !this.deepEquals(actualValue, assertion.expected);
          if (!passed) {
            error = `Expected value not to equal ${JSON.stringify(assertion.expected)}`;
          }
          break;

        case "contains":
          if (Array.isArray(actualValue)) {
            passed = actualValue.includes(assertion.expected);
          } else if (typeof actualValue === "string") {
            passed = actualValue.includes(assertion.expected as string);
          } else if (typeof actualValue === "object" && actualValue !== null) {
            passed = String(assertion.expected) in actualValue;
          }
          if (!passed) {
            error = `Expected to contain ${JSON.stringify(assertion.expected)}`;
          }
          break;

        case "notContains":
          if (Array.isArray(actualValue)) {
            passed = !actualValue.includes(assertion.expected);
          } else if (typeof actualValue === "string") {
            passed = !actualValue.includes(assertion.expected as string);
          } else if (typeof actualValue === "object" && actualValue !== null) {
            passed = !(String(assertion.expected) in actualValue);
          }
          if (!passed) {
            error = `Expected not to contain ${JSON.stringify(assertion.expected)}`;
          }
          break;

        case "exists":
          passed = actualValue !== undefined && actualValue !== null;
          if (!passed) {
            error = "Expected value to exist";
          }
          break;

        case "notExists":
          passed = actualValue === undefined || actualValue === null;
          if (!passed) {
            error = "Expected value not to exist";
          }
          break;

        case "greaterThan":
          passed =
            typeof actualValue === "number" &&
            actualValue > (assertion.expected as number);
          if (!passed) {
            error = `Expected ${actualValue} to be greater than ${assertion.expected}`;
          }
          break;

        case "lessThan":
          passed =
            typeof actualValue === "number" &&
            actualValue < (assertion.expected as number);
          if (!passed) {
            error = `Expected ${actualValue} to be less than ${assertion.expected}`;
          }
          break;

        case "regex":
          if (assertion.pattern) {
            const regex = new RegExp(assertion.pattern);
            passed = regex.test(String(actualValue));
            if (!passed) {
              error = `Expected ${actualValue} to match pattern ${assertion.pattern}`;
            }
          } else {
            passed = false;
            error = "No regex pattern provided";
          }
          break;

        case "custom":
          if (assertion.customFunction) {
            try {
              const fn = new Function(
                "value",
                "context",
                assertion.customFunction
              );
              passed = Boolean(fn(actualValue, context));
            } catch (err) {
              passed = false;
              error = `Custom function error: ${err instanceof Error ? err.message : "Unknown error"}`;
            }
          } else {
            passed = false;
            error = "No custom function provided";
          }
          break;

        default:
          passed = false;
          error = `Unknown assertion type: ${assertion.type}`;
      }

      return {
        assertion,
        passed,
        actualValue,
        error,
      };
    } catch (err) {
      return {
        assertion,
        passed: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  // ==========================================================================
  // Test Results
  // ==========================================================================

  saveTestResult(result: TestResult): void {
    if (!this.testResults.has(result.testCaseId)) {
      this.testResults.set(result.testCaseId, []);
    }

    const results = this.testResults.get(result.testCaseId)!;
    results.unshift(result);

    if (results.length > 100) {
      results.splice(100);
    }

    this.saveToStorage();
  }

  getTestResults(testId: string, limit?: number): TestResult[] {
    const results = this.testResults.get(testId) || [];
    return limit ? results.slice(0, limit) : results;
  }

  getTestHistory(testId: string): TestResult[] {
    return this.getTestResults(testId);
  }

  getTestStatistics(testId: string): TestStatistics | null {
    const results = this.testResults.get(testId);
    if (!results || results.length === 0) {
      return null;
    }

    const successfulRuns = results.filter((r) => r.passed).length;
    const failedRuns = results.length - successfulRuns;
    const durations = results.map((r) => r.duration);

    return {
      testCaseId: testId,
      totalRuns: results.length,
      successfulRuns,
      failedRuns,
      passRate: (successfulRuns / results.length) * 100,
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      lastRun: results[0]?.endTime,
      lastPassed: results[0]?.passed,
    };
  }

  clearTestResults(testId: string): boolean {
    if (!this.testResults.has(testId)) {
      return false;
    }

    this.testResults.delete(testId);
    this.saveToStorage();
    return true;
  }

  getAllTestResults(): Map<string, TestResult[]> {
    return new Map(this.testResults);
  }

  // ==========================================================================
  // Coverage Analysis
  // ==========================================================================

  calculateCoverage(workflowId: string, workflow: Workflow): WorkflowCoverage {
    const testCases = this.getTestCasesForWorkflow(workflowId);
    const testCaseIds = testCases.map((t) => t.id);

    const allResults = testCases.flatMap((tc) => this.getTestResults(tc.id));

    const actionCoverageMap = new Map<string, ActionCoverage>();

    workflow.actions.forEach((action) => {
      actionCoverageMap.set(action.id, {
        actionId: action.id,
        actionType: action.type,
        actionName: action.name,
        covered: false,
        coveredByTests: [],
        testCount: 0,
      });
    });

    allResults.forEach((result) => {
      if (result.executionPath) {
        result.executionPath.forEach((actionId) => {
          const coverage = actionCoverageMap.get(actionId);
          if (coverage) {
            coverage.covered = true;
            if (!coverage.coveredByTests.includes(result.testCaseId)) {
              coverage.coveredByTests.push(result.testCaseId);
            }
            coverage.testCount++;
          }
        });
      }
    });

    const actions = Array.from(actionCoverageMap.values());
    const coveredActions = actions.filter((a) => a.covered).length;
    const untestedActions = actions
      .filter((a) => !a.covered)
      .map((a) => a.actionId);

    return {
      workflowId,
      workflowName: workflow.name,
      coveragePercentage:
        workflow.actions.length > 0
          ? (coveredActions / workflow.actions.length) * 100
          : 0,
      totalActions: workflow.actions.length,
      coveredActions,
      actions,
      untestedActions,
      testCases: testCaseIds,
    };
  }

  getUntestedActions(workflowId: string, workflow: Workflow): Action[] {
    const coverage = this.calculateCoverage(workflowId, workflow);
    return workflow.actions.filter((action) =>
      coverage.untestedActions.includes(action.id)
    );
  }

  getCoverageReport(workflows: Map<string, Workflow>): CoverageReport {
    const workflowCoverages: WorkflowCoverage[] = [];

    workflows.forEach((workflow, workflowId) => {
      const coverage = this.calculateCoverage(workflowId, workflow);
      workflowCoverages.push(coverage);
    });

    const totalActions = workflowCoverages.reduce(
      (sum, wc) => sum + wc.totalActions,
      0
    );
    const coveredActions = workflowCoverages.reduce(
      (sum, wc) => sum + wc.coveredActions,
      0
    );

    return {
      timestamp: new Date().toISOString(),
      workflows: workflowCoverages,
      overallCoverage:
        totalActions > 0 ? (coveredActions / totalActions) * 100 : 0,
      totalWorkflows: workflows.size,
      summary: {
        totalActions,
        coveredActions,
        totalTestCases: this.testCases.size,
        totalTestSuites: this.testSuites.size,
      },
    };
  }

  // ==========================================================================
  // Import/Export
  // ==========================================================================

  exportTestSuite(suiteId: string): string {
    const suite = this.testSuites.get(suiteId);
    if (!suite) {
      throw new Error(`Test suite not found: ${suiteId}`);
    }

    const testCases = suite.testCaseIds
      .map((id) => this.testCases.get(id))
      .filter((tc): tc is TestCase => tc !== undefined);

    const exportData = {
      suite,
      testCases,
      exportedAt: new Date().toISOString(),
      version: "1.0.0",
    };

    return JSON.stringify(exportData, null, 2);
  }

  importTestSuite(data: string): TestSuite {
    try {
      const parsed = JSON.parse(data);

      if (!parsed.suite || !parsed.testCases) {
        throw new Error("Invalid test suite export format");
      }

      const testCaseIdMap = new Map<string, string>();

      for (const testCase of parsed.testCases) {
        const oldId = testCase.id;
        const newTestCase = this.createTestCase(
          testCase.workflowId,
          testCase.config,
          {
            name: testCase.name,
            description: testCase.description,
            enabled: testCase.enabled,
          }
        );
        testCaseIdMap.set(oldId, newTestCase.id);
      }

      const newTestCaseIds = parsed.suite.testCaseIds
        .map((id: string) => testCaseIdMap.get(id))
        .filter((id: string | undefined): id is string => id !== undefined);

      const suite = this.createTestSuite(
        parsed.suite.name,
        parsed.suite.description,
        newTestCaseIds
      );

      return this.updateTestSuite(suite.id, {
        executionOrder: parsed.suite.executionOrder,
        stopOnFailure: parsed.suite.stopOnFailure,
        tags: parsed.suite.tags,
      });
    } catch (error) {
      throw new Error(
        `Failed to import test suite: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  exportTestResults(testId: string): string {
    const testCase = this.testCases.get(testId);
    const results = this.testResults.get(testId) || [];
    const statistics = this.getTestStatistics(testId);

    const exportData = {
      testCase,
      results,
      statistics,
      exportedAt: new Date().toISOString(),
      version: "1.0.0",
    };

    return JSON.stringify(exportData, null, 2);
  }

  exportAll(): string {
    const exportData = {
      testCases: Array.from(this.testCases.values()),
      testSuites: Array.from(this.testSuites.values()),
      testResults: Array.from(this.testResults.entries()),
      exportedAt: new Date().toISOString(),
      version: "1.0.0",
    };

    return JSON.stringify(exportData, null, 2);
  }

  importAll(data: string): void {
    try {
      const parsed = JSON.parse(data);

      if (parsed.testCases) {
        parsed.testCases.forEach((tc: TestCase) => {
          this.testCases.set(tc.id, tc);
        });
      }

      if (parsed.testSuites) {
        parsed.testSuites.forEach((suite: TestSuite) => {
          this.testSuites.set(suite.id, suite);
        });
      }

      if (parsed.testResults) {
        this.testResults = new Map(parsed.testResults);
      }

      this.saveToStorage();
    } catch (error) {
      throw new Error(
        `Failed to import test data: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  // ==========================================================================
  // Persistence (localStorage)
  // ==========================================================================

  private saveToStorage(): void {
    try {
      localStorage.setItem(
        STORAGE_KEYS.TEST_CASES,
        JSON.stringify(Array.from(this.testCases.entries()))
      );

      localStorage.setItem(
        STORAGE_KEYS.TEST_SUITES,
        JSON.stringify(Array.from(this.testSuites.entries()))
      );

      localStorage.setItem(
        STORAGE_KEYS.TEST_RESULTS,
        JSON.stringify(Array.from(this.testResults.entries()))
      );
    } catch (error) {
      logger.error("Failed to save to localStorage:", error);
    }
  }

  private loadFromStorage(): void {
    if (typeof window === "undefined") return;
    try {
      const testCasesData = localStorage.getItem(STORAGE_KEYS.TEST_CASES);
      if (testCasesData) {
        this.testCases = new Map(JSON.parse(testCasesData));
      }

      const testSuitesData = localStorage.getItem(STORAGE_KEYS.TEST_SUITES);
      if (testSuitesData) {
        this.testSuites = new Map(JSON.parse(testSuitesData));
      }

      const testResultsData = localStorage.getItem(STORAGE_KEYS.TEST_RESULTS);
      if (testResultsData) {
        this.testResults = new Map(JSON.parse(testResultsData));
      }
    } catch (error) {
      logger.error("Failed to load from localStorage:", error);
    }
  }

  clearStorage(): void {
    this.testCases.clear();
    this.testSuites.clear();
    this.testResults.clear();
    this.runningTests.clear();

    localStorage.removeItem(STORAGE_KEYS.TEST_CASES);
    localStorage.removeItem(STORAGE_KEYS.TEST_SUITES);
    localStorage.removeItem(STORAGE_KEYS.TEST_RESULTS);
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private deepEquals(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== typeof b) return false;

    if (typeof a === "object" && typeof b === "object") {
      const aRecord = a as Record<string, unknown>;
      const bRecord = b as Record<string, unknown>;
      const aKeys = Object.keys(aRecord);
      const bKeys = Object.keys(bRecord);

      if (aKeys.length !== bKeys.length) return false;

      return aKeys.every((key) => this.deepEquals(aRecord[key], bRecord[key]));
    }

    return false;
  }

  private getValueByPath(obj: unknown, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = obj;

    for (const part of parts) {
      if (current == null) return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ==========================================================================
// Singleton Instance
// ==========================================================================

let instance: WorkflowTestingService | null = null;

export function getWorkflowTestingService(): WorkflowTestingService {
  if (!instance) {
    instance = new WorkflowTestingService();
  }
  return instance;
}

export function resetWorkflowTestingService(): void {
  instance = null;
}
