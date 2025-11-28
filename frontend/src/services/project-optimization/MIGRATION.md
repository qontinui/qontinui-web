# Migration Guide: project-optimization-service Refactoring

## Overview

The `project-optimization-service.ts` file (2,880 lines) has been refactored into a modular structure with 15 focused modules. This migration maintains **100% backward compatibility** - existing code will continue to work without changes.

## What Changed

### Before: Single File Structure

```
services/
└── project-optimization-service.ts (2,880 lines)
```

### After: Modular Structure

```
services/
├── project-optimization-service.ts (DEPRECATED - kept for reference)
└── project-optimization/
    ├── index.ts                      # Main orchestrator
    ├── types.ts                      # Shared types
    ├── health-analyzer.ts            # Health scoring
    ├── resource-analyzer.ts          # Resource analysis
    ├── unused-resource-detector.ts   # Unused resources
    ├── duplicate-detector.ts         # Duplication
    ├── reference-validator.ts        # Broken references
    ├── storage-analyzer.ts           # Storage analysis
    ├── complexity-analyzer.ts        # Complexity
    ├── coverage-analyzer.ts          # Coverage
    ├── dependency-analyzer.ts        # Dependencies
    ├── suggestion-generator.ts       # Suggestions
    ├── auto-optimizer.ts             # Auto-optimization
    ├── report-exporter.ts            # Reports
    └── utils.ts                      # Utilities
```

## Migration Steps

### Step 1: Update Import Paths (Required)

**Before:**

```typescript
import { projectOptimizationService } from "@/services/project-optimization-service";
```

**After:**

```typescript
import { projectOptimizationService } from "@/services/project-optimization";
```

**That's it!** The API remains the same.

### Step 2: Update Type Imports (If Using Types)

**Before:**

```typescript
import type {
  ProjectHealth,
  HealthReport,
  OptimizationSuggestion,
} from "@/services/project-optimization-service";
```

**After:**

```typescript
import type {
  ProjectHealth,
  HealthReport,
  OptimizationSuggestion,
} from "@/services/project-optimization";
```

## Usage Patterns

### Pattern 1: Singleton Service (Recommended for Consistency)

```typescript
import { projectOptimizationService } from "@/services/project-optimization";

// All methods work exactly as before
const health = projectOptimizationService.calculateProjectHealth(
  workflows,
  states,
  images,
  transitions
);

const report = projectOptimizationService.getHealthReport(
  workflows,
  states,
  images,
  transitions
);

const unusedImages = projectOptimizationService.findUnusedImages(
  images,
  workflows,
  states
);
```

### Pattern 2: Direct Function Imports (New Option)

The refactoring also enables you to import functions directly:

```typescript
import {
  calculateProjectHealth,
  getHealthReport,
  findUnusedImages,
  validateAllReferences,
} from "@/services/project-optimization";

// Use directly without the service instance
const health = calculateProjectHealth(workflows, states, images, transitions);
const unusedImages = findUnusedImages(images, workflows, states);
const brokenRefs = validateAllReferences(
  workflows,
  states,
  images,
  transitions
);
```

This is useful for:

- Tree-shaking (only import what you need)
- Testing (easier to mock individual functions)
- Functional programming style

### Pattern 3: Module-Specific Imports (Advanced)

For specialized use cases, import from specific modules:

```typescript
// Import only health-related functions
import {
  calculateProjectHealth,
  getHealthReport,
} from "@/services/project-optimization/health-analyzer";

// Import only storage-related functions
import {
  getStorageUsage,
  estimateStorageSavings,
} from "@/services/project-optimization/storage-analyzer";

// Import only types
import type {
  ProjectHealth,
  HealthFactor,
} from "@/services/project-optimization/types";
```

## Examples

### Example 1: Basic Health Check

**Before & After (Same Code):**

```typescript
import { projectOptimizationService } from "@/services/project-optimization";

function checkProjectHealth() {
  const workflows = getWorkflows();
  const states = getStates();
  const images = getImages();
  const transitions = getTransitions();

  const health = projectOptimizationService.calculateProjectHealth(
    workflows,
    states,
    images,
    transitions
  );

  if (health < 60) {
    console.warn("Project health is below 60!");
  }

  return health;
}
```

### Example 2: Generate Optimization Report

**Before & After (Same Code):**

```typescript
import { projectOptimizationService } from "@/services/project-optimization";

function generateReport() {
  const workflows = getWorkflows();
  const states = getStates();
  const images = getImages();
  const transitions = getTransitions();

  const report = projectOptimizationService.getHealthReport(
    workflows,
    states,
    images,
    transitions
  );

  return {
    health: report.health,
    suggestions: report.suggestions,
    issues: report.issues,
    storage: report.storage,
  };
}
```

### Example 3: Find and Clean Unused Resources

**Before & After (Same Code):**

