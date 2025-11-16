# Resource Services API Reference

Comprehensive API reference for managing images, states, transitions, and project resources.

## Table of Contents

- [Overview](#overview)
- [Image Service](#image-service)
- [State Service](#state-service)
- [Transition Service](#transition-service)
- [Project Service](#project-service)
- [Validation Service](#validation-service)
- [Search Service](#search-service)
- [Type Definitions](#type-definitions)

## Overview

This document provides API reference for resource management services. While some services are conceptual (for future implementation), the patterns and interfaces are based on the existing codebase.

## Image Service

### Methods

#### `addImage(image: ImageAsset): Promise<ImageAsset>`

Add an image to the library.

```typescript
const image = await addImage({
  id: generateId(),
  name: 'login-button-normal',
  url: imageDataUrl,
  size: 45000,
  createdAt: new Date(),
  usageCount: 0,
  source: 'uploaded',
  s3_key: 's3-key',
  url_expires_at: new Date()
});
```

#### `deleteImage(imageId: string): Promise<void>`

Delete an image from the library.

```typescript
// Check usage first
const usage = getImageUsage(imageId);
if (usage.length > 0) {
  console.warn('Image is used in:', usage);
}

await deleteImage(imageId);
```

#### `updateImage(imageId: string, updates: Partial<ImageAsset>): Promise<ImageAsset>`

Update image properties.

```typescript
const updated = await updateImage('img-123', {
  name: 'auth-button-login-normal'
});
```

#### `getImageUsage(imageId: string): ImageUsage[]`

Get list of where image is used.

```typescript
const usage = getImageUsage('img-123');
// Returns: [{ type: 'state', id: 'state-1', name: 'Login' }, ...]
```

#### `findImages(query: ImageQuery): ImageAsset[]`

Find images matching query.

```typescript
// Find unused images
const unused = findImages({
  usageCount: 0
});

// Find large images
const large = findImages({
  minSize: 1024 * 1024  // 1MB
});

// Find by source
const uploaded = findImages({
  source: 'uploaded'
});

// Find by name
const loginImages = findImages({
  nameContains: 'login'
});
```

#### `createImageAsset(imageData: string, name: string, source: ImageSource): ImageAsset`

Utility to create an ImageAsset object.

```typescript
import { createImageAsset } from '@/lib/image-library-utils';

const asset = createImageAsset(
  imageDataUrl,
  'button-submit',
  'pattern_optimization'
);
```

### Types

```typescript
interface ImageAsset {
  id: string;
  name: string;
  url: string;
  mask?: string;
  size: number;
  createdAt: Date;
  usageCount: number;
  usage?: ImageUsage[];
  source: 'uploaded' | 'pattern_optimization' | 'image_extraction' | 'state_discovery';
  s3_key: string;
  url_expires_at: Date;
  version?: number;
  parentImageId?: string;
  versions?: string[];
}

interface ImageUsage {
  type: "state" | "process";
  id: string;
  name: string;
}

interface ImageQuery {
  nameContains?: string;
  source?: ImageSource;
  usageCount?: number;
  minSize?: number;
  maxSize?: number;
  createdAfter?: Date;
  createdBefore?: Date;
}
```

## State Service

### Methods

#### `addState(state: State): Promise<State>`

Create a new state.

```typescript
const state = await addState({
  id: generateId(),
  name: 'auth-login',
  description: 'Login screen with email and password',
  initial: false,
  stateImages: [],
  regions: [],
  locations: [],
  strings: [],
  position: { x: 100, y: 100 }
});
```

#### `updateState(state: State): Promise<State>`

Update an existing state.

```typescript
const updated = await updateState({
  ...existingState,
  name: 'auth-login-redesign',
  description: 'Updated login screen'
});
```

#### `updateStateWithIdChange(oldId: string, newState: State): Promise<State>`

Update state with ID change (updates all references).

```typescript
const updated = await updateStateWithIdChange('old-id', {
  ...state,
  id: 'new-id'
});
// Automatically updates all transitions referencing this state
```

#### `deleteState(stateId: string): Promise<void>`

Delete a state and its transitions.

```typescript
await deleteState('state-123');
// Also removes all transitions to/from this state
```

#### `findStates(query: StateQuery): State[]`

Find states matching query.

```typescript
// Find by name
const authStates = findStates({
  nameContains: 'auth'
});

// Find initial states
const initial = findStates({
  initial: true
});

// Find empty states
const empty = findStates({
  isEmpty: true
});

// Find states with images
const withImages = findStates({
  hasImages: true
});
```

#### `getStateUsage(stateId: string): StateUsage`

Get where state is used.

```typescript
const usage = getStateUsage('state-123');
// Returns: { transitions: [...], workflows: [...] }
```

### Types

```typescript
interface State {
  id: string;
  name: string;
  description: string;
  initial?: boolean;
  stateImages: StateImage[];
  regions: StateRegion[];
  locations: StateLocation[];
  strings: StateString[];
  position: { x: number; y: number };
  projectName?: string;
}

interface StateImage {
  id: string;
  name: string;
  patterns: Pattern[];
  shared: boolean;
  searchRegions?: SearchRegion[];
  probability?: number;
  source?: 'upload' | 'pattern-optimization';
}

interface StateRegion {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isSearchRegion?: boolean;
  referenceImageId?: string;
  position?: Position;
  offsetX?: number;
  offsetY?: number;
}

interface StateLocation {
  id: string;
  name: string;
  x: number;
  y: number;
  fixed: boolean;
  anchor: boolean;
  referenceImageId?: string;
  position?: Position;
  offsetX?: number;
  offsetY?: number;
}

interface StateString {
  id: string;
  name: string;
  value: string;
  identifier?: boolean;
  inputText?: boolean;
  expectedText?: boolean;
  regexPattern?: boolean;
}
```

## Transition Service

### Methods

#### `addTransition(transition: Transition): Promise<Transition>`

Create a new transition.

```typescript
const transition = await addTransition({
  id: generateId(),
  type: 'OutgoingTransition',
  fromState: 'auth-login',
  toState: 'dashboard-home',
  activateStates: ['dashboard-home'],
  staysVisible: false,
  deactivateStates: ['auth-login'],
  workflows: ['workflow-submit-login'],
  timeout: 15000,
  retryCount: 3
});
```

#### `updateTransition(transition: Transition): Promise<Transition>`

Update an existing transition.

```typescript
const updated = await updateTransition({
  ...existingTransition,
  timeout: 30000,
  retryCount: 5
});
```

#### `deleteTransition(transitionId: string): Promise<void>`

Delete a transition.

```typescript
await deleteTransition('trans-123');
```

#### `validateTransition(transition: Transition): ValidationError[]`

Validate a single transition.

```typescript
const errors = validateTransition(transition);
if (errors.length > 0) {
  console.error('Validation errors:', errors);
}
```

#### `validateAllTransitions(): ValidationReport`

Validate all transitions in project.

```typescript
const report = validateAllTransitions();
if (!report.valid) {
  console.error('Found issues:', report.errors);
}
```

#### `findCircularDependencies(): string[][]`

Detect circular state dependencies.

```typescript
const cycles = findCircularDependencies();
cycles.forEach(cycle => {
  console.warn('Circular dependency:', cycle.join(' → '));
});
```

#### `findUnreachableStates(): State[]`

Find states not reachable from initial state.

```typescript
const unreachable = findUnreachableStates();
unreachable.forEach(state => {
  console.warn('Unreachable state:', state.name);
});
```

### Types

```typescript
interface OutgoingTransition {
  id: string;
  type: "OutgoingTransition";
  fromState: string;
  toState?: string;
  activateStates: string[];
  staysVisible: boolean;
  deactivateStates: string[];
  workflows: string[];
  timeout: number;
  retryCount: number;
  position?: { x: number; y: number };
}

interface IncomingTransition {
  id: string;
  type: "IncomingTransition";
  toState: string;
  workflows: string[];
  timeout: number;
  retryCount: number;
  position?: { x: number; y: number };
}

type Transition = OutgoingTransition | IncomingTransition;

interface ValidationError {
  type: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  message: string;
  transitionId?: string;
  field?: string;
  value?: any;
}

interface ValidationReport {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  stats: {
    totalTransitions: number;
    validTransitions: number;
    brokenReferences: number;
    circularDependencies: number;
    unreachableStates: number;
  };
}
```

## Project Service

### Methods

#### `getProjectOverview(): ProjectOverview`

Get project overview and health metrics.

```typescript
const overview = getProjectOverview();
console.log('Health score:', overview.healthScore);
console.log('Resources:', overview.resourceCounts);
```

#### `calculateHealthScore(): HealthMetrics`

Calculate detailed health metrics.

```typescript
const health = calculateHealthScore();
console.log('Score:', health.score);
console.log('Breakdown:', health.breakdown);
health.recommendations.forEach(rec => {
  console.log(`${rec.severity}: ${rec.message}`);
});
```

#### `exportProject(): ProjectExport`

Export entire project.

```typescript
const exportData = exportProject();
downloadJSON(exportData, 'project-backup.json');
```

#### `importProject(data: ProjectExport, options: ImportOptions): ImportResult`

Import project data.

```typescript
const result = importProject(importData, {
  mode: 'merge',
  handleConflicts: 'rename'
});

console.log('Imported:', result.imported);
console.log('Skipped:', result.skipped);
```

### Types

```typescript
interface ProjectOverview {
  name: string;
  resourceCounts: {
    images: number;
    states: number;
    transitions: number;
    workflows: number;
  };
  healthScore: number;
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

interface HealthMetrics {
  score: number;
  breakdown: {
    resourceUsage: { score: number; unusedImages: number; unusedStates: number; unusedWorkflows: number; };
    validation: { score: number; brokenReferences: number; circularDependencies: number; unreachableStates: number; };
    organization: { score: number; poorlyNamed: number; missingDescriptions: number; };
    performance: { score: number; largeImages: number; complexStates: number; };
  };
  recommendations: Recommendation[];
}

interface Recommendation {
  type: 'DELETE' | 'OPTIMIZE' | 'RENAME' | 'FIX';
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  resource: string;
  message: string;
  action: string;
}

interface ProjectExport {
  version: string;
  exported: Date;
  project: { name: string; description: string; };
  resources: {
    images: ImageAsset[];
    states: State[];
    transitions: Transition[];
    workflows: Workflow[];
  };
  metadata: { totalResources: number; healthScore: number; };
}
```

## Validation Service

### Methods

#### `validateAll(): ValidationReport`

Validate entire project.

```typescript
const report = validateAll();

if (!report.valid) {
  report.errors.forEach(error => {
    console.error(`${error.type}: ${error.message}`);
  });
}
```

#### `findBrokenReferences(): BrokenReference[]`

Find broken state/workflow references.

```typescript
const broken = findBrokenReferences();
broken.forEach(ref => {
  console.error(`Broken ${ref.type} in ${ref.transitionId}: ${ref.value}`);
});
```

#### `autoFixBrokenReferences(): FixReport`

Automatically fix broken references where possible.

```typescript
const fixes = autoFixBrokenReferences();
console.log('Fixed:', fixes.fixed);
console.log('Requires manual review:', fixes.requiresManualReview);
```

### Types

```typescript
interface BrokenReference {
  type: 'BROKEN_STATE_REFERENCE' | 'BROKEN_WORKFLOW_REFERENCE';
  transitionId: string;
  field: string;
  value: string;
  message: string;
}

interface FixReport {
  fixes: Fix[];
  requiresManualReview: boolean;
}

interface Fix {
  type: 'REMOVED_WORKFLOW' | 'UPDATED_STATE' | 'DELETED_TRANSITION';
  resource: string;
  action: string;
}
```

## Search Service

### Methods

#### `searchResources(query: string, options?: SearchOptions): SearchResult[]`

Search across all resources.

```typescript
// Simple search
const results = searchResources('login');

// Advanced search
const results = searchResources('login', {
  type: 'state',
  fuzzy: true,
  limit: 10
});

results.forEach(result => {
  console.log(`${result.type}: ${result.name}`);
});
```

#### `parseSearchQuery(query: string): ParsedQuery`

Parse search query with operators.

```typescript
const parsed = parseSearchQuery('type:image unused size:large');
// Returns: { type: 'image', filters: { unused: true, size: 'large' } }
```

### Types

```typescript
interface SearchOptions {
  type?: 'image' | 'state' | 'transition' | 'workflow';
  fuzzy?: boolean;
  limit?: number;
  offset?: number;
}

interface SearchResult {
  id: string;
  type: 'image' | 'state' | 'transition' | 'workflow';
  name: string;
  description?: string;
  metadata: any;
  score: number;
}

interface ParsedQuery {
  query: string;
  type?: string;
  filters: Record<string, any>;
}
```

## Type Definitions

### Common Types

```typescript
type Position = {
  percentW: number;
  percentH: number;
  positionName?: PositionName;
};

type PositionName =
  | "TOPLEFT" | "TOPMIDDLE" | "TOPRIGHT"
  | "MIDDLELEFT" | "MIDDLEMIDDLE" | "MIDDLERIGHT"
  | "BOTTOMLEFT" | "BOTTOMMIDDLE" | "BOTTOMRIGHT";

interface SearchRegion {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Pattern {
  id: string;
  name?: string;
  imageId?: string;
  searchRegions: SearchRegion[];
  fixed: boolean;
  similarity?: number;
  targetPosition?: Position;
  offsetX?: number;
  offsetY?: number;
}
```

## Usage Examples

### Example 1: Create Complete State

```typescript
// 1. Upload images
const buttonImage = await addImage({
  id: generateId(),
  name: 'login-button-submit',
  url: imageDataUrl,
  size: 45000,
  createdAt: new Date(),
  usageCount: 0,
  source: 'uploaded',
  s3_key: 's3-key',
  url_expires_at: new Date()
});

// 2. Create state
const state = await addState({
  id: generateId(),
  name: 'auth-login',
  description: 'Login screen',
  initial: true,
  stateImages: [
    {
      id: generateId(),
      name: 'Submit Button',
      patterns: [
        {
          id: generateId(),
          imageId: buttonImage.id,
          searchRegions: [],
          fixed: false,
          similarity: 0.95
        }
      ],
      shared: false
    }
  ],
  regions: [
    {
      id: generateId(),
      name: 'Form Area',
      x: 100,
      y: 100,
      width: 400,
      height: 300,
      isSearchRegion: true
    }
  ],
  locations: [],
  strings: [
    {
      id: generateId(),
      name: 'Username',
      value: '',
      inputText: true
    }
  ],
  position: { x: 100, y: 100 }
});

// 3. Create transition
const transition = await addTransition({
  id: generateId(),
  type: 'OutgoingTransition',
  fromState: state.id,
  toState: 'dashboard-home',
  activateStates: ['dashboard-home'],
  staysVisible: false,
  deactivateStates: [state.id],
  workflows: ['workflow-submit-login'],
  timeout: 15000,
  retryCount: 3
});
```

### Example 2: Project Health Check

```typescript
// Get health metrics
const health = calculateHealthScore();

// Check if project needs attention
if (health.score < 70) {
  console.warn('Project health low:', health.score);

  // Review recommendations
  health.recommendations.forEach(rec => {
    if (rec.severity === 'CRITICAL') {
      console.error(`CRITICAL: ${rec.message}`);
      console.log(`Action: ${rec.action}`);
    }
  });

  // Find and fix issues
  const unused = findImages({ usageCount: 0 });
  const broken = findBrokenReferences();

  console.log(`Found ${unused.length} unused images`);
  console.log(`Found ${broken.length} broken references`);

  // Auto-fix where possible
  const fixes = autoFixBrokenReferences();
  console.log(`Fixed ${fixes.fixes.length} issues automatically`);
}
```

### Example 3: Cleanup Workflow

```typescript
async function cleanupProject() {
  // 1. Find unused resources
  const unusedImages = findImages({
    usageCount: 0,
    createdBefore: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 days ago
  });

  const unreachable = findUnreachableStates();

  console.log(`Found ${unusedImages.length} old unused images`);
  console.log(`Found ${unreachable.length} unreachable states`);

  // 2. Delete unused images
  for (const image of unusedImages) {
    await deleteImage(image.id);
  }

  // 3. Review unreachable states
  for (const state of unreachable) {
    console.log(`Review state: ${state.name}`);
    // Decide whether to delete or add transition
  }

  // 4. Validate
  const validation = validateAll();
  if (validation.valid) {
    console.log('Project validation passed!');
  } else {
    console.error('Validation errors:', validation.errors);
  }

  // 5. Check new health score
  const health = calculateHealthScore();
  console.log(`New health score: ${health.score}`);
}
```

---

**Related Documentation:**
- [Image Library](../image-library/README.md)
- [State Builder](../state-builder/README.md)
- [Transitions](../transitions/README.md)
- [Project Management](../project-management/README.md)
