# Config Migration System Architecture

## Overview

The Config Migration System provides automatic backward compatibility for all historical JSON export formats. When users import old configurations, the system detects the version and applies all necessary migrations to bring it to the current format.

## Architecture Diagram

```mermaid
graph TB
    subgraph "User Import Flow"
        A[User Imports JSON Config] --> B[Config File with version field]
        B --> C{Version Detection}
    end

    subgraph "Version Detection Layer"
        C --> D[parseVersion]
        D --> E[isValidVersion]
        E --> F{Needs Migration?}
        F -->|No| G[Return Config As-Is]
        F -->|Yes| H[MigrationEngine.migrateToLatest]
    end

    subgraph "Migration Planning - BFS Algorithm"
        H --> I[Build Migration Graph]
        I --> J[Graph: Map<fromVersion, Migration[]>]
        J --> K[BFS Path Finding Algorithm]
        K --> L{Path Found?}
        L -->|No| M[Return Error: No migration path]
        L -->|Yes| N[Migration Path Array]
        N --> O[Example: 1.0.0 → 2.0.0 → 2.1.0]
    end

    subgraph "Sequential Migration Execution"
        O --> P[For Each Migration in Path]
        P --> Q[Deep Clone Config]
        Q --> R{isApplicable?}
        R -->|No| S[Skip Migration, Update Version]
        R -->|Yes| T[Execute migrate function]
        S --> P
        T --> U[Transform Config Data]
        U --> V{validate?}
        V -->|Pass| W[Update Version Field]
        V -->|Fail| X[Rollback to Original]
        W --> Y{More Migrations?}
        Y -->|Yes| P
        Y -->|No| Z[Add Migration History]
    end

    subgraph "Validation & Schema Layer"
        V --> AA[Zod Schema Validation]
        AA --> AB[TypeScript Type System]
        AB --> AC[export-schema.ts Types]
        AC --> AD[QontinuiConfig Interface]
    end

    subgraph "Error Handling & Rollback"
        X --> AE[Preserve Original Config]
        AE --> AF[MigrationContext with Errors]
        AF --> AG[Return MigrationResult]
        AG --> AH[success: false, original config]
    end

    subgraph "Success Path"
        Z --> AI[Add MigrationHistoryEntry]
        AI --> AJ[Update config.metadata.migrationHistory]
        AJ --> AK[Track: fromVersion, toVersion, path, date]
        AK --> AL[Return MigrationResult]
        AL --> AM[success: true, migrated config]
    end

    subgraph "Migration Registry"
        AN[migrations/index.ts] --> AO[ALL_MIGRATIONS Array]
        AO --> AP[migrationV1ToV2]
        AO --> AQ[migrationV2ToV21]
        AO --> AR[Future Migrations...]
        AP --> I
        AQ --> I
        AR --> I
    end

    style C fill:#e1f5ff
    style K fill:#ffe1e1
    style T fill:#e1ffe1
    style V fill:#fff3e1
    style X fill:#ffe1e1
    style Z fill:#e1ffe1
```

## Component Breakdown

### 1. Version Detection Layer

**Location:** `/frontend/src/lib/config-migration/version-utils.ts`

**Responsibilities:**
- Parse semantic version strings (X.Y.Z format)
- Validate version format
- Compare versions (>, <, =)
- Determine if migration is needed

**Key Functions:**
```typescript
parseVersion(version: string): {major, minor, patch} | null
isValidVersion(version: string): boolean
compareVersions(a: string, b: string): number  // -1, 0, 1
```

**Used by:**
- MigrationEngine constructor validation
- Migration registration validation
- needsMigration() checks

---

### 2. Migration Engine (Core Orchestrator)

**Location:** `/frontend/src/lib/config-migration/migration-engine.ts`

**Responsibilities:**
- Central orchestration of all migration operations
- Migration registration and storage
- Version comparison and detection
- Path finding (BFS algorithm)
- Sequential migration execution
- Error handling and rollback
- Migration history tracking

**Key Methods:**

```typescript
class MigrationEngine {
  registerMigration(migration: Migration): void
  needsMigration(configVersion: string): boolean
  migrateToLatest(config: any): Promise<MigrationResult>
  findMigrationPath(from: string, to: string): Migration[] | null
}
```