```typescript
import { projectOptimizationService } from "@/services/project-optimization";

async function cleanupUnusedResources() {
  const workflows = getWorkflows();
  const states = getStates();
  const images = getImages();
  const transitions = getTransitions();

  // Find unused resources
  const unusedImages = projectOptimizationService.findUnusedImages(
    images,
    workflows,
    states
  );
  const unusedStates = projectOptimizationService.findUnusedStates(
    states,
    transitions
  );

  console.log(`Found ${unusedImages.length} unused images`);
  console.log(`Found ${unusedStates.length} unused states`);

  // Auto-optimize (dry run)
  const result = await projectOptimizationService.autoOptimize(
    workflows,
    states,
    images,
    transitions,
    {
      removeUnusedImages: true,
      removeOrphanedStates: true,
      dryRun: true, // Preview changes
    }
  );

  return result;
}
```

### Example 4: Using Direct Imports (New Feature)

**New Pattern Available After Refactoring:**

```typescript
import {
  calculateProjectHealth,
  findUnusedImages,
  findUnusedStates,
  validateAllReferences,
  type ProjectHealth,
  type BrokenReference,
} from "@/services/project-optimization";

function quickHealthCheck(): {
  health: number;
  unusedImageCount: number;
  unusedStateCount: number;
  brokenRefCount: number;
} {
  const workflows = getWorkflows();
  const states = getStates();
  const images = getImages();
  const transitions = getTransitions();

  // Direct function calls - cleaner, more functional
  const health = calculateProjectHealth(workflows, states, images, transitions);
  const unusedImages = findUnusedImages(images, workflows, states);
  const unusedStates = findUnusedStates(states, transitions);
  const brokenRefs = validateAllReferences(
    workflows,
    states,
    images,
    transitions
  );

  return {
    health,
    unusedImageCount: unusedImages.length,
    unusedStateCount: unusedStates.length,
    brokenRefCount: brokenRefs.length,
  };
}
```

## Testing

### Before: Hard to Test (Singleton with Many Dependencies)

```typescript
// Had to mock the entire service
jest.mock("@/services/project-optimization-service");
```

### After: Easy to Test (Import Only What You Need)

```typescript
import { calculateProjectHealth } from "@/services/project-optimization/health-analyzer";

// Mock only specific dependencies
jest.mock("@/services/workflow-complexity-analyzer");
jest.mock("@/services/project-optimization/coverage-analyzer");

describe("calculateProjectHealth", () => {
  it("calculates health correctly", () => {
    const health = calculateProjectHealth(
      mockWorkflows,
      mockStates,
      mockImages,
      mockTransitions
    );
    expect(health).toBe(85);
  });
});
```

## Troubleshooting

### Issue: Import Path Not Found

**Error:**

```
Cannot find module '@/services/project-optimization'
```

**Solution:**
Ensure you're importing from the directory (index.ts) not the old file:

```typescript
// ❌ Wrong (old path)
import { projectOptimizationService } from "@/services/project-optimization-service";

// ✅ Correct (new path)
import { projectOptimizationService } from "@/services/project-optimization";
```

### Issue: Type Errors After Update

**Solution:**
Clear your TypeScript build cache and restart your IDE:

```bash
# Clear TypeScript cache
rm -rf node_modules/.cache

# Rebuild
npm run build
```

### Issue: Missing Exports

If you get errors about missing exports, make sure you're using the correct export:

```typescript
// ✅ These are exported
import {
  projectOptimizationService, // Singleton
  calculateProjectHealth, // Function
  getHealthReport, // Function
  type ProjectHealth, // Type
} from "@/services/project-optimization";

// ❌ These are NOT exported (internal modules)
import { someInternalHelper } from "@/services/project-optimization/internal-helper";
```

## Benefits of the Refactoring

1. **Better Organization**: Related functionality is grouped together
2. **Easier Testing**: Test modules independently
3. **Better Performance**: Import only what you need (tree-shaking)
4. **Easier Maintenance**: Changes are localized
5. **Better Documentation**: Each module is self-documenting
6. **Type Safety**: Shared types are centralized
7. **100% Backward Compatible**: Existing code works without changes

## Rollback Plan

If you encounter issues, you can temporarily rollback:

1. Keep the old `project-optimization-service.ts` file (don't delete it yet)
2. Change imports back to the old path
3. Report the issue

The old file will be removed in a future release after confirming everything works.

## Summary

- ✅ **No breaking changes** - existing code works as-is
- ✅ **Update import paths** from `project-optimization-service` to `project-optimization`
- ✅ **Optional**: Use direct function imports for better tree-shaking
- ✅ **Optional**: Import from specific modules for advanced use cases

## Need Help?

- Check the [README.md](./README.md) for detailed module documentation
- Review the examples above
- Check existing usages in the codebase for patterns
