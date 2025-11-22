-- Production Database Repair Script
-- ====================================
-- This script creates the annotation tables that are missing from production
-- due to incomplete migration path.
--
-- IMPORTANT: Run this BEFORE running 'alembic upgrade head'
--
-- Expected state:
--   - Current migration: 63e5da6dd826
--   - Missing tables: annotation_sets, annotations
--   - Existing table: analytics_events (should NOT be dropped)
--
-- This script is extracted from migration d42d46b1738d_add_annotation_tables.py
-- but DOES NOT drop analytics_events (keeping it for backward compatibility)

-- Start transaction for safety
BEGIN;

-- Check current state
SELECT 'Current alembic version:' as info;
SELECT version_num FROM alembic_version;

SELECT 'Existing tables before repair:' as info;
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Create annotation_sets table
-- This table stores sets of UI element annotations with screenshots
CREATE TABLE IF NOT EXISTS annotation_sets (
    id UUID NOT NULL,
    screenshot_name VARCHAR NOT NULL,
    screenshot_url VARCHAR NOT NULL,
    image_width INTEGER NOT NULL,
    image_height INTEGER NOT NULL,
    screenshots JSON,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    created_by_id UUID NOT NULL,
    notes TEXT,
    boundary_width INTEGER NOT NULL,
    CONSTRAINT annotation_sets_pkey PRIMARY KEY (id),
    CONSTRAINT annotation_sets_created_by_id_fkey FOREIGN KEY(created_by_id)
        REFERENCES users (id)
);

-- Create index on screenshot_name for efficient lookups
CREATE INDEX IF NOT EXISTS ix_annotation_sets_screenshot_name
    ON annotation_sets (screenshot_name);

-- Create annotations table
-- This table stores individual UI element annotations within an annotation set
CREATE TABLE IF NOT EXISTS annotations (
    id UUID NOT NULL,
    annotation_set_id UUID NOT NULL,
    screenshot_index INTEGER NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    label VARCHAR,
    description TEXT,
    reason TEXT,
    extra_data JSON,
    "order" INTEGER,
    CONSTRAINT annotations_pkey PRIMARY KEY (id),
    CONSTRAINT annotations_annotation_set_id_fkey FOREIGN KEY(annotation_set_id)
        REFERENCES annotation_sets (id) ON DELETE CASCADE
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS ix_annotations_screenshot_index
    ON annotations (screenshot_index);

CREATE INDEX IF NOT EXISTS ix_annotations_set_screenshot
    ON annotations (annotation_set_id, screenshot_index);

-- Verify tables were created
SELECT 'Tables created successfully:' as info;
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('annotation_sets', 'annotations')
ORDER BY tablename;

-- Verify foreign key constraints exist
SELECT 'Foreign key constraints:' as info;
SELECT
    tc.table_name,
    tc.constraint_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
AND tc.table_name IN ('annotation_sets', 'annotations')
ORDER BY tc.table_name;

-- Verify indexes were created
SELECT 'Indexes created:' as info;
SELECT
    indexname,
    tablename,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename IN ('annotation_sets', 'annotations')
ORDER BY tablename, indexname;

-- Final status check
SELECT 'Total tables in database:' as info;
SELECT COUNT(*) as total_tables
FROM pg_tables
WHERE schemaname = 'public';

SELECT '
========================================
REPAIR COMPLETE - READY FOR MIGRATION
========================================

Next steps:
1. Review the output above to verify tables were created
2. Commit this transaction by running: COMMIT;
3. Run alembic upgrade: poetry run alembic upgrade head

If anything looks wrong:
- Run: ROLLBACK;
- Do not proceed with alembic upgrade
- Review this script and the migration plan

' as next_steps;

-- IMPORTANT: Transaction is still open!
-- To commit: COMMIT;
-- To rollback: ROLLBACK;
