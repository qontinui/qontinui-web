# Module Overview & Line Count Distribution

## Summary Statistics

| Metric | Value |
|--------|-------|
| **Total Modules** | 15 |
| **Total Lines** | 3,459 |
| **Largest Module** | types.ts (655 lines) |
| **Smallest Module** | report-exporter.ts (40 lines) |
| **Average Lines/Module** | 231 lines |
| **Original File** | 2,880 lines |

## Line Count Distribution

```
types.ts                    ████████████████████████████████████ 655 lines (19%)
health-analyzer.ts          ███████████████████████████████      537 lines (16%)
index.ts                    ███████████████████████████████      530 lines (15%)
resource-analyzer.ts        ███████████████████████              393 lines (11%)
suggestion-generator.ts     ████████                             242 lines (7%)
reference-validator.ts      ██████                               200 lines (6%)
duplicate-detector.ts       █████                                163 lines (5%)
auto-optimizer.ts           ████                                 145 lines (4%)
storage-analyzer.ts         ████                                 127 lines (4%)
coverage-analyzer.ts        ████                                 124 lines (4%)
dependency-analyzer.ts      ████                                 121 lines (3%)
complexity-analyzer.ts      ██                                    71 lines (2%)
unused-resource-detector.ts ██                                    63 lines (2%)
utils.ts                    █                                     48 lines (1%)
report-exporter.ts          █                                     40 lines (1%)
```

## Module Categories by Size

### Large Modules (400+ lines)
**Purpose**: Core infrastructure and complex orchestration

1. **types.ts** (655 lines)
   - All TypeScript interfaces and types
   - 25+ exported interfaces
   - Shared across all modules
   - No logic, pure type definitions

2. **health-analyzer.ts** (537 lines)
   - Health scoring algorithms
   - Metrics tracking
   - Trend analysis
   - Alert checking
   - Multiple health factor calculations

3. **index.ts** (530 lines)
   - Main orchestrator
   - Backward compatibility layer
   - Re-exports all functions
   - Singleton service class
   - API facade

### Medium Modules (150-400 lines)
**Purpose**: Core analysis functionality

4. **resource-analyzer.ts** (393 lines)
   - Analyzes 4 resource types (workflows, states, images, transitions)
   - Complex analysis logic per type
   - Integration with external services

5. **suggestion-generator.ts** (242 lines)
   - Generates 9 types of suggestions
   - Priority calculation
   - Impact estimation
   - Resource aggregation

6. **reference-validator.ts** (200 lines)
   - Validates 3 reference types
   - Cross-resource validation
   - Broken reference detection

7. **duplicate-detector.ts** (163 lines)
   - Detects 3 types of duplicates
   - Similarity algorithms
   - Match type classification

### Small Modules (50-150 lines)
**Purpose**: Focused, single-purpose utilities

8. **auto-optimizer.ts** (145 lines)
   - Auto-optimization logic
   - Backup creation
   - Category suggestions
   - Dry-run support

9. **storage-analyzer.ts** (127 lines)
   - Storage calculation
   - Breakdown analysis
   - Savings estimation

10. **coverage-analyzer.ts** (124 lines)
    - Test coverage calculation
    - Documentation coverage
    - Folder-level analysis

11. **dependency-analyzer.ts** (121 lines)
    - Dependency graph
    - Critical resource detection
    - Impact analysis

12. **complexity-analyzer.ts** (71 lines)
    - Complexity distribution
    - High complexity detection
    - Simplification suggestions

### Tiny Modules (<50 lines)
**Purpose**: Minimal, focused functionality

13. **unused-resource-detector.ts** (63 lines)
    - 4 detection functions
    - Delegates to analyzers
    - Pure detection logic

14. **utils.ts** (48 lines)
    - 2 utility functions
    - String similarity
    - Byte formatting

15. **report-exporter.ts** (40 lines)
    - Single export function
    - Simple delegation

## Complexity by Module

### High Complexity (Multiple Concerns)
- **types.ts**: Defines 25+ complex interfaces
- **health-analyzer.ts**: Calculates 6 health factors with weights
- **resource-analyzer.ts**: Analyzes 4 different resource types
- **suggestion-generator.ts**: Generates 9 suggestion types

### Medium Complexity (Single Main Concern)
- **reference-validator.ts**: Validates 3 reference types
- **duplicate-detector.ts**: Detects 3 duplicate types
- **auto-optimizer.ts**: Applies multiple optimizations
- **storage-analyzer.ts**: Multiple calculation methods

