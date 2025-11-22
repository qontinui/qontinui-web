# Screenshot Table Consolidation Plan

## Current State Analysis

### Two Separate Screenshot Tables

#### 1. `screenshots` (Integration Testing)
**Purpose**: Store screenshots from snapshot runs (integration testing)
**Primary Key**: Integer
**Parent**: `snapshot_runs` table

**Schema**:
```python
class Screenshot(Base):
    __tablename__ = "screenshots"

    id: Integer (PK)
    snapshot_run_id: Integer (FK → snapshot_runs, CASCADE)
    screenshot_path: String(500)
    active_states: JSON list
    timestamp: DateTime
    width: Integer
    height: Integer
    state_hash: String(64) - for duplicate detection
    metadata: JSON
```

**Use Cases**:
- Integration testing screenshots
- State discovery workflow
- Pattern detection and matching
- Visual testing automation

#### 2. `automation_screenshots` (Runtime Automation)
**Purpose**: Store screenshots from live automation sessions
**Primary Key**: UUID
**Parent**: `automation_sessions` table

**Schema**:
```python
class AutomationScreenshot(Base):
    __tablename__ = "automation_screenshots"

    id: UUID (PK, server_default=gen_random_uuid())
    session_id: UUID (FK → automation_sessions, CASCADE)
    project_id: Integer (FK → projects, SET NULL) [NEWLY ADDED]
    name: String(255)
    storage_path: String(500)
    width: Integer
    height: Integer
    content_type: String(100)
    automation_metadata: JSON
    timestamp: DateTime
    presigned_url: String(2048) - temporary URL
    created_at: DateTime
```

**Use Cases**:
- Real-time automation execution monitoring
- Debugging automation runs
- Session timeline analysis
- Input event association (via screenshot_input_associations)

---

## Consolidation Strategy

### Option 1: Single Unified Table ⭐ **RECOMMENDED**

Merge both tables into a single `screenshots` table with a `source_type` discriminator.

**Benefits**:
- ✅ Single source of truth for all screenshots
- ✅ Unified API for querying screenshots
- ✅ Easier to implement cross-functional features (e.g., use automation screenshots in patterns)
- ✅ Simpler codebase (one model, one set of CRUD operations)
- ✅ Better for future features (e.g., comparison across sources)

**Drawbacks**:
- ⚠️ More complex schema (nullable fields for source-specific data)
- ⚠️ Requires data migration from both existing tables
- ⚠️ All existing code must be updated to use new table

#### Proposed Unified Schema

```python
class Screenshot(Base):
    """
    Unified screenshot storage for all sources.

    Supports:
    - Automation runtime screenshots (from runner)
    - Integration testing screenshots (from snapshot runs)
    - Manual user uploads (future)
    """

    __tablename__ = "screenshots"

    # Primary key (UUID for globally unique identifiers)
    id: UUID (PK, server_default=gen_random_uuid())

    # Source identification
    source_type: String(50) NOT NULL  # 'automation' | 'integration_test' | 'manual'

    # Parent associations (polymorphic - only one should be set)
    session_id: UUID (FK → automation_sessions, CASCADE) [nullable]
    snapshot_run_id: Integer (FK → snapshot_runs, CASCADE) [nullable]
    project_id: Integer (FK → projects, SET NULL) [nullable]

    # Screenshot identification
    name: String(255) NOT NULL
    storage_path: String(500) NOT NULL  # S3 key or local path

    # Image properties
    width: Integer NOT NULL
    height: Integer NOT NULL
    content_type: String(100) DEFAULT 'image/png'

    # Duplicate detection (nullable for automation screenshots)
    state_hash: String(64) [nullable, indexed]

    # Timestamps
    timestamp: DateTime(timezone=True) NOT NULL  # When captured
    created_at: DateTime(timezone=True) DEFAULT utcnow NOT NULL

    # Metadata storage (source-specific data)
    metadata: JSON NOT NULL DEFAULT {}

    # Integration test specific
    active_states: JSON [nullable] DEFAULT []

    # Automation specific
    presigned_url: String(2048) [nullable]

    # Indexes
    INDEX ix_screenshots_source_type (source_type)
    INDEX ix_screenshots_session_id (session_id)
    INDEX ix_screenshots_snapshot_run_id (snapshot_run_id)
    INDEX ix_screenshots_project_id (project_id)
    INDEX ix_screenshots_state_hash (state_hash)
    INDEX ix_screenshots_timestamp (timestamp)

    # Constraints
    CHECK (
        (source_type = 'automation' AND session_id IS NOT NULL) OR
        (source_type = 'integration_test' AND snapshot_run_id IS NOT NULL) OR
        (source_type = 'manual')
    )
```

