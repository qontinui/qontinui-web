# Workflow Builder Documentation

Welcome to the comprehensive documentation for the Qontinui Workflow Builder advanced features. This documentation covers enterprise-grade workflow management capabilities including organization, dependency analysis, testing, analytics, and complexity analysis.

## Table of Contents

- [Overview](#overview)
- [Feature Summary](#feature-summary)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Detailed Documentation](#detailed-documentation)

## Overview

The Workflow Builder is a powerful automation tool that enables you to create, organize, and manage complex UI automation workflows. It provides a visual interface for building workflows along with advanced features for enterprise-scale automation projects.

### Key Benefits

- **Organized**: Hierarchical folder structure
- **Reliable**: Testing framework with assertions and test suites
- **Insightful**: Execution metrics and complexity analysis
- **Documented**: Auto-generated documentation with markdown support
- **Scalable**: Dependency analysis and circular dependency detection

## Feature Summary

### 1. Organization & Folder Management

Organize workflows in hierarchical folders.

- Create nested folder structures
- Move workflows and folders within the tree
- Search folders by name and description
- Export/import folder structures

**Documentation**: [Organization Guide](./organization.md)

### 2. Dependency Analysis

Understand workflow relationships and prevent circular dependencies.

- Visualize dependency graphs
- Detect circular dependencies
- Impact analysis for workflow changes
- Identify unused workflows
- Export dependency reports

**Documentation**: [Dependencies Guide](./dependencies.md)

### 3. Testing Framework

Test cases with assertions, grouped into suites. Execution is simulated.

- Create test cases with multiple assertions
- Organize tests into suites
- Assertion types: equals, contains, exists, comparisons, regex, custom
- Test result history, statistics and action coverage

**Documentation**: [Testing Guide](./testing.md)

### 4. Analytics & Metrics

Track workflow executions and derive metrics from them.

- Execution count and success rates
- Average, minimum and maximum duration
- Most-used, slowest and most error-prone workflows
- Export analytics reports

**Documentation**: [Analytics Guide](./analytics.md)

### 5. Documentation System

Auto-generate and maintain workflow documentation.

- Markdown-based documentation with version history
- Auto-generate from workflow structure
- Built-in documentation templates
- Export to Markdown or HTML

**Documentation**: [Documentation Guide](./documentation.md)

### 6. Complexity Analysis

Analyze workflow structure.

- Cyclomatic complexity
- Depth and branching factor
- Complexity score and rating
- Simplification suggestions

**Documentation**: [Analytics Guide - Complexity](./analytics.md#complexity-analysis)

## Quick Start

### Organizing Workflows

```typescript
import { workflowFolderManager } from '@/services/workflow-folder-manager';

// Create a top-level folder
const { folder } = workflowFolderManager.createFolder({
  name: 'Authentication',
  parentId: null
});

// Move a workflow into it
if (folder) {
  workflowFolderManager.moveWorkflow(workflowId, folder.id);
}
```

### Creating a Test

```typescript
import { getWorkflowTestingService } from '@/services/workflow-testing-service';

const testing = getWorkflowTestingService();

// Create test case
const testCase = testing.createTestCase(
  workflow.id,
  {
    inputs: { loginResult: 'success' },
    assertions: [{ id: 'login', type: 'equals', path: 'loginResult', expected: 'success' }]
  },
  { name: 'Verify login success' }
);

// Run test (simulated execution)
const result = await testing.runTestCase(testCase.id);
console.log(result.passed ? 'Test passed' : 'Test failed');
```

## Architecture

### Service Layer

The Workflow Builder uses a service-oriented architecture with singleton services for each major feature:

```
┌─────────────────────────────────────────────────────────────┐
│                     Workflow Builder UI                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Service Layer                           │
├─────────────────────────────────────────────────────────────┤
│  • WorkflowFolderManager         (Organization)             │
│  • WorkflowDependencyAnalyzer     (Dependencies)            │
│  • WorkflowTestingService         (Testing)                 │
│  • WorkflowAnalyticsService       (Metrics & Analytics)     │
│  • WorkflowComplexityAnalyzer     (Complexity)              │
│  • WorkflowDocumentationService   (Documentation)           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Data Persistence Layer                    │
├─────────────────────────────────────────────────────────────┤
│  • LocalStorage (Browser Storage)                           │
│  • Export/Import (JSON files)                               │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **UI Layer**: React components provide user interface
2. **Service Layer**: Singleton services handle business logic
3. **Persistence Layer**: LocalStorage stores data locally
4. **Export/Import**: JSON-based backup and restore

### Service Interactions

```
WorkflowBuilder
    │
    ├──> FolderManager ──> LocalStorage
    │
    ├──> DependencyAnalyzer
    │         │
    │         └──> Analyzes RUN_WORKFLOW actions
    │
    ├──> TestingService ──> LocalStorage
    │         │
    │         └──> Simulated Execution
    │
    ├──> AnalyticsService ──> LocalStorage
    │
    └──> DocumentationService
              │
              └──> Generates from Workflow structure
```

## Detailed Documentation

### Feature Guides

- [Organization & Folders](./organization.md) - Manage workflow hierarchy
- [Dependencies](./dependencies.md) - Analyze workflow relationships
- [Testing Framework](./testing.md) - Test workflows comprehensively
- [Analytics & Metrics](./analytics.md) - Track execution metrics and complexity
- [Documentation](./documentation.md) - Auto-generate documentation

### Guides

- [Best Practices](./best-practices.md) - Design patterns and strategies

## Getting Help

If you need assistance:

1. Read the feature guide for the service you are using (linked above)
2. Read [Best Practices](./best-practices.md) for recommended patterns
3. The services themselves live in `frontend/src/services/` and are the authoritative API reference

## Contributing

When extending the Workflow Builder:

1. Follow the service pattern (singleton services)
2. Use TypeScript for type safety
3. Persist data to LocalStorage
4. Provide export/import capabilities
5. Document new features thoroughly
6. Add comprehensive tests

## Version History

- **v1.0.0** - Initial release with all major features
  - Organization & Folder Management
  - Dependency Analysis
  - Testing Framework
  - Analytics & Metrics
  - Documentation System
  - Complexity Analysis

## License

Licensed under AGPL-3.0-or-later, as part of qontinui-web — see the repository [LICENSE](../../LICENSE).
