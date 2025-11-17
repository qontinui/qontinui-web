# Workflow Builder Examples

Complete working examples for common use cases.

## Table of Contents

- [Basic Workflow Management](#basic-workflow-management)
- [Organization Examples](#organization-examples)
- [Dependency Management](#dependency-management)
- [Testing Examples](#testing-examples)
- [Version Control Examples](#version-control-examples)
- [Performance Optimization](#performance-optimization)
- [Component Examples](#component-examples)
- [Complete Workflows](#complete-workflows)

## Basic Workflow Management

### Create and Save Workflow

```typescript
import { workflowFolderManager } from '@/services/workflow-folder-manager';
import { workflowVersionControl } from '@/services/workflow-version-control';

// Create a new workflow
const loginWorkflow: Workflow = {
  id: 'login-wf-1',
  name: 'Login Workflow',
  description: 'Authenticates user with credentials',
  actions: [
    {
      id: 'action-1',
      type: 'FIND',
      name: 'Find username field',
      position: [100, 100],
      config: { target: 'username-input' }
    },
    {
      id: 'action-2',
      type: 'TYPE',
      name: 'Enter username',
      position: [100, 200],
      config: { text: '{{username}}' }
    },
    {
      id: 'action-3',
      type: 'FIND',
      name: 'Find password field',
      position: [100, 300],
      config: { target: 'password-input' }
    },
    {
      id: 'action-4',
      type: 'TYPE',
      name: 'Enter password',
      position: [100, 400],
      config: { text: '{{password}}' }
    },
    {
      id: 'action-5',
      type: 'CLICK',
      name: 'Click login button',
      position: [100, 500],
      config: { target: 'login-button' }
    }
  ],
  connections: {
    'action-1': { main: [[{ action: 'action-2', index: 0 }]] },
    'action-2': { main: [[{ action: 'action-3', index: 0 }]] },
    'action-3': { main: [[{ action: 'action-4', index: 0 }]] },
    'action-4': { main: [[{ action: 'action-5', index: 0 }]] }
  }
};

// Move to folder
workflowFolderManager.createFolder({
  name: 'Authentication',
  parentPath: '/'
});

workflowFolderManager.moveWorkflow(loginWorkflow.id, '/Authentication');

// Add tags
workflowFolderManager.addTag(loginWorkflow.id, 'critical');
workflowFolderManager.addTag(loginWorkflow.id, 'authentication');

// Create version control
const branch = workflowVersionControl.createBranch(
  loginWorkflow.id,
  'main',
  undefined,
  'Main branch'
);

workflowVersionControl.saveVersion(
  loginWorkflow.id,
  branch.id,
  loginWorkflow,
  'Initial version',
  'developer@example.com'
);
```

## Organization Examples

### Organize Project Workflows

```typescript
// Create folder structure for a project
const projectStructure = [
  '/E2E Tests',
  '/E2E Tests/Smoke',
  '/E2E Tests/Regression',
  '/API Tests',
  '/API Tests/Authentication',
  '/API Tests/Data Validation',
  '/Utilities',
  '/Utilities/Setup',
  '/Utilities/Cleanup'
];

projectStructure.forEach(path => {
  const parts = path.split('/').filter(p => p);
  const name = parts[parts.length - 1];
  const parentPath = parts.length > 1
    ? '/' + parts.slice(0, -1).join('/')
    : '/';

  workflowFolderManager.createFolder({ name, parentPath });
});

// Organize workflows
const workflowMapping = {
  '/E2E Tests/Smoke': ['login-test', 'search-test', 'checkout-test'],
  '/API Tests/Authentication': ['api-login-test', 'api-token-test'],
  '/Utilities/Setup': ['create-test-data', 'setup-environment']
};

Object.entries(workflowMapping).forEach(([folder, workflowIds]) => {
  workflowIds.forEach(id => {
    workflowFolderManager.moveWorkflow(id, folder);
  });
});

// Tag workflows by priority
const criticalWorkflows = ['login-test', 'checkout-test'];
const smokeWorkflows = ['login-test', 'search-test'];

criticalWorkflows.forEach(id => {
  workflowFolderManager.addTag(id, 'p0-critical');
});

smokeWorkflows.forEach(id => {
  workflowFolderManager.addTag(id, 'smoke');
  workflowFolderManager.addTag(id, 'nightly');
});
```

### Search and Filter Workflows

```typescript
// Search by name
const searchResults = workflowFolderManager.searchWorkflows('login');

console.log('Found workflows:');
searchResults.forEach(result => {
  console.log(`  ${result.workflow.name} in ${result.folder.path}`);
});

// Filter by tags
const criticalWorkflows = workflowFolderManager.filterWorkflowsByTag('p0-critical');

console.log('Critical workflows:');
criticalWorkflows.forEach(result => {
  console.log(`  ${result.workflow.name}`);
});

// Complex search
const nightlySmokeTests = workflowFolderManager.searchWorkflows('', {
  tags: ['nightly', 'smoke']
});

console.log('Nightly smoke tests:');
nightlySmokeTests.forEach(result => {
  console.log(`  ${result.workflow.name}`);
});
```

## Dependency Management

### Analyze Dependencies

```typescript
import { workflowDependencyAnalyzer } from '@/services/workflow-dependency-analyzer';

// Analyze all workflows
const analysis = workflowDependencyAnalyzer.analyzeDependencies(workflows);

console.log(`Total workflows: ${analysis.totalWorkflows}`);
console.log(`Workflows with dependencies: ${analysis.workflowsWithDependencies}`);
console.log(`Total dependencies: ${analysis.totalDependencies}`);
console.log(`Circular dependencies: ${analysis.circularDependencies.length}`);

// Check specific workflow
const deps = workflowDependencyAnalyzer.getDependencies('login-workflow');

console.log('\nDependencies:');
deps.forEach(dep => {
  console.log(`  → ${dep.targetWorkflowName || dep.targetWorkflowId}`);
});

// Get dependents (who uses this workflow)
const dependents = workflowDependencyAnalyzer.getDependents('login-workflow');

console.log('\nUsed by:');
dependents.forEach(dep => {
  console.log(`  ← ${dep.sourceWorkflowName || dep.sourceWorkflowId}`);
});

// Impact analysis before deletion
const impact = workflowDependencyAnalyzer.getImpactAnalysis('login-workflow', workflows);

console.log(`\nDeleting this workflow would affect ${impact.totalImpact} workflows`);
console.log(`Risk level: ${impact.riskLevel}`);
```

### Detect and Fix Circular Dependencies

```typescript
// Detect circular dependencies
const circular = workflowDependencyAnalyzer.detectCircularDependencies(workflows);

if (circular.length > 0) {
  console.log('Circular dependencies found:');

  circular.forEach((cycle, index) => {
    console.log(`\n${index + 1}. ${cycle.description}`);
    console.log(`   Severity: ${cycle.severity}`);
    console.log(`   Cycle: ${cycle.cycle.join(' → ')}`);
    console.log(`   Full path: ${cycle.path.join(' → ')}`);
  });

  // To fix: Remove one RUN_WORKFLOW action from the cycle
  // or restructure to avoid the circular reference
}
```

## Testing Examples

### Create Comprehensive Test Suite

```typescript
import { workflowTestingService } from '@/services/workflow-testing-service';

// Create test cases
const testCase1 = workflowTestingService.createTestCase({
  name: 'Verify successful login',
  workflowId: 'login-workflow',
  description: 'Tests login with valid credentials',
  setup: {
    variables: {
      username: 'test@example.com',
      password: 'Test123!'
    }
  },
  assertions: [
    {
      type: 'equals',
      actual: '{{loginResult}}',
      expected: 'success',
      message: 'Login should succeed'
    },
    {
      type: 'exists',
      actual: '{{sessionToken}}',
      message: 'Session token should be set'
    },
    {
      type: 'exists',
      actual: '{{userId}}',
      message: 'User ID should be set'
    }
  ],
  tags: ['smoke', 'authentication']
});

const testCase2 = workflowTestingService.createTestCase({
  name: 'Verify invalid credentials error',
  workflowId: 'login-workflow',
  setup: {
    variables: {
      username: 'invalid@example.com',
      password: 'wrong'
    }
  },
  assertions: [
    {
      type: 'equals',
      actual: '{{loginResult}}',
      expected: 'failure',
      message: 'Login should fail'
    },
    {
      type: 'contains',
      actual: '{{errorMessage}}',
      expected: 'Invalid credentials',
      message: 'Should show error message'
    },
    {
      type: 'notExists',
      actual: '{{sessionToken}}',
      message: 'Session token should not be set'
    }
  ],
  tags: ['authentication', 'error-handling']
});

// Create test suite
const loginSuite = workflowTestingService.createTestSuite({
  name: 'Login Flow Tests',
  description: 'Comprehensive tests for login functionality',
  testCaseIds: [testCase1.id, testCase2.id],
  tags: ['authentication', 'critical']
});

// Run test suite
async function runLoginTests() {
  const result = await workflowTestingService.runTestSuite(loginSuite.id);

  console.log(`\nTest Suite: ${result.suite.name}`);
  console.log(`Total: ${result.totalTests}`);
  console.log(`Passed: ${result.passed}`);
  console.log(`Failed: ${result.failed}`);
  console.log(`Success Rate: ${result.successRate}%`);

  if (result.failed > 0) {
    console.log('\nFailed Tests:');
    result.testResults
      .filter(r => !r.passed)
      .forEach(r => {
        console.log(`  ${r.testCase.name}`);
        r.failures.forEach(f => {
          console.log(`    - ${f.message}`);
        });
      });
  }

  return result;
}

runLoginTests();
```

## Version Control Examples

### Feature Branch Workflow

```typescript
// 1. Create feature branch from main
const mainBranch = workflowVersionControl.getAllBranches(workflowId)
  .find(b => b.name === 'main');

const featureBranch = workflowVersionControl.createBranch(
  workflowId,
  'feature/oauth-login',
  mainBranch!.id,
  'Adding OAuth authentication'
);

// 2. Switch to feature branch
workflowVersionControl.switchBranch(workflowId, featureBranch.id);

// 3. Make changes and commit
// ... modify workflow ...

workflowVersionControl.saveVersion(
  workflowId,
  featureBranch.id,
  modifiedWorkflow,
  'Add OAuth provider selection',
  'developer@example.com'
);

// ... more changes ...

workflowVersionControl.saveVersion(
  workflowId,
  featureBranch.id,
  modifiedWorkflow,
  'Add OAuth callback handling',
  'developer@example.com'
);

// 4. Compare changes
const diff = workflowVersionControl.compareWorkflows(
  mainBranch.currentVersionId
    ? workflowVersionControl.getVersion(mainBranch.currentVersionId)!.workflow
    : workflow,
  modifiedWorkflow
);

console.log(`Changes: ${diff.summary.totalChanges}`);
console.log(`  Actions added: ${diff.summary.actionsAdded}`);
console.log(`  Actions modified: ${diff.summary.actionsModified}`);

// 5. Merge feature branch to main
const mergeResult = workflowVersionControl.mergeBranch(
  featureBranch.id,
  mainBranch!.id,
  'developer@example.com'
);

if (mergeResult.success) {
  console.log('Merge successful!');

  // 6. Tag the release
  const latestVersion = workflowVersionControl.getLatestVersion(
    workflowId,
    mainBranch!.id
  );

  workflowVersionControl.createTag(
    workflowId,
    latestVersion!.id,
    'v2.0.0',
    'OAuth authentication release'
  );
} else {
  console.error('Merge failed:', mergeResult.message);
  console.log('Conflicts:', mergeResult.conflicts);
}
```

## Performance Optimization

### Analyze and Optimize Workflow

```typescript
import { workflowPerformanceAnalyzer } from '@/services/workflow-performance-analyzer';

// Analyze performance
const analysis = workflowPerformanceAnalyzer.analyzePerformance(workflow);

console.log(`Performance Score: ${analysis.performanceScore}/100`);
console.log(`Bottleneck Score: ${analysis.bottleneckScore}/100`);
console.log(`Estimated Execution Time: ${analysis.estimatedExecutionTime}ms`);

// Review bottlenecks
console.log('\nBottlenecks:');
analysis.bottlenecks.forEach((bottleneck, index) => {
  console.log(`\n${index + 1}. ${bottleneck.type} (Severity: ${bottleneck.severity})`);
  console.log(`   ${bottleneck.description}`);
  console.log(`   Estimated impact: ${bottleneck.estimatedImpact}ms`);
  console.log('   Suggestions:');
  bottleneck.suggestions.forEach(s => console.log(`     - ${s}`));
});

// Review optimization suggestions
console.log('\nTop Optimization Suggestions:');
analysis.suggestions.slice(0, 5).forEach((suggestion, index) => {
  console.log(`\n${index + 1}. [Priority ${suggestion.priority}/5] ${suggestion.title}`);
  console.log(`   ${suggestion.description}`);
  if (suggestion.expectedSpeedup) {
    console.log(`   Expected speedup: ${suggestion.expectedSpeedup}`);
  }
  if (suggestion.difficulty) {
    console.log(`   Difficulty: ${suggestion.difficulty}/5`);
  }
});

// Check parallelization opportunities
console.log('\nParallelization Opportunities:');
analysis.parallelizationOpportunities.forEach((opp, index) => {
  const actionCount = opp.groups.reduce((sum, g) => sum + g.length, 0);
  console.log(`\n${index + 1}. ${actionCount} actions can be parallelized`);
  console.log(`   Estimated speedup: ${opp.estimatedSpeedup}ms`);
  console.log(`   Reason: ${opp.reason}`);
});

// Generate report
const report = workflowPerformanceAnalyzer.generatePerformanceReport(workflow);
console.log('\n' + report);
```

## Component Examples

### Create and Use Reusable Component

```typescript
import { workflowComponentsService } from '@/services/workflow-components-service';

// Create a login component
const loginComponent = workflowComponentsService.createComponent({
  name: 'Login',
  description: 'Authenticates user with username and password',
  category: 'Authentication',
  actions: [
    {
      id: 'comp-action-1',
      type: 'FIND',
      name: 'Find username field',
      position: [0, 0],
      config: { target: 'username-input' }
    },
    {
      id: 'comp-action-2',
      type: 'TYPE',
      name: 'Enter username',
      position: [0, 100],
      config: { text: '{{username}}' }
    },
    {
      id: 'comp-action-3',
      type: 'FIND',
      name: 'Find password field',
      position: [0, 200],
      config: { target: 'password-input' }
    },
    {
      id: 'comp-action-4',
      type: 'TYPE',
      name: 'Enter password',
      position: [0, 300],
      config: { text: '{{password}}' }
    },
    {
      id: 'comp-action-5',
      type: 'CLICK',
      name: 'Click login',
      position: [0, 400],
      config: { target: 'login-button' }
    }
  ],
  connections: {
    'comp-action-1': { main: [[{ action: 'comp-action-2', index: 0 }]] },
    'comp-action-2': { main: [[{ action: 'comp-action-3', index: 0 }]] },
    'comp-action-3': { main: [[{ action: 'comp-action-4', index: 0 }]] },
    'comp-action-4': { main: [[{ action: 'comp-action-5', index: 0 }]] }
  },
  parameters: [
    {
      name: 'username',
      type: 'string',
      description: 'User login name',
      required: true
    },
    {
      name: 'password',
      type: 'string',
      description: 'User password',
      required: true,
      sensitive: true
    }
  ],
  outputs: [
    {
      name: 'sessionToken',
      type: 'string',
      description: 'Authentication token'
    },
    {
      name: 'userId',
      type: 'string',
      description: 'User identifier'
    }
  ]
});

// Use the component in a workflow
const testWorkflow: Workflow = {
  id: 'test-wf-1',
  name: 'E2E Test with Login',
  actions: [],
  connections: {}
};

// Insert component
const insertedActions = workflowComponentsService.insertComponent(
  testWorkflow,
  loginComponent,
  {
    username: '{{testUsername}}',
    password: '{{testPassword}}'
  },
  [100, 100]
);

console.log(`Inserted ${insertedActions.length} actions from component`);
```

## Complete Workflows

### Complete E2E Test Workflow

```typescript
// Create a complete e2e test workflow with all features
const e2eWorkflow: Workflow = {
  id: 'e2e-checkout-1',
  name: 'E2E Checkout Test',
  description: 'Complete checkout flow test',
  actions: [
    // Setup
    { id: 'setup-1', type: 'SET_VARIABLE', name: 'Set test data',
      position: [100, 100], config: { name: 'testUser', value: 'test@example.com' } },

    // Login (using component)
    // ... login actions ...

    // Search for product
    { id: 'search-1', type: 'FIND', name: 'Find search box',
      position: [100, 300], config: { target: 'search-input' } },
    { id: 'search-2', type: 'TYPE', name: 'Enter search',
      position: [100, 400], config: { text: 'laptop' } },
    { id: 'search-3', type: 'CLICK', name: 'Search',
      position: [100, 500], config: { target: 'search-button' } },

    // Add to cart
    { id: 'cart-1', type: 'FIND', name: 'Find first result',
      position: [100, 600], config: { target: 'product-1' } },
    { id: 'cart-2', type: 'CLICK', name: 'Add to cart',
      position: [100, 700], config: { target: 'add-to-cart' } },

    // Checkout
    { id: 'checkout-1', type: 'CLICK', name: 'Go to cart',
      position: [100, 800], config: { target: 'cart-icon' } },
    { id: 'checkout-2', type: 'CLICK', name: 'Checkout',
      position: [100, 900], config: { target: 'checkout-button' } },

    // Verify
    { id: 'verify-1', type: 'FIND', name: 'Find confirmation',
      position: [100, 1000], config: { target: 'order-confirmation' } }
  ],
  connections: {
    'setup-1': { main: [[{ action: 'search-1', index: 0 }]] },
    'search-1': { main: [[{ action: 'search-2', index: 0 }]] },
    'search-2': { main: [[{ action: 'search-3', index: 0 }]] },
    'search-3': { main: [[{ action: 'cart-1', index: 0 }]] },
    'cart-1': { main: [[{ action: 'cart-2', index: 0 }]] },
    'cart-2': { main: [[{ action: 'checkout-1', index: 0 }]] },
    'checkout-1': { main: [[{ action: 'checkout-2', index: 0 }]] },
    'checkout-2': { main: [[{ action: 'verify-1', index: 0 }]] }
  }
};

// Organize it
workflowFolderManager.moveWorkflow(e2eWorkflow.id, '/E2E Tests/Smoke');
workflowFolderManager.addTag(e2eWorkflow.id, 'smoke');
workflowFolderManager.addTag(e2eWorkflow.id, 'checkout');
workflowFolderManager.addTag(e2eWorkflow.id, 'critical');

// Version it
const branch = workflowVersionControl.createBranch(e2eWorkflow.id, 'main');
workflowVersionControl.saveVersion(
  e2eWorkflow.id,
  branch.id,
  e2eWorkflow,
  'Initial E2E checkout test',
  'qa@example.com'
);

// Test it
const testCase = workflowTestingService.createTestCase({
  name: 'Verify checkout completes',
  workflowId: e2eWorkflow.id,
  assertions: [
    {
      type: 'exists',
      actual: '{{orderConfirmation}}',
      message: 'Should show order confirmation'
    }
  ]
});

// Analyze it
const performance = workflowPerformanceAnalyzer.analyzePerformance(e2eWorkflow);
console.log(`Performance score: ${performance.performanceScore}/100`);
```

## See Also

- [Organization Guide](./organization.md) - Organize workflows
- [Testing Guide](./testing.md) - Create tests
- [Version Control](./version-control.md) - Version workflows
- [API Reference](./api-reference.md) - Complete API
