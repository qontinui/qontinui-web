# Project Optimization Service

A refactored, modular project optimization service following the Single Responsibility Principle.

## Overview

This service was refactored from a single 2,880-line file into 15 focused modules, each with a single, clear responsibility. The refactoring maintains 100% backward compatibility with the original API while improving:

- **Maintainability**: Each module has a clear purpose and can be modified independently
- **Testability**: Modules can be tested in isolation with minimal dependencies
- **Readability**: Smaller, focused files are easier to understand
- **Scalability**: New features can be added to specific modules without affecting others

## Module Structure

```
project-optimization/
├── types.ts                      # Shared TypeScript types and interfaces
├── index.ts                      # Main orchestrator (backward compatible API)
├── health-analyzer.ts            # Health scoring and metrics
├── resource-analyzer.ts          # Resource analysis for workflows/states/images/transitions
├── unused-resource-detector.ts   # Orphaned/unused resource detection
├── duplicate-detector.ts         # Duplication detection
├── reference-validator.ts        # Broken reference validation
├── storage-analyzer.ts           # Storage calculations
├── complexity-analyzer.ts        # Complexity analysis
├── coverage-analyzer.ts          # Test/documentation coverage
├── dependency-analyzer.ts        # Dependency impact analysis
├── suggestion-generator.ts       # Optimization suggestion generation
├── auto-optimizer.ts             # Auto-optimization capabilities
├── report-exporter.ts            # Report export functionality
└── utils.ts                      # Shared utility functions
```

## Module Responsibilities

### 1. `types.ts` - Shared Types

All TypeScript interfaces and types used across modules:

- `ProjectHealth`, `HealthFactor`, `HealthReport`
- `WorkflowAnalysis`, `StateAnalysis`, `ImageAnalysis`, `TransitionAnalysis`
- `OptimizationSuggestion`, `ProjectIssue`
- `DuplicateMatch`, `BrokenReference`
- `StorageAnalysis`, `CoverageReport`, `ComplexityReport`
- `ProjectMetrics`, `MetricsTrend`
- `AutoOptimizationOptions`, `AutoOptimizationResult`
- `HealthAlert`, `HealthAlertTrigger`

### 2. `index.ts` - Main Orchestrator

Main entry point that:

- Maintains the original `ProjectOptimizationService` singleton class
- Delegates to specialized modules
- Provides backward compatibility
- Re-exports all types and functions

### 3. `health-analyzer.ts` - Health Scoring

Calculates project health metrics:

- `calculateProjectHealth()` - Overall health score (0-100)
- `getHealthReport()` - Detailed health breakdown
- `createMetricsSnapshot()` - Current metrics snapshot
- `calculateMetricsTrend()` - Metrics trends over time
- `checkAlerts()` - Health alert monitoring

Health factors (weighted):

- Test coverage (25%)
- Documentation coverage (20%)
- Organization (15%)
- Complexity (20%)
- Unused resources (10%)
- Broken references (10%)

### 4. `resource-analyzer.ts` - Resource Analysis

Analyzes different resource types:

- `analyzeWorkflows()` - Complexity, testing, documentation, dependencies
- `analyzeStates()` - Usage, images, complexity, broken references
- `analyzeImages()` - Usage, duplicates, optimization potential
- `analyzeTransitions()` - Valid references, circular dependencies

### 5. `unused-resource-detector.ts` - Unused Resources

Detects orphaned/unused resources:

- `findUnusedImages()` - Images not referenced anywhere
- `findUnusedStates()` - States not used in transitions
- `findUnusedWorkflows()` - Workflows never called
- `findOrphanedStates()` - States with no transitions

### 6. `duplicate-detector.ts` - Duplication Detection

Finds potential duplicates using:

- Exact name matching
- Size similarity (within 5%)
- String similarity (Levenshtein distance)
- Structure similarity (action sequences)

Functions:

- `findDuplicateImages()`
- `findDuplicateStates()`
- `findDuplicateWorkflows()`

### 7. `reference-validator.ts` - Reference Validation

Validates references between resources:

- `validateAllReferences()` - Complete project validation
- `findBrokenWorkflowReferences()` - Missing workflow/state/image references
- `findBrokenStateReferences()` - Missing image references
- `findBrokenTransitionReferences()` - Missing state/workflow references

### 8. `storage-analyzer.ts` - Storage Analysis

Analyzes storage usage:

- `getStorageUsage()` - Total and breakdown by type/folder
- `estimateStorageSavings()` - Potential savings from optimizations
- `getImageStorageBreakdown()` - Storage by image source

### 9. `complexity-analyzer.ts` - Complexity Analysis

Analyzes code complexity:

