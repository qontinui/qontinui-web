# Workflow Testing Framework

This guide covers workflow test cases, assertions, test suites and results with the workflow testing service.

## Table of Contents

- [Overview](#overview)
- [Test Cases](#test-cases)
- [Assertions](#assertions)
- [Test Suites](#test-suites)
- [Running Tests](#running-tests)
- [Results, History and Coverage](#results-history-and-coverage)
- [Import & Export](#import--export)

## Overview

`WorkflowTestingService` (`@/services/workflow-testing-service`) stores test cases, test suites and results in browser storage. The module exports no ready-made instance; get the singleton with `getWorkflowTestingService()`.

Test execution is **simulated**: a run does not drive the GUI. Assertions are evaluated against the test case's `inputs` plus a mock `result` value, so these tests check test definitions and assertion logic, not live automation.

## Test Cases

```typescript
import { getWorkflowTestingService } from '@/services/workflow-testing-service';

const testing = getWorkflowTestingService();

// createTestCase(workflowId, config, options?)
const testCase = testing.createTestCase(
  'workflow-123',
  {
    inputs: { username: 'testuser' },
    assertions: [
      { id: 'a1', type: 'equals', path: 'username', expected: 'testuser' },
      { id: 'a2', type: 'exists', path: 'result' },
    ],
    timeout: 30000,
    tags: ['smoke'],
  },
  { name: 'Verify login inputs', description: 'Valid credentials' },
);
```

`TestCaseConfig` also accepts `initialState` and an `expected` block (`shouldSucceed`, `finalActionId`, `actionPath`, `maxDuration`). The types are defined in `frontend/src/services/workflow-testing-service.ts`.

Manage test cases with `updateTestCase`, `duplicateTestCase`, `deleteTestCase`, `getTestCase`, `getTestCasesForWorkflow` and `getAllTestCases`.

## Assertions

Each assertion reads the value at `path` (dot notation) from the evaluation context and compares it according to `type`:

| Type | Passes when |
|------|-------------|
| `equals` / `notEquals` | the value deep-equals / does not equal `expected` |
| `contains` / `notContains` | the string, array or object (as a key) contains / does not contain `expected` |
| `exists` / `notExists` | the value is neither / is `null` or `undefined` |
| `greaterThan` / `lessThan` | the number compares against `expected` |
| `regex` | the string matches `pattern` |
| `custom` | the `customFunction` expression evaluates to true |

## Test Suites

```typescript
// createTestSuite(name, description?, testCaseIds?)
const suite = testing.createTestSuite('Login Flow Tests', 'Authentication checks', [testCase.id]);

testing.addTestToSuite(suite.id, anotherTestCase.id);
testing.removeTestFromSuite(suite.id, anotherTestCase.id);

const suites = testing.getAllTestSuites();
```

## Running Tests

```typescript
const result = await testing.runTestCase(testCase.id);

if (!result.passed) {
  result.assertions
    .filter((a) => !a.passed)
    .forEach((a) => console.log(`${a.assertion.id}: ${a.error}`));
}

// Every test in a suite, every test, or every test of one workflow
const suiteResults = await testing.runTestSuite(suite.id);
const allResults = await testing.runAllTests();
const workflowResults = await testing.runTestsForWorkflow('workflow-123');

// Stop a running test
if (testing.isTestRunning(testCase.id)) {
  testing.stopTestExecution(testCase.id);
}
```

## Results, History and Coverage

```typescript
const history = testing.getTestHistory(testCase.id);
const stats = testing.getTestStatistics(testCase.id);

// Which actions of a workflow no test case reaches
const coverage = testing.calculateCoverage('workflow-123', workflow);
const untested = testing.getUntestedActions('workflow-123', workflow);
```

## Import & Export

```typescript
const suiteJson = testing.exportTestSuite(suite.id);
const imported = testing.importTestSuite(suiteJson);

const resultsJson = testing.exportTestResults(testCase.id);

// Everything the service stores
const backup = testing.exportAll();
testing.importAll(backup);
```

## See Also

- [Best Practices](./best-practices.md) - Testing best practices