**BFS Path Finding Algorithm:**
1. Build adjacency list (graph) from registered migrations
2. Initialize queue with starting version
3. Use BFS to explore version transitions
4. Track visited versions to avoid cycles
5. Return shortest path when target version found
6. Return null if no path exists

**Why BFS?**
- Guarantees shortest migration path
- Avoids unnecessary intermediate steps
- Handles complex migration graphs
- O(V + E) time complexity

---

### 3. Migration Registry

**Location:** `/frontend/src/lib/config-migration/migrations/index.ts`

**Responsibilities:**
- Central registry of all available migrations
- Version constant management
- Migration export and organization

**Structure:**
```typescript
export const CURRENT_VERSION = '2.0.0';

export const ALL_MIGRATIONS: Migration[] = [
  migrationV1ToV2,
  migrationV2ToV21,
  // Future migrations...
];
```

**How to Add New Migration:**
1. Create new file: `v2.0.0-to-v2.1.0.ts`
2. Export migration implementation
3. Register in `ALL_MIGRATIONS` array
4. Update `CURRENT_VERSION` constant

---

### 4. Individual Migrations

**Location:** `/frontend/src/lib/config-migration/migrations/vX-to-vY.ts`

**Example:** `v1.0.0-to-v2.0.0.ts`

**Structure:**
```typescript
export const migrationV1ToV2: Migration = {
  fromVersion: '1.0.0',
  toVersion: '2.0.0',
  description: 'Migrate legacy formats to v2.0.0 graph format',

  migrate(config: any, context: MigrationContext): any {
    const migrated = structuredClone(config); // Deep clone
    // Transform data...
    context.warnings.push('Migration applied');
    migrated.version = '2.0.0';
    return migrated;
  },

  isApplicable?(config: any): boolean {
    // Check if migration is needed
    return config.workflows?.some(w => w.format !== 'graph');
  },

  validate?(config: any): boolean {
    // Verify migration success
    return config.workflows?.every(w => w.format === 'graph');
  }
};
```

**Key Principles:**
- Use `structuredClone()` to avoid mutations
- Add warnings to context for transparency
- Update version field at the end
- Optional: Implement `isApplicable()` for conditional execution
- Optional: Implement `validate()` for post-migration verification

---

### 5. Migration Context

**Location:** `/frontend/src/lib/config-migration/migration-types.ts`

**Purpose:** Accumulate warnings, errors, and metadata during migration pipeline

```typescript
interface MigrationContext {
  fromVersion: string;    // Original version
  toVersion: string;      // Target version
  timestamp: Date;        // Migration timestamp
  warnings: string[];     // Non-critical issues
  errors: string[];       // Critical failures
}
```

**Passed through:**
- Every migration in the chain
- Accumulates warnings from each step
- Collects errors on failures
- Returned in MigrationResult

---

### 6. Migration Result

**Location:** `/frontend/src/lib/config-migration/migration-types.ts`

**Purpose:** Return value from migration operations

```typescript
interface MigrationResult {
  success: boolean;           // Migration succeeded?
  config: any;                // Migrated config (or original on failure)
  context: MigrationContext;  // Warnings and errors
}
```

**Success Path:**
- `success: true`
- `config`: Fully migrated configuration
- `context.warnings`: List of applied transformations

**Failure Path:**
- `success: false`
- `config`: Original untouched configuration (rollback)
- `context.errors`: List of failures

---

### 7. TypeScript Type System

**Location:** `/frontend/src/lib/export-schema.ts`

**Responsibilities:**
- Define current config schema (v2.0.0)
- Provide type safety for all config operations
- Document expected structure

**Key Types:**
```typescript
interface QontinuiConfig {
  version: string;              // Semantic version
  metadata: ConfigMetadata;
  workflows: Workflow[];        // Graph-format workflows
  states: State[];
  transitions: Transition[];
  // ...
}
```

**Used by:**
- Migration validation
- Import/export operations
- Frontend type checking

---

### 8. Zod Schema Validation

**Framework:** Zod (TypeScript-first schema validation)

**Purpose:**
- Runtime validation of migrated configs
- Ensure type safety at runtime
- Catch invalid data before it reaches the application

