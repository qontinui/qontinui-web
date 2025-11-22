# Config Migration System - Complete Architecture

## System Overview

The Config Migration System provides automatic backward compatibility for all historical JSON export formats. When users import old configurations, the system detects the version and applies necessary migrations using an intelligent BFS pathfinding algorithm.

**Current Version:** 2.0.1
**Location:** `/frontend/src/lib/config-migration/`
**Pattern:** Client-side, automatic, transparent

---

## High-Level Architecture

```mermaid
graph TB
    subgraph "User Layer"
        A[User Imports JSON] --> B[ConfigImporter]
        B --> C{Version Check}
    end

    subgraph "Detection Layer"
        C -->|Old Version| D[MigrationEngine]
        C -->|Current Version| E[Use As-Is]
    end

    subgraph "Planning Layer - BFS"
        D --> F[Build Migration Graph]
        F --> G[BFS Pathfinding]
        G --> H{Path Found?}
        H -->|Yes| I[Optimal Path Array]
        H -->|No| J[Error: No Path]
    end

    subgraph "Execution Layer"
        I --> K[For Each Migration]
        K --> L[Deep Clone Config]
        L --> M[Apply Transform]
        M --> N{Validate?}
        N -->|Pass| O[Next Migration]
        N -->|Fail| P[Rollback to Original]
        O --> Q{More?}
        Q -->|Yes| K
        Q -->|No| R[Add History]
    end

    subgraph "Result Layer"
        R --> S[Success Result]
        P --> T[Error Result]
        E --> U[Success Result]
    end

    style C fill:#e1f5ff
    style G fill:#ffe1e1
    style M fill:#e1ffe1
    style N fill:#fff3e1
    style P fill:#ffcdd2
    style R fill:#c8e6c9
```

---

## Complete Data Flow: User Import Journey

```mermaid
sequenceDiagram
    participant U as User
    participant UI as Import Dialog
    participant CI as ConfigImporter
    participant ME as MigrationEngine
    participant MR as Migration Registry
    participant M1 as Migration v1→v2
    participant M2 as Migration v2→v2.0.1
    participant DB as IndexedDB/State

    U->>UI: Upload JSON config
    UI->>CI: importConfiguration(json)

    activate CI
    CI->>CI: Parse JSON
    CI->>CI: Check version field

    alt Version is current (2.0.1)
        CI->>DB: Import directly
        CI-->>UI: Success (no migration)
    else Version is old (e.g., 1.0.0)
        CI->>ME: migrateToLatest(config)

        activate ME
        ME->>ME: parseVersion('1.0.0')
        ME->>ME: compareVersions('1.0.0', '2.0.1')
        ME->>MR: Get all migrations
        MR-->>ME: [migV1→V2, migV2→V2.0.1]

        ME->>ME: buildMigrationGraph()
        ME->>ME: BFS from 1.0.0 to 2.0.1

        alt Path found
            ME->>ME: Path: [migV1→V2, migV2→V2.0.1]
            ME->>ME: structuredClone(config)

            loop For each migration
                ME->>M1: isApplicable(config)?
                M1-->>ME: true
                ME->>M1: migrate(config, context)

                activate M1
                M1->>M1: Transform to v2.0.0
                M1->>M1: Add warnings to context
                M1-->>ME: Migrated config v2.0.0
                deactivate M1

                ME->>M1: validate(config)?
                M1-->>ME: true (valid)

                ME->>M2: isApplicable(config)?
                M2-->>ME: true
                ME->>M2: migrate(config, context)

                activate M2
                M2->>M2: Transform to v2.0.1
                M2->>M2: Add warnings
                M2-->>ME: Migrated config v2.0.1
                deactivate M2

                ME->>M2: validate(config)?
                M2-->>ME: true (valid)
            end

            ME->>ME: addMigrationHistory()
            ME-->>CI: {success: true, config, warnings}
            deactivate ME

            CI->>DB: Import migrated config
            CI-->>UI: Success with warnings
            UI->>U: Show success + migration log

        else No path found
            ME-->>CI: {success: false, errors}
            deactivate ME
            CI-->>UI: Error: Cannot migrate
            UI->>U: Show error message
        end
    end
    deactivate CI
```

---

## BFS Pathfinding Algorithm Deep Dive

