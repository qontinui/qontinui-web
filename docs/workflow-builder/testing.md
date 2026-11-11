# Workflow Testing Framework

This guide covers authoring workflow test cases, assertions and test suites with the workflow testing service.

## Table of Contents

- [Overview](#overview)
- [Test Cases](#test-cases)
- [Assertions](#assertions)
- [Test Suites](#test-suites)
- [Import & Export](#import--export)

## Overview

`WorkflowTestingService` (`@/services/workflow-testing`) authors and persists test cases and test suites in browser storage. It runs nothing: the in-browser runner it once carried was a simulator (mock inputs, an always-met expected behavior), so it was removed together with the results, statistics and coverage computed from its runs. The module exports no ready-made instance; get the singleton with `getWorkflowTestingService()`.

## Test Cases

```typescript
import { getWorkflowTestingService } from '@/services/workflow-testing';

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

`TestCaseConfig` also accepts `initialState` and an `expected` block (`shouldSucceed`, `finalActionId`, `actionPath`, `maxDuration`). The types are defined in `frontend/src/services/workflow-testing/types.ts`.

Manage test cases with `updateTestCase`, `duplicateTestCase`, `deleteTestCase`, `getTestCase`, `getTestCasesForWorkflow` and `getAllTestCases`.

## Assertions

Each assertion names a value at `path` (dot notation) and how it should compare according to `type`. The web app stores assertions as part of the test definition; it does not evaluate them.

| Type | Holds when |
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

## Import & Export

```typescript
const suiteJson = testing.exportTestSuite(suite.id);
const imported = testing.importTestSuite(suiteJson);

// Every test case and suite the service stores
const backup = testing.exportAll();
testing.importAll(backup);
```

## See Also

- [Best Practices](./best-practices.md) - Testing best practices
