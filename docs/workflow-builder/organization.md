# Workflow Organization & Folder Management

This guide covers organizing workflows into hierarchical folders with `workflowFolderManager`.

## Table of Contents

- [Overview](#overview)
- [Creating Folders](#creating-folders)
- [Moving Workflows](#moving-workflows)
- [Browsing Folders](#browsing-folders)
- [Export & Import](#export--import)
- [Best Practices](#best-practices)

## Overview

`workflowFolderManager` (`@/services/workflow-folder-manager`) is a singleton that keeps a folder tree and the workflow-to-folder associations in browser storage. Folders are addressed by **id**; a folder's place in the tree is its `parentId` (`null` for a top-level folder).

Most operations return a result object (`{ success, error?, ... }`) instead of throwing, so check `success` before using the payload. The result and option types live in `frontend/src/types/workflow-organization/types.ts`.

The folder manager has no tag, bulk or workflow-search API.

## Creating Folders

```typescript
import { workflowFolderManager } from '@/services/workflow-folder-manager';

const created = workflowFolderManager.createFolder({
  name: 'Authentication',
  parentId: null,
  description: 'Auth workflows',
});

if (!created.success || !created.folder) {
  throw new Error(created.error);
}

const child = workflowFolderManager.createFolder({
  name: 'Login',
  parentId: created.folder.id,
});
```

Rename or re-describe a folder with `updateFolder(id, options)`, re-parent it with `moveFolder(folderId, newParentId)` (use `canMoveFolder` first to check it would not create a cycle), and remove it with `deleteFolder(id, options?)`.

## Moving Workflows

```typescript
// Place a workflow in a folder (a workflow lives in at most one folder)
const moved = workflowFolderManager.moveWorkflow('workflow-123', folderId);
if (!moved.success) {
  console.error('Failed to move workflow:', moved.error);
}

// Which folder holds a workflow?
const location = workflowFolderManager.getWorkflowFolder('workflow-123');
if (location.success && location.folder) {
  console.log(`Workflow is in: ${location.folder.name}`);
}

// Take it out of its folder again
workflowFolderManager.removeWorkflowFromFolder('workflow-123');
```

## Browsing Folders

```typescript
const { folders } = workflowFolderManager.getAllFolders();
const { tree } = workflowFolderManager.getFolderTree();

// Breadcrumb from the root to a folder
const breadcrumb = workflowFolderManager.getFolderPath(folderId);

// Workflow ids in a folder; pass `true` to include sub-folders
const { workflowIds } = workflowFolderManager.getWorkflowsInFolder(folderId, true);

// Search folders (not workflows) by name or description
const matches = workflowFolderManager.searchFolders({ query: 'auth', includeDescription: true });
```

## Export & Import

### Export Folder Structure

```typescript
// Folders plus workflow associations, with version and timestamp
const exportData = workflowFolderManager.exportFolders();

const blob = new Blob([JSON.stringify(exportData, null, 2)], {
  type: 'application/json',
});
const url = URL.createObjectURL(blob);
const link = document.createElement('a');
link.href = url;
link.download = 'workflow-folders.json';
link.click();
```

### Import Folder Structure

```typescript
const data = JSON.parse(await file.text());

// merge = false replaces the current structure; true merges into it
const result = workflowFolderManager.importFolders(data, true);

if (result.success) {
  console.log(`Imported ${result.migratedFolders} folders`);
} else {
  console.error('Import failed:', result.errors);
}
```

The exported object is an `ImportExportData`: `folders`, `associations`, `exportedAt`, `exportedBy` and `version`.

## Best Practices

### Folder Naming

Use clear, descriptive names (`Registration`, `API Tests`, `Smoke Tests`) rather than vague ones (`Tests`, `Stuff`, `Misc`).

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

## See Also

- [Dependencies Guide](./dependencies.md) - Analyze workflow relationships
- [Best Practices](./best-practices.md) - Recommended patterns
