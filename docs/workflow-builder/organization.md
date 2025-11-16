# Workflow Organization & Folder Management

This guide covers organizing workflows using hierarchical folders, tags, search, and bulk operations.

## Table of Contents

- [Overview](#overview)
- [Folder Structure](#folder-structure)
- [Creating Folders](#creating-folders)
- [Moving Workflows](#moving-workflows)
- [Tags](#tags)
- [Search & Filter](#search--filter)
- [Bulk Operations](#bulk-operations)
- [Export & Import](#export--import)
- [Best Practices](#best-practices)

## Overview

The Workflow Folder Manager provides a file-system-like organization structure for workflows. You can create nested folders, tag workflows, search across your entire workflow library, and perform bulk operations.

### Key Features

- Hierarchical folder structure (unlimited nesting)
- Tag-based categorization
- Powerful search and filtering
- Bulk move, copy, and delete operations
- Folder statistics and metadata
- Export/import folder structures
- LocalStorage persistence

## Folder Structure

### Path Format

Folders use a path-based structure similar to file systems:

```
/                          # Root
/Authentication            # Top-level folder
/Authentication/Login      # Nested folder
/Authentication/Logout     # Another nested folder
/E2E Tests                 # Top-level folder
/E2E Tests/Smoke           # Nested under E2E Tests
```

### Root Folder

The root folder (`/`) is created automatically and cannot be deleted. All workflows start in the root folder by default.

### Folder Hierarchy

```
Root (/)
├── Authentication
│   ├── Login
│   │   ├── workflow-1.json
│   │   └── workflow-2.json
│   ├── Logout
│   └── Password Reset
├── E2E Tests
│   ├── Smoke
│   └── Regression
└── Utilities
    ├── Data Setup
    └── Cleanup
```

## Creating Folders

### Basic Folder Creation

```typescript
import { workflowFolderManager } from '@/services/workflow-folder-manager';

// Create a top-level folder
const authFolder = workflowFolderManager.createFolder({
  name: 'Authentication',
  parentPath: '/'
});

// Create a nested folder
const loginFolder = workflowFolderManager.createFolder({
  name: 'Login',
  parentPath: '/Authentication',
  description: 'Login-related workflows',
  metadata: {
    owner: 'team-a',
    priority: 'high'
  }
});
```

### With Description and Metadata

```typescript
const folder = workflowFolderManager.createFolder({
  name: 'E2E Tests',
  parentPath: '/',
  description: 'End-to-end test workflows',
  metadata: {
    environment: 'staging',
    frequency: 'daily',
    lastReviewed: '2024-01-15'
  }
});
```

### Folder Properties

```typescript
interface WorkflowFolder {
  id: string;              // Unique identifier
  name: string;            // Folder name
  path: string;            // Full path
  parentPath: string;      // Parent folder path
  description?: string;    // Optional description
  createdAt: string;       // ISO timestamp
  updatedAt: string;       // ISO timestamp
  workflowIds: string[];   // Workflows in this folder
  metadata?: Record<string, any>; // Custom metadata
}
```

## Moving Workflows

### Move Single Workflow

```typescript
// Move workflow to a folder
workflowFolderManager.moveWorkflow(
  'workflow-123',
  '/Authentication/Login'
);

// Move workflow to root
workflowFolderManager.moveWorkflow(
  'workflow-123',
  '/'
);
```

### Move with Error Handling

```typescript
try {
  const result = workflowFolderManager.moveWorkflow(
    workflowId,
    targetPath
  );

  if (result) {
    console.log('Workflow moved successfully');
  }
} catch (error) {
  console.error('Failed to move workflow:', error.message);
}
```

### Get Workflow Location

```typescript
// Get folder containing a workflow
const folder = workflowFolderManager.getFolderForWorkflow('workflow-123');

if (folder) {
  console.log(`Workflow is in: ${folder.path}`);
}
```

## Tags

Tags provide an additional layer of organization, allowing workflows to be categorized independently of folder structure.

### Adding Tags

```typescript
// Add single tag
workflowFolderManager.addTag('workflow-123', 'critical');

// Add multiple tags
workflowFolderManager.addTag('workflow-123', 'login');
workflowFolderManager.addTag('workflow-123', 'authentication');
workflowFolderManager.addTag('workflow-123', 'nightly');
```

### Removing Tags

```typescript
// Remove a specific tag
workflowFolderManager.removeTag('workflow-123', 'nightly');
```

### Getting Tags

```typescript
// Get all tags for a workflow
const tags = workflowFolderManager.getTags('workflow-123');
// Returns: ['critical', 'login', 'authentication']

// Get all unique tags across all workflows
const allTags = workflowFolderManager.getAllTags();
// Returns: ['critical', 'login', 'authentication', 'smoke-test', ...]
```

### Common Tag Categories

```typescript
// By priority
'critical' | 'high' | 'medium' | 'low'

// By type
'smoke-test' | 'regression' | 'integration' | 'unit'

// By feature
'login' | 'checkout' | 'search' | 'payment'

// By frequency
'nightly' | 'weekly' | 'on-demand'

// By environment
'production' | 'staging' | 'dev'
```

## Search & Filter

### Search by Name

```typescript
// Search for workflows by name (case-insensitive, partial match)
const results = workflowFolderManager.searchWorkflows('login');

results.forEach(result => {
  console.log(`${result.workflow.name} in ${result.folder.path}`);
});
```

### Filter by Tags

```typescript
// Find all workflows with specific tag
const criticalWorkflows = workflowFolderManager.filterWorkflowsByTag('critical');

criticalWorkflows.forEach(result => {
  console.log(result.workflow.name);
});

// Find workflows with multiple tags (AND logic)
const nightlyTests = workflowFolderManager.searchWorkflows('', {
  tags: ['nightly', 'smoke-test']
});
```

### Advanced Filtering

```typescript
// Custom filter function
const filtered = workflowFolderManager.filterWorkflows((workflow, folder) => {
  // Find workflows in Authentication folder
  return folder.path.startsWith('/Authentication');
});

// Filter by folder metadata
const highPriorityFolders = Array.from(
  workflowFolderManager.getAllFolders().values()
).filter(folder => folder.metadata?.priority === 'high');
```

### Get Workflows in Folder

```typescript
// Get all workflows in a specific folder (non-recursive)
const workflows = workflowFolderManager.getWorkflowsInFolder('/Authentication/Login');

workflows.forEach(wf => {
  console.log(wf.name);
});

// Get workflows recursively (including subfolders)
const allAuthWorkflows = workflowFolderManager.getWorkflowsInFolderRecursive(
  '/Authentication'
);
```

## Bulk Operations

### Bulk Move

```typescript
// Move multiple workflows to a folder
const workflowIds = ['wf-1', 'wf-2', 'wf-3'];

const result = workflowFolderManager.bulkMoveWorkflows(
  workflowIds,
  '/Authentication/Login'
);

console.log(`Success: ${result.successful.length}`);
console.log(`Failed: ${result.failed.length}`);

result.failed.forEach(failure => {
  console.error(`${failure.workflowId}: ${failure.error}`);
});
```

### Bulk Tag Operations

```typescript
// Add tag to multiple workflows
const workflowIds = ['wf-1', 'wf-2', 'wf-3'];

workflowIds.forEach(id => {
  workflowFolderManager.addTag(id, 'regression');
});

// Remove tag from multiple workflows
workflowIds.forEach(id => {
  workflowFolderManager.removeTag(id, 'deprecated');
});
```

### Bulk Delete

```typescript
// Delete multiple workflows
const result = workflowFolderManager.bulkDeleteWorkflows([
  'wf-1',
  'wf-2',
  'wf-3'
]);

if (result.successful.length > 0) {
  console.log(`Deleted ${result.successful.length} workflows`);
}
```

## Export & Import

### Export Folder Structure

```typescript
// Export entire folder structure with metadata
const exportData = workflowFolderManager.exportFolderStructure();

// Save to file
const blob = new Blob([JSON.stringify(exportData, null, 2)], {
  type: 'application/json'
});
const url = URL.createObjectURL(blob);
const link = document.createElement('a');
link.href = url;
link.download = 'workflow-folders.json';
link.click();
```

### Import Folder Structure

```typescript
// Read file content
const fileContent = await file.text();

// Import folder structure
const success = workflowFolderManager.importFolderStructure(fileContent);

if (success) {
  console.log('Folder structure imported successfully');
} else {
  console.error('Failed to import folder structure');
}
```

### Export Format

```json
{
  "folders": [
    {
      "id": "folder-123",
      "name": "Authentication",
      "path": "/Authentication",
      "parentPath": "/",
      "description": "Authentication workflows",
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:30:00Z",
      "workflowIds": ["wf-1", "wf-2"],
      "metadata": {
        "owner": "team-a"
      }
    }
  ],
  "tags": {
    "wf-1": ["critical", "login"],
    "wf-2": ["smoke-test"]
  },
  "exportedAt": "2024-01-15T12:00:00Z"
}
```

## Best Practices

### Folder Naming

```typescript
// ✅ Good: Clear, descriptive names
'/E2E Tests/User Management/Registration'
'/API Tests/Authentication'
'/Smoke Tests'

// ❌ Bad: Vague or inconsistent names
'/Tests'
'/Stuff'
'/Misc'
```

### Folder Organization Strategies

#### By Feature

```
/Features
  /User Management
    /Registration
    /Login
    /Profile
  /Shopping Cart
    /Add to Cart
    /Checkout
  /Search
```

#### By Test Type

```
/Tests
  /Smoke
  /Regression
  /Integration
  /Performance
```

#### By Environment

```
/Production
  /Critical Paths
  /Monitoring
/Staging
  /Feature Tests
  /Integration Tests
/Development
  /Experimental
  /Debugging
```

#### Hybrid Approach

```
/E2E Tests
  /Smoke
    /Authentication
    /Core Features
  /Regression
    /User Management
    /Shopping
/API Tests
  /Authentication
  /Data Validation
/Utilities
  /Setup
  /Cleanup
```

### Tag Strategy

```typescript
// Use consistent tag naming conventions

// Priority tags
workflowFolderManager.addTag(wfId, 'p0-critical');
workflowFolderManager.addTag(wfId, 'p1-high');
workflowFolderManager.addTag(wfId, 'p2-medium');
workflowFolderManager.addTag(wfId, 'p3-low');

// Type tags
workflowFolderManager.addTag(wfId, 'type:smoke');
workflowFolderManager.addTag(wfId, 'type:regression');

// Feature tags
workflowFolderManager.addTag(wfId, 'feature:login');
workflowFolderManager.addTag(wfId, 'feature:checkout');

// Schedule tags
workflowFolderManager.addTag(wfId, 'schedule:nightly');
workflowFolderManager.addTag(wfId, 'schedule:weekly');
```

### Folder Statistics

```typescript
// Get statistics for a folder
const folder = workflowFolderManager.getFolder('/Authentication');
const stats = {
  workflowCount: folder.workflowIds.length,
  createdDaysAgo: Math.floor(
    (Date.now() - new Date(folder.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  ),
  lastUpdated: new Date(folder.updatedAt).toLocaleDateString()
};

console.log(`Folder: ${folder.path}`);
console.log(`Workflows: ${stats.workflowCount}`);
console.log(`Last updated: ${stats.lastUpdated}`);
```

### Maintenance Tasks

```typescript
// Find empty folders
const emptyFolders = Array.from(
  workflowFolderManager.getAllFolders().values()
).filter(folder => folder.workflowIds.length === 0 && folder.path !== '/');

// Find workflows without tags
const untaggedWorkflows = workflowFolderManager.getAllWorkflows()
  .filter(wf => workflowFolderManager.getTags(wf.id).length === 0);

// Find duplicate workflow names
const workflowsByName = new Map<string, string[]>();
workflowFolderManager.getAllWorkflows().forEach(wf => {
  const existing = workflowsByName.get(wf.name) || [];
  existing.push(wf.id);
  workflowsByName.set(wf.name, existing);
});

const duplicates = Array.from(workflowsByName.entries())
  .filter(([name, ids]) => ids.length > 1);
```

## Common Patterns

### Moving Workflow with Confirmation

```typescript
function moveWorkflowWithConfirmation(
  workflowId: string,
  targetPath: string
): boolean {
  const folder = workflowFolderManager.getFolderForWorkflow(workflowId);
  const currentPath = folder?.path || '/';

  const confirmed = confirm(
    `Move workflow from "${currentPath}" to "${targetPath}"?`
  );

  if (confirmed) {
    return workflowFolderManager.moveWorkflow(workflowId, targetPath);
  }

  return false;
}
```

### Create Folder Hierarchy

```typescript
function createFolderHierarchy(paths: string[]): void {
  paths.forEach(path => {
    // Split path into parts
    const parts = path.split('/').filter(p => p);
    let currentPath = '';

    // Create each level if it doesn't exist
    parts.forEach(part => {
      const parentPath = currentPath || '/';
      currentPath = `${parentPath}/${part}`.replace('//', '/');

      const exists = workflowFolderManager.getFolder(currentPath);
      if (!exists) {
        workflowFolderManager.createFolder({
          name: part,
          parentPath
        });
      }
    });
  });
}

// Usage
createFolderHierarchy([
  '/E2E Tests/Smoke',
  '/E2E Tests/Regression',
  '/API Tests/Authentication'
]);
```

### Tag-based Workflow Selection

```typescript
function selectWorkflowsByTags(
  requiredTags: string[],
  excludedTags: string[] = []
): string[] {
  const allWorkflows = workflowFolderManager.getAllWorkflows();

  return allWorkflows
    .filter(wf => {
      const tags = workflowFolderManager.getTags(wf.id);

      // Must have all required tags
      const hasRequired = requiredTags.every(tag => tags.includes(tag));

      // Must not have any excluded tags
      const hasExcluded = excludedTags.some(tag => tags.includes(tag));

      return hasRequired && !hasExcluded;
    })
    .map(wf => wf.id);
}

// Usage: Get all nightly smoke tests that aren't deprecated
const workflowIds = selectWorkflowsByTags(
  ['nightly', 'smoke-test'],
  ['deprecated', 'disabled']
);
```

## Troubleshooting

### Folder Not Found

```typescript
// Always check if folder exists before operations
const targetFolder = workflowFolderManager.getFolder('/NonExistent');
if (!targetFolder) {
  console.error('Folder does not exist');
  // Create it or handle error
}
```

### Circular Folder References

The system prevents circular references automatically. Parent folders are validated during creation.

### Performance with Large Hierarchies

```typescript
// For large folder structures, cache frequently accessed data
const folderCache = new Map<string, WorkflowFolder>();

function getCachedFolder(path: string): WorkflowFolder | null {
  if (!folderCache.has(path)) {
    const folder = workflowFolderManager.getFolder(path);
    if (folder) {
      folderCache.set(path, folder);
    }
  }
  return folderCache.get(path) || null;
}
```

## See Also

- [Dependencies Guide](./dependencies.md) - Analyze workflow relationships
- [Best Practices](./best-practices.md) - Recommended patterns
- [API Reference](./api-reference.md) - Complete API documentation
