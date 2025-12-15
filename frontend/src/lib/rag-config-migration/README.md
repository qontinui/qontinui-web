# RAG Configuration Migration System

This directory contains the migration infrastructure for Qontinui RAG (Retrieval-Augmented Generation) configurations.

## Overview

The RAG migration system provides automatic backward compatibility for RAG configuration formats. When users import older RAG configs, the system detects the version and applies migrations to transform them to the current format.

## Current Version

**1.0.0** - Initial RAG configuration format

## Architecture

The system follows the same architecture as the workflow config migration system:

```
rag-config-migration/
├── types.ts                    # TypeScript interfaces for RAG configs
├── migration-engine.ts         # Core migration orchestration
├── validators.ts               # Validation functions
├── migrations/
│   └── index.ts               # Migration registry
└── index.ts                   # Public API
```

## Key Features

### 1. Version Detection

Automatically detects the RAG config version and determines if migration is needed.

### 2. Migration Path Finding

Uses BFS to find the shortest migration path from the current version to the target version.

### 3. Re-embedding Detection

Tracks whether migrations require re-embedding of all elements. When embedding model structure or metadata changes, users are notified that they need to re-run the embedding pipeline.

### 4. Validation

Comprehensive validation ensures:

- Correct structure and types
- Valid state references in elements
- Valid workflow references in transitions
- Valid element references in states

### 5. Caching

Migration results are cached for performance when importing the same config multiple times.

## Usage

### Basic Migration

```typescript
import {
  migrateRAGConfigToLatest,
  needsRAGMigration,
} from "@/lib/rag-config-migration";

// Check if migration is needed
if (needsRAGMigration(config.version)) {
  const result = await migrateRAGConfigToLatest(config);

  if (result.success) {
    config = result.config;

    // Check if re-embedding is required
    if (result.requiresReembedding) {
      alert(
        "This config requires re-embedding all elements. Please run the embedding pipeline."
      );
    }
  } else {
    console.error("Migration failed:", result.context.errors);
  }
}
```

### Preview Migration

```typescript
import { previewRAGMigration } from "@/lib/rag-config-migration";

const preview = await previewRAGMigration(config);

console.log("Migration steps:", preview.migrationSteps);
console.log("Estimated changes:", preview.estimatedChanges);
console.log("Requires re-embedding:", preview.requiresReembedding);
```

### Validation

```typescript
import {
  validateRAGConfigComprehensive,
  validateStateReferences,
  validateWorkflowReferences,
} from "@/lib/rag-config-migration";

// Comprehensive validation
const result = validateRAGConfigComprehensive(config);
if (!result.success) {
  console.error("Validation errors:", result.errors);
}

// Specific validations
const stateRefResult = validateStateReferences(config);
const workflowRefResult = validateWorkflowReferences(config);
```

## RAG Config Structure

```typescript
interface RAGConfig {
  version: string; // Semantic version (e.g., "1.0.0")
  configType: "rag"; // Always "rag"
  metadata: RAGMetadata; // Project metadata
  embeddingConfig: EmbeddingConfig; // Embedding model configuration
  elements: RAGElement[]; // UI elements with embeddings
  states: RAGState[]; // Application states
  workflows: RAGWorkflow[]; // Automation workflows
  transitions: RAGTransition[]; // State transitions
  screenshots: Record<string, ScreenshotInfo>; // Screenshot metadata
  vectorDb?: VectorDBInfo; // Vector database info
}
```

## Adding a New Migration

When the RAG config format changes, follow these steps:

### 1. Create Migration File

Create `migrations/v1.0.0-to-v1.1.0.ts`:

```typescript
import type { RAGMigration, RAGConfig, RAGMigrationContext } from "../types";

export const migrationV10ToV11: RAGMigration = {
  fromVersion: "1.0.0",
  toVersion: "1.1.0",
  description: "Add semantic tags to elements",

  // Set to true if this migration requires re-embedding
  requiresReembedding: false,

  migrate(config: RAGConfig, context: RAGMigrationContext): RAGConfig {
    const migrated = structuredClone(config);

    // Add semanticTags field to all elements
    migrated.elements = migrated.elements.map((element) => ({
      ...element,
      semanticTags: [],
    }));

    migrated.version = "1.1.0";
    return migrated;
  },

  validate(config: RAGConfig): boolean {
    // Check that all elements have semanticTags
    return config.elements.every((el) =>
      Array.isArray((el as any).semanticTags)
    );
  },
};
```

### 2. Register Migration

Update `migrations/index.ts`:

```typescript
import { migrationV10ToV11 } from "./v1.0.0-to-v1.1.0";

export const CURRENT_RAG_VERSION = "1.1.0";

export const RAG_MIGRATIONS: RAGMigration[] = [migrationV10ToV11];
```

### 3. Update Types

Update `types.ts` to include new fields:

```typescript
export interface RAGElement {
  // ... existing fields
  semanticTags?: string[]; // Added in v1.1.0
}
```

## Re-embedding Flag

The `requiresReembedding` flag is critical for maintaining embedding consistency:

### When to Set `requiresReembedding: true`

- **Embedding model changes**: If the migration updates embedding model versions
- **Structural changes**: If element bounding boxes, OCR text, or other embedded data changes
- **Metadata changes**: If changes affect how elements are described or embedded

### When to Set `requiresReembedding: false`

- **UI-only changes**: Adding display fields that don't affect embeddings
- **Non-embedded metadata**: Changes to workflow names, state descriptions, etc.
- **Reference updates**: Changes to IDs or references that don't affect element content

### Example

```typescript
// Requires re-embedding (embedding model changed)
export const migrationV11ToV12: RAGMigration = {
  fromVersion: "1.1.0",
  toVersion: "1.2.0",
  description: "Upgrade to CLIP-v2 model",
  requiresReembedding: true, // ← User must re-embed
  migrate(config, context) {
    config.embeddingConfig.clipModel = "openai/clip-vit-large-patch14";
    config.embeddingConfig.clipEmbeddingDim = 768;
    return config;
  },
};

// Does NOT require re-embedding (UI metadata only)
export const migrationV12ToV13: RAGMigration = {
  fromVersion: "1.2.0",
  toVersion: "1.3.0",
  description: "Add display names for states",
  requiresReembedding: false, // ← No re-embedding needed
  migrate(config, context) {
    config.states = config.states.map((state) => ({
      ...state,
      displayName: state.name,
    }));
    return config;
  },
};
```

## Migration History

Each successful migration adds an entry to the config metadata:

```typescript
{
  "metadata": {
    "migrationHistory": [
      {
        "fromVersion": "1.0.0",
        "toVersion": "1.3.0",
        "date": "2024-12-10T18:00:00.000Z",
        "path": ["1.0.0→1.1.0", "1.1.0→1.2.0", "1.2.0→1.3.0"],
        "requiresReembedding": true
      }
    ]
  }
}
```

## Best Practices

### 1. Always Use structuredClone()

```typescript
migrate(config: RAGConfig, context: RAGMigrationContext): RAGConfig {
  const migrated = structuredClone(config); // ← Prevent mutations
  // ... make changes to migrated
  return migrated;
}
```

### 2. Always Update Version

```typescript
migrated.version = "1.1.0"; // ← Always set new version
```

### 3. Add Validation

```typescript
validate(config: RAGConfig): boolean {
  // Verify migration succeeded
  return config.elements.every(el => el.newField !== undefined);
}
```

### 4. Handle Edge Cases

```typescript
migrate(config: RAGConfig, context: RAGMigrationContext): RAGConfig {
  const migrated = structuredClone(config);

  // Handle configs that might not have all fields
  migrated.elements = migrated.elements.map(element => ({
    ...element,
    newField: element.oldField ?? defaultValue,
  }));

  return migrated;
}
```

### 5. Document Breaking Changes

```typescript
description: "Remove deprecated 'oldField' property (BREAKING: clients must update)",
```

## Testing

```typescript
import { migrateRAGConfigToLatest } from "@/lib/rag-config-migration";

// Create test config
const oldConfig: RAGConfig = {
  version: "1.0.0",
  configType: "rag",
  // ... rest of config
};

// Test migration
const result = await migrateRAGConfigToLatest(oldConfig);

expect(result.success).toBe(true);
expect(result.config.version).toBe("1.1.0");
expect(result.requiresReembedding).toBe(false);
```

## Comparison with Workflow Config Migration

| Feature              | Workflow Migration | RAG Migration             |
| -------------------- | ------------------ | ------------------------- |
| Version tracking     | ✅                 | ✅                        |
| BFS path finding     | ✅                 | ✅                        |
| Validation           | ✅                 | ✅                        |
| Caching              | ✅                 | ✅                        |
| Re-embedding flag    | ❌                 | ✅                        |
| Reference validation | States/Transitions | Elements/States/Workflows |

## Related Files

- `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui-runner/src-tauri/src/config/rag_types.rs` - Rust RAG types (runner)
- `/mnt/c/Users/Joshua/Documents/qontinui_parent_directory/qontinui/src/qontinui/rag/export.py` - Python RAG export (core library)
