# Migration Guide

Guide for migrating from legacy workflows to the new Workflow Builder system.

## Table of Contents

- [Overview](#overview)
- [Before You Start](#before-you-start)
- [Migration Steps](#migration-steps)
- [Migrate Snapshots to Version Control](#migrate-snapshots-to-version-control)
- [Organize Existing Workflows](#organize-existing-workflows)
- [Add Testing](#add-testing)
- [Set Up Analytics](#set-up-analytics)
- [Common Issues](#common-issues)
- [Rollback Plan](#rollback-plan)

## Overview

This guide helps you migrate from the legacy workflow system to the new Workflow Builder with folders, version control, testing, and analytics.

### What's New

- **Folder Organization**: Hierarchical folder structure with tags
- **Version Control**: Git-like branches, versions, and tags
- **Dependency Analysis**: Understand workflow relationships
- **Testing Framework**: Comprehensive testing with assertions
- **Analytics**: Performance metrics and trends
- **Components**: Reusable workflow components
- **Documentation**: Auto-generated documentation

## Before You Start

### Backup Your Workflows

```typescript
// Export all existing workflows
const allWorkflows = getAllWorkflows();

const backup = {
  workflows: allWorkflows,
  timestamp: new Date().toISOString(),
  version: '1.0.0'
};

const json = JSON.stringify(backup, null, 2);
downloadFile(new Blob([json]), `workflow-backup-${Date.now()}.json`);
```

### Analyze Current State

```typescript
// Check what you have
console.log(`Total workflows: ${allWorkflows.length}`);

// Check for dependencies
const analysis = workflowDependencyAnalyzer.analyzeDependencies(allWorkflows);
console.log(`Workflows with dependencies: ${analysis.workflowsWithDependencies}`);
console.log(`Circular dependencies: ${analysis.circularDependencies.length}`);

// Check complexity
allWorkflows.forEach(wf => {
  const complexity = workflowComplexityAnalyzer.analyzeComplexity(wf);
  if (complexity.cyclomaticComplexity > 10) {
    console.log(`High complexity: ${wf.name} (${complexity.cyclomaticComplexity})`);
  }
});
```

## Migration Steps

### Step 1: Migrate Snapshots to Version Control

If you have existing snapshots, migrate them to the new version control system:

```typescript
// Automatic migration
const migratedCount = workflowVersionControl.migrateSnapshots();
console.log(`Migrated ${migratedCount} snapshots to version control`);
```

This creates:
- A `main` branch for each workflow
- Versions from each snapshot (in chronological order)
- Preserves snapshot metadata

### Step 2: Create Folder Structure

```typescript
// Plan your folder structure
const folderStructure = [
  '/Authentication',
  '/Authentication/Login',
  '/Authentication/Logout',
  '/E2E Tests',
  '/E2E Tests/Smoke',
  '/E2E Tests/Regression',
  '/Utilities',
  '/Utilities/Setup',
  '/Utilities/Cleanup'
];

// Create folders
folderStructure.forEach(path => {
  const parts = path.split('/').filter(p => p);
  const name = parts[parts.length - 1];
  const parentPath = parts.length > 1
    ? '/' + parts.slice(0, -1).join('/')
    : '/';

  const exists = workflowFolderManager.getFolder(path);
  if (!exists) {
    workflowFolderManager.createFolder({ name, parentPath });
  }
});
```

### Step 3: Organize Workflows into Folders

```typescript
// Categorize workflows
const categories = {
  '/Authentication/Login': [
    'login-workflow-1',
    'login-workflow-2'
  ],
  '/Authentication/Logout': [
    'logout-workflow-1'
  ],
  '/E2E Tests/Smoke': [
    'smoke-test-1',
    'smoke-test-2'
  ]
  // ... more categories
};

// Move workflows
Object.entries(categories).forEach(([path, workflowIds]) => {
  workflowIds.forEach(workflowId => {
    workflowFolderManager.moveWorkflow(workflowId, path);
  });
});
```

### Step 4: Add Tags

```typescript
// Define tag mapping
const tagMapping = {
  'login-workflow-1': ['critical', 'authentication', 'nightly'],
  'smoke-test-1': ['smoke', 'p0', 'quick'],
  // ... more mappings
};

// Apply tags
Object.entries(tagMapping).forEach(([workflowId, tags]) => {
  tags.forEach(tag => {
    workflowFolderManager.addTag(workflowId, tag);
  });
});
```

### Step 5: Create Version Control Branches

```typescript
// Create development branches for active workflows
const activeworkflows = [
  'login-workflow-1',
  'checkout-workflow-1'
];

activeWorkflows.forEach(workflowId => {
  // Get main branch
  const branches = workflowVersionControl.getAllBranches(workflowId);
  const mainBranch = branches.find(b => b.name === 'main');

  if (mainBranch) {
    // Create develop branch
    workflowVersionControl.createBranch(
      workflowId,
      'develop',
      mainBranch.id,
      'Development branch'
    );
  }
});
```

### Step 6: Add Tests

```typescript
// Create test cases for critical workflows
const criticalWorkflows = getAllWorkflows().filter(wf =>
  workflowFolderManager.getTags(wf.id).includes('critical')
);

criticalWorkflows.forEach(workflow => {
  // Create basic smoke test
  const testCase = workflowTestingService.createTestCase({
    name: `Smoke test for ${workflow.name}`,
    workflowId: workflow.id,
    assertions: [
      {
        type: 'exists',
        actual: '{{result}}',
        message: 'Workflow should produce a result'
      }
    ],
    tags: ['smoke', 'migration']
  });

  console.log(`Created test for ${workflow.name}`);
});
```

### Step 7: Set Up Analytics

```typescript
// Enable analytics tracking
// This happens automatically when workflows execute

// Optionally, record historical data if you have it
historicalExecutions.forEach(execution => {
  workflowAnalyticsService.recordExecution({
    workflowId: execution.workflowId,
    workflowName: execution.workflowName,
    duration: execution.duration,
    success: execution.success,
    timestamp: execution.timestamp
  });
});
```

### Step 8: Analyze and Optimize

```typescript
// Analyze all workflows for issues
getAllWorkflows().forEach(workflow => {
  // Check dependencies
  const dependencies = workflowDependencyAnalyzer.getDependencies(workflow.id);
  if (dependencies.length > 5) {
    console.log(`${workflow.name} has many dependencies (${dependencies.length})`);
  }

  // Check performance
  const performance = workflowPerformanceAnalyzer.analyzePerformance(workflow);
  if (performance.performanceScore < 50) {
    console.log(`${workflow.name} has low performance score (${performance.performanceScore})`);
  }

  // Check complexity
  const complexity = workflowComplexityAnalyzer.analyzeComplexity(workflow);
  if (complexity.cyclomaticComplexity > 10) {
    console.log(`${workflow.name} is complex (${complexity.cyclomaticComplexity})`);
  }
});
```

## Migrate Snapshots to Version Control

### Manual Migration

If automatic migration doesn't work, migrate manually:

```typescript
import { WorkflowSnapshotsService } from '@/services/workflow-snapshots';

function migrateSnapshotsManually(workflowId: string) {
  const snapshotService = WorkflowSnapshotsService.getInstance();
  const snapshots = snapshotService.getSnapshots(workflowId);

  // Sort by timestamp
  snapshots.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Create main branch
  let branches = workflowVersionControl.getAllBranches(workflowId);
  if (branches.length === 0) {
    workflowVersionControl.createBranch(workflowId, 'main');
    branches = workflowVersionControl.getAllBranches(workflowId);
  }

  const mainBranch = branches[0];

  // Create version for each snapshot
  snapshots.forEach(snapshot => {
    workflowVersionControl.saveVersion(
      workflowId,
      mainBranch.id,
      snapshot.workflow,
      snapshot.name,
      snapshot.metadata?.author
    );
  });

  console.log(`Migrated ${snapshots.length} snapshots for ${workflowId}`);
}
```

## Common Issues

### Issue: Workflows Lost After Migration

**Solution:**
```typescript
// Restore from backup
const backup = JSON.parse(backupJson);

backup.workflows.forEach(workflow => {
  // Re-import workflow
  importWorkflow(workflow);
});
```

### Issue: Circular Dependencies Detected

**Solution:**
```typescript
// Fix circular dependencies
const circular = workflowDependencyAnalyzer.detectCircularDependencies(workflows);

circular.forEach(cycle => {
  console.log('Circular dependency:', cycle.cycle.join(' -> '));
  // Manual intervention required to break the cycle
});
```

### Issue: Tags Not Showing

**Solution:**
```typescript
// Verify tags are saved
const tags = workflowFolderManager.getTags(workflowId);
console.log('Tags:', tags);

// Re-add if missing
workflowFolderManager.addTag(workflowId, 'critical');
```

### Issue: Version History Missing

**Solution:**
```typescript
// Re-run migration
workflowVersionControl.clearAll(workflowId);
workflowVersionControl.migrateSnapshots();
```

## Rollback Plan

### Prepare for Rollback

```typescript
// Before migration, export everything
const fullBackup = {
  workflows: getAllWorkflows(),
  snapshots: snapshotService.listAllSnapshots(),
  folders: Array.from(workflowFolderManager.getAllFolders().values()),
  tags: {}, // Add tag data
  timestamp: new Date().toISOString()
};

localStorage.setItem('pre-migration-backup', JSON.stringify(fullBackup));
```

### Execute Rollback

```typescript
// Restore from backup
const backup = JSON.parse(localStorage.getItem('pre-migration-backup')!);

// Clear new data
workflowVersionControl.clearAll();
workflowFolderManager.clearAll();

// Restore workflows
backup.workflows.forEach(workflow => {
  saveWorkflow(workflow);
});

// Restore snapshots
backup.snapshots.forEach(snapshot => {
  snapshotService.createSnapshot(snapshot);
});
```

## Post-Migration Checklist

- [ ] All workflows imported successfully
- [ ] Folder structure created and organized
- [ ] Tags applied to workflows
- [ ] Version control branches created
- [ ] Snapshots migrated to versions
- [ ] Tests created for critical workflows
- [ ] Analytics enabled and tracking
- [ ] Dependencies analyzed
- [ ] Performance analyzed
- [ ] Documentation generated
- [ ] Team trained on new system
- [ ] Backup created and verified

## Next Steps

After migration:

1. **Train Your Team**: Familiarize everyone with new features
2. **Create Documentation**: Generate docs for all workflows
3. **Set Up CI/CD**: Integrate testing into your pipeline
4. **Monitor Performance**: Track metrics and optimize
5. **Establish Workflow**: Define branching and versioning strategy
6. **Regular Maintenance**: Schedule periodic analysis and cleanup

## See Also

- [Organization Guide](./organization.md) - Organize workflows
- [Version Control](./version-control.md) - Use version control
- [Testing Guide](./testing.md) - Create tests
- [Best Practices](./best-practices.md) - Follow best practices
