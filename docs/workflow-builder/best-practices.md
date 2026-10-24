# Workflow Builder Best Practices

This guide covers recommended patterns, design strategies, and common pitfalls to avoid.

## Table of Contents

- [Workflow Design](#workflow-design)
- [Organization](#organization)
- [Testing](#testing)
- [Performance](#performance)
- [Documentation](#documentation)
- [Common Pitfalls](#common-pitfalls)

## Workflow Design

### Single Responsibility Principle

Each workflow should do one thing well.

```typescript
// ✅ Good: Single purpose
'User Login Workflow' - Only handles login
'Product Search Workflow' - Only handles search
'Checkout Workflow' - Only handles checkout

// ❌ Bad: Multiple responsibilities
'Login and Setup Dashboard and Load Data' - Does too much
```

### Keep Workflows Small

```typescript
// ✅ Good: 10-20 actions
const loginWorkflow = {
  actions: [
    // Navigate to login
    // Fill credentials
    // Click submit
    // Wait for redirect
    // Verify login
  ] // ~10 actions
};

// ❌ Bad: 100+ actions
const massiveWorkflow = {
  actions: [/* 100+ actions */]
};

// Solution: Break into smaller workflows or use components
```

### Use Meaningful Names

```typescript
// ✅ Good: Clear, descriptive names
'Login with Valid Credentials'
'Search Products by Category'
'Add Item to Cart and Verify Total'

// ❌ Bad: Vague or cryptic names
'Workflow 1'
'Test'
'Do Stuff'
```

### Error Handling

```typescript
// ✅ Good: Proper error handling
{
  type: 'TRY_CATCH',
  config: {
    tryActions: [
      // Main logic
    ],
    catchActions: [
      // Error handling
      { type: 'SET_VARIABLE', config: { name: 'error', value: '{{$error}}' } },
      { type: 'LOG', config: { message: 'Error occurred: {{error}}' } }
    ]
  }
}

// ❌ Bad: No error handling
// Actions that can fail without try-catch
```

## Organization

### Folder Structure

```typescript
// ✅ Good: Logical hierarchy
/E2E Tests
  /Smoke Tests
  /Regression Tests
/API Tests
  /Authentication
  /Data Validation
/Utilities
  /Setup
  /Cleanup

// ❌ Bad: Flat or messy structure
/Tests
/Misc
/Old Stuff
/Backup
```

### Naming Conventions

```typescript
// Use consistent prefixes/patterns

// By purpose
'Test: Login with valid credentials'
'Setup: Create test user'
'Cleanup: Delete test data'

// By feature
'Auth/Login'
'Auth/Logout'
'Cart/Add Item'
'Cart/Checkout'
```

## Testing

### Test Coverage

```typescript
// ✅ Good: Comprehensive test coverage
const testCases = [
  // Happy path
  'Verify successful login with valid credentials',

  // Edge cases
  'Verify login with extra whitespace',
  'Verify case-insensitive username',

  // Error cases
  'Verify error on invalid credentials',
  'Verify error on missing username',
  'Verify account lockout after failed attempts'
];

// ❌ Bad: Only testing happy path
const testCases = [
  'Verify successful login'
];
```

### Specific Assertions

```typescript
// ✅ Good: Multiple specific assertions
{
  assertions: [
    { id: 'status', type: 'equals', path: 'status', expected: 200 },
    { id: 'token', type: 'exists', path: 'token' },
    { id: 'message', type: 'contains', path: 'message', expected: 'Success' }
  ]
}

// ❌ Bad: Generic or single assertion
{
  assertions: [
    { id: 'result', type: 'exists', path: 'result' }
  ]
}
```

### Test Organization

```typescript
// ✅ Good: Organized test suites
const smokeSuite = {
  name: 'Smoke Tests',
  testCaseIds: [/* critical paths */]
};

const regressionSuite = {
  name: 'Regression Tests',
  testCaseIds: [/* all features */]
};

// ❌ Bad: Unorganized tests
// Individual tests without suites
```

## Performance

### Use Intelligent Waits

```typescript
// ✅ Good: Use FIND with timeout - waits intelligently for element
{
  type: 'FIND',
  config: {
    target: 'Login Button',
    timeout: 5000  // Waits up to 5 seconds, succeeds as soon as element appears
  }
}

// ✅ Good: Use VANISH to wait for element to disappear
{
  type: 'VANISH',
  config: {
    target: 'Loading Spinner',
    maxWaitTime: 10000  // Waits up to 10 seconds for spinner to vanish
  }
}
```

### Parallelize When Possible

```typescript
// ✅ Good: Parallel execution
{
  type: 'PARALLEL',
  config: {
    branches: [
      [/* Independent action 1 */],
      [/* Independent action 2 */],
      [/* Independent action 3 */]
    ]
  }
}

// ❌ Bad: Sequential when could be parallel
// Running independent actions sequentially
```

### Optimize Loops

```typescript
// ✅ Good: Limited iterations with early exit
{
  type: 'LOOP',
  config: {
    maxIterations: 10,
    condition: '{{!found}}',
    breakCondition: '{{found}}'
  }
}

// ❌ Bad: No iteration limit
{
  type: 'LOOP',
  config: {
    condition: '{{true}}'  // Infinite loop risk
  }
}
```

### Reduce Screenshot Actions

```typescript
// ✅ Good: Strategic screenshots
// Only take screenshots when necessary:
// - Before critical actions
// - After important results
// - On errors

// ❌ Bad: Excessive screenshots
// Taking screenshots after every action
```

## Documentation

### Keep Documentation Updated

```typescript
// ✅ Good: Update docs with changes
function updateWorkflow(workflow: Workflow) {
  saveWorkflow(workflow);

  // Regenerate documentation
  const docs = workflowDocumentation.generateDocumentation(workflow);
  workflowDocumentation.updateDocumentation(workflow.id, docs, 'Workflow changed');
}

// ❌ Bad: Outdated documentation
// Never updating docs after changes
```

### Include Examples

```typescript
// ✅ Good: Documentation with examples
const docs = `
## Usage

\`\`\`typescript
const result = await loginWorkflow.execute({
  username: 'user@example.com',
  password: 'secure123'
});
\`\`\`

## Parameters
- username: User email
- password: User password
`;

// ❌ Bad: No examples
const docs = `
## Usage
Use this workflow to log in.
`;
```

## Common Pitfalls

### Pitfall: Deep Nesting

```typescript
// ❌ Bad: Too much nesting
{
  type: 'IF',
  config: {
    thenActions: [{
      type: 'IF',
      config: {
        thenActions: [{
          type: 'IF',
          config: {
            thenActions: [/* ... */]
          }
        }]
      }
    }]
  }
}

// ✅ Good: Flat structure
// Break into multiple workflows or use switch
```

### Pitfall: Hardcoded Values

```typescript
// ❌ Bad: Hardcoded values
{
  type: 'TYPE',
  config: {
    text: 'john.doe@example.com'  // Hardcoded
  }
}

// ✅ Good: Use variables
{
  type: 'TYPE',
  config: {
    text: '{{username}}'  // Variable
  }
}
```

### Pitfall: No Error Handling

```typescript
// ❌ Bad: No error handling
[
  { type: 'FIND', /* ... */ },
  { type: 'CLICK', /* ... */ }
]

// ✅ Good: Wrapped in try-catch
{
  type: 'TRY_CATCH',
  config: {
    tryActions: [
      { type: 'FIND', /* ... */ },
      { type: 'CLICK', /* ... */ }
    ],
    catchActions: [
      { type: 'LOG', config: { message: 'Error: {{$error}}' } }
    ]
  }
}
```

### Pitfall: Ignoring Dependencies

```typescript
// ❌ Bad: Creating circular dependencies
Workflow A → Workflow B → Workflow C → Workflow A

// ✅ Good: Check dependencies before saving
const cycles = workflowDependencyAnalyzer.findCircularDependencies(workflows);
if (cycles.length > 0) {
  alert('Cannot save: Circular dependency detected!');
}
```

### Pitfall: No Testing

```typescript
// ❌ Bad: No tests
// Deploying workflows without testing

// ✅ Good: Comprehensive tests
const testing = getWorkflowTestingService();
const testSuite = testing.createTestSuite('Login Tests', undefined, testCaseIds);

await testing.runTestSuite(testSuite.id);
```

## Performance Checklist

Before deploying a workflow:

- [ ] No fixed waits (use FIND instead)
- [ ] Independent actions parallelized
- [ ] Loops have iteration limits
- [ ] Error handling in place
- [ ] No circular dependencies
- [ ] Tests passing
- [ ] Documentation updated

## Security Best Practices

### Sensitive Data

```typescript
// ✅ Good: Mark sensitive parameters
{
  name: 'password',
  type: 'string',
  sensitive: true  // Won't be logged
}

// ❌ Bad: No sensitivity marking
{
  name: 'password',
  type: 'string'
}
```

### Credential Management

```typescript
// ✅ Good: Use variables for credentials
{
  username: '{{env.TEST_USERNAME}}',
  password: '{{env.TEST_PASSWORD}}'
}

// ❌ Bad: Hardcoded credentials
{
  username: 'admin',
  password: 'password123'
}
```

## See Also

- [Organization Guide](./organization.md) - Organize workflows
- [Testing Guide](./testing.md) - Testing best practices
- [Analytics](./analytics.md) - Execution metrics and complexity analysis
