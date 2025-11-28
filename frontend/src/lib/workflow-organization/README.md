# Workflow Organization Types

Comprehensive TypeScript type definitions for workflow organization features in qontinui-web.

## Overview

This module provides types for advanced workflow management capabilities including:

- **Folder System**: Hierarchical organization of workflows
- **Dependencies**: Workflow dependency tracking and analysis
- **Testing**: Test cases, suites, and assertions
- **Metrics**: Performance and complexity analytics
- **Components**: Reusable workflow components
- **Documentation**: Workflow documentation and comments
- **Version Control**: Branching, versioning, and diffing
- **Collaboration**: Locks, comments, and reviews
- **Search**: Advanced filtering and search
- **Bulk Operations**: Batch workflow operations

## Installation

Import types from the module:

```typescript
import type {
  WorkflowFolder,
  TestCase,
  DependencyGraph,
  WorkflowMetrics,
} from "@/lib/workflow-organization";
```

## Usage Examples

### Folder System

```typescript
import type { WorkflowFolder, FolderTree } from "@/lib/workflow-organization";

const folder: WorkflowFolder = {
  id: "folder-1",
  name: "Authentication",
  parentId: null,
  path: "/authentication",
  children: ["folder-2", "folder-3"],
  workflowIds: ["wf-1", "wf-2"],
  color: "#3b82f6",
  icon: "lock",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
```

### Testing

```typescript
import type { TestCase, TestAssertion } from "@/lib/workflow-organization";

const testCase: TestCase = {
  id: "test-1",
  name: "Login flow validation",
  workflowId: "wf-1",
  description: "Validates successful login",
  inputs: {
    username: "test@example.com",
    password: "password123",
  },
  assertions: [
    {
      type: "equals",
      path: "output.success",
      expected: true,
      description: "Login should succeed",
    },
  ],
  status: "pending",
  enabled: true,
};
```

### Dependencies

```typescript
import type {
  WorkflowDependency,
  DependencyGraph,
} from "@/lib/workflow-organization";

const dependency: WorkflowDependency = {
  sourceWorkflowId: "wf-1",
  targetWorkflowId: "wf-2",
  actionId: "action-5",
  type: "workflow-call",
};
```

### Metrics

```typescript
import type {
  WorkflowMetrics,
  ComplexityMetrics,
} from "@/lib/workflow-organization";

const metrics: WorkflowMetrics = {
  workflowId: "wf-1",
  executionCount: 100,
  avgDuration: 1500,
  minDuration: 800,
  maxDuration: 3000,
  successRate: 0.95,
  errorRate: 0.05,
  lastRun: new Date().toISOString(),
  lastStatus: "success",
};

const complexity: ComplexityMetrics = {
  workflowId: "wf-1",
  actionCount: 15,
  connectionCount: 18,
  maxDepth: 5,
  branchingFactor: 1.2,
  cyclomaticComplexity: 8,
  score: 45,
  rating: "moderate",
  actionTypeDistribution: {
    CLICK: 5,
    TYPE: 3,
    IF: 2,
    // ...
  },
};
```

### Search & Filter

```typescript
import type { SearchFilter, SearchResult } from "@/lib/workflow-organization";

const filter: SearchFilter = {
  text: "login",
  tags: ["authentication", "critical"],
  folders: ["folder-1"],
  complexity: {
    rating: ["simple", "moderate"],
    maxActions: 25,
  },
  sortBy: "updated",
  sortOrder: "desc",
  limit: 20,
};
```

### Bulk Operations

```typescript
import type {
  BulkOperation,
  BulkOperationResult,
} from "@/lib/workflow-organization";

const operation: BulkOperation = {
  type: "move",
  workflowIds: ["wf-1", "wf-2", "wf-3"],
  parameters: {
    targetFolderId: "folder-5",
  },
  requireConfirmation: true,
};
```

## Type Guards

Utility functions for type checking:

```typescript
import {
  isAssertionPassed,
  isTestSuccessful,
  hasCircularDependencies,
  isRootFolder,
} from "@/lib/workflow-organization";

const assertion: TestAssertion = {
  /* ... */
};
if (isAssertionPassed(assertion)) {
  console.log("Assertion passed!");
}

const result: TestResult = {
  /* ... */
};
if (isTestSuccessful(result)) {
  console.log("Test passed!");
}

const analysis: DependencyAnalysis = {
  /* ... */
};
if (hasCircularDependencies(analysis)) {
  console.warn("Circular dependencies detected!");
}
```

## Constants

Predefined constants for common values:

```typescript
import {
  COMPLEXITY_THRESHOLDS,
  DEFAULT_TEST_TIMEOUT,
  MAX_FOLDER_DEPTH,
} from "@/lib/workflow-organization";

console.log(COMPLEXITY_THRESHOLDS.SIMPLE.maxActions); // 10
console.log(DEFAULT_TEST_TIMEOUT); // 60000 (60 seconds)
console.log(MAX_FOLDER_DEPTH); // 10
```

## Best Practices

1. **Use strict types**: Always import types explicitly with `type` keyword
2. **Leverage type guards**: Use provided type guards for runtime checks
3. **Document custom fields**: Use metadata fields for custom properties
4. **Follow naming conventions**: Use descriptive IDs with prefixes (e.g., 'wf-', 'test-', 'folder-')
5. **Handle optional fields**: Check for optional fields before accessing
6. **Use timestamps**: Always use ISO 8601 format for dates (`.toISOString()`)

## Related Files

- `/frontend/src/lib/action-schema/action-types.ts` - Core workflow and action types
- `/frontend/src/components/automation-builder/types.ts` - Builder UI types
- `/frontend/src/lib/api-client/types.ts` - API types

## Future Enhancements

The following features are planned for future releases:

- Real-time collaboration with WebSockets
- Advanced metrics visualization
- AI-powered workflow optimization suggestions
- Cross-project workflow sharing
- Team permissions and access control