```mermaid
graph TB
    subgraph "Migration Graph Construction"
        A[ALL_MIGRATIONS Array] --> B[Build Adjacency List]
        B --> C[Map: fromVersion → Migration[]]
        C --> D["Example:<br/>1.0.0 → [migV1toV2]<br/>2.0.0 → [migV2toV201]"]
    end

    subgraph "BFS Initialization"
        D --> E[Initialize Queue]
        E --> F["Queue: [{version: '1.0.0', path: []}]"]
        F --> G[Initialize Visited Set]
        G --> H["Visited: Set(['1.0.0'])"]
    end

    subgraph "BFS Iteration"
        H --> I[Dequeue Current]
        I --> J{Is Target Version?}
        J -->|Yes| K[Return Path - FOUND!]
        J -->|No| L[Get Neighbors from Graph]
        L --> M{For Each Neighbor}
        M --> N{Already Visited?}
        N -->|Yes| O[Skip]
        N -->|No| P[Add to Visited]
        P --> Q[Enqueue with Updated Path]
        Q --> R{Queue Empty?}
        R -->|No| I
        R -->|Yes| S[Return null - NO PATH]
    end

    subgraph "Example Path Finding"
        T["Start: 1.0.0<br/>Target: 2.0.1"] --> U["Iteration 1:<br/>Current: 1.0.0<br/>Neighbor: 2.0.0<br/>Path: [migV1→V2]"]
        U --> V["Iteration 2:<br/>Current: 2.0.0<br/>Neighbor: 2.0.1<br/>Path: [migV1→V2, migV2→V201]"]
        V --> W["Iteration 3:<br/>Current: 2.0.1<br/>MATCH! Return path"]
    end

    style K fill:#c8e6c9
    style S fill:#ffcdd2
    style W fill:#c8e6c9
```

---

## Migration Execution Pipeline

```mermaid
graph TB
    subgraph "Pre-Execution"
        A[Migration Path Found] --> B[Preserve Original Config]
        B --> C[Deep Clone: structuredClone]
        C --> D[Create MigrationContext]
        D --> E["Context: {<br/>fromVersion<br/>toVersion<br/>warnings: []<br/>errors: []<br/>}"]
    end

    subgraph "Migration Loop"
        E --> F[Get Next Migration]
        F --> G{Has isApplicable?}
        G -->|Yes| H[Call isApplicable]
        G -->|No| I[Assume Applicable]

        H --> J{Result?}
        J -->|false| K[Skip Migration]
        J -->|true| L[Execute migrate]
        I --> L

        K --> M[Update Version Only]
        M --> N[Add Warning: Skipped]

        L --> O[Transform Config Data]
        O --> P[Collect Warnings]
        P --> Q[Update Version Field]
    end

    subgraph "Validation"
        Q --> R{Has validate?}
        R -->|Yes| S[Call validate]
        R -->|No| T[Assume Valid]

        S --> U{Result?}
        U -->|false| V[ROLLBACK]
        U -->|true| W[Continue]
        T --> W

        V --> X[Return Original Config]
        X --> Y[Add Error to Context]
        Y --> Z[Return Failure Result]
    end

    subgraph "Continuation"
        N --> AA{More Migrations?}
        W --> AA
        AA -->|Yes| F
        AA -->|No| AB[All Complete]
    end

    subgraph "Finalization"
        AB --> AC[Add Migration History]
        AC --> AD["metadata.migrationHistory.push({<br/>fromVersion<br/>toVersion<br/>path: ['1.0.0→2.0.0', '2.0.0→2.0.1']<br/>date<br/>})"]
        AD --> AE[Return Success Result]
    end

    style V fill:#ffcdd2
    style Z fill:#ffcdd2
    style AE fill:#c8e6c9
```

---

## Component Architecture

