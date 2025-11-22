# Migration Workflow Guide: Managing Multiple Branches

## Yes, Multiple Branches with Migrations Caused Your Issues!

### What Happened: Your Scenario

```
Timeline of your work:

Week 1:
├─ main: migration_001 (initial schema)
│
├─ feature/organizations (you create migration_002_org)
│  └─ Based on: migration_001
│
├─ feature/automation (you create migration_003_auto)
│  └─ Based on: migration_001  ← SAME parent as organizations!
│
├─ feature/collaboration (you create migration_004_collab)
│  └─ Based on: migration_001  ← SAME parent again!
│
└─ feature/annotations (you create migration_005_annot)
   └─ Based on: migration_001  ← SAME parent again!

When you merge all branches:
main now has:
    migration_001
         ├─ migration_002_org
         ├─ migration_003_auto
         ├─ migration_004_collab
         └─ migration_005_annot
            └─ 4 HEADS! 🚨
```

This is exactly what created your complex migration tree.

---

## Why This Happens

### The Core Issue

**Migrations are DATABASE SCHEMA changes, not code changes.**

When you work on multiple branches:
- **Code changes** can be merged easily (Git handles conflicts)
- **Migration changes** create PERMANENT DIVERGENT PATHS in your database

### Example with Real Scenario

```python
# Branch A: feature/add-users
# Creates: migration_002_add_users.py
revision = '002'
down_revision = '001'  # Parent

def upgrade():
    op.create_table('users', ...)

# Branch B: feature/add-projects
# Creates: migration_003_add_projects.py
revision = '003'
down_revision = '001'  # SAME parent as Branch A!

def upgrade():
    op.create_table('projects', ...)
```

**Problem:** Both migrations think they come DIRECTLY after `001`. But they were developed in parallel!

When you merge:
```
001
 ├─ 002 (users)
 └─ 003 (projects)

Alembic asks: "To get to the latest state, do I apply 002 or 003?"
Answer: BOTH! But in what order?
Result: Multiple heads!
```

---

## Solutions: How to Work with Multiple Branches

You have **3 options**, depending on your workflow:

### ✅ Option 1: Avoid Migrations in Feature Branches (Recommended for Teams)

**Strategy:** Only create migrations on `main` branch

```bash
# Workflow:
1. Work on feature/organizations branch
   - Write code (models, services, routes)
   - DON'T create migrations yet
   - Commit code changes

2. Merge feature to main (no migrations yet)

3. On main branch, create migration AFTER merge
   git checkout main
   git merge feature/organizations
   alembic revision --autogenerate -m "add_organizations"
   git add alembic/versions/*
   git commit -m "Add organizations migration"

4. Repeat for each feature
```

**Pros:**
- ✅ Always linear migration history
- ✅ No merge conflicts
- ✅ Safe for production

**Cons:**
- ❌ Can't test with real database in feature branch
- ❌ Must create migrations separately

**Best for:** Teams, production systems, when safety is critical

---

### ✅ Option 2: Create Migrations in Branches, But Rebase Before Merge (Advanced)

**Strategy:** Create migrations in feature branches, but rebase to make them sequential

```bash
# Day 1: On feature/organizations
git checkout -b feature/organizations
# Make code changes
alembic revision --autogenerate -m "add_organizations"
# Commit

# Day 2: On feature/automation
git checkout main
git checkout -b feature/automation
# Make code changes
alembic revision --autogenerate -m "add_automation"
# Commit

# Day 3: Time to merge
# Merge organizations first (no conflicts)
git checkout main
git merge feature/organizations  # migration_002_org now on main

# Rebase automation on top of organizations
git checkout feature/automation
git rebase main  # This will have conflicts!

# Fix the migration file:
# In migration_003_automation.py, change:
# FROM: down_revision = '001'
# TO:   down_revision = '002_org'  # Point to organizations migration

# Also need to delete and recreate migration:
rm alembic/versions/*automation.py
alembic revision --autogenerate -m "add_automation"
# This creates NEW migration based on CURRENT state
# Which includes organizations migration

git add .
git rebase --continue

# Now merge
git checkout main
git merge feature/automation  # Clean merge, sequential migrations!
```

**Pros:**
- ✅ Can test with database in feature branches
- ✅ Ends up with linear history

**Cons:**
- ❌ Requires rebasing (advanced Git)
- ❌ Must manually fix migration dependencies
- ❌ Can mess up if done wrong

**Best for:** Solo developers or small teams with Git expertise

---

### ✅ Option 3: Create Merge Migrations (What You Did, But Better)

**Strategy:** Allow branches, but merge them properly BEFORE creating more branches

```bash
# Create feature branches with migrations
feature/organizations → migration_002_org (parent: 001)
feature/automation    → migration_003_auto (parent: 001)

# BEFORE creating more branches, merge these:
git checkout main
git merge feature/organizations
git merge feature/automation

# Check migration state
alembic heads  # Shows 2 heads: 002_org, 003_auto

# IMMEDIATELY create merge migration
alembic merge heads -m "merge_org_and_automation"
# This creates: migration_004_merge
# down_revision = ('002_org', '003_auto')

# Test it works
alembic upgrade head

# Verify
alembic heads  # Should show ONLY 1 head: 004_merge

# NOW you can create new feature branches
# All new migrations will have parent: 004_merge
```

**The KEY RULE:**
🚨 **NEVER create a new migration when `alembic heads` shows multiple heads!**