**Integration Points:**
- Post-migration validation
- Import validation
- API response validation

**Example:**
```typescript
import { z } from 'zod';

const workflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  format: z.literal('graph'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  actions: z.array(actionSchema),
  connections: z.record(z.any()),
});
```

---

## Data Flow: Complete Migration Example

### Scenario: User imports v1.0.0 config

```
1. [User Action]
   └─ Import v1.0.0 config file

2. [Version Detection]
   └─ parseVersion('1.0.0') → {major: 1, minor: 0, patch: 0}
   └─ compareVersions('1.0.0', '2.0.0') → -1 (needs migration)

3. [BFS Path Finding]
   └─ Build graph: {'1.0.0': [migrationV1ToV2]}
   └─ BFS search from '1.0.0' to '2.0.0'
   └─ Found path: [migrationV1ToV2]

4. [Sequential Execution]
   └─ Clone config (structuredClone)
   └─ Check isApplicable() → true
   └─ Execute migrate()
      ├─ Set workflow.format = 'graph'
      ├─ Add workflow.connections = {}
      ├─ Add action.position arrays
      └─ Update version = '2.0.0'
   └─ Check validate() → true
   └─ Add migration history entry

5. [Validation]
   └─ Zod schema validation
   └─ TypeScript type checking
   └─ Config structure verification

6. [Success]
   └─ Return MigrationResult {
         success: true,
         config: <migrated config>,
         context: {
           fromVersion: '1.0.0',
           toVersion: '2.0.0',
           warnings: ['Workflow X: Updated format to graph'],
           errors: []
         }
       }
```

---

## Multi-Step Migration Example

### Scenario: User imports v1.0.0 config, target is v2.1.0

```
Registry contains:
  - migrationV1ToV2: 1.0.0 → 2.0.0
  - migrationV2ToV21: 2.0.0 → 2.1.0

BFS Path Finding:
  Graph: {
    '1.0.0': [migrationV1ToV2],
    '2.0.0': [migrationV2ToV21]
  }

  Queue: [
    {version: '1.0.0', path: []},
    {version: '2.0.0', path: [migrationV1ToV2]},
    {version: '2.1.0', path: [migrationV1ToV2, migrationV2ToV21]} ← Found!
  ]

Sequential Execution:
  1. Execute migrationV1ToV2
     - Transform 1.0.0 → 2.0.0
     - Validate → Pass

  2. Execute migrationV2ToV21
     - Transform 2.0.0 → 2.1.0
     - Validate → Pass

  3. Add history entry:
     {
       fromVersion: '1.0.0',
       toVersion: '2.1.0',
       path: ['1.0.0→2.0.0', '2.0.0→2.1.0'],
       date: '2025-11-18T10:30:00Z'
     }
```

---

## Error Handling & Rollback

### Rollback Triggers

1. **Migration throws exception**
   ```typescript
   try {
     currentConfig = migration.migrate(currentConfig, context);
   } catch (error) {
     context.errors.push(`Migration failed: ${error.message}`);
     return { success: false, config: originalConfig, context };
   }
   ```

2. **Validation fails**
   ```typescript
   if (migration.validate && !migration.validate(currentConfig)) {
     context.errors.push('Migration validation failed');
     return { success: false, config: originalConfig, context };
   }
   ```

3. **No migration path found**
   ```typescript
   if (!path) {
     context.errors.push('No migration path found');
     return { success: false, config: originalConfig, context };
   }
   ```

### Rollback Mechanism

- Original config is preserved before migration starts
- Uses `structuredClone()` for deep copy
- No mutations to original data
- On failure, return original config in MigrationResult

---

## Framework Integration

### TypeScript Type System
- **Role:** Compile-time type safety
- **Integration:** All migration functions are typed
- **Benefits:** Catch errors during development

### Zod
- **Role:** Runtime schema validation
- **Integration:** Validate migrated configs before use
- **Benefits:** Ensure data integrity at runtime

### export-schema.ts
- **Role:** Single source of truth for config structure
- **Integration:** Used by migrations, imports, exports
- **Benefits:** Consistent schema across codebase

### Migration Registries
- **Role:** Centralized migration management
- **Integration:** All migrations registered in one place
- **Benefits:** Easy to add/remove migrations