```mermaid
graph TB
    subgraph "Core Components"
        A[MigrationEngine<br/>migration-engine.ts] --> B[Central Orchestrator]
        B --> C["Methods:<br/>• registerMigration<br/>• needsMigration<br/>• migrateToLatest<br/>• findMigrationPath"]
    end

    subgraph "Utility Components"
        D[Version Utils<br/>version-utils.ts] --> E["Functions:<br/>• parseVersion<br/>• compareVersions<br/>• isVersionLessThan<br/>• isValidVersion"]
    end

    subgraph "Type System"
        F[Migration Types<br/>migration-types.ts] --> G["Interfaces:<br/>• Migration<br/>• MigrationContext<br/>• MigrationResult<br/>• MigrationHistoryEntry"]
    end

    subgraph "Migration Registry"
        H[migrations/index.ts] --> I["Exports:<br/>• CURRENT_VERSION = '2.0.1'<br/>• ALL_MIGRATIONS = [...]"]
        I --> J[migrationV1ToV2]
        I --> K[migrationV2ToV201]
        I --> L[Future Migrations...]
    end

    subgraph "Individual Migrations"
        J --> M["v1.0.0-to-v2.0.0.ts<br/>• Migrate to graph format<br/>• Add connections object<br/>• Generate positions"]
        K --> N["v2.0.0-to-v2.0.1.ts<br/>• Remove parallel connections<br/>• Update workflow versions"]
        L --> O["Example Template<br/>example-v2.0.0-to-v2.1.0.ts.example"]
    end

    subgraph "Integration Layer"
        P[ConfigImporter<br/>config-importer.ts] --> Q[Import Entry Point]
        Q --> R["Calls:<br/>• needsMigration<br/>• migrateToLatest"]

        S[ConfigExporter<br/>config-exporter.ts] --> T[Export Entry Point]
        T --> U["Sets:<br/>version = CURRENT_VERSION"]
    end

    subgraph "Schema Layer"
        V[export-schema.ts] --> W["Current Schema<br/>QontinuiConfig v2.0.1"]
        W --> X["Interfaces:<br/>• Workflow<br/>• Action<br/>• State<br/>• Transition"]
    end

    A --> D
    A --> F
    A --> H
    P --> A
    S --> I
    W --> A

    style A fill:#e3f2fd
    style D fill:#fff3e0
    style F fill:#f3e5f5
    style H fill:#e8f5e9
    style P fill:#fce4ec
    style S fill:#fce4ec
    style V fill:#e0f2f1
```

---

## Error Handling & Rollback Flow

```mermaid
graph TB
    subgraph "Normal Flow"
        A[Start Migration] --> B[Clone Config]
        B --> C[Execute Migration 1]
        C --> D[Execute Migration 2]
        D --> E[All Complete]
        E --> F[Return Success]
    end

    subgraph "Error Scenarios"
        G[Migration Throws Exception] --> H[Catch Error]
        I[Validation Fails] --> J[Catch Failure]
        K[No Path Found] --> L[Return Error]
    end

    subgraph "Rollback Mechanism"
        H --> M[Add to context.errors]
        J --> M
        M --> N[Return Original Config]
        N --> O["MigrationResult {<br/>success: false<br/>config: originalConfig<br/>context: { errors }"]
    end

    subgraph "Error Types"
        P[Invalid Version Format] --> Q["Error: 'Invalid version'"]
        R[Missing Migration] --> S["Error: 'No migration path'"]
        T[Transform Error] --> U["Error: 'Migration X→Y failed'"]
        V[Validation Error] --> W["Error: 'Validation failed'"]
    end

    subgraph "User Impact"
        O --> X[ConfigImporter Receives]
        L --> X
        X --> Y{success?}
        Y -->|false| Z[Display Errors to User]
        Y -->|true| AA[Import Config]
        Z --> AB[Config Not Imported]
        AB --> AC[Original Data Preserved]
    end

    style N fill:#ffcdd2
    style O fill:#ffcdd2
    style AB fill:#ffecb3
    style AC fill:#c8e6c9
    style F fill:#c8e6c9
```

---

## Migration History Tracking