### Low Complexity (Simple, Focused)
- **unused-resource-detector.ts**: Simple detection logic
- **complexity-analyzer.ts**: Delegates to external service
- **coverage-analyzer.ts**: Straightforward calculations
- **dependency-analyzer.ts**: Mostly delegation
- **utils.ts**: Two utility functions
- **report-exporter.ts**: Single export function

## Dependency Graph

### Core Dependencies (Used by Many)
```
types.ts
  └── Imported by: ALL 14 other modules

utils.ts
  └── Imported by: duplicate-detector.ts, storage-analyzer.ts, health-analyzer.ts
```

### Analysis Layer
```
resource-analyzer.ts
  ├── Imports: types.ts, utils.ts
  ├── Imports: duplicate-detector.ts, reference-validator.ts
  └── Used by: unused-resource-detector.ts, health-analyzer.ts

coverage-analyzer.ts
  ├── Imports: types.ts
  └── Used by: health-analyzer.ts

complexity-analyzer.ts
  ├── Imports: types.ts
  └── Used by: health-analyzer.ts

storage-analyzer.ts
  ├── Imports: types.ts, utils.ts
  ├── Imports: resource-analyzer.ts, duplicate-detector.ts
  └── Used by: health-analyzer.ts
```

### Detection Layer
```
unused-resource-detector.ts
  ├── Imports: types.ts, resource-analyzer.ts
  └── Used by: auto-optimizer.ts, health-analyzer.ts

duplicate-detector.ts
  ├── Imports: types.ts, utils.ts
  └── Used by: resource-analyzer.ts

reference-validator.ts
  ├── Imports: types.ts
  └── Used by: resource-analyzer.ts

dependency-analyzer.ts
  ├── Imports: types.ts
  └── Used by: index.ts
```

### Action Layer
```
suggestion-generator.ts
  ├── Imports: types.ts, utils.ts
  └── Used by: health-analyzer.ts, index.ts

health-analyzer.ts
  ├── Imports: types.ts, utils.ts
  ├── Imports: resource-analyzer.ts, coverage-analyzer.ts
  ├── Imports: complexity-analyzer.ts, storage-analyzer.ts
  ├── Imports: suggestion-generator.ts
  └── Used by: index.ts, report-exporter.ts

auto-optimizer.ts
  ├── Imports: types.ts
  ├── Imports: unused-resource-detector.ts
  └── Used by: index.ts

report-exporter.ts
  ├── Imports: types.ts, health-analyzer.ts
  └── Used by: index.ts
```

### Orchestration Layer
```
index.ts
  ├── Imports: ALL modules
  └── Provides: Unified API + Backward compatibility
```

## Module Responsibility Matrix

| Module | Create | Read | Update | Delete | Calculate | Validate | Export |
|--------|--------|------|--------|--------|-----------|----------|--------|
| types.ts | - | - | - | - | - | - | ✓ |
| index.ts | - | - | - | - | - | - | ✓ |
| health-analyzer.ts | ✓ | - | - | - | ✓ | - | ✓ |
| resource-analyzer.ts | ✓ | - | - | - | ✓ | ✓ | ✓ |
| unused-resource-detector.ts | - | ✓ | - | - | - | - | ✓ |
| duplicate-detector.ts | - | ✓ | - | - | ✓ | - | ✓ |
| reference-validator.ts | - | ✓ | - | - | - | ✓ | ✓ |
| storage-analyzer.ts | - | - | - | - | ✓ | - | ✓ |
| complexity-analyzer.ts | - | - | - | - | ✓ | - | ✓ |
| coverage-analyzer.ts | - | - | - | - | ✓ | - | ✓ |
| dependency-analyzer.ts | - | ✓ | - | - | ✓ | - | ✓ |
| suggestion-generator.ts | ✓ | - | - | - | - | - | ✓ |
| auto-optimizer.ts | - | - | ✓ | ✓ | - | - | ✓ |
| report-exporter.ts | ✓ | - | - | - | - | - | ✓ |
| utils.ts | - | - | - | - | ✓ | - | ✓ |

## Function Export Count

