# N+1 Query Optimization Fixes

## Overview

This document identifies N+1 query problems in the qontinui-web backend and provides optimized solutions. N+1 queries occur when code executes 1 query to fetch a list of records, then N additional queries to fetch related data for each record.

**Impact:**
- Slow API response times (proportional to number of records)
- Increased database load
- Higher AWS RDS costs due to increased I/O

**Solution:**
- Use SQLAlchemy's `selectinload()` or `joinedload()` for eager loading
- Use subqueries with aggregations for counts
- Consolidate multiple queries into a single query with joins

---

## 1. Critical: Automation Session List (automation.py:42-163)

### Current Problem

```python
# Lines 129-156: N+1 query problem
for session in sessions:
    # Query 1 per session for log count
    log_count_query = select(func.count()).where(AutomationLog.session_id == session.id)
    log_count_result = await db.execute(log_count_query)
    log_count = log_count_result.scalar_one()

    # Query 2 per session for screenshot count
    screenshot_count_query = select(func.count()).where(AutomationScreenshot.session_id == session.id)
    screenshot_count_result = await db.execute(screenshot_count_query)
    screenshot_count = screenshot_count_result.scalar_one()
```

**Queries executed:** 1 + (2 × N) where N = number of sessions
- For 50 sessions: 101 queries
- For 100 sessions: 201 queries

### Optimized Solution

Replace the loop with a single query using LEFT JOIN and GROUP BY:

```python
from sqlalchemy import case

# Build query with counts using subqueries
log_counts_subquery = (
    select(
        AutomationLog.session_id,
        func.count(AutomationLog.id).label("log_count")
    )
    .group_by(AutomationLog.session_id)
    .subquery()
)

screenshot_counts_subquery = (
    select(
        AutomationScreenshot.session_id,
        func.count(AutomationScreenshot.id).label("screenshot_count")
    )
    .group_by(AutomationScreenshot.session_id)
    .subquery()
)

# Main query with LEFT JOINs to include sessions with 0 logs/screenshots
query = (
    select(
        AutomationSession,
        func.coalesce(log_counts_subquery.c.log_count, 0).label("log_count"),
        func.coalesce(screenshot_counts_subquery.c.screenshot_count, 0).label("screenshot_count")
    )
    .outerjoin(log_counts_subquery, AutomationSession.id == log_counts_subquery.c.session_id)
    .outerjoin(screenshot_counts_subquery, AutomationSession.id == screenshot_counts_subquery.c.session_id)
    .where(
        or_(
            AutomationSession.project_id.in_(accessible_project_ids),
            and_(
                AutomationSession.project_id.is_(None),
                AutomationSession.user_id == current_user.id,
            ),
        )
    )
)

# Apply filters
if status:
    query = query.where(AutomationSession.status == status)
if start_date:
    query = query.where(AutomationSession.created_at >= start_date)
if end_date:
    query = query.where(AutomationSession.created_at <= end_date)

# Get total count
count_query = select(func.count()).select_from(query.subquery())
count_result = await db.execute(count_query)
total = count_result.scalar_one()

# Apply pagination
query = query.order_by(AutomationSession.created_at.desc())
query = query.offset(skip).limit(limit)

# Execute query
result = await db.execute(query)
rows = result.all()

# Build response
sessions_with_stats = []
for row in rows:
    session = row[0]  # AutomationSession object
    log_count = row[1]  # log_count from subquery
    screenshot_count = row[2]  # screenshot_count from subquery

    session_data = AutomationSessionWithStats(
        id=session.id,
        project_id=session.project_id,
        runner_version=session.runner_version,
        runner_os=session.runner_os,
        runner_hostname=session.runner_hostname,
        status=session.status,
        configuration_snapshot=session.configuration_snapshot,
        created_at=session.created_at,
        ended_at=session.ended_at,
        log_count=log_count,
        screenshot_count=screenshot_count,
    )
    sessions_with_stats.append(session_data)
```

**Queries executed:** 1 (single query with JOINs)
**Performance improvement:** ~99% reduction in queries for large result sets

---

## 2. Permission Service - User Accessible Projects (permission_service.py:260-359)

### Current Implementation (Already Optimized!)

✅ The `get_user_accessible_projects` method already uses efficient joins and is NOT an N+1 problem:

```python
# Lines 307-337: Efficient single query with joins
shared_result = await db.execute(
    select(Project)
    .join(ProjectAccessControl, ProjectAccessControl.project_id == Project.id)
    .outerjoin(
        TeamMember,
        and_(
            TeamMember.organization_id == ProjectAccessControl.organization_id,
            TeamMember.user_id == user_id,
        ),
    )
    .where(...)
    .distinct()
)
```

**No changes needed** - this is already optimized.

### Potential Improvement: Eager Load Relationships

If the API endpoints accessing projects also access related data (e.g., `project.owner.email`, `project.organization.name`), add eager loading:

```python
# Add to permission_service.py:291
owned_result = await db.execute(
    select(Project)
    .options(
        selectinload(Project.owner),
        selectinload(Project.organization),
    )
    .where(Project.owner_id == user_id)
)

# Add to permission_service.py:307
shared_result = await db.execute(
    select(Project)
    .options(
        selectinload(Project.owner),
        selectinload(Project.organization),
    )
    .join(ProjectAccessControl, ProjectAccessControl.project_id == Project.id)
    ...
)
```

**Only add this if endpoints access these relationships.** Otherwise, it's unnecessary overhead.

---