```mermaid
graph TB
    subgraph "History Entry Structure"
        A["MigrationHistoryEntry {"] --> B["fromVersion: '1.0.0'"]
        A --> C["toVersion: '2.0.1'"]
        A --> D["date: '2025-11-21T15:30:00Z'"]
        A --> E["path: ['1.0.0→2.0.0', '2.0.0→2.0.1']"]
        A --> F["}"]
    end

    subgraph "Storage Location"
        G[Config Object] --> H[metadata Object]
        H --> I["migrationHistory: MigrationHistoryEntry[]"]
        I --> J[Entry 1: 0.9.0 → 1.0.0]
        I --> K[Entry 2: 1.0.0 → 2.0.1]
    end

    subgraph "History Accumulation"
        L[Import v0.9.0 Config] --> M[Migrate to 1.0.0]
        M --> N["Add History:<br/>0.9.0 → 1.0.0"]
        N --> O[Export Config]

        P[Re-import v1.0.0 Config] --> Q[Migrate to 2.0.1]
        Q --> R["Add History:<br/>1.0.0 → 2.0.1"]
        R --> S[Now Has 2 Entries]
    end

    subgraph "Use Cases"
        T[Debugging] --> U[Track Config Journey]
        V[Auditing] --> W[When Was It Migrated?]
        X[Analytics] --> Y[Common Migration Paths]
    end

    style I fill:#e3f2fd
```

---

## Version Progression Timeline

```mermaid
graph LR
    A[v0.9.0<br/>Sequential Format] -->|migrationV09ToV1| B[v1.0.0<br/>Legacy Format]
    B -->|migrationV1ToV2| C[v2.0.0<br/>Graph Format]
    C -->|migrationV2ToV201| D[v2.0.1<br/>Current]

    E[Future<br/>v2.0.2] -.->|Not Yet Implemented| D
    F[Future<br/>v2.1.0] -.->|Not Yet Implemented| D

    style A fill:#ffcdd2
    style B fill:#ffecb3
    style C fill:#fff9c4
    style D fill:#c8e6c9
    style E fill:#e0e0e0
    style F fill:#e0e0e0
```

---

## Integration Points

```mermaid
graph TB
    subgraph "User Actions"
        A[Import File] --> B[Import URL]
        B --> C[Import Clipboard]
        C --> D[Import Template]
    end

    subgraph "UI Components"
        D --> E[ImportExportDialog.tsx]
        E --> F[ProjectManager.tsx]
    end

    subgraph "Import Layer"
        F --> G[ConfigImporter.ts]
        G --> H{needsMigration?}
    end

    subgraph "Migration Layer"
        H -->|Yes| I[MigrationEngine]
        H -->|No| J[Direct Import]
        I --> K[migrateToLatest]
        K --> L{success?}
    end

    subgraph "Application Layer"
        L -->|Yes| M[Apply Config]
        L -->|No| N[Show Errors]
        J --> M

        M --> O[Update Workflows]
        M --> P[Update States]
        M --> Q[Update Transitions]
        M --> R[Update Images]
    end

    subgraph "Storage Layer"
        O --> S[Zustand State]
        P --> S
        Q --> S
        R --> S

        S --> T[IndexedDB]
        S --> U[Backend API]
    end

    style I fill:#e3f2fd
    style M fill:#c8e6c9
    style N fill:#ffcdd2
```

---

## Migration Examples

### Example 1: Simple Field Rename

```mermaid
graph LR
    A["Before v2.0.0:<br/>{<br/>  clickType: 'left'<br/>}"] -->|Migration| B["After v2.0.0:<br/>{<br/>  mouseButton: 'LEFT'<br/>}"]

    C[Transformation] --> D["1. Check if clickType exists<br/>2. Convert to mouseButton<br/>3. Delete old field<br/>4. Add warning"]

    style A fill:#ffecb3
    style B fill:#c8e6c9
```

### Example 2: Type Conversion (String → Array)

```mermaid
graph LR
    A["Before:<br/>{<br/>  imageId: 'abc123'<br/>}"] -->|Migration| B["After:<br/>{<br/>  imageIds: ['abc123']<br/>}"]

    C[Transformation] --> D["1. Check if imageId is string<br/>2. Wrap in array<br/>3. Rename to imageIds<br/>4. Add warning"]

    style A fill:#ffecb3
    style B fill:#c8e6c9
```

### Example 3: Object Restructuring

```mermaid
graph LR
    A["Before:<br/>{<br/>  target: 'Last Find Result'<br/>}"] -->|Migration| B["After:<br/>{<br/>  target: {<br/>    type: 'lastFindResult'<br/>  }<br/>}"]

    C[Transformation] --> D["1. Check if target is string<br/>2. Map to object structure<br/>3. Replace field<br/>4. Add warning"]

    style A fill:#ffecb3
    style B fill:#c8e6c9
```

---

## Key Design Principles

