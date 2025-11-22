# Migration Tree Analysis

## Current State: 6 Heads (Problems!)

Your migration tree has become a complex branching structure with 6 active heads. Here's what happened:

```
c1464319e0e2 (initial_schema_with_uuid)
    ├─ 9d66b0c555d3 (fix_subscription_user_id_type)
    │   └─ 63e5da6dd826 (merge_migration_branches) ← First merge
    │       ├─ a1b2c3d4e5f6 (add_organization_and_team_management)
    │       │   ├─ 08e4e8448e57
    │       │   │   └─ b1c2d3e4f5g6
    │       │   │       └─ d703626068d7 (HEAD 3) ← merge_migrations
    │       │   └─ e1f2g3h4i5j6 (HEAD 4) ← merge_automation_and_recording
    │       ├─ z9fc6936875 (HEAD 6) ← add_organization_and_team_management
    │       └─ 67c33a12bedb (add_automation_tables_and_input_events)
    │           ├─ 4e5f6a7b8c9d
    │           │   ├─ (goes to d703626068d7)
    │           │   └─ (goes to e1f2g3h4i5j6)
    │           └─ e45f9b2c3d1a (snapshot tables)
    │               └─ collaboration_001 (collaboration tables)
    │                   ├─ 3dc9c2bf5574 (HEAD 1) ← add_automation_streaming_fields
    │                   └─ f9593625b747 (HEAD 2) ← Add automation tables
    └─ 6a54cc0f9180 (add_session_activity_table)
        └─ 7b3c9d1e2f4a
            └─ 8d5f2a3c1b9e
                └─ 93687f70383c
                    ├─ 8727d5cd01ba
                    │   └─ (goes to 63e5da6dd826)
                    └─ d42d46b1738d (HEAD 5) ← Add annotation tables
```

## Root Causes

### 1. **Multiple Feature Branches Created Simultaneously**
The tree shows at least 5-6 different feature branches being developed in parallel:
- Organization/team management
- Automation features
- Collaboration features
- Annotation features
- Subscription fixes
- Session tracking

### 2. **Incomplete Merge Migrations**
You have merge migrations (`63e5da6dd826`, `d703626068d7`, `e1f2g3h4i5j6`) but they don't merge ALL branches. After creating a merge, new branches were created, leading to more heads.

### 3. **Duplicate Migrations**
Looking at the names, you have:
- `a1b2c3d4e5f6` - "add_organization_and_team_management"
- `z9fc6936875` - ALSO "add_organization_and_team_management"

This suggests the same migration was created twice on different branches.

### 4. **The "Overlap" Error**
The error "f9593625b747 overlaps with 67c33a12bedb" occurs because:
- `67c33a12bedb` is an ANCESTOR of `f9593625b747` (through e45f9b2c3d1a → collaboration_001)
- But they're both being treated as separate upgrade targets
- This creates a circular dependency

## What Went Wrong: Timeline Reconstruction

1. **Day 1**: Initial schema created (`c1464319e0e2`)
2. **Day 2-5**: Two developers work on different features:
   - Dev A: Session tracking (6a54cc0f9180 → ... → 93687f70383c)
   - Dev B: Subscription fixes (9d66b0c555d3)
3. **Day 6**: First merge attempt (`63e5da6dd826`) merges these two branches
4. **Day 7-10**: Multiple new features started WITHOUT pulling the merge:
   - Organization management (created TWICE!)
   - Automation features
   - Collaboration features
   - Annotations
5. **Day 11+**: More merge attempts, but incomplete, leading to current mess

---

## How to Prevent This in Production

### ✅ Best Practices

#### 1. **Linear Migration History (Ideal)**
```
migration_001 → migration_002 → migration_003 → migration_004
```

**How to maintain:**
- Always `git pull` before creating new migrations
- Run `alembic heads` - should show ONLY ONE head
- If multiple heads exist, create merge migration IMMEDIATELY
- Never create new migrations when multiple heads exist

#### 2. **Branch-Based Workflow (If Linear Not Possible)**

```bash
# Before creating a migration:
git checkout main
git pull origin main
alembic heads  # Should show 1 head!

# Create your feature branch
git checkout -b feature/my-feature

# Create migration
alembic revision --autogenerate -m "add_my_feature"

# BEFORE merging to main:
git checkout main
git pull origin main
git checkout feature/my-feature
git merge main  # Get latest migrations

# If conflicts in migrations:
alembic heads  # Check for multiple heads
# If multiple heads exist:
alembic merge heads -m "merge_main_and_my_feature"

# Test the migration path
alembic upgrade head

# Then merge to main
```

#### 3. **Migration Naming Convention**
Use timestamps or sequential numbers:
```
20251118_120000_add_user_table.py
20251118_130000_add_project_table.py
```

This makes the order explicit.