#### Migration Steps

**Phase 1: Create New Table**
```sql
-- Create unified screenshots table
CREATE TABLE screenshots_unified (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type VARCHAR(50) NOT NULL,
    session_id UUID REFERENCES automation_sessions(id) ON DELETE CASCADE,
    snapshot_run_id INTEGER REFERENCES snapshot_runs(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    storage_path VARCHAR(500) NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    content_type VARCHAR(100) DEFAULT 'image/png',
    state_hash VARCHAR(64),
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    metadata JSONB DEFAULT '{}' NOT NULL,
    active_states JSONB,
    presigned_url VARCHAR(2048),

    -- Ensure only one parent association is set
    CONSTRAINT chk_screenshots_source_parent CHECK (
        (source_type = 'automation' AND session_id IS NOT NULL AND snapshot_run_id IS NULL) OR
        (source_type = 'integration_test' AND snapshot_run_id IS NOT NULL AND session_id IS NULL) OR
        (source_type = 'manual')
    )
);

-- Create indexes
CREATE INDEX ix_screenshots_unified_source_type ON screenshots_unified(source_type);
CREATE INDEX ix_screenshots_unified_session_id ON screenshots_unified(session_id);
CREATE INDEX ix_screenshots_unified_snapshot_run_id ON screenshots_unified(snapshot_run_id);
CREATE INDEX ix_screenshots_unified_project_id ON screenshots_unified(project_id);
CREATE INDEX ix_screenshots_unified_state_hash ON screenshots_unified(state_hash);
CREATE INDEX ix_screenshots_unified_timestamp ON screenshots_unified(timestamp);
```

**Phase 2: Migrate Data**
```sql
-- Migrate from automation_screenshots
INSERT INTO screenshots_unified (
    id, source_type, session_id, project_id, name, storage_path,
    width, height, content_type, timestamp, created_at, metadata, presigned_url
)
SELECT
    id,
    'automation' as source_type,
    session_id,
    project_id,
    name,
    storage_path,
    width,
    height,
    content_type,
    timestamp,
    created_at,
    automation_metadata as metadata,
    presigned_url
FROM automation_screenshots;

-- Migrate from screenshots (integration testing)
INSERT INTO screenshots_unified (
    id, source_type, snapshot_run_id, name, storage_path,
    width, height, content_type, state_hash, timestamp, created_at,
    metadata, active_states
)
SELECT
    gen_random_uuid() as id,  -- Generate new UUIDs
    'integration_test' as source_type,
    snapshot_run_id,
    COALESCE(screenshot_path, 'screenshot_' || id::text) as name,
    screenshot_path as storage_path,
    width,
    height,
    'image/png' as content_type,
    state_hash,
    timestamp,
    timestamp as created_at,  -- Use timestamp if created_at doesn't exist
    metadata,
    active_states
FROM screenshots;
```

**Phase 3: Update Foreign Keys**
```sql
-- Update screenshot_input_associations to reference new table
-- This requires mapping old UUIDs to new UUIDs (stored in migration log)
-- For now, we can keep the existing foreign key since UUIDs are preserved
-- from automation_screenshots

-- Verify data integrity
SELECT
    source_type,
    COUNT(*) as count,
    COUNT(DISTINCT session_id) as sessions,
    COUNT(DISTINCT snapshot_run_id) as snapshot_runs
FROM screenshots_unified
GROUP BY source_type;
```

**Phase 4: Rename Tables**
```sql
-- Backup old tables
ALTER TABLE screenshots RENAME TO screenshots_integration_backup;
ALTER TABLE automation_screenshots RENAME TO screenshots_automation_backup;

-- Promote unified table
ALTER TABLE screenshots_unified RENAME TO screenshots;

-- Update all indexes
-- (handled automatically by PostgreSQL)
```