```mermaid
mindmap
  root((Config Migration<br/>System))
    Automatic
      No user intervention
      Transparent operation
      Clear warnings
    Safe
      Original preserved
      Rollback on error
      No data corruption
    Intelligent
      BFS pathfinding
      Optimal chains
      Skip unnecessary steps
    Extensible
      Easy to add migrations
      Registry pattern
      Template provided
    Type Safe
      TypeScript interfaces
      Compile-time checks
      Runtime validation
    Observable
      Migration history
      Warning collection
      Error tracking
```

---

## Performance Characteristics

```mermaid
graph TB
    subgraph "Time Complexity"
        A[BFS Pathfinding] --> B[O V + E]
        C[Version Comparison] --> D[O 1]
        E[Deep Clone] --> F[O n]
        G[Migration Execution] --> H[O m × n]

        I["V = number of versions<br/>E = number of migrations<br/>n = config size<br/>m = migrations in path"]
    end

    subgraph "Space Complexity"
        J[Original Config] --> K[O n]
        L[Cloned Config] --> M[O n]
        N[Migration Graph] --> O[O E]
        P[BFS Queue] --> Q[O V]

        R[Total: O 2n + E + V]
    end

    subgraph "Typical Performance"
        S[Config Size] --> T[50-500 KB]
        U[Migration Time] --> V[50-200ms]
        W[BFS Time] --> X[Less than 1ms]
        Y[Clone Time] --> Z[10-50ms per migration]
    end

    style B fill:#e3f2fd
    style R fill:#e3f2fd
    style V fill:#c8e6c9
```

---

## Future Enhancement Opportunities

```mermaid
graph TB
    subgraph "Caching"
        A[Migration Result Cache] --> B[Cache by version + hash]
        B --> C[Speed up repeated imports]
    end

    subgraph "Preview"
        D[Migration Preview UI] --> E[Show changes before applying]
        E --> F[User approval required]
    end

    subgraph "Analytics"
        G[Track Migration Patterns] --> H[Which versions are common?]
        H --> I[Identify problem migrations]
    end

    subgraph "Validation"
        J[Enhanced Validation] --> K[Zod schema per version]
        K --> L[Stricter checks]
    end

    subgraph "Downgrade"
        M[Downgrade Support] --> N[Rollback to older versions]
        N --> O[Testing compatibility]
    end

    subgraph "Parallel Paths"
        P[Multiple Target Versions] --> Q[Support branching strategies]
        Q --> R[Environment-specific versions]
    end

    style C fill:#c8e6c9
    style F fill:#fff9c4
    style I fill:#e3f2fd
    style L fill:#c8e6c9
    style O fill:#ffecb3
    style R fill:#fff9c4
```

---

## References

**Core Implementation:**
- Migration Engine: `/frontend/src/lib/config-migration/migration-engine.ts`
- Migration Types: `/frontend/src/lib/config-migration/migration-types.ts`
- Version Utils: `/frontend/src/lib/config-migration/version-utils.ts`
- Registry: `/frontend/src/lib/config-migration/migrations/index.ts`

**Migrations:**
- v1→v2: `/frontend/src/lib/config-migration/migrations/v1.0.0-to-v2.0.0.ts`
- v2→v2.0.1: `/frontend/src/lib/config-migration/migrations/v2.0.0-to-v2.0.1.ts`
- Template: `/frontend/src/lib/config-migration/migrations/example-v2.0.0-to-v2.1.0.ts.example`

**Integration:**
- Config Importer: `/frontend/src/lib/config-importer.ts`
- Export Schema: `/frontend/src/lib/export-schema.ts`

**Documentation:**
- Full Guide: `/qontinui-dev-notes/qontinui/guides/CONFIG_MIGRATION_SYSTEM.md`

---

## Summary

The Config Migration System is a production-ready, intelligent solution for handling backward compatibility of JSON configurations. Key features:

✅ **Automatic** - Detects old versions and migrates transparently
✅ **Safe** - Preserves original data, rolls back on errors
✅ **Optimal** - BFS algorithm finds shortest migration path
✅ **Extensible** - Easy to add new migrations via registry pattern
✅ **Type-Safe** - Full TypeScript coverage with runtime validation
✅ **Observable** - Complete migration history and warning system

**Status:** Production-ready, actively used, well-documented