### BFS Pathfinding Algorithm
- **Role:** Find shortest migration path
- **Integration:** Built into MigrationEngine
- **Benefits:** Optimal migration chains

---

## Adding a New Migration

### Step-by-Step Guide

**1. Create migration file**
```bash
cd /frontend/src/lib/config-migration/migrations/
touch v2.0.0-to-v2.1.0.ts
```

**2. Implement migration**
```typescript
export const migrationV2ToV21: Migration = {
  fromVersion: '2.0.0',
  toVersion: '2.1.0',
  description: 'Add new feature X',

  migrate(config, context) {
    const migrated = structuredClone(config);
    // Transform logic here
    migrated.version = '2.1.0';
    return migrated;
  },

  isApplicable(config) {
    // Optional: check if migration needed
    return true;
  },

  validate(config) {
    // Optional: verify migration success
    return config.version === '2.1.0';
  }
};
```

**3. Register migration**
```typescript
// migrations/index.ts
import { migrationV2ToV21 } from './v2.0.0-to-v2.1.0';

export const CURRENT_VERSION = '2.1.0';
export const ALL_MIGRATIONS = [
  migrationV1ToV2,
  migrationV2ToV21  // Add here
];
```

**4. Update export schema**
```typescript
// lib/export-schema.ts
export const CURRENT_EXPORT_VERSION = '2.1.0';
```

**5. Test migration**
- Create test configs from v1.0.0, v2.0.0
- Run through migration engine
- Verify multi-step paths work (1.0.0 → 2.1.0)
- Test validation logic
- Test rollback on errors

---

## Benefits of This Architecture

### 1. Automatic Version Upgrades
- No manual intervention required
- Users import any version, get latest

### 2. Transparent Migration Path
- Clear history in metadata
- Warnings for each transformation
- Easy debugging

### 3. Safe Rollback
- Original config preserved
- Failures don't corrupt data
- Clear error messages

### 4. Optimal Chaining
- BFS finds shortest path
- No redundant migrations
- Handles complex graphs

### 5. Extensible Design
- Easy to add new migrations
- No changes to core engine
- Registry pattern for organization

### 6. Type-Safe Operations
- TypeScript catches errors early
- Zod validates at runtime
- Clear interfaces for all types

### 7. Validation at Each Step
- Optional per-migration validation
- Catch issues immediately
- Clear failure points

---

## Future Enhancements

### Potential Improvements

1. **Migration Caching**
   - Cache migration results for repeated imports
   - Speed up bulk operations

2. **Parallel Migration Paths**
   - Support multiple target versions
   - Allow branching migration strategies

3. **Migration Preview**
   - Show migration plan before execution
   - Let users review changes

4. **Downgrade Support**
   - Allow rolling back to older versions
   - Useful for compatibility testing

5. **Migration Analytics**
   - Track which migrations are most common
   - Identify problem areas

6. **Automated Testing**
   - Generate test cases from migrations
   - Verify all paths work

---

## References

- **Migration Engine:** `/frontend/src/lib/config-migration/migration-engine.ts`
- **Migration Types:** `/frontend/src/lib/config-migration/migration-types.ts`
- **Version Utils:** `/frontend/src/lib/config-migration/version-utils.ts`
- **Migration Registry:** `/frontend/src/lib/config-migration/migrations/index.ts`
- **Example Migration:** `/frontend/src/lib/config-migration/migrations/v1.0.0-to-v2.0.0.ts`
- **Export Schema:** `/frontend/src/lib/export-schema.ts`
- **Full Documentation:** `/qontinui-dev-notes/qontinui/guides/CONFIG_MIGRATION_SYSTEM.md`

---

## Glossary

- **BFS:** Breadth-First Search algorithm for graph traversal
- **Migration:** Transformation from one config version to another
- **Migration Chain:** Sequence of migrations (e.g., 1.0.0 → 2.0.0 → 2.1.0)
- **Migration Path:** Shortest sequence found by BFS
- **Rollback:** Reverting to original config on failure
- **Version Detection:** Identifying config version from metadata
- **Sequential Execution:** Running migrations one after another
- **Validation:** Verifying migration correctness
- **Context:** Metadata accumulated during migration
- **Registry:** Central collection of available migrations