#### 4. **Pre-Merge Checklist**
Before merging any branch:
- [ ] Run `alembic heads` - must show exactly 1 head
- [ ] Run `alembic upgrade head` on a test database
- [ ] Run `alembic downgrade -1` and `alembic upgrade head` (test reversibility)
- [ ] Check that no other branches have new migrations (coordinate with team)

### ⚠️ Production Migration Safety

#### Before Running in Production:

1. **Test on Staging Database**
   ```bash
   # Export production DB to staging
   pg_dump production_db > staging_backup.sql
   psql staging_db < staging_backup.sql

   # Test migrations on staging
   alembic upgrade head

   # Verify data integrity
   # Run your application tests
   ```

2. **Backup Production Database**
   ```bash
   pg_dump production_db > backup_$(date +%Y%m%d_%H%M%S).sql
   ```

3. **Create Rollback Plan**
   ```bash
   # Know your current version
   alembic current

   # Plan: If migration fails, rollback to current
   alembic downgrade <current_version>
   ```

4. **Run Migration with Safeguards**
   ```bash
   # Set a statement timeout (migrations shouldn't take hours)
   psql production_db -c "SET statement_timeout = '10min';"

   # Run migration
   alembic upgrade head

   # Verify
   alembic current
   ```

5. **Monitor During Migration**
   - Watch for locks (migrations can lock tables)
   - Monitor application errors
   - Have rollback ready

#### Handling Migrations with User Data

```python
# Example migration with data preservation
def upgrade():
    # 1. Add new column as nullable first
    op.add_column('users', sa.Column('new_field', sa.String(), nullable=True))

    # 2. Populate data for existing rows
    connection = op.get_bind()
    connection.execute(
        text("UPDATE users SET new_field = 'default_value' WHERE new_field IS NULL")
    )

    # 3. Make column non-nullable after data is populated
    op.alter_column('users', 'new_field', nullable=False)

def downgrade():
    # Always implement downgrade for production!
    op.drop_column('users', 'new_field')
```

### 🔧 Migration Best Practices Summary

| ✅ DO | ❌ DON'T |
|-------|----------|
| Pull latest before creating migrations | Create migrations on stale branches |
| Check `alembic heads` shows 1 head | Ignore multiple heads |
| Create merge migrations immediately | Let branches diverge |
| Test migrations on staging | Run untested migrations in prod |
| Implement `downgrade()` functions | Leave downgrade empty |
| Use transactions for data migrations | Modify data outside transactions |
| Back up before production migrations | Trust that it "should work" |
| Coordinate with team on migrations | Create migrations independently |
| Use `--autogenerate` to detect changes | Write migrations manually (error-prone) |
| Version control migration files | Generate migrations locally only |

### 📋 Team Workflow

```bash
# Team Migration Protocol

# 1. Designate a "Migration Coordinator" for each sprint
#    Only this person creates merge migrations

# 2. Before creating any migration:
git pull origin main
alembic heads  # Must be 1 head

# 3. Create migration
alembic revision --autogenerate -m "descriptive_name"

# 4. Review migration file manually
#    - Check it does what you expect
#    - Add data migrations if needed
#    - Implement downgrade()

# 5. Before pushing:
alembic upgrade head  # Test locally
alembic current       # Verify

# 6. Communicate in team chat:
"🚨 New migration: add_user_profile_table - please pull and upgrade"

# 7. If someone else pushed a migration while you were working:
git pull origin main
alembic heads  # If shows 2 heads:
alembic merge heads -m "merge_feature_x_and_y"
```

---

## Fixing Your Current Situation

### Option 1: Clean Slate (Recommended for Development)
Since you're in development and can recreate data:

1. Delete all migration files EXCEPT `c1464319e0e2_initial_schema_with_uuid.py`
2. Drop and recreate database
3. Update all models to current state
4. Create ONE comprehensive migration:
   ```bash
   alembic revision --autogenerate -m "complete_schema_v2"
   ```
5. Test thoroughly
6. This becomes your new baseline

### Option 2: Create Final Merge Migration
Create a migration that depends on ALL 6 heads and merges them:

```python
# This is complex and error-prone
revision = 'final_merge'
down_revision = ('3dc9c2bf5574', 'd42d46b1738d', 'd703626068d7',
                 'e1f2g3h4i5j6', 'f9593625b747', 'z9fc6936875')
```

But this requires fixing the overlap issue first.

### Option 3: Import from Working Database
You mentioned migrations worked on another computer - use that database!

---

## Key Takeaway

**Migrations should be LINEAR in production.** Branches are fine during development, but must be merged BEFORE going to production. Think of migrations like Git commits - you want a clean history, not a tangled web.

**Golden Rule:** `alembic heads` should ALWAYS show exactly 1 head before deploying to production.
