# Project Management

Comprehensive guide for managing large automation projects with overview, health monitoring, and optimization tools.

## Table of Contents

- [Overview](#overview)
- [Project Dashboard](#project-dashboard)
- [Resource Management](#resource-management)
- [Health Monitoring](#health-monitoring)
- [Optimization Tools](#optimization-tools)
- [Backup and Export](#backup-and-export)
- [Best Practices](#best-practices)

## Overview

Project management features help you maintain healthy, optimized automation projects as they scale from dozens to hundreds of resources.

### Key Capabilities

- **Project Dashboard**: Overview of all project resources
- **Health Monitoring**: Track project health scores
- **Resource Tracking**: Monitor images, states, transitions, workflows
- **Optimization**: Find and fix issues
- **Export/Import**: Backup and share projects
- **Search**: Globally search across all resources

## Project Dashboard

### Dashboard Overview

The project dashboard provides at-a-glance project health:

```typescript
interface ProjectOverview {
  name: string;
  resourceCounts: {
    images: number;
    states: number;
    transitions: number;
    workflows: number;
  };
  healthScore: number;        // 0-100
  issues: {
    critical: number;
    warnings: number;
    info: number;
  };
  lastModified: Date;
  size: {
    totalBytes: number;
    imageBytes: number;
  };
}
```

### Health Score

Project health score (0-100) based on:

- **Resource Usage** (30%): Unused vs. used resources
- **Validation** (30%): Broken references, circular deps
- **Organization** (20%): Naming conventions, structure
- **Performance** (20%): Image sizes, state complexity

```typescript
// Excellent health
score: 90-100  // Green

// Good health
score: 70-89   // Yellow

// Needs attention
score: 50-69   // Orange

// Critical
score: 0-49    // Red
```

### Resource Counts

Track resource counts over time:

```typescript
{
  images: 127,
  states: 45,
  transitions: 156,
  workflows: 89,
  totalResources: 417
}
```

**Healthy Ratios:**
- States: 20-100
- Transitions: 2-4x state count
- Images: 1-5x state count
- Workflows: 1-3x state count

## Resource Management

### Resource Overview

Track all resources in one place:

```
┌─ Images (127)
│  ├─ Uploaded: 45
│  ├─ Pattern Optimization: 52
│  ├─ Image Extraction: 20
│  └─ State Discovery: 10
│
├─ States (45)
│  ├─ Authentication: 8
│  ├─ Dashboard: 12
│  ├─ Checkout: 15
│  └─ Other: 10
│
├─ Transitions (156)
│  ├─ Outgoing: 142
│  └─ Incoming: 14
│
└─ Workflows (89)
   ├─ Navigation: 25
   ├─ Forms: 30
   └─ Other: 34
```

### Resource Tracking

Monitor resource usage:

```typescript
interface ResourceUsage {
  id: string;
  name: string;
  type: 'image' | 'state' | 'transition' | 'workflow';
  usageCount: number;
  lastUsed?: Date;
  createdAt: Date;
  size?: number;
}
```

### Finding Resources

Quick resource location:

```typescript
// Find resource by ID
findResourceById(id: string): Resource | null

// Find resources by type
findResourcesByType(type: ResourceType): Resource[]

// Find resources by name
findResourcesByName(query: string): Resource[]

// Find unused resources
findUnusedResources(): Resource[]
```

## Health Monitoring

### Health Metrics

Track key health indicators:

```typescript
interface HealthMetrics {
  score: number;  // 0-100
  breakdown: {
    resourceUsage: {
      score: number;
      unusedImages: number;
      unusedStates: number;
      unusedWorkflows: number;
    };
    validation: {
      score: number;
      brokenReferences: number;
      circularDependencies: number;
      unreachableStates: number;
    };
    organization: {
      score: number;
      poorlyNamed: number;
      missingDescriptions: number;
    };
    performance: {
      score: number;
      largeImages: number;
      complexStates: number;
    };
  };
  recommendations: Recommendation[];
}
```

### Health Recommendations

Get actionable recommendations:

```typescript
interface Recommendation {
  type: 'DELETE' | 'OPTIMIZE' | 'RENAME' | 'FIX';
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  resource: string;
  message: string;
  action: string;
}

// Example recommendations
{
  type: 'DELETE',
  severity: 'WARNING',
  resource: '15 unused images',
  message: '15 images are not used anywhere',
  action: 'Review and delete unused images'
}
```

### Monitoring Trends

Track health over time:

```typescript
interface HealthTrend {
  date: Date;
  score: number;
  resourceCount: number;
  issueCount: number;
}

// Example trend
[
  { date: '2024-01-01', score: 85, resourceCount: 200, issueCount: 5 },
  { date: '2024-01-08', score: 82, resourceCount: 250, issueCount: 12 },
  { date: '2024-01-15', score: 88, resourceCount: 240, issueCount: 8 }
]
```

## Optimization Tools

See [Optimization Guide](./optimization.md) for detailed information.

### Quick Optimization Actions

**Find Unused Resources:**
```typescript
// Unused images
const unusedImages = images.filter(img => img.usageCount === 0);

// Unused states
const unusedStates = findUnreachableStates(states, transitions);

// Unused workflows
const unusedWorkflows = workflows.filter(w =>
  !transitions.some(t => t.workflows.includes(w.id))
);
```

**Find Duplicates:**
```typescript
// Duplicate image names
const duplicateNames = findDuplicateResourceNames(images);

// Similar states
const similarStates = findSimilarStates(states);
```

**Fix Broken References:**
```typescript
// Broken transitions
const brokenTransitions = validateTransitions(transitions, states, workflows);

// Fix automatically where possible
autoFixBrokenReferences(brokenTransitions);
```

## Backup and Export

### Project Export

Export entire project:

```typescript
interface ProjectExport {
  version: string;
  exported: Date;
  project: {
    name: string;
    description: string;
  };
  resources: {
    images: ImageAsset[];
    states: State[];
    transitions: Transition[];
    workflows: Workflow[];
  };
  metadata: {
    totalResources: number;
    healthScore: number;
  };
}

// Export to JSON
const exportData = exportProject(projectId);
downloadJSON(exportData, 'project-backup.json');
```

### Partial Export

Export specific resources:

```typescript
// Export authentication feature
const authExport = {
  states: states.filter(s => s.name.startsWith('auth-')),
  transitions: transitions.filter(t =>
    t.fromState?.startsWith('auth-') || t.toState?.startsWith('auth-')
  ),
  workflows: /* related workflows */,
  images: /* related images */
};
```

### Project Import

Import from backup:

```typescript
// Import project
const importData = loadJSON('project-backup.json');
const result = importProject(importData, {
  mode: 'merge',  // or 'replace'
  handleConflicts: 'rename'  // or 'skip', 'overwrite'
});

// Review import results
console.log(`Imported:
  - ${result.imported.images} images
  - ${result.imported.states} states
  - ${result.imported.transitions} transitions
  - ${result.imported.workflows} workflows

  Skipped: ${result.skipped.total}
  Errors: ${result.errors.length}
`);
```

### Backup Strategy

**Automated Backups:**
- Daily: Auto-export project
- Weekly: Full backup with history
- Before major changes: Manual backup

**Backup Storage:**
- Local: Download JSON files
- Cloud: S3/cloud storage
- Version control: Git integration

## Best Practices

### Project Organization

1. **Use Consistent Naming**
   - Prefix resources by feature
   - Follow naming conventions
   - Document naming strategy

2. **Regular Maintenance**
   - Weekly: Quick health check
   - Monthly: Deep cleanup
   - Quarterly: Full optimization

3. **Monitor Health**
   - Check dashboard weekly
   - Address critical issues immediately
   - Track trends over time

### Resource Management

1. **Avoid Resource Bloat**
   - Delete unused resources monthly
   - Optimize large images
   - Consolidate duplicates

2. **Document Resources**
   - Add descriptions to states
   - Comment complex workflows
   - Document naming conventions

3. **Track Dependencies**
   - Understand resource relationships
   - Avoid circular dependencies
   - Keep state machine simple

### Performance

1. **Optimize Images**
   - Keep images under 1MB
   - Use appropriate formats
   - Crop to minimum size

2. **Simplify States**
   - Avoid overly complex states
   - Use reasonable StateImage counts
   - Optimize search regions

3. **Streamline Workflows**
   - Keep workflows focused
   - Reuse common patterns
   - Avoid unnecessary actions

## Global Search

See [Global Search Guide](./global-search.md) for detailed information.

### Quick Search (Cmd+K)

Search across all resources:

```
// Search by name
"login" → Finds all login-related resources

// Search by type
"image:logo" → Finds all images with "logo" in name

// Search by usage
"unused" → Finds all unused resources
```

## Troubleshooting

### Low Health Score

**Problem**: Health score below 70
**Solutions:**
- Review recommendations
- Delete unused resources
- Fix broken references
- Improve naming conventions

### Too Many Resources

**Problem**: Project becoming unwieldy
**Solutions:**
- Split into multiple projects
- Archive old resources
- Consolidate duplicates
- Delete unused resources

### Slow Performance

**Problem**: Project actions slow
**Solutions:**
- Optimize large images
- Reduce resource counts
- Clean up unused resources
- Simplify complex states

## Related Documentation

- **[Optimization Guide](./optimization.md)** - Detailed optimization
- **[Global Search](./global-search.md)** - Search features
- **[Best Practices](../best-practices/large-projects.md)** - Large project strategies
- **[Image Library](../image-library/README.md)** - Image management
- **[State Builder](../state-builder/README.md)** - State management

---

**Key Takeaways:**
- Monitor project health regularly
- Address issues proactively
- Keep resources organized and documented
- Export backups regularly
- Use optimization tools to maintain performance
