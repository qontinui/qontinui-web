# RAG Config Migration - Quick Start Guide

## Installation

No installation needed - the migration system is part of the frontend library.

## Basic Usage

### 1. Import the Migration Functions

```typescript
import {
  migrateRAGConfigToLatest,
  needsRAGMigration,
} from "@/lib/rag-config-migration";
```

### 2. Check if Migration is Needed

```typescript
const config = loadRAGConfig(); // Your RAG config

if (needsRAGMigration(config.version)) {
  console.log("Migration needed from version:", config.version);
} else {
  console.log("Config is up to date");
}
```

### 3. Migrate to Latest Version

```typescript
if (needsRAGMigration(config.version)) {
  const result = await migrateRAGConfigToLatest(config);

  if (result.success) {
    // Migration succeeded
    config = result.config;

    // Check if re-embedding is needed
    if (result.requiresReembedding) {
      alert("Please re-run the embedding pipeline for this configuration");
    }

    // Check for warnings
    if (result.context.warnings.length > 0) {
      console.warn("Migration warnings:", result.context.warnings);
    }
  } else {
    // Migration failed
    console.error("Migration errors:", result.context.errors);
  }
}
```

## Common Patterns

### Pattern 1: Import with Validation

```typescript
import {
  migrateRAGConfigToLatest,
  validateRAGConfigComprehensive,
} from "@/lib/rag-config-migration";

async function importRAGConfig(file: File) {
  const config = JSON.parse(await file.text());

  // Validate structure
  const validation = validateRAGConfigComprehensive(config);
  if (!validation.success) {
    throw new Error(`Invalid config: ${validation.errors.join(", ")}`);
  }

  // Migrate if needed
  if (needsRAGMigration(config.version)) {
    const result = await migrateRAGConfigToLatest(config);
    if (!result.success) {
      throw new Error(`Migration failed: ${result.context.errors.join(", ")}`);
    }
    config = result.config;

    if (result.requiresReembedding) {
      // Notify user
      showReembeddingNotification();
    }
  }

  return config;
}
```

### Pattern 2: Preview Before Migrating

```typescript
import { previewRAGMigration } from "@/lib/rag-config-migration";

async function showMigrationPreview(config: RAGConfig) {
  const preview = await previewRAGMigration(config);

  if (!preview.needsMigration) {
    console.log("No migration needed");
    return;
  }

  console.log("Migration Preview:");
  console.log(`From: ${preview.currentVersion}`);
  console.log(`To: ${preview.targetVersion}`);
  console.log("\nSteps:");
  preview.migrationSteps.forEach((step) => {
    console.log(`- ${step.from} → ${step.to}: ${step.description}`);
    if (step.requiresReembedding) {
      console.log("  ⚠️  Requires re-embedding");
    }
  });
  console.log("\nEstimated changes:");
  preview.estimatedChanges.forEach((change) => console.log(`- ${change}`));

  if (preview.requiresReembedding) {
    console.log(
      "\n⚠️  WARNING: This migration requires re-embedding all elements"
    );
  }
}
```

### Pattern 3: Batch Migration with Progress

```typescript
import { migrateRAGConfigToLatest } from "@/lib/rag-config-migration";

async function migrateMultipleConfigs(configs: RAGConfig[]) {
  const results = [];

  for (let i = 0; i < configs.length; i++) {
    console.log(`Migrating config ${i + 1}/${configs.length}...`);

    const result = await migrateRAGConfigToLatest(configs[i]);
    results.push(result);

    if (!result.success) {
      console.error(`Failed to migrate config ${i}:`, result.context.errors);
    }
  }

  const successful = results.filter((r) => r.success).length;
  const needReembedding = results.filter((r) => r.requiresReembedding).length;

  console.log(
    `\nMigration complete: ${successful}/${configs.length} succeeded`
  );
  if (needReembedding > 0) {
    console.log(`⚠️  ${needReembedding} configs require re-embedding`);
  }

  return results;
}
```

## Validation Examples

### Validate Entire Config

```typescript
import { validateRAGConfigComprehensive } from "@/lib/rag-config-migration";

const result = validateRAGConfigComprehensive(config);
if (!result.success) {
  console.error("Validation failed:");
  result.errors.forEach((err) => console.error(`- ${err}`));
}
```

### Validate Specific Aspects

```typescript
import {
  validateStateReferences,
  validateWorkflowReferences,
  validateElementReferences,
} from "@/lib/rag-config-migration";

// Check state references
const stateRefResult = validateStateReferences(config);
if (!stateRefResult.success) {
  console.error("Invalid state references:", stateRefResult.errors);
}

// Check workflow references
const workflowRefResult = validateWorkflowReferences(config);
if (!workflowRefResult.success) {
  console.error("Invalid workflow references:", workflowRefResult.errors);
}

// Check element references
const elementRefResult = validateElementReferences(config);
if (!elementRefResult.success) {
  console.error("Invalid element references:", elementRefResult.errors);
}
```

## Error Handling

```typescript
import { migrateRAGConfigToLatest } from "@/lib/rag-config-migration";

try {
  const result = await migrateRAGConfigToLatest(config);

  if (result.success) {
    // Success
    console.log("Migration successful");
    return result.config;
  } else {
    // Migration failed, but not an exception
    console.error("Migration failed:", result.context.errors);
    throw new Error(`Migration failed: ${result.context.errors.join(", ")}`);
  }
} catch (error) {
  // Unexpected error
  console.error("Unexpected migration error:", error);
  throw error;
}
```

## Type Safety

```typescript
import type { RAGConfig, RAGMigrationResult } from "@/lib/rag-config-migration";

// Type-safe function signature
async function handleRAGImport(rawConfig: unknown): Promise<RAGConfig> {
  // Validate it's a RAGConfig
  if (!isValidRAGConfig(rawConfig)) {
    throw new Error("Invalid RAG config format");
  }

  const config = rawConfig as RAGConfig;

  // Migrate with type-safe result
  const result: RAGMigrationResult = await migrateRAGConfigToLatest(config);

  if (result.success) {
    return result.config; // Type: RAGConfig
  } else {
    throw new Error("Migration failed");
  }
}

function isValidRAGConfig(obj: unknown): obj is RAGConfig {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "version" in obj &&
    "configType" in obj &&
    (obj as any).configType === "rag"
  );
}
```

## Next Steps

- Read [README.md](./README.md) for full documentation
- See [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) for technical details
- Check [migrations/example-v1.0.0-to-v1.1.0.ts.example](./migrations/example-v1.0.0-to-v1.1.0.ts.example) for migration template

## Common Questions

### Q: When should I run migrations?

**A:** Run migrations when importing RAG configs from files or receiving them from the API.

### Q: What does "requires re-embedding" mean?

**A:** It means the migration changed the config structure in a way that invalidates the existing embeddings. The user must re-run the embedding pipeline.

### Q: Can I skip migrations?

**A:** No. Migrations must be applied sequentially to maintain data integrity.

### Q: How do I create a new migration?

**A:** See [README.md](./README.md#adding-a-new-migration) for step-by-step instructions.

### Q: Are migrations reversible?

**A:** No. Migrations are one-way transformations. Always keep backups of original configs.

### Q: What happens if migration fails?

**A:** The original config is returned unchanged. Check `result.context.errors` for details.
