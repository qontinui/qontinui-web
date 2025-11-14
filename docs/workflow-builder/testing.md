# Workflow Testing Framework

This guide covers comprehensive workflow testing with test cases, assertions, test suites, and mock execution.

## Table of Contents

- [Overview](#overview)
- [Test Cases](#test-cases)
- [Assertions](#assertions)
- [Test Suites](#test-suites)
- [Running Tests](#running-tests)
- [Mock Execution](#mock-execution)
- [Test Reports](#test-reports)
- [Best Practices](#best-practices)

## Overview

The Workflow Testing Service provides a comprehensive framework for testing workflows without actual execution. It supports multiple assertion types, test suites, mock environments, and detailed result tracking.

### Key Features

- Create test cases with multiple assertions
- Organize tests into suites
- Mock execution environment
- Multiple assertion types
- Detailed test results
- Test coverage tracking
- Export test reports

## Test Cases

### Creating a Test Case

```typescript
import { workflowTestingService } from '@/services/workflow-testing-service';

// Create a basic test case
const testCase = workflowTestingService.createTestCase({
  name: 'Verify login success',
  workflowId: 'workflow-123',
  description: 'Tests successful login with valid credentials',
  assertions: [
    {
      type: 'equals',
      actual: '{{loginResult}}',
      expected: 'success',
      message: 'Login result should be success'
    },
    {
      type: 'exists',
      actual: '{{sessionToken}}',
      message: 'Session token should be set'
    }
  ]
});
```

### Test Case Structure

```typescript
interface TestCase {
  id: string;
  name: string;
  workflowId: string;
  description?: string;

  // Test setup
  setup?: {
    variables?: Record<string, any>;
    initialState?: any;
  };

  // Assertions to verify
  assertions: TestAssertion[];

  // Expected outcomes
  expectedResult?: 'success' | 'failure' | 'error';

  // Metadata
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  author?: string;
}
```

### Test Setup

```typescript
// Define initial state and variables
const testCase = workflowTestingService.createTestCase({
  name: 'Test checkout flow',
  workflowId: 'checkout-workflow',
  setup: {
    variables: {
      userId: 'test-user-123',
      cartItems: [
        { id: 'product-1', quantity: 2 },
        { id: 'product-2', quantity: 1 }
      ],
      shippingAddress: {
        street: '123 Test St',
        city: 'Test City',
        zip: '12345'
      }
    },
    initialState: {
      isLoggedIn: true,
      cartTotal: 99.99
    }
  },
  assertions: [
    {
      type: 'equals',
      actual: '{{orderStatus}}',
      expected: 'completed',
      message: 'Order should be completed'
    }
  ]
});
```

## Assertions

### Assertion Types

#### 1. Equals Assertion

```typescript
{
  type: 'equals',
  actual: '{{loginStatus}}',
  expected: 'success',
  message: 'Login status should be success'
}
```

#### 2. Not Equals Assertion

```typescript
{
  type: 'notEquals',
  actual: '{{errorMessage}}',
  expected: '',
  message: 'Error message should not be empty'
}
```

#### 3. Contains Assertion

```typescript
{
  type: 'contains',
  actual: '{{responseText}}',
  expected: 'Welcome',
  message: 'Response should contain welcome message'
}
```

#### 4. Not Contains Assertion

```typescript
{
  type: 'notContains',
  actual: '{{pageContent}}',
  expected: 'Error',
  message: 'Page should not contain error text'
}
```

#### 5. Exists Assertion

```typescript
{
  type: 'exists',
  actual: '{{userId}}',
  message: 'User ID should exist'
}
```

#### 6. Not Exists Assertion

```typescript
{
  type: 'notExists',
  actual: '{{error}}',
  message: 'Error should not be present'
}
```

#### 7. Greater Than Assertion

```typescript
{
  type: 'greaterThan',
  actual: '{{score}}',
  expected: 50,
  message: 'Score should be greater than 50'
}
```

#### 8. Less Than Assertion

```typescript
{
  type: 'lessThan',
  actual: '{{executionTime}}',
  expected: 5000,
  message: 'Execution time should be less than 5 seconds'
}
```

#### 9. Regex Match Assertion

```typescript
{
  type: 'matches',
  actual: '{{email}}',
  expected: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  message: 'Email should be valid format'
}
```

#### 10. Type Assertion

```typescript
{
  type: 'type',
  actual: '{{count}}',
  expected: 'number',
  message: 'Count should be a number'
}
```

#### 11. Length Assertion

```typescript
{
  type: 'length',
  actual: '{{items}}',
  expected: 5,
  message: 'Should have exactly 5 items'
}
```

#### 12. Custom Assertion

```typescript
{
  type: 'custom',
  actual: '{{value}}',
  customFunction: (value: any) => {
    return value > 0 && value < 100;
  },
  message: 'Value should be between 0 and 100'
}
```

### Complete Assertion Reference

```typescript
interface TestAssertion {
  type:
    | 'equals'
    | 'notEquals'
    | 'contains'
    | 'notContains'
    | 'exists'
    | 'notExists'
    | 'greaterThan'
    | 'lessThan'
    | 'greaterThanOrEqual'
    | 'lessThanOrEqual'
    | 'matches'
    | 'type'
    | 'length'
    | 'custom';

  actual: string | any;
  expected?: any;
  message: string;
  customFunction?: (value: any) => boolean;
}
```

## Test Suites

### Creating a Test Suite

```typescript
// Create a test suite
const suite = workflowTestingService.createTestSuite({
  name: 'Login Flow Tests',
  description: 'Comprehensive tests for login functionality',
  testCaseIds: [testCase1.id, testCase2.id, testCase3.id]
});
```

### Test Suite Structure

```typescript
interface TestSuite {
  id: string;
  name: string;
  description?: string;
  testCaseIds: string[];
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}
```

### Organizing Test Suites

```typescript
// By feature
const authSuite = workflowTestingService.createTestSuite({
  name: 'Authentication Suite',
  description: 'All authentication-related tests',
  testCaseIds: [loginTest.id, logoutTest.id, passwordResetTest.id],
  tags: ['authentication', 'critical']
});

// By priority
const smokeSuite = workflowTestingService.createTestSuite({
  name: 'Smoke Tests',
  description: 'Quick validation tests',
  testCaseIds: [/* critical test IDs */],
  tags: ['smoke', 'p0']
});

// By component
const checkoutSuite = workflowTestingService.createTestSuite({
  name: 'Checkout Tests',
  description: 'End-to-end checkout flow tests',
  testCaseIds: [/* checkout test IDs */],
  tags: ['checkout', 'e2e']
});
```

## Running Tests

### Run Single Test Case

```typescript
// Run a test case
const result = await workflowTestingService.runTestCase(testCase.id);

if (result.passed) {
  console.log('✓ Test passed');
} else {
  console.log('✗ Test failed');
  result.failures.forEach(failure => {
    console.log(`  - ${failure.message}`);
  });
}
```

### Run Test Suite

```typescript
// Run all tests in a suite
const suiteResult = await workflowTestingService.runTestSuite(suite.id);

console.log(`Tests run: ${suiteResult.totalTests}`);
console.log(`Passed: ${suiteResult.passed}`);
console.log(`Failed: ${suiteResult.failed}`);
console.log(`Success rate: ${suiteResult.successRate}%`);

// Show failed tests
suiteResult.testResults
  .filter(r => !r.passed)
  .forEach(result => {
    console.log(`\nFailed: ${result.testCase.name}`);
    result.failures.forEach(failure => {
      console.log(`  - ${failure.message}`);
    });
  });
```

### Test Result Structure

```typescript
interface TestResult {
  testCaseId: string;
  testCase: TestCase;
  passed: boolean;
  failures: AssertionFailure[];
  executionTime: number;
  timestamp: string;
  variables?: Record<string, any>;
}

interface AssertionFailure {
  assertion: TestAssertion;
  message: string;
  actual: any;
  expected: any;
}

interface TestSuiteResult {
  suiteId: string;
  suite: TestSuite;
  testResults: TestResult[];
  totalTests: number;
  passed: number;
  failed: number;
  successRate: number;
  totalExecutionTime: number;
  timestamp: string;
}
```

### Async Test Execution

```typescript
// Run tests asynchronously
async function runAllTests() {
  const suites = workflowTestingService.getAllTestSuites();

  for (const suite of suites) {
    console.log(`\nRunning suite: ${suite.name}`);

    const result = await workflowTestingService.runTestSuite(suite.id);

    console.log(`  Passed: ${result.passed}/${result.totalTests}`);

    if (result.failed > 0) {
      console.log('  Failed tests:');
      result.testResults
        .filter(r => !r.passed)
        .forEach(r => {
          console.log(`    - ${r.testCase.name}`);
        });
    }
  }
}

// Usage
await runAllTests();
```

## Mock Execution

### Mock Environment

The testing service provides a mock execution environment that simulates workflow execution without actually running actions.

```typescript
// Mock execution happens automatically when running tests
const result = await workflowTestingService.runTestCase(testCase.id);

// The mock environment:
// 1. Initializes variables from test setup
// 2. Simulates action execution
// 3. Updates variables based on action logic
// 4. Evaluates assertions against final state
```

### Custom Mock Actions

```typescript
// Define custom mock behavior for specific actions
workflowTestingService.registerMockAction('FIND', (action, context) => {
  // Simulate finding an element
  return {
    found: true,
    element: { x: 100, y: 200 }
  };
});

workflowTestingService.registerMockAction('CLICK', (action, context) => {
  // Simulate click
  return { success: true };
});
```

### Mock Data

```typescript
// Provide mock data for testing
const testCase = workflowTestingService.createTestCase({
  name: 'Test with mock data',
  workflowId: 'workflow-123',
  setup: {
    variables: {
      // Mock API response
      apiResponse: {
        status: 200,
        data: {
          users: [
            { id: 1, name: 'John Doe' },
            { id: 2, name: 'Jane Smith' }
          ]
        }
      },

      // Mock UI state
      currentPage: 'dashboard',
      isLoggedIn: true,

      // Mock form data
      formData: {
        username: 'testuser',
        email: 'test@example.com'
      }
    }
  },
  assertions: [
    {
      type: 'length',
      actual: '{{apiResponse.data.users}}',
      expected: 2,
      message: 'Should have 2 users'
    }
  ]
});
```

## Test Reports

### Generate Test Report

```typescript
// Generate detailed test report
const report = workflowTestingService.generateTestReport(suiteResult);

console.log(report);
```

### Report Format

```markdown
# Test Report: Login Flow Tests

**Date:** 2024-01-15 10:30:00
**Duration:** 1.5s
**Status:** FAILED

## Summary

- Total Tests: 5
- Passed: 4
- Failed: 1
- Success Rate: 80%

## Failed Tests

### Verify password reset flow

**Duration:** 0.3s

**Failures:**
- Email verification: Expected email to contain reset link (Actual: "", Expected: "reset-link")

## Passed Tests

- ✓ Verify login success (0.2s)
- ✓ Verify logout (0.1s)
- ✓ Verify invalid credentials (0.3s)
- ✓ Verify session timeout (0.6s)
```

### Export Test Results

```typescript
// Export to JSON
const json = workflowTestingService.exportTestResults(suiteResult);

// Save to file
const blob = new Blob([json], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const link = document.createElement('a');
link.href = url;
link.download = `test-results-${Date.now()}.json`;
link.click();

// Export to CSV
const csv = workflowTestingService.exportTestResultsCSV(suiteResult);
```

### Test History

```typescript
// Get test history
const history = workflowTestingService.getTestHistory(testCase.id);

history.forEach(result => {
  console.log(`${result.timestamp}: ${result.passed ? 'PASS' : 'FAIL'}`);
});

// Get trend over time
const trend = workflowTestingService.getTestTrend(testCase.id, 30); // Last 30 days
console.log(`Success rate trend: ${trend.average}%`);
```

## Best Practices

### Test Organization

```typescript
// Organize tests by feature and priority
const testStructure = {
  'P0-Critical': {
    'Authentication': [
      'Login with valid credentials',
      'Logout successfully',
      'Session management'
    ],
    'Checkout': [
      'Complete purchase',
      'Payment processing'
    ]
  },
  'P1-High': {
    'User Profile': [
      'Update profile',
      'Change password'
    ]
  },
  'P2-Medium': {
    'Search': [
      'Basic search',
      'Advanced filters'
    ]
  }
};
```

### Naming Conventions

```typescript
// ✅ Good: Clear, descriptive names
'Verify login with valid credentials'
'Verify error message on invalid email'
'Verify checkout completes successfully'

// ❌ Bad: Vague names
'Test 1'
'Login test'
'Check stuff'
```

### Comprehensive Test Coverage

```typescript
// Cover happy path, edge cases, and error cases
const loginTests = [
  // Happy path
  'Verify successful login with valid credentials',

  // Edge cases
  'Verify login with email instead of username',
  'Verify login with extra whitespace',
  'Verify case-insensitive username',

  // Error cases
  'Verify error on invalid credentials',
  'Verify error on missing username',
  'Verify error on missing password',
  'Verify account lockout after failed attempts'
];
```

### Assertion Best Practices

```typescript
// ✅ Good: Specific assertions
{
  type: 'equals',
  actual: '{{loginStatus}}',
  expected: 'success',
  message: 'Login status should be "success"'
}

// ❌ Bad: Generic assertions
{
  type: 'exists',
  actual: '{{loginStatus}}',
  message: 'Login should work'
}

// ✅ Good: Multiple specific assertions
const testCase = {
  assertions: [
    {
      type: 'equals',
      actual: '{{status}}',
      expected: 200,
      message: 'HTTP status should be 200'
    },
    {
      type: 'contains',
      actual: '{{response.message}}',
      expected: 'Success',
      message: 'Response message should contain "Success"'
    },
    {
      type: 'exists',
      actual: '{{response.data.userId}}',
      message: 'Response should include user ID'
    }
  ]
};
```

### Test Data Management

```typescript
// Use test data factory
class TestDataFactory {
  static validUser() {
    return {
      username: 'testuser@example.com',
      password: 'Test123!',
      firstName: 'Test',
      lastName: 'User'
    };
  }

  static invalidUser() {
    return {
      username: 'invalid',
      password: '123'
    };
  }

  static productData() {
    return {
      id: 'prod-123',
      name: 'Test Product',
      price: 99.99,
      quantity: 1
    };
  }
}

// Use in tests
const testCase = workflowTestingService.createTestCase({
  name: 'Verify login',
  workflowId: 'login-workflow',
  setup: {
    variables: TestDataFactory.validUser()
  },
  assertions: [/* ... */]
});
```

### Test Maintenance

```typescript
// Keep tests maintainable
const createLoginTest = (userData: any, expectedResult: string) => {
  return workflowTestingService.createTestCase({
    name: `Verify login with ${userData.username}`,
    workflowId: 'login-workflow',
    setup: { variables: userData },
    assertions: [
      {
        type: 'equals',
        actual: '{{loginResult}}',
        expected: expectedResult,
        message: `Login result should be ${expectedResult}`
      }
    ]
  });
};

// Create multiple test cases easily
const validUserTest = createLoginTest(
  { username: 'valid@example.com', password: 'Pass123!' },
  'success'
);

const invalidUserTest = createLoginTest(
  { username: 'invalid@example.com', password: 'wrong' },
  'failure'
);
```

## Advanced Patterns

### Parameterized Tests

```typescript
// Data-driven testing
const testData = [
  { input: 'test@example.com', expected: true },
  { input: 'invalid-email', expected: false },
  { input: '', expected: false },
  { input: 'test@', expected: false }
];

testData.forEach(data => {
  const testCase = workflowTestingService.createTestCase({
    name: `Verify email validation: "${data.input}"`,
    workflowId: 'email-validation',
    setup: { variables: { email: data.input } },
    assertions: [
      {
        type: 'equals',
        actual: '{{isValid}}',
        expected: data.expected,
        message: `Email "${data.input}" should be ${data.expected ? 'valid' : 'invalid'}`
      }
    ]
  });
});
```

### Test Fixtures

```typescript
// Reusable test fixtures
class TestFixtures {
  static async setupDatabase() {
    // Setup test database
  }

  static async teardownDatabase() {
    // Cleanup test database
  }

  static async createTestUser() {
    // Create test user
    return { id: 'test-user-123', name: 'Test User' };
  }
}

// Use in tests
async function runTestWithFixtures() {
  await TestFixtures.setupDatabase();
  const testUser = await TestFixtures.createTestUser();

  // Run tests
  const result = await workflowTestingService.runTestCase(testCase.id);

  await TestFixtures.teardownDatabase();

  return result;
}
```

### Test Tags

```typescript
// Tag tests for organization
const testCase = workflowTestingService.createTestCase({
  name: 'Login test',
  workflowId: 'login-workflow',
  tags: ['smoke', 'authentication', 'p0', 'critical'],
  // ... rest of test
});

// Run tests by tag
const smokeTests = workflowTestingService.getTestCasesByTag('smoke');
const criticalTests = workflowTestingService.getTestCasesByTag('critical');
```

## Troubleshooting

### Test Failures

```typescript
// Debugging test failures
const result = await workflowTestingService.runTestCase(testCase.id);

if (!result.passed) {
  console.log('Test failed!');
  console.log('Variables at failure:', result.variables);

  result.failures.forEach((failure, index) => {
    console.log(`\nFailure ${index + 1}:`);
    console.log(`  Assertion: ${failure.assertion.message}`);
    console.log(`  Expected: ${JSON.stringify(failure.expected)}`);
    console.log(`  Actual: ${JSON.stringify(failure.actual)}`);
  });
}
```

### Flaky Tests

```typescript
// Identify flaky tests
const flakyTests = workflowTestingService.findFlakyTests({
  minRuns: 10,
  successRateThreshold: 0.9
});

flakyTests.forEach(test => {
  console.log(`Flaky test: ${test.name}`);
  console.log(`  Success rate: ${test.successRate}%`);
});
```

## See Also

- [Components Guide](./components.md) - Test reusable components
- [Best Practices](./best-practices.md) - Testing best practices
- [API Reference](./api-reference.md) - Complete API documentation