**Pros:**
- ✅ Flexible workflow
- ✅ Can test in feature branches

**Cons:**
- ❌ Requires discipline
- ❌ Can still create complex tree if you forget to merge

**Best for:** When you must work on multiple branches, but need database testing

---

## Your Specific Situation: What Went Wrong

Looking at your migration tree, here's what happened:

```bash
# You had this:
main (migration_001)

# You created multiple branches:
feature/org1    → migration_002_org     (parent: 001)
feature/org2    → migration_003_org_v2  (parent: 001) # DUPLICATE!
feature/auto1   → migration_004_auto    (parent: 001)
feature/auto2   → migration_005_auto_v2 (parent: 001)
feature/collab  → migration_006_collab  (parent: 001)
feature/annot   → migration_007_annot   (parent: 001)

# You tried to merge with merge migrations:
merge_001 → merges (002, 003) into 008
merge_002 → merges (004, 005) into 009

# BUT then you created MORE branches from the old state!
# So you ended up with:
008 (merge)
 ├─ 010 (new feature from 008)
 └─ 011 (new feature from 008)

009 (merge)
 ├─ 012 (new feature from 009)
 └─ 013 (new feature from 009)

# AND the old unmarged branches:
006 (collab) ← Still unmerged!
007 (annot)  ← Still unmerged!

Result: 6 heads!
```

**What you should have done:**

```bash
# Step 1: Merge ALL branches at once
git checkout main
for branch in org1 org2 auto1 auto2 collab annot; do
    git merge feature/$branch
done

# Step 2: Check heads
alembic heads  # Shows 6 heads

# Step 3: Create ONE mega-merge
alembic merge heads -m "merge_all_features"

# Step 4: Test
alembic upgrade head

# Step 5: Verify
alembic heads  # Should show 1 head

# Step 6: ONLY NOW create new branches
```

---

## Recommended Workflow for You Going Forward

### For Solo Development (You Working Alone)

**Approach: Option 1 (No Migrations in Branches)**

```bash
# Daily workflow:
1. git checkout -b feature/my-feature
2. Write code (models, services, etc.)
3. DON'T create migrations yet
4. git commit -am "Add feature code"

5. git checkout main
6. git merge feature/my-feature

7. alembic revision --autogenerate -m "add_feature_schema"
8. git add alembic/versions/*
9. git commit -m "Add migration for feature"

# Always verify:
alembic heads  # Should show 1 head
```

**When you MUST have migrations in branches (for testing):**

```bash
# Create branch and migration
git checkout -b feature/my-feature
# ... code changes ...
alembic revision --autogenerate -m "add_feature"
git commit -am "Add feature with migration"

# BEFORE merging: check if main has new migrations
git checkout main
git pull
alembic current  # Note the current head

git checkout feature/my-feature
git rebase main

# If there are new migrations on main:
# Delete your migration and recreate it
rm alembic/versions/*my_feature*.py
alembic revision --autogenerate -m "add_feature"
git add .
git rebase --continue

# Now merge
git checkout main
git merge feature/my-feature

# Verify
alembic heads  # Should be 1
```

---

## Quick Reference: Pre-Merge Checklist

Before merging ANY branch with migrations:

```bash
# 1. Check current state
git checkout main
git pull
alembic heads  # Note number of heads

# 2. Merge your branch
git merge feature/your-branch

# 3. Check heads again
alembic heads

# 4. If multiple heads:
alembic merge heads -m "merge_your_branch_and_main"
alembic upgrade head  # Test the merge

# 5. Verify clean state
alembic heads  # MUST show 1 head

# 6. Push
git push origin main
```

---

## Key Principles

### The Golden Rules

1. **Check heads before creating migrations**
   ```bash
   alembic heads  # If > 1, create merge migration FIRST
   ```

2. **Never create a migration when multiple heads exist**
   - First merge the heads
   - Then create your migration

3. **Coordinate with your team**
   - If someone else is creating migrations, wait
   - Or use Option 1 (migrations only on main)

4. **Test migration paths locally**
   ```bash
   alembic upgrade head
   alembic current
   alembic downgrade -1  # Test reversibility
   alembic upgrade head
   ```

5. **Production deploys must have 1 head**
   ```bash
   # Before deploying:
   alembic heads  # MUST show exactly 1 head
   ```

---

## Summary: Should You Avoid Working on Multiple Branches?

### Answer: **No, you can work on multiple branches!**

**BUT you must:**

1. **Either:** Don't create migrations in feature branches (Option 1)
2. **Or:** Create merge migrations IMMEDIATELY when branches are merged (Option 3)
3. **Or:** Rebase and fix migration dependencies (Option 2)

### What you should NEVER do:

❌ Create migrations in multiple branches without merging them
❌ Ignore multiple heads
❌ Create new migrations when multiple heads exist
❌ Merge branches with migrations without checking `alembic heads`

### What you ALWAYS do:

✅ Run `alembic heads` before creating migrations
✅ If multiple heads exist, create merge migration FIRST
✅ Test migrations locally before pushing
✅ Ensure `alembic heads` shows 1 head before production deploy

---

## Your Next Steps

1. **Fix current situation:** Import database from working computer
2. **Going forward:** Use Option 1 (no migrations in branches) for simplicity
3. **Before production:** Always verify `alembic heads` shows 1 head
4. **Document your workflow:** Share this with your team if you have one

The complexity you experienced is a **one-time learning experience**. With proper workflow, migrations are manageable even with multiple branches!
