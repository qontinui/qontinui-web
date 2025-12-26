# Workflow Builder Best Practices

This guide covers recommended patterns, design strategies, and common pitfalls to avoid.

## Table of Contents

- [Workflow Design](#workflow-design)
- [Organization](#organization)
- [Version Control](#version-control)
- [Testing](#testing)
- [Performance](#performance)
- [Components](#components)
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

### Tag Strategy

```typescript
// ✅ Good: Consistent, meaningful tags
'p0-critical'      // Priority 0 - critical
'p1-high'          // Priority 1 - high
'type:smoke'       // Test type
'feature:login'    // Feature area
'schedule:nightly' // Schedule

// ❌ Bad: Inconsistent or unclear tags (avoid vague names like these)
'important'
'test'
'old'
'todo'
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

## Version Control

### Commit Often

```typescript
// ✅ Good: Small, frequent commits
saveVersion(workflowId, branchId, workflow, 'Add login form validation');
// ... make more changes ...
saveVersion(workflowId, branchId, workflow, 'Add error message display');
// ... make more changes ...
saveVersion(workflowId, branchId, workflow, 'Update button styling');

// ❌ Bad: Infrequent, large commits
// ... make many changes over days ...
saveVersion(workflowId, branchId, workflow, 'Many changes');
```

### Write Good Commit Messages

```typescript
// ✅ Good: Clear, specific messages
'Add two-factor authentication support'
'Fix timeout issue in login validation'
'Update error messages for consistency'
'Remove deprecated password reset flow'

// ❌ Bad: Vague messages
'Update'
'Fix'
'Changes'
'WIP'
```

### Use Branches

```typescript
// ✅ Good: Feature branches
main                    // Production
develop                 // Integration
feature/oauth-login     // New feature
fix/timeout-bug         // Bug fix
hotfix/security-patch   // Critical fix

// ❌ Bad: Everything in main
// Making all changes directly in main branch
```

### Tag Releases

```typescript
// ✅ Good: Tag important versions
createTag(workflowId, versionId, 'v1.0.0', 'Initial release');
createTag(workflowId, versionId, 'v1.1.0', 'Added OAuth support');
createTag(workflowId, versionId, 'v2.0.0', 'Major update');

// ❌ Bad: No tags
// Never tagging releases
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
    { type: 'equals', actual: '{{status}}', expected: 200 },
    { type: 'exists', actual: '{{token}}' },
    { type: 'contains', actual: '{{message}}', expected: 'Success' }
  ]
}

// ❌ Bad: Generic or single assertion
{
  assertions: [
    { type: 'exists', actual: '{{result}}' }
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

### Avoid Unnecessary Waits

```typescript
// ✅ Good: Use FIND instead of WAIT
{
  type: 'FIND',
  config: {
    target: 'Login Button',
    timeout: 5000
  }
}

// ❌ Bad: Fixed waits
{
  type: 'WAIT',
  config: {
    duration: 3000  // Always waits 3 seconds
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

## Components

### Single Responsibility

```typescript
// ✅ Good: Focused components
{
  name: 'Login',
  description: 'Authenticates user with credentials'
}

{
  name: 'Fill Form',
  description: 'Fills form fields with data'
}

// ❌ Bad: Multi-purpose components
{
  name: 'Login and Setup and Validate',
  description: 'Does everything'
}
```

### Clear Parameters

```typescript
// ✅ Good: Well-defined parameters
{
  parameters: [
    {
      name: 'username',
      type: 'string',
      description: 'User login email',
      required: true
    },
    {
      name: 'rememberMe',
      type: 'boolean',
      description: 'Keep user logged in',
      required: false,
      defaultValue: false
    }
  ]
}

// ❌ Bad: Vague parameters
{
  parameters: [
    { name: 'data', type: 'object', required: true }
  ]
}
```

### Versioning

```typescript
// ✅ Good: Semantic versioning
'1.0.0' // Initial version
'1.1.0' // Add optional parameter (backward compatible)
'2.0.0' // Change required parameter (breaking change)

// ❌ Bad: No versioning
// Just updating component without tracking versions
```

## Documentation

### Keep Documentation Updated

```typescript
// ✅ Good: Update docs with changes
function updateWorkflow(workflow: Workflow) {
  saveWorkflow(workflow);

  // Regenerate documentation
  const docs = workflowDocumentationService.generateDocumentation(workflow);
  workflowDocumentationService.updateDocumentation(workflow.id, docs);
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
const circular = workflowDependencyAnalyzer.detectCircularDependencies(workflows);
if (circular.length > 0) {
  alert('Cannot save: Circular dependency detected!');
}
```

### Pitfall: No Testing

```typescript
// ❌ Bad: No tests
// Deploying workflows without testing

// ✅ Good: Comprehensive tests
const testSuite = createTestSuite({
  name: 'Login Tests',
  testCaseIds: [/* test cases */]
});

await runTestSuite(testSuite.id);
```

## Performance Checklist

Before deploying a workflow:

- [ ] No fixed waits (use FIND instead)
- [ ] Independent actions parallelized
- [ ] Loops have iteration limits
- [ ] Error handling in place
- [ ] No circular dependencies
- [ ] Performance score > 70
- [ ] Tests passing
- [ ] Documentation updated
- [ ] Version tagged

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
- [Version Control](./version-control.md) - Version control strategies
- [Testing Guide](./testing.md) - Testing best practices
- [Analytics](./analytics.md) - Performance optimization
- [Troubleshooting](./troubleshooting.md) - Common issues