**Phase 5: Update Code**
- Update `AutomationScreenshot` model → `Screenshot` model with source_type
- Update `Screenshot` model (old integration test) → merged into unified model
- Update all queries to filter by `source_type` where needed
- Update API endpoints to use unified model
- Update WebSocket handler for automation screenshots
- Update snapshot run endpoints

**Phase 6: Cleanup**
```sql
-- After verifying everything works (1-2 weeks)
DROP TABLE screenshots_integration_backup;
DROP TABLE screenshots_automation_backup;
```

---

### Option 2: Keep Separate, Add Views (Minimal Change)

Create database views to provide unified access while keeping tables separate.

**Benefits**:
- ✅ No data migration required
- ✅ Minimal code changes
- ✅ Lower risk of breaking existing functionality
- ✅ Easier rollback

**Drawbacks**:
- ❌ Still two sources of truth
- ❌ More complex to maintain long-term
- ❌ Cross-table queries still difficult
- ❌ Doesn't solve the fundamental duplication problem

#### Implementation

```sql
-- Create unified view
CREATE VIEW screenshots_unified AS
SELECT
    id::text as id,
    'automation' as source_type,
    session_id::text as parent_id,
    name,
    storage_path,
    width,
    height,
    content_type,
    NULL::varchar(64) as state_hash,
    timestamp,
    created_at,
    automation_metadata as metadata,
    NULL::jsonb as active_states,
    presigned_url,
    project_id
FROM automation_screenshots

UNION ALL

SELECT
    id::text as id,
    'integration_test' as source_type,
    snapshot_run_id::text as parent_id,
    screenshot_path as name,
    screenshot_path as storage_path,
    width,
    height,
    'image/png' as content_type,
    state_hash,
    timestamp,
    timestamp as created_at,
    metadata,
    active_states,
    NULL as presigned_url,
    NULL as project_id
FROM screenshots;
```

**Verdict**: ⚠️ Not recommended - postpones the problem, doesn't solve it.

---

## Recommendation

### Implement Option 1: Single Unified Table

**Timeline**: 2-3 sprints
- Sprint 1: Create migration, test with copy of production data
- Sprint 2: Update models and API endpoints
- Sprint 3: Update frontend, integration tests, deploy

**Risk Assessment**:
- **High Risk**: Data migration (mitigate with thorough testing and backups)
- **Medium Risk**: Code updates (mitigate with comprehensive test coverage)
- **Low Risk**: Performance (UUID vs Integer negligible for screenshot volume)

**Success Criteria**:
- ✅ All existing API endpoints work with unified table
- ✅ No data loss during migration
- ✅ Performance equal or better than current state
- ✅ All tests passing
- ✅ Can rollback to backup tables if needed

---

## Alternative: Keep Separate (Status Quo)

If consolidation is too risky or not worth the effort, keep tables separate but:

1. ✅ **Already Added**: `project_id` to `automation_screenshots` (enables cross-referencing)
2. Add helper functions for cross-table queries
3. Document the separation clearly in code comments
4. Add integration tests that verify both tables work correctly
5. Monitor for opportunities to consolidate in the future

**When to Keep Separate**:
- Limited development resources
- High risk tolerance is low
- Tables serve fundamentally different purposes long-term
- Performance is critical and UUID→Integer conversion is problematic

---

## Decision Required

**Question for Product/Engineering Lead**:

Should we consolidate the screenshot tables into a single unified table, or keep them separate with improved cross-referencing?

**Factors to Consider**:
1. How often do we need to query across both tables?
2. Are there plans for additional screenshot sources (e.g., manual uploads, API uploads)?
3. What is the current screenshot volume? (affects migration time)
4. How critical is this system? (affects acceptable downtime)
5. Do we have good backups and rollback procedures?

**My Recommendation**:
- **If** we expect to add more screenshot sources or frequently need cross-source queries → **Consolidate now**
- **If** the tables serve fundamentally different purposes and are rarely queried together → **Keep separate**

Given that we just added `project_id` to enable cross-referencing, and the use cases are starting to overlap (automation screenshots being used in patterns), I recommend **Option 1: Consolidate**.