| Module | Exported Functions | Exported Types |
|--------|-------------------|----------------|
| types.ts | 0 | 25+ |
| index.ts | 40+ | 25+ (re-export) |
| health-analyzer.ts | 5 | 0 |
| resource-analyzer.ts | 4 | 0 |
| unused-resource-detector.ts | 4 | 0 |
| duplicate-detector.ts | 3 | 0 |
| reference-validator.ts | 4 | 0 |
| storage-analyzer.ts | 3 | 0 |
| complexity-analyzer.ts | 3 | 0 |
| coverage-analyzer.ts | 4 | 0 |
| dependency-analyzer.ts | 4 | 0 |
| suggestion-generator.ts | 1 | 0 |
| auto-optimizer.ts | 2 | 0 |
| report-exporter.ts | 1 | 0 |
| utils.ts | 2 | 0 |

## Import Relationships

### Zero Dependencies (Foundation)
- **types.ts**: No imports (pure types)

### Minimal Dependencies (1-2 imports)
- **utils.ts**: types.ts
- **report-exporter.ts**: types.ts, health-analyzer.ts
- **complexity-analyzer.ts**: types.ts, workflow-complexity-analyzer
- **coverage-analyzer.ts**: types.ts, external services
- **dependency-analyzer.ts**: types.ts, external services

### Moderate Dependencies (3-5 imports)
- **unused-resource-detector.ts**: types.ts, resource-analyzer.ts
- **duplicate-detector.ts**: types.ts, utils.ts
- **reference-validator.ts**: types.ts
- **storage-analyzer.ts**: types.ts, utils.ts, resource-analyzer.ts, duplicate-detector.ts
- **auto-optimizer.ts**: types.ts, unused-resource-detector.ts
- **suggestion-generator.ts**: types.ts, utils.ts

### Heavy Dependencies (6+ imports)
- **resource-analyzer.ts**: types.ts, duplicate-detector.ts, reference-validator.ts, external services
- **health-analyzer.ts**: types.ts, utils.ts, 6 analyzer modules
- **index.ts**: ALL modules (orchestrator)

## Testability Score

| Module | Testability | Reason |
|--------|-------------|--------|
| utils.ts | ⭐⭐⭐⭐⭐ | Pure functions, no dependencies |
| types.ts | ⭐⭐⭐⭐⭐ | No logic to test |
| reference-validator.ts | ⭐⭐⭐⭐⭐ | Pure validation, minimal deps |
| duplicate-detector.ts | ⭐⭐⭐⭐ | Mostly pure, one util dep |
| unused-resource-detector.ts | ⭐⭐⭐⭐ | Simple logic, clear deps |
| complexity-analyzer.ts | ⭐⭐⭐⭐ | Delegates to service |
| coverage-analyzer.ts | ⭐⭐⭐⭐ | Clear calculations |
| storage-analyzer.ts | ⭐⭐⭐ | Multiple dependencies |
| suggestion-generator.ts | ⭐⭐⭐ | Complex logic |
| auto-optimizer.ts | ⭐⭐⭐ | Side effects |
| dependency-analyzer.ts | ⭐⭐⭐ | External service deps |
| resource-analyzer.ts | ⭐⭐ | Many dependencies |
| report-exporter.ts | ⭐⭐⭐ | Simple delegation |
| health-analyzer.ts | ⭐⭐ | Many dependencies |
| index.ts | ⭐ | Integration layer |

## Recommended Testing Strategy

### Unit Tests (Isolated)
```
utils.ts
duplicate-detector.ts
reference-validator.ts
unused-resource-detector.ts
complexity-analyzer.ts
coverage-analyzer.ts
storage-analyzer.ts
suggestion-generator.ts
```

### Integration Tests (Module Groups)
```
resource-analyzer.ts + (duplicate, reference, unused detectors)
health-analyzer.ts + (all analyzers)
auto-optimizer.ts + (unused detector)
```

### E2E Tests (Full System)
```
index.ts (complete service)
report-exporter.ts (end-to-end flow)
```

## Performance Characteristics

| Module | Time Complexity | Space Complexity | Notes |
|--------|----------------|------------------|-------|
| calculateStringSimilarity | O(n*m) | O(n*m) | n,m = string lengths |
| findDuplicates | O(n²) | O(n) | n = number of resources |
| analyzeResources | O(n) | O(n) | Linear scan |
| validateReferences | O(n*m) | O(n+m) | n resources, m references |
| calculateHealth | O(n) | O(n) | Aggregation |

## Conclusion

The refactoring successfully decomposed a 2,880-line monolith into 15 focused modules:
- **3 large** modules (400+ lines) for infrastructure
- **4 medium** modules (150-400 lines) for core analysis
- **5 small** modules (50-150 lines) for focused utilities
- **3 tiny** modules (<50 lines) for minimal functionality

Each module has a clear, single responsibility and well-defined boundaries.