- `getComplexityDistribution()` - Distribution across low/medium/high/very-high
- `findHighComplexityResources()` - Resources above threshold
- `suggestComplexityReductions()` - Simplification suggestions

### 10. `coverage-analyzer.ts` - Coverage Analysis

Test and documentation coverage:

- `calculateTestCoverage()` - Overall and per-folder test coverage
- `calculateDocumentationCoverage()` - Documentation coverage metrics
- `getUndocumentedResources()` - Resources lacking documentation
- `getUntestedResources()` - Resources lacking tests

### 11. `dependency-analyzer.ts` - Dependency Analysis

Dependency and impact analysis:

- `analyzeProjectDependencies()` - Build dependency graph
- `findCriticalResources()` - Most depended-on resources
- `findCircularDependencies()` - Circular dependency detection
- `getImpactAnalysis()` - Impact of modifying/removing a resource

### 12. `suggestion-generator.ts` - Suggestions

Generates optimization suggestions with priorities:

- Delete unused images/states/workflows
- Add tests/documentation
- Organize into folders
- Fix broken references
- Reduce complexity
- Consolidate duplicates
- Optimize storage

### 13. `auto-optimizer.ts` - Auto-Optimization

Automatic optimizations:

- `autoOptimize()` - Apply optimizations based on options
- `exportBackup()` - Create backup before optimization
- Dry-run support
- Category suggestions

### 14. `report-exporter.ts` - Report Export

Export functionality:

- `exportOptimizationReport()` - Generate comprehensive report

### 15. `utils.ts` - Utilities

Shared helper functions:

- `calculateStringSimilarity()` - Levenshtein distance
- `formatBytes()` - Human-readable byte formatting

## Usage

### Basic Usage (Singleton)

```typescript
import { projectOptimizationService } from "@/services/project-optimization";

// Calculate health
const health = projectOptimizationService.calculateProjectHealth(
  workflows,
  states,
  images,
  transitions
);

// Get detailed report
const report = projectOptimizationService.getHealthReport(
  workflows,
  states,
  images,
  transitions
);

// Find unused resources
const unusedImages = projectOptimizationService.findUnusedImages(
  images,
  workflows,
  states
);
```

### Direct Function Usage

```typescript
import {
  calculateProjectHealth,
  getHealthReport,
  findUnusedImages,
  validateAllReferences,
} from "@/services/project-optimization";

// Use functions directly
const health = calculateProjectHealth(workflows, states, images, transitions);
const unusedImages = findUnusedImages(images, workflows, states);
const brokenRefs = validateAllReferences(
  workflows,
  states,
  images,
  transitions
);
```

### Type Imports

```typescript
import type {
  ProjectHealth,
  HealthReport,
  OptimizationSuggestion,
  BrokenReference,
} from "@/services/project-optimization";
```

## Migration Guide

### Before (Original)

```typescript
import { projectOptimizationService } from '@/services/project-optimization-service';

const health = projectOptimizationService.calculateProjectHealth(...);
```

### After (Refactored)

```typescript
// Same API - no changes needed!
import { projectOptimizationService } from '@/services/project-optimization';

const health = projectOptimizationService.calculateProjectHealth(...);
```

The refactored service maintains 100% backward compatibility. All existing code will continue to work without modifications.

## Benefits of This Architecture

1. **Single Responsibility**: Each module has one clear purpose
2. **Independent Testing**: Modules can be tested in isolation
3. **Easier Maintenance**: Changes are localized to specific modules
4. **Better Organization**: Related functionality is grouped together
5. **Reduced Coupling**: Modules depend on shared types, not each other
6. **Improved Readability**: Smaller files are easier to understand
7. **Scalability**: New features fit naturally into existing structure

## Metrics

- **Original**: 1 file, 2,880 lines
- **Refactored**: 15 files, ~3,457 lines total (includes documentation comments)
- **Modules**: 15 focused, single-responsibility modules
- **Backward Compatibility**: 100%

## Testing Strategy

Each module can be tested independently:

```typescript
// Test health analyzer
import { calculateProjectHealth } from "./health-analyzer";
// Mock only what's needed

// Test resource analyzer
import { analyzeWorkflows } from "./resource-analyzer";
// Test in isolation

// Test suggestion generator
import { generateSuggestions } from "./suggestion-generator";
// Pass mock analysis results
```

## Future Enhancements

The modular structure makes it easy to add:

- Performance metrics tracking (`performance-analyzer.ts`)
- Security analysis (`security-analyzer.ts`)
- AI-powered suggestions (`ai-suggestion-generator.ts`)
- Custom rules engine (`rules-engine.ts`)
- Plugin system (`plugin-manager.ts`)

Each enhancement would be a new module following the same pattern.
