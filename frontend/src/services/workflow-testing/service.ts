/**
 * Workflow Testing Service
 *
 * Core service class for the workflow testing framework: authoring and
 * persistence of test cases and suites.
 *
 * It runs nothing. The in-browser runner it used to carry was a simulator
 * (random delay, mock variables, an always-met expected behavior), so it and
 * the results, statistics and coverage computed from its runs were removed:
 * no store serves a web-simulated run.
 */

import type { TestCase, TestCaseConfig, TestSuite } from "./types";
import { createLogger } from "@/lib/logger";
const logger = createLogger("WorkflowTesting");

// ============================================================================
// Storage Keys
// ============================================================================

const STORAGE_KEYS = {
  TEST_CASES: "workflow-test-cases",
  TEST_SUITES: "workflow-test-suites",
  /** Simulated-run results written by the removed runner; only ever cleared. */
  LEGACY_TEST_RESULTS: "workflow-test-results",
} as const;

// ============================================================================
// WorkflowTestingService Class
// ============================================================================

export class WorkflowTestingService {
  private testCases: Map<string, TestCase> = new Map();
  private testSuites: Map<string, TestSuite> = new Map();

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

  exportAll(): string {
    const exportData = {
      testCases: Array.from(this.testCases.values()),
      testSuites: Array.from(this.testSuites.values()),
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
    } catch (error) {
      logger.error("Failed to load from localStorage:", error);
    }
  }

  clearStorage(): void {
    this.testCases.clear();
    this.testSuites.clear();

    localStorage.removeItem(STORAGE_KEYS.TEST_CASES);
    localStorage.removeItem(STORAGE_KEYS.TEST_SUITES);
    localStorage.removeItem(STORAGE_KEYS.LEGACY_TEST_RESULTS);
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
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
