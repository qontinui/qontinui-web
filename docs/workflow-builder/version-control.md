# Workflow Version Control

This guide covers git-like version control for workflows including branches, versions, tags, merging, and diffs.

## Table of Contents

- [Overview](#overview)
- [Branches](#branches)
- [Versions](#versions)
- [Tags](#tags)
- [Comparing & Diff](#comparing--diff)
- [Merging](#merging)
- [Import & Export](#import--export)
- [Best Practices](#best-practices)

## Overview

The Workflow Version Control system provides git-like version management for workflows with branches, commits (versions), tags, merging, and detailed diffs.

### Key Features

- Create and manage branches
- Save versions (like git commits)
- Tag important releases
- Compare versions with detailed diffs
- Merge branches with conflict detection
- Rollback to previous versions
- Export/import version history

## Branches

### Create Branch

```typescript
import { workflowVersionControl } from '@/services/workflow-version-control';

// Create a new branch
const branch = workflowVersionControl.createBranch(
  workflowId,
  'feature/new-login-flow',
  undefined,  // parent branch (undefined = from current/default branch)
  'Implementing new OAuth login flow'
);

console.log(`Created branch: ${branch.name}`);
console.log(`Branch ID: ${branch.id}`);
```

### Switch Branch

```typescript
// Switch to a different branch
const branch = workflowVersionControl.switchBranch(workflowId, branchId);

console.log(`Switched to: ${branch.name}`);
```

### List Branches

```typescript
// Get all branches for a workflow
const branches = workflowVersionControl.getAllBranches(workflowId);

branches.forEach(branch => {
  console.log(`${branch.name}${branch.isDefault ? ' (default)' : ''}`);
  console.log(`  Created: ${new Date(branch.createdAt).toLocaleDateString()}`);
  console.log(`  Last updated: ${new Date(branch.updatedAt).toLocaleDateString()}`);
});
```

### Delete Branch

```typescript
// Delete a branch
const success = workflowVersionControl.deleteBranch(branchId);

if (success) {
  console.log('Branch deleted successfully');
}
```

### Branch Structure

```typescript
interface Branch {
  id: string;
  workflowId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  parentBranchId?: string;
  currentVersionId?: string;
  isDefault?: boolean;
  metadata?: Record<string, any>;
}
```

## Versions

Versions are like git commits - they represent saved states of a workflow.

### Save Version

```typescript
// Save a new version (commit)
const version = workflowVersionControl.saveVersion(
  workflowId,
  branchId,
  workflow,
  'Add two-factor authentication support',
  'john.doe@example.com'
);

console.log(`Version saved: ${version.id}`);
console.log(`Message: ${version.message}`);
```

### Version History

```typescript
// Get version history for a workflow
const versions = workflowVersionControl.getVersionHistory(workflowId);

versions.forEach(version => {
  console.log(`\n${version.message}`);
  console.log(`  By: ${version.author || 'Unknown'}`);
  console.log(`  Date: ${new Date(version.timestamp).toLocaleString()}`);
  console.log(`  Branch: ${version.branchId}`);
  console.log(`  Actions: ${version.metadata?.actionCount}`);
});

// Get history for specific branch
const branchVersions = workflowVersionControl.getVersionHistory(
  workflowId,
  branchId
);
```

### Rollback

```typescript
// Rollback to a previous version
const newVersion = workflowVersionControl.rollbackToVersion(
  workflowId,
  versionId,
  'admin@example.com'
);

console.log('Rolled back to version:', newVersion.parentVersionId);
console.log('Created new version:', newVersion.id);
```

### Get Version

```typescript
// Get a specific version
const version = workflowVersionControl.getVersion(versionId);

if (version) {
  // Access the workflow state at that version
  const workflowSnapshot = version.workflow;

  console.log(`Version: ${version.message}`);
  console.log(`Actions: ${workflowSnapshot.actions.length}`);
}
```

## Tags

Tags mark important versions (like git tags for releases).

### Create Tag

```typescript
// Tag a version
const tag = workflowVersionControl.createTag(
  workflowId,
  versionId,
  'v1.0.0',
  'Initial production release'
);

console.log(`Created tag: ${tag.name}`);
```

### List Tags

```typescript
// Get all tags for a workflow
const tags = workflowVersionControl.getAllTags(workflowId);

tags.forEach(tag => {
  console.log(`${tag.name}: ${tag.description || 'No description'}`);
  console.log(`  Created: ${new Date(tag.createdAt).toLocaleDateString()}`);
});
```

### Get Version by Tag

```typescript
// Get version by tag name
const version = workflowVersionControl.getVersionByTag(workflowId, 'v1.0.0');

if (version) {
  console.log(`Tag v1.0.0 points to: ${version.message}`);
}
```

### Delete Tag

```typescript
// Delete a tag
const success = workflowVersionControl.deleteTag(tagId);
```

## Comparing & Diff

### Compare Versions

```typescript
// Compare two versions
const diff = workflowVersionControl.compareVersions(version1Id, version2Id);

if (diff) {
  console.log(`\nActions added: ${diff.summary.actionsAdded}`);
  console.log(`Actions removed: ${diff.summary.actionsRemoved}`);
  console.log(`Actions modified: ${diff.summary.actionsModified}`);
  console.log(`Connections changed: ${diff.summary.connectionsChanged}`);
  console.log(`Total changes: ${diff.summary.totalChanges}`);
}
```

### Diff Structure

```typescript
interface VersionDiff {
  // Action changes
  actionsAdded: ActionDiff[];
  actionsRemoved: ActionDiff[];
  actionsModified: ActionModification[];
  actionsUnchanged: string[];

  // Connection changes
  connectionsAdded: ConnectionDiff[];
  connectionsRemoved: ConnectionDiff[];
  connectionsModified: ConnectionModification[];

  // Property changes
  propertiesChanged: PropertyChange[];

  // Variable changes
  variablesChanged: VariableChange[];

  // Summary
  summary: DiffSummary;
}
```

### View Detailed Changes

```typescript
// View added actions
diff.actionsAdded.forEach(action => {
  console.log(`Added: ${action.name} (${action.type})`);
});

// View removed actions
diff.actionsRemoved.forEach(action => {
  console.log(`Removed: ${action.name} (${action.type})`);
});

// View modified actions
diff.actionsModified.forEach(mod => {
  console.log(`\nModified: ${mod.id}`);

  if (mod.changes.name) {
    console.log(`  Name: "${mod.changes.name.old}" → "${mod.changes.name.new}"`);
  }

  if (mod.changes.config) {
    console.log(`  Config changed:`, mod.changes.config.fields);
  }

  if (mod.changes.position) {
    console.log(`  Position changed`);
  }
});
```

### Compare Workflows

```typescript
// Compare two workflow instances directly
const diff = workflowVersionControl.compareWorkflows(workflow1, workflow2);

// Same diff structure as compareVersions
```

## Merging

### Merge Branches

```typescript
// Merge source branch into target branch
const result = workflowVersionControl.mergeBranch(
  sourceBranchId,
  targetBranchId,
  'admin@example.com'
);

if (result.success) {
  console.log('Merge successful!');
  console.log('Merged workflow:', result.workflow);
} else {
  console.error('Merge failed:', result.message);

  if (result.conflicts.length > 0) {
    console.log('\nConflicts:');
    result.conflicts.forEach(conflict => {
      console.log(`  - ${conflict.type}: ${conflict.description}`);
    });
  }
}
```

### Detect Conflicts

```typescript
// Check for conflicts before merging
const conflicts = workflowVersionControl.detectConflicts(
  sourceBranchId,
  targetBranchId
);

if (conflicts.length > 0) {
  console.log('Merge conflicts detected:');

  conflicts.forEach(conflict => {
    console.log(`\n${conflict.type} conflict:`);
    console.log(`  Path: ${conflict.path}`);
    console.log(`  Description: ${conflict.description}`);
    console.log(`  Source value:`, conflict.sourceValue);
    console.log(`  Target value:`, conflict.targetValue);
  });
}
```

### Conflict Types

```typescript
interface MergeConflict {
  id: string;
  type: 'action' | 'connection' | 'property' | 'variable';
  path: string;
  sourceValue: any;
  targetValue: any;
  baseValue?: any;
  description: string;
}
```

### Auto-Merge

```typescript
// Attempt auto-merge (fails if conflicts exist)
const result = workflowVersionControl.autoMerge(
  sourceBranchId,
  targetBranchId,
  'admin@example.com'
);
```

## Import & Export

### Export Branch

```typescript
// Export a branch with all its versions
const json = workflowVersionControl.exportBranch(branchId);

if (json) {
  // Save to file
  const blob = new Blob([json], { type: 'application/json' });
  downloadFile(blob, `branch-${branchId}.json`);
}
```

### Import Branch

```typescript
// Import a branch from JSON
const fileContent = await file.text();

const branch = workflowVersionControl.importBranch(fileContent);

if (branch) {
  console.log(`Imported branch: ${branch.name}`);
} else {
  console.error('Failed to import branch');
}
```

### Export Version History

```typescript
// Export complete version history for a workflow
const json = workflowVersionControl.exportVersionHistory(workflowId);

if (json) {
  downloadFile(new Blob([json]), `workflow-${workflowId}-history.json`);
}
```

### Import Version History

```typescript
// Import version history
const success = workflowVersionControl.importVersionHistory(fileContent);

if (success) {
  console.log('Version history imported successfully');
}
```

## Best Practices

### Branch Naming Conventions

```typescript
// Use descriptive branch names with prefixes
'main'                          // Default branch
'develop'                       // Development branch
'feature/oauth-login'           // New feature
'fix/login-timeout'             // Bug fix
'hotfix/security-patch'         // Critical fix
'experiment/new-ui'             // Experimental changes
'release/v2.0.0'                // Release preparation
```

### Commit Messages

```typescript
// Write clear, descriptive commit messages
// ✅ Good
'Add two-factor authentication support'
'Fix timeout issue in login flow'
'Update user profile validation logic'
'Remove deprecated password reset method'

// ❌ Bad
'Update'
'Fix stuff'
'Changes'
'WIP'
```

### Semantic Versioning for Tags

```typescript
// Use semantic versioning: MAJOR.MINOR.PATCH

// MAJOR: Breaking changes
workflowVersionControl.createTag(workflowId, versionId, 'v2.0.0',
  'Major update: Changed authentication method');

// MINOR: New features, backward compatible
workflowVersionControl.createTag(workflowId, versionId, 'v1.1.0',
  'Added OAuth support');

// PATCH: Bug fixes
workflowVersionControl.createTag(workflowId, versionId, 'v1.0.1',
  'Fixed login timeout issue');
```

### Feature Branch Workflow

```
main (production)
  ↓
develop (integration)
  ↓
feature/xyz (feature development)
```

```typescript
// 1. Create feature branch from develop
const featureBranch = workflowVersionControl.createBranch(
  workflowId,
  'feature/new-feature',
  developBranchId,
  'Adding new feature'
);

// 2. Make changes and commit
workflowVersionControl.switchBranch(workflowId, featureBranch.id);
// ... make changes ...
workflowVersionControl.saveVersion(
  workflowId,
  featureBranch.id,
  workflow,
  'Implement new feature',
  'dev@example.com'
);

// 3. Merge back to develop
const mergeResult = workflowVersionControl.mergeBranch(
  featureBranch.id,
  developBranchId,
  'dev@example.com'
);

// 4. Test on develop, then merge to main
if (testsPass) {
  workflowVersionControl.mergeBranch(
    developBranchId,
    mainBranchId,
    'admin@example.com'
  );

  // 5. Tag the release
  const releaseVersion = workflowVersionControl.getLatestVersion(
    workflowId,
    mainBranchId
  );

  workflowVersionControl.createTag(
    workflowId,
    releaseVersion!.id,
    'v1.2.0',
    'Release 1.2.0'
  );
}
```

### Regular Commits

```typescript
// Commit frequently with meaningful messages
// This makes it easier to track changes and rollback if needed

// ✅ Good: Commit after each logical change
saveVersion(workflowId, branchId, workflow, 'Add login form validation');
// ... make more changes ...
saveVersion(workflowId, branchId, workflow, 'Add error handling for network failures');
// ... make more changes ...
saveVersion(workflowId, branchId, workflow, 'Update success message formatting');

// ❌ Bad: One big commit
// ... make all changes at once ...
saveVersion(workflowId, branchId, workflow, 'Update login workflow');
```

### Migration from Snapshots

```typescript
// Migrate existing snapshots to version control
const migratedCount = workflowVersionControl.migrateSnapshots();
console.log(`Migrated ${migratedCount} snapshots to version control`);
```

## Advanced Patterns

### Review Before Merge

```typescript
// Review changes before merging
function reviewAndMerge(sourceBranchId: string, targetBranchId: string) {
  // Get branches
  const sourceBranch = workflowVersionControl.getBranch(sourceBranchId);
  const targetBranch = workflowVersionControl.getBranch(targetBranchId);

  // Get latest versions
  const sourceVersion = workflowVersionControl.getVersion(
    sourceBranch!.currentVersionId!
  );
  const targetVersion = workflowVersionControl.getVersion(
    targetBranch!.currentVersionId!
  );

  // Compare
  const diff = workflowVersionControl.compareWorkflows(
    targetVersion!.workflow,
    sourceVersion!.workflow
  );

  // Show summary
  console.log(`\nMerging ${sourceBranch!.name} → ${targetBranch!.name}`);
  console.log(`Total changes: ${diff.summary.totalChanges}`);

  // Check for conflicts
  const conflicts = workflowVersionControl.detectConflicts(
    sourceBranchId,
    targetBranchId
  );

  if (conflicts.length > 0) {
    console.error(`Cannot merge: ${conflicts.length} conflicts found`);
    return false;
  }

  // Confirm merge
  const confirmed = confirm('Proceed with merge?');

  if (confirmed) {
    const result = workflowVersionControl.mergeBranch(
      sourceBranchId,
      targetBranchId
    );

    return result.success;
  }

  return false;
}
```

### Change Statistics

```typescript
// Track change statistics
const stats = workflowVersionControl.getChangeStatistics(workflowId);

console.log(`Total versions: ${stats.totalVersions}`);
console.log(`Total changes: ${stats.totalChanges}`);
console.log(`Avg changes per version: ${stats.averageChangesPerVersion.toFixed(1)}`);
console.log(`Most active areas: ${stats.mostActiveAreas.join(', ')}`);
```

### Contributors

```typescript
// Get contributor information
const contributors = workflowVersionControl.getContributors(workflowId);

console.log('\nContributors:');
contributors.forEach(contributor => {
  console.log(`  ${contributor.author}: ${contributor.versionCount} versions`);
  console.log(`    Last contribution: ${new Date(contributor.lastContribution).toLocaleDateString()}`);
});
```

## See Also

- [Organization Guide](./organization.md) - Organize workflows
- [Testing Guide](./testing.md) - Test different versions
- [Best Practices](./best-practices.md) - Version control best practices
- [API Reference](./api-reference.md) - Complete API documentation