## 3. Annotations with Screenshots (annotations.py)

### Check for N+1 Pattern

Search for patterns like:
```python
annotations = db.query(Annotation).all()
for annotation in annotations:
    screenshot = annotation.screenshot  # Lazy load - causes N+1
```

### Optimized Solution

Use eager loading:
```python
from sqlalchemy.orm import selectinload

annotations = await db.execute(
    select(Annotation)
    .options(
        selectinload(Annotation.screenshot),
        selectinload(Annotation.user),  # if accessed
    )
    .where(...)
)
```

---

## 4. Analysis Results with Regions (analysis.py, region_analysis.py)

### Check for N+1 Pattern

```python
analysis_results = db.query(AnalysisResult).all()
for result in analysis_results:
    regions = result.regions  # Lazy load - causes N+1
```

### Optimized Solution

Use eager loading:
```python
analysis_results = await db.execute(
    select(AnalysisResult)
    .options(
        selectinload(AnalysisResult.regions),
        selectinload(AnalysisResult.screenshot),
    )
    .where(...)
)
```

---

## 5. Organizations with Members (organizations.py)

### Check for N+1 Pattern

```python
organizations = db.query(Organization).all()
for org in organizations:
    members = org.members  # Lazy load - causes N+1
```

### Optimized Solution

Use eager loading:
```python
organizations = await db.execute(
    select(Organization)
    .options(
        selectinload(Organization.members)
        .selectinload(TeamMember.user),  # Nested eager loading
        selectinload(Organization.projects),
    )
    .where(...)
)
```

---

## Eager Loading Strategies

### When to Use `selectinload()` (Recommended)

- **One-to-many** relationships (e.g., Project → Screenshots)
- **Many-to-many** relationships
- When you need **all** related objects

```python
# Loads all screenshots for each project in separate query
.options(selectinload(Project.screenshots))
```

**Queries executed:** 2
1. SELECT * FROM projects WHERE ...
2. SELECT * FROM screenshots WHERE project_id IN (1, 2, 3, ...)

### When to Use `joinedload()`

- **Many-to-one** relationships (e.g., Project → User)
- When you always need the related object
- Single object relationships

```python
# Loads user via LEFT JOIN in single query
.options(joinedload(Project.owner))
```

**Queries executed:** 1
1. SELECT projects.*, users.* FROM projects LEFT JOIN users ON ...

**⚠️ Warning:** `joinedload()` can create duplicate rows for one-to-many relationships. Use `selectinload()` instead.

### Nested Eager Loading

```python
# Load projects → screenshots → annotations (3 levels deep)
projects = await db.execute(
    select(Project)
    .options(
        selectinload(Project.screenshots)
        .selectinload(Screenshot.annotations)
    )
)
```

---

## Testing for N+1 Queries

### 1. Enable SQL Logging

Add to `app/core/config.py`:

```python
import logging
logging.basicConfig()
logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO)
```

### 2. Count Queries

```python
from app.middleware.database_timing import DatabaseTimingMiddleware

# Already implemented! Check response headers:
# X-Database-Query-Count: 5
# X-Database-Query-Time: 0.245
```

### 3. Use pytest with Query Counter

```python
import pytest
from app.tests.utils.query_counter import QueryCounter

def test_list_sessions_no_n_plus_1(db_session):
    counter = QueryCounter(db_session)

    with counter:
        response = client.get("/api/v1/automation/sessions?limit=50")

    # Should be <= 3 queries (count + sessions + related data)
    assert counter.count <= 3, f"Too many queries: {counter.count}"
```

---

## Implementation Checklist

- [x] ✅ Identify N+1 query in `list_automation_sessions` (automation.py:129-156)
- [ ] 🔧 Fix automation sessions list query with subquery joins
- [ ] 🔍 Audit `annotations.py` for N+1 queries
- [ ] 🔍 Audit `analysis.py` for N+1 queries
- [ ] 🔍 Audit `region_analysis.py` for N+1 queries
- [ ] 🔍 Audit `organizations.py` for N+1 queries
- [ ] ✅ Add eager loading to projects if needed
- [ ] 🧪 Test with SQL logging enabled
- [ ] 📊 Monitor `X-Database-Query-Count` headers

---

## Performance Impact Estimates

| Endpoint | Before | After | Improvement |
|----------|--------|-------|-------------|
| `GET /automation/sessions?limit=50` | 101 queries | 1 query | 99% ↓ |
| `GET /automation/sessions?limit=100` | 201 queries | 1 query | 99.5% ↓ |
| `GET /projects` (with 20 projects) | 1 query | 1 query | ✅ Already optimized |

**Estimated API response time improvement:**
- Local dev: 200ms → 50ms (75% faster)
- Production (AWS RDS): 500ms → 100ms (80% faster)

---

## File Locations

- **automation.py**: `/backend/app/api/v1/endpoints/automation.py`
- **permission_service.py**: `/backend/app/services/permission_service.py`
- **annotations.py**: `/backend/app/api/v1/endpoints/annotations.py`
- **analysis.py**: `/backend/app/api/v1/endpoints/analysis.py`
- **organizations.py**: `/backend/app/api/v1/endpoints/organizations.py`

---

## References

- SQLAlchemy Eager Loading: https://docs.sqlalchemy.org/en/20/orm/queryguide/relationships.html
- N+1 Query Problem: https://stackoverflow.com/questions/97197/what-is-the-n1-selects-problem
- Database Timing Middleware: `/backend/app/middleware/DATABASE_TIMING_README.md`
