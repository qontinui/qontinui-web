# Project Optimization

Comprehensive guide for optimizing automation projects and improving project health.

## Table of Contents

- [Overview](#overview)
- [Finding Unused Resources](#finding-unused-resources)
- [Detecting Duplicates](#detecting-duplicates)
- [Fixing Broken References](#fixing-broken-references)
- [Performance Optimization](#performance-optimization)
- [Improving Health Score](#improving-health-score)

## Overview

Project optimization keeps your automation project lean, fast, and maintainable as it grows to 100+ resources.

## Finding Unused Resources

### Unused Images

```typescript
// Find images with no usage
const unusedImages = images.filter(img => img.usageCount === 0);

// Find images not used in last 30 days
const staleImages = images.filter(img => {
  if (!img.lastUsed) return true;
  const daysSinceUse = (Date.now() - img.lastUsed.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceUse > 30;
});

// Review and delete
console.log(`Found ${unusedImages.length} unused images`);
unusedImages.forEach(img => {
  console.log(`- ${img.name} (created ${img.createdAt})`);
});
```

**Recommendation**: Delete images unused for 30+ days

### Unused States

```typescript
// Find unreachable states
const unreachable = findUnreachableStates(states, transitions);

// Find states with no transitions
const isolated = states.filter(state => {
  const hasIncoming = transitions.some(t =>
    t.type === 'OutgoingTransition' && t.toState === state.id
  );
  const hasOutgoing = transitions.some(t =>
    t.type === 'OutgoingTransition' && t.fromState === state.id
  );
  return !hasIncoming && !hasOutgoing && !state.initial;
});
```

**Recommendation**: Review isolated/unreachable states monthly

### Unused Workflows

```typescript
// Find workflows not used in any transition
const unusedWorkflows = workflows.filter(workflow => {
  return !transitions.some(t => t.workflows.includes(workflow.id));
});

// Find workflows not executed in 30 days
const staleWorkflows = workflows.filter(w => {
  if (!w.lastExecuted) return true;
  const daysSinceExec = (Date.now() - w.lastExecuted.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceExec > 30;
});
```

**Recommendation**: Archive or delete unused workflows quarterly

## Detecting Duplicates

### Duplicate Names

```typescript
// Find duplicate resource names
function findDuplicateNames(resources: Resource[]): Map<string, Resource[]> {
  const nameMap = new Map<string, Resource[]>();

  resources.forEach(resource => {
    const existing = nameMap.get(resource.name) || [];
    existing.push(resource);
    nameMap.set(resource.name, existing);
  });

  // Return only duplicates
  return new Map(
    Array.from(nameMap.entries()).filter(([_, items]) => items.length > 1)
  );
}

// Usage
const duplicateImages = findDuplicateNames(images);
duplicateImages.forEach((items, name) => {
  console.log(`Duplicate name "${name}": ${items.length} images`);
});
```

**Recommendation**: Rename duplicates with descriptive suffixes

### Similar States

```typescript
// Find states with similar structure
function findSimilarStates(states: State[]): [State, State][] {
  const similar: [State, State][] = [];

  for (let i = 0; i < states.length; i++) {
    for (let j = i + 1; j < states.length; j++) {
      const similarity = calculateStateSimilarity(states[i], states[j]);
      if (similarity > 0.8) {  // 80% similar
        similar.push([states[i], states[j]]);
      }
    }
  }

  return similar;
}

function calculateStateSimilarity(a: State, b: State): number {
  // Compare structure
  const imageCountSimilar = Math.abs(a.stateImages.length - b.stateImages.length) < 2;
  const regionCountSimilar = Math.abs(a.regions.length - b.regions.length) < 2;
  const nameSimilar = levenshteinDistance(a.name, b.name) < 5;

  return (
    (imageCountSimilar ? 0.4 : 0) +
    (regionCountSimilar ? 0.3 : 0) +
    (nameSimilar ? 0.3 : 0)
  );
}
```

**Recommendation**: Consolidate similar states or use templates

### Duplicate Image Content

```typescript
// Find images with identical content (same data URL)
function findDuplicateImages(images: ImageAsset[]): Map<string, ImageAsset[]> {
  const urlMap = new Map<string, ImageAsset[]>();

  images.forEach(image => {
    const existing = urlMap.get(image.url) || [];
    existing.push(image);
    urlMap.set(image.url, existing);
  });

  return new Map(
    Array.from(urlMap.entries()).filter(([_, items]) => items.length > 1)
  );
}
```

**Recommendation**: Keep one copy, update references

## Fixing Broken References

### Broken Transition References

```typescript
// Find and fix broken state references
const brokenStateRefs = transitions.filter(t => {
  if (t.type === 'OutgoingTransition' && t.toState) {
    return !states.some(s => s.id === t.toState);
  }
  return false;
});

// Auto-fix: Remove or prompt user
brokenStateRefs.forEach(transition => {
  // Option 1: Delete transition
  deleteTransition(transition.id);

  // Option 2: Prompt user to select correct state
  const correctState = promptUserForState();
  updateTransition(transition.id, { toState: correctState.id });
});
```

### Broken Workflow References

```typescript
// Find transitions with deleted workflows
const brokenWorkflowRefs = transitions.filter(t =>
  t.workflows.some(wId => !workflows.some(w => w.id === wId))
);

// Auto-fix: Remove broken workflow references
brokenWorkflowRefs.forEach(transition => {
  const validWorkflows = transition.workflows.filter(wId =>
    workflows.some(w => w.id === wId)
  );

  updateTransition(transition.id, { workflows: validWorkflows });
});
```

### Broken Image References

```typescript
// Find StateImages with deleted images
states.forEach(state => {
  state.stateImages.forEach(stateImage => {
    stateImage.patterns.forEach(pattern => {
      if (pattern.imageId) {
        const imageExists = images.some(img => img.id === pattern.imageId);
        if (!imageExists) {
          console.warn(
            `State "${state.name}" references deleted image "${pattern.imageId}"`
          );
        }
      }
    });
  });
});
```

**Recommendation**: Run validation before deleting resources

## Performance Optimization

### Optimize Large Images

```typescript
// Find images over 1MB
const largeImages = images.filter(img => img.size > 1024 * 1024);

console.log(`Found ${largeImages.length} images over 1MB:`);
largeImages.forEach(img => {
  const sizeMB = (img.size / (1024 * 1024)).toFixed(2);
  console.log(`- ${img.name}: ${sizeMB}MB`);
});

// Recommendations:
// 1. Compress images
// 2. Crop to minimum required size
// 3. Use WebP format
// 4. Remove from library if not needed
```

### Simplify Complex States

```typescript
// Find states with many components
const complexStates = states.filter(state => {
  const componentCount =
    state.stateImages.length +
    state.regions.length +
    state.locations.length +
    state.strings.length;
  return componentCount > 20;
});

// Recommendations:
// 1. Split into multiple states
// 2. Remove unnecessary components
// 3. Use shared components
```

### Optimize Search Regions

```typescript
// Find states with many search regions
states.forEach(state => {
  const totalSearchRegions =
    state.regions.filter(r => r.isSearchRegion).length +
    state.stateImages.reduce(
      (sum, si) => sum + (si.searchRegions?.length || 0),
      0
    );

  if (totalSearchRegions > 10) {
    console.warn(
      `State "${state.name}" has ${totalSearchRegions} search regions (recommend < 10)`
    );
  }
});

// Recommendations:
// 1. Consolidate overlapping search regions
// 2. Remove redundant search regions
// 3. Use larger, fewer search regions
```

## Improving Health Score

### Health Score Breakdown

```typescript
// Calculate health score components
function calculateHealthScore(project: Project): HealthScore {
  return {
    total: 0-100,
    breakdown: {
      resourceUsage: calculateResourceUsageScore(),    // 30%
      validation: calculateValidationScore(),          // 30%
      organization: calculateOrganizationScore(),      // 20%
      performance: calculatePerformanceScore()         // 20%
    }
  };
}
```

### Improving Resource Usage Score (30%)

```typescript
// Target: < 10% unused resources
function calculateResourceUsageScore(): number {
  const unusedCount =
    unusedImages.length +
    unusedStates.length +
    unusedWorkflows.length;

  const totalCount =
    images.length +
    states.length +
    workflows.length;

  const unusedPercentage = (unusedCount / totalCount) * 100;

  if (unusedPercentage < 5) return 100;
  if (unusedPercentage < 10) return 80;
  if (unusedPercentage < 20) return 60;
  return 40;
}

// Actions to improve:
// 1. Delete unused resources
// 2. Use existing resources instead of creating new ones
// 3. Regular cleanup (monthly)
```

### Improving Validation Score (30%)

```typescript
// Target: 0 validation errors
function calculateValidationScore(): number {
  const errors =
    brokenReferences.length +
    circularDependencies.length +
    unreachableStates.length;

  if (errors === 0) return 100;
  if (errors < 5) return 80;
  if (errors < 10) return 60;
  return 40;
}

// Actions to improve:
// 1. Fix all broken references
// 2. Resolve circular dependencies
// 3. Make all states reachable
// 4. Run validation before committing changes
```

### Improving Organization Score (20%)

```typescript
// Target: Good naming and documentation
function calculateOrganizationScore(): number {
  const wellNamed = resources.filter(r =>
    r.name.includes('-') && r.name.length >= 5
  ).length;

  const withDescriptions = resources.filter(r =>
    r.description && r.description.length > 10
  ).length;

  const namingScore = (wellNamed / resources.length) * 50;
  const docScore = (withDescriptions / resources.length) * 50;

  return namingScore + docScore;
}

// Actions to improve:
// 1. Follow naming conventions
// 2. Add descriptions to all resources
// 3. Use consistent prefixing
// 4. Document organization strategy
```

### Improving Performance Score (20%)

```typescript
// Target: Optimized resource sizes and complexity
function calculatePerformanceScore(): number {
  const largeImages = images.filter(img => img.size > 1024 * 1024);
  const complexStates = states.filter(s => getComponentCount(s) > 20);

  const imageSizeScore = (1 - largeImages.length / images.length) * 50;
  const stateComplexityScore = (1 - complexStates.length / states.length) * 50;

  return imageSizeScore + stateComplexityScore;
}

// Actions to improve:
// 1. Optimize large images (compress, crop)
// 2. Simplify complex states
// 3. Use appropriate search regions
// 4. Remove unnecessary components
```

## Optimization Workflow

### Weekly Quick Optimization (15 minutes)

1. **Check Dashboard**
   - Review health score
   - Note any critical issues

2. **Quick Fixes**
   - Fix broken references
   - Delete obvious unused resources

3. **Update Documentation**
   - Add descriptions to new resources

### Monthly Deep Optimization (1-2 hours)

1. **Resource Cleanup**
   ```typescript
   // Delete unused resources
   const unused = findAllUnusedResources();
   reviewAndDelete(unused);
   ```

2. **Duplicate Detection**
   ```typescript
   // Find and consolidate duplicates
   const duplicates = findAllDuplicates();
   consolidateDuplicates(duplicates);
   ```

3. **Performance Review**
   ```typescript
   // Optimize large/complex resources
   const largeImages = findLargeImages();
   const complexStates = findComplexStates();
   optimizeResources([...largeImages, ...complexStates]);
   ```

4. **Validation**
   ```typescript
   // Fix all validation errors
   const errors = runFullValidation();
   fixAllErrors(errors);
   ```

5. **Health Check**
   ```typescript
   // Review health score improvement
   const newScore = calculateHealthScore();
   console.log(`Health improved to ${newScore}`);
   ```

### Quarterly Full Audit (2-4 hours)

1. **Complete Resource Review**
   - Review all resources
   - Apply consistent naming
   - Add missing descriptions

2. **Organization Restructure**
   - Optimize folder/group structure
   - Update naming conventions
   - Consolidate related resources

3. **Performance Optimization**
   - Optimize all large images
   - Simplify all complex states
   - Streamline workflows

4. **Documentation Update**
   - Update project documentation
   - Document organization strategy
   - Create resource guide

## Optimization Tools

### Automated Optimization

```typescript
// Run automated optimization
function autoOptimize(project: Project): OptimizationReport {
  const report: OptimizationReport = {
    deleted: { images: 0, states: 0, workflows: 0 },
    optimized: { images: 0, states: 0 },
    fixed: { brokenReferences: 0, circularDeps: 0 },
    renamed: 0
  };

  // Delete unused resources older than 30 days
  const oldUnused = findOldUnusedResources(30);
  oldUnused.forEach(resource => {
    deleteResource(resource);
    report.deleted[resource.type]++;
  });

  // Fix broken references
  const broken = findBrokenReferences();
  broken.forEach(ref => {
    autoFixReference(ref);
    report.fixed.brokenReferences++;
  });

  // Optimize large images
  const large = findLargeImages();
  large.forEach(img => {
    optimizeImage(img);
    report.optimized.images++;
  });

  return report;
}
```

### Optimization Report

```typescript
interface OptimizationReport {
  healthBefore: number;
  healthAfter: number;
  actions: {
    deleted: number;
    optimized: number;
    fixed: number;
    renamed: number;
  };
  timeSaved: number;  // estimated ms saved per execution
  sizeSaved: number;  // bytes saved
  recommendations: string[];
}
```

## Related Documentation

- **[Project Management](./README.md)** - Project overview
- **[Global Search](./global-search.md)** - Finding resources
- **[Best Practices](../best-practices/large-projects.md)** - Large project strategies

---

**Key Takeaways:**
- Regular optimization prevents project bloat
- Delete unused resources monthly
- Fix validation errors immediately
- Optimize large images and complex states
- Aim for health score > 80
- Automate where possible
