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

- **Organized**: Hierarchical folder structure with tags and search capabilities
- **Reliable**: Comprehensive testing framework with assertions and test suites
- **Reusable**: Component library for creating modular, parameterized subflows
- **Insightful**: Analytics dashboard with execution metrics and performance trends
- **Documented**: Auto-generated documentation with markdown support
- **Scalable**: Dependency analysis and circular dependency detection

## Feature Summary

### 1. Organization & Folder Management

Organize workflows in hierarchical folders with tagging, search, and bulk operations.

- Create nested folder structures
- Tag workflows for easy categorization
- Search and filter across all workflows
- Bulk move, copy, and delete operations
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

### 3. Reusable Components

Create modular, parameterized workflow components for code reuse.

- Build component library
- Parameterize components
- Version component templates
- Share components across workflows
- Built-in component catalog

**Documentation**: [Components Guide](./components.md)

### 4. Testing Framework

Comprehensive testing with test cases, assertions, and automated suites.

- Create test cases with multiple assertions
- Organize tests into suites
- Mock execution environment
- Assertion types: equals, contains, exists, regex, custom
- Test result tracking and reporting

**Documentation**: [Testing Guide](./testing.md)

### 5. Analytics & Metrics

Track workflow performance with detailed metrics and trends.

- Execution count and success rates
- Average duration and performance trends
- Success/failure analysis
- Custom metrics and dashboards
- Export analytics reports

**Documentation**: [Analytics Guide](./analytics.md)

### 6. Documentation System

Auto-generate and maintain workflow documentation.

- Markdown-based documentation
- Auto-generate from workflow structure
- Custom documentation templates
- Export to multiple formats

**Documentation**: [Documentation Guide](./documentation.md)

### 7. Complexity Analysis

Analyze and track workflow complexity metrics.

- Cyclomatic complexity
- Cognitive complexity
- Nesting depth analysis
- Maintainability index
- Code smell detection

**Documentation**: [Best Practices - Complexity](./best-practices.md#managing-complexity)

## Quick Start

### Setting Up Your First Workflow

```typescript
import { WorkflowBuilder } from '@/services/workflow-builder';

// Create a new workflow
const workflow = WorkflowBuilder.create({
  name: 'My First Workflow',
  description: 'Automates login process'
});

// Add actions
workflow.addAction({
  type: 'FIND',
  name: 'Find Login Button',
  config: { /* ... */ }
});

// Save the workflow
workflow.save();
```

### Organizing Workflows

```typescript
import { workflowFolderManager } from '@/services/workflow-folder-manager';

// Create folder structure
const folder = workflowFolderManager.createFolder({
  name: 'Authentication',
  parentPath: '/Workflows'
});

// Move workflow to folder
workflowFolderManager.moveWorkflow(workflowId, '/Workflows/Authentication');

// Add tags
workflowFolderManager.addTag(workflowId, 'login');
workflowFolderManager.addTag(workflowId, 'critical');
```

### Creating a Test

```typescript
import { workflowTestingService } from '@/services/workflow-testing-service';

// Create test case
const testCase = workflowTestingService.createTestCase({
  name: 'Verify login success',
  workflowId: workflow.id,
  assertions: [
    {
      type: 'equals',
      actual: '{{loginResult}}',
      expected: 'success',
      message: 'Login should succeed'
    }
  ]
});

// Run test
const result = await workflowTestingService.runTestCase(testCase.id);
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
│  • WorkflowComponentsService      (Reusable Components)     │
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
    │         └──> Mock Execution
    │
    ├──> AnalyticsService ──> LocalStorage
    │
    ├──> ComponentsService ──> LocalStorage
    │
    └──> DocumentationService
              │
              └──> Generates from Workflow structure
```

## Detailed Documentation

### Feature Guides

- [Organization & Folders](./organization.md) - Manage workflow hierarchy
- [Dependencies](./dependencies.md) - Analyze workflow relationships
- [Reusable Components](./components.md) - Build component libraries
- [Testing Framework](./testing.md) - Test workflows comprehensively
- [Analytics & Metrics](./analytics.md) - Track execution metrics and complexity
- [Documentation](./documentation.md) - Auto-generate documentation

### Reference Documentation

- [API Reference](./api-reference.md) - Complete API documentation
- [Data Models](./data-models.md) - Type definitions and schemas
- [Examples](./examples.md) - Complete working examples

### Guides

- [Migration Guide](./migration-guide.md) - Migrate from legacy system
- [Best Practices](./best-practices.md) - Design patterns and strategies
- [Troubleshooting](./troubleshooting.md) - Common issues and solutions

## Getting Help

If you need assistance:

1. Check the [Troubleshooting Guide](./troubleshooting.md)
2. Review [Examples](./examples.md) for reference implementations
3. Consult the [API Reference](./api-reference.md) for detailed method signatures
4. Read [Best Practices](./best-practices.md) for recommended patterns

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
  - Reusable Components
  - Testing Framework
  - Analytics & Metrics
  - Documentation System
  - Complexity Analysis

## License

Licensed under AGPL-3.0-or-later, as part of qontinui-web — see the repository [LICENSE](../../LICENSE).
