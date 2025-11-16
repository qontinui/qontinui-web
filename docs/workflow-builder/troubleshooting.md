# Troubleshooting Guide

Common issues and solutions for the Workflow Builder.

## Table of Contents

- [Organization Issues](#organization-issues)
- [Dependency Issues](#dependency-issues)
- [Version Control Issues](#version-control-issues)
- [Testing Issues](#testing-issues)
- [Performance Issues](#performance-issues)
- [Component Issues](#component-issues)
- [Data Issues](#data-issues)

## Organization Issues

### Folder Not Found

**Problem:** Cannot find or access a folder

**Solution:**
```typescript
// Check if folder exists
const folder = workflowFolderManager.getFolder('/Authentication');

if (!folder) {
  console.error('Folder does not exist');

  // Create it
  workflowFolderManager.createFolder({
    name: 'Authentication',
    parentPath: '/'
  });
}
```

### Workflow Not in Expected Folder

**Problem:** Workflow appears in wrong folder

**Solution:**
```typescript
// Find current location
const folder = workflowFolderManager.getFolderForWorkflow(workflowId);
console.log('Current folder:', folder?.path);

// Move to correct folder
workflowFolderManager.moveWorkflow(workflowId, '/Correct/Path');
```

### Tags Not Showing

**Problem:** Tags are not displayed

**Solution:**
```typescript
// Verify tags exist
const tags = workflowFolderManager.getTags(workflowId);
console.log('Tags:', tags);

// Re-add if missing
if (tags.length === 0) {
  workflowFolderManager.addTag(workflowId, 'critical');
}

// Clear browser cache if persists
localStorage.removeItem('workflow-folders');
location.reload();
```

### Cannot Delete Folder

**Problem:** Folder deletion fails

**Solution:**
```typescript
// Check if folder has workflows
const folder = workflowFolderManager.getFolder(folderPath);

if (folder && folder.workflowIds.length > 0) {
  console.log('Folder has workflows, move them first');

  // Move workflows to parent
  folder.workflowIds.forEach(workflowId => {
    workflowFolderManager.moveWorkflow(workflowId, folder.parentPath);
  });

  // Now delete
  workflowFolderManager.deleteFolder(folderPath);
}
```

## Dependency Issues

### Circular Dependency Detected

**Problem:** Cannot save workflow due to circular dependency

**Solution:**
```typescript
// Identify the cycle
const circular = workflowDependencyAnalyzer.detectCircularDependencies(workflows);

circular.forEach(cycle => {
  console.log('Cycle detected:', cycle.cycle.join(' → '));
  console.log('Full path:', cycle.path.join(' → '));
});

// To fix:
// 1. Remove one of the RUN_WORKFLOW actions in the cycle
// 2. Restructure workflows to avoid the cycle
// 3. Create a third workflow that both can call
```

### Dependency Graph Not Loading

**Problem:** Dependency visualization fails

**Solution:**
```typescript
// Check if workflows are loaded
if (workflows.length === 0) {
  console.error('No workflows loaded');
  return;
}

// Regenerate graph
const graph = workflowDependencyAnalyzer.buildDependencyGraph(workflows);

if (graph.nodes.length === 0) {
  console.error('No dependencies found');
} else {
  console.log(`Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
}
```

### Broken Dependencies

**Problem:** Workflow references non-existent workflow

**Solution:**
```typescript
// Find broken dependencies
const broken = workflows.filter(wf => {
  const deps = workflowDependencyAnalyzer.getDependencies(wf.id);
  return deps.some(dep => {
    return !workflows.some(w => w.id === dep.targetWorkflowId);
  });
});

console.log(`Found ${broken.length} workflows with broken dependencies`);

// Fix by:
// 1. Removing the RUN_WORKFLOW action
// 2. Updating the target workflow ID
// 3. Restoring the missing workflow
```

## Version Control Issues

### Version History Missing

**Problem:** No versions shown for workflow

**Solution:**
```typescript
// Check if branches exist
const branches = workflowVersionControl.getAllBranches(workflowId);

if (branches.length === 0) {
  console.log('No branches found, creating main branch');

  // Create main branch
  const branch = workflowVersionControl.createBranch(
    workflowId,
    'main',
    undefined,
    'Main branch'
  );

  // Save initial version
  workflowVersionControl.saveVersion(
    workflowId,
    branch.id,
    workflow,
    'Initial version'
  );
}

// Check versions
const versions = workflowVersionControl.getVersionHistory(workflowId);
console.log(`Found ${versions.length} versions`);
```

### Cannot Merge Branches

**Problem:** Merge fails with conflicts

**Solution:**
```typescript
// Check for conflicts
const conflicts = workflowVersionControl.detectConflicts(
  sourceBranchId,
  targetBranchId
);

if (conflicts.length > 0) {
  console.log('Conflicts detected:');
  conflicts.forEach(conflict => {
    console.log(`  ${conflict.type}: ${conflict.description}`);
  });

  // Resolve manually:
  // 1. Review changes in both branches
  // 2. Create new version with resolved changes
  // 3. Merge to target branch
}
```

### Tag Already Exists

**Problem:** Cannot create tag with existing name

**Solution:**
```typescript
// Check existing tags
const tags = workflowVersionControl.getAllTags(workflowId);
const existingTag = tags.find(t => t.name === 'v1.0.0');

if (existingTag) {
  // Option 1: Delete old tag
  workflowVersionControl.deleteTag(existingTag.id);

  // Option 2: Use different name
  workflowVersionControl.createTag(workflowId, versionId, 'v1.0.1');
}
```

## Testing Issues

### Test Fails Unexpectedly

**Problem:** Test passes locally but fails in CI

**Solution:**
```typescript
// Add debugging
const result = await workflowTestingService.runTestCase(testCaseId);

if (!result.passed) {
  console.log('Test failed');
  console.log('Variables:', result.variables);
  console.log('Failures:');

  result.failures.forEach(failure => {
    console.log(`  ${failure.assertion.message}`);
    console.log(`    Expected: ${JSON.stringify(failure.expected)}`);
    console.log(`    Actual: ${JSON.stringify(failure.actual)}`);
  });
}

// Common causes:
// 1. Timing issues (add proper waits)
// 2. Environment differences
// 3. Test data issues
// 4. Race conditions
```

### Assertion Always Fails

**Problem:** Specific assertion never passes

**Solution:**
```typescript
// Check variable values
const testCase = workflowTestingService.getTestCase(testCaseId);
console.log('Test setup:', testCase.setup);

// Verify assertion
const assertion = testCase.assertions[0];
console.log('Assertion:', assertion);

// Common issues:
// 1. Variable path incorrect: '{{result}}' vs '{{result.data}}'
// 2. Type mismatch: 'true' (string) vs true (boolean)
// 3. Case sensitivity: 'Success' vs 'success'

// Fix:
{
  type: 'equals',
  actual: '{{result.status}}',  // Correct path
  expected: 'success',          // Correct case
  message: 'Status should be success'
}
```

### Mock Execution Not Working

**Problem:** Mock environment doesn't simulate correctly

**Solution:**
```typescript
// Register custom mock behavior
workflowTestingService.registerMockAction('FIND', (action, context) => {
  // Return expected result
  return {
    found: true,
    element: { x: 100, y: 200 }
  };
});

// Set up test variables properly
const testCase = workflowTestingService.createTestCase({
  name: 'Test',
  workflowId: workflow.id,
  setup: {
    variables: {
      // Provide all required mock data
      apiResponse: { status: 200, data: {} },
      currentPage: 'dashboard'
    }
  },
  assertions: [/* ... */]
});
```

## Performance Issues

### Low Performance Score

**Problem:** Workflow has poor performance score

**Solution:**
```typescript
// Analyze performance
const analysis = workflowPerformanceAnalyzer.analyzePerformance(workflow);

console.log(`Performance Score: ${analysis.performanceScore}/100`);
console.log(`Bottleneck Score: ${analysis.bottleneckScore}/100`);

// Review bottlenecks
analysis.bottlenecks.forEach(bottleneck => {
  console.log(`${bottleneck.type} (${bottleneck.severity}): ${bottleneck.description}`);
});

// Review suggestions
analysis.suggestions.forEach(suggestion => {
  console.log(`[Priority ${suggestion.priority}] ${suggestion.title}`);
});

// Apply top suggestions
const topSuggestion = analysis.suggestions[0];
// Implement the suggestion
```

### Workflow Runs Too Slow

**Problem:** Execution takes too long

**Solution:**
```typescript
// Analyze wait actions
const waitAnalysis = analysis.waitAnalysis;

console.log(`Total wait time: ${waitAnalysis.totalWaitTime}ms`);
console.log(`Fixed waits: ${waitAnalysis.fixedWaits.length}`);

// Replace fixed waits with dynamic waits
waitAnalysis.fixedWaits.forEach(wait => {
  console.log(`Replace WAIT at ${wait.actionId} with FIND action`);
});

// Check parallelization opportunities
const opportunities = analysis.parallelizationOpportunities;

opportunities.forEach(opp => {
  console.log(`Can parallelize ${opp.groups.length} action groups`);
  console.log(`Estimated speedup: ${opp.estimatedSpeedup}ms`);
});
```

### Memory Issues

**Problem:** Browser runs out of memory

**Solution:**
```typescript
// Check resource usage
const resourceAnalysis = analysis.resourceAnalysis;

if (resourceAnalysis.screenshotCount > 10) {
  console.log('Too many screenshots, reduce count');
}

// Clear caches
workflowPerformanceAnalyzer.clearCache();
workflowAnalyticsService.clearOldData();

// Reduce workflow size
// 1. Split large workflows into smaller ones
// 2. Remove unnecessary screenshots
// 3. Clean up unused variables
```

## Component Issues

### Component Not Found

**Problem:** Cannot find or use component

**Solution:**
```typescript
// Verify component exists
const component = workflowComponentsService.getComponent(componentId);

if (!component) {
  console.error('Component not found');

  // List available components
  const all = workflowComponentsService.getAllComponents();
  console.log('Available components:');
  all.forEach(c => console.log(`  - ${c.name} (${c.id})`));
}
```

### Parameter Validation Fails

**Problem:** Component parameters not valid

**Solution:**
```typescript
// Validate parameters
const result = workflowComponentsService.validateParameters(
  component,
  parameterValues
);

if (!result.valid) {
  console.log('Validation errors:');
  result.errors.forEach(error => {
    console.log(`  ${error.parameter}: ${error.message}`);
  });

  // Fix parameters
  const correctedParams = {
    username: 'valid@example.com',  // Provide required
    timeout: 5000                    // Use correct type
  };
}
```

## Data Issues

### Data Lost After Refresh

**Problem:** Workflows or settings disappear

**Solution:**
```typescript
// Check localStorage
console.log('LocalStorage keys:', Object.keys(localStorage));

// Verify data exists
const folders = localStorage.getItem('workflow-folders');
const versions = localStorage.getItem('workflow-versions');

if (!folders || !versions) {
  console.error('Data missing from localStorage');

  // Restore from backup
  const backup = localStorage.getItem('workflow-backup');
  if (backup) {
    // Restore data
  }
}

// Enable auto-backup
setInterval(() => {
  const backup = {
    folders: workflowFolderManager.exportFolderStructure(),
    versions: workflowVersionControl.exportVersionHistory(workflowId),
    timestamp: new Date().toISOString()
  };

  localStorage.setItem('workflow-backup', JSON.stringify(backup));
}, 5 * 60 * 1000); // Every 5 minutes
```

### Export/Import Fails

**Problem:** Cannot export or import data

**Solution:**
```typescript
// Export with error handling
try {
  const json = workflowVersionControl.exportVersionHistory(workflowId);

  if (!json) {
    console.error('Export returned null');
    return;
  }

  // Validate JSON
  JSON.parse(json);

  // Save
  downloadFile(new Blob([json]), 'export.json');
} catch (error) {
  console.error('Export failed:', error);
}

// Import with validation
try {
  const content = await file.text();

  // Validate before import
  const data = JSON.parse(content);

  if (!data.workflowId || !data.branches) {
    throw new Error('Invalid export format');
  }

  // Import
  const success = workflowVersionControl.importVersionHistory(content);

  if (!success) {
    console.error('Import failed');
  }
} catch (error) {
  console.error('Import failed:', error);
}
```

## Getting Help

If you encounter issues not covered here:

1. **Check Browser Console**: Look for error messages
2. **Verify Data**: Check localStorage for missing data
3. **Review Logs**: Enable debug logging
4. **Clear Cache**: Try clearing browser cache
5. **Recreate Data**: As last resort, reimport from backup

### Debug Mode

```typescript
// Enable debug logging
localStorage.setItem('workflow-debug', 'true');

// Now all services will log detailed information
```

### Create Minimal Reproduction

```typescript
// To report an issue:
// 1. Create minimal workflow that reproduces the issue
// 2. Export the workflow
// 3. Document exact steps to reproduce
// 4. Include error messages and logs
```

## See Also

- [Best Practices](./best-practices.md) - Avoid common issues
- [API Reference](./api-reference.md) - Method documentation
- [Examples](./examples.md) - Working examples
