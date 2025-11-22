# Database Query Timing Middleware

## Overview

The database timing middleware provides comprehensive query performance monitoring for the FastAPI backend. It tracks query execution time, logs slow queries, counts queries per request, and warns about potential N+1 query problems.

## Features

- **Query Timing**: Tracks execution time for all database queries
- **Slow Query Logging**: Automatically logs queries that exceed the configured threshold
- **Query Count Tracking**: Counts queries per request to detect N+1 problems
- **Request Statistics**: Provides per-request query statistics
- **Development Headers**: Adds query stats to response headers in development mode
- **SQLAlchemy Integration**: Uses SQLAlchemy event listeners for both sync and async engines

## Configuration

Add these settings to your `.env` file:

```bash
# Database query timing settings
SLOW_QUERY_THRESHOLD_MS=100        # Log queries slower than 100ms
ENABLE_QUERY_LOGGING=true          # Enable query logging (false in production)
MAX_QUERIES_PER_REQUEST=20         # Warn if more than 20 queries per request
```

### Configuration Options

| Setting | Default | Description |
|---------|---------|-------------|
| `SLOW_QUERY_THRESHOLD_MS` | 100 | Threshold in milliseconds for logging slow queries |
| `ENABLE_QUERY_LOGGING` | false | Enable/disable query logging (set to false in production for performance) |
| `MAX_QUERIES_PER_REQUEST` | 20 | Maximum queries per request before warning (N+1 detection) |

## Usage

### Enable Query Logging

To enable query logging during development:

```bash
# .env
ENABLE_QUERY_LOGGING=true
```

### Disable Query Logging (Production)

For production, disable query logging to avoid performance overhead:

```bash
# .env
ENABLE_QUERY_LOGGING=false
```

Note: The middleware is only registered when `ENABLE_QUERY_LOGGING=true`, so there's zero overhead in production.

## Log Output

### Request Query Statistics

For each request, the middleware logs query statistics:

```json
{
  "event": "request_query_stats",
  "request_id": "abc123",
  "path": "/api/v1/projects/",
  "method": "GET",
  "query_count": 5,
  "total_time_ms": 45.23,
  "avg_time_ms": 9.05,
  "slow_query_count": 1
}
```

### Slow Query Warning

When a query exceeds the threshold:

```json
{
  "event": "slow_query_async",
  "duration_ms": 156.78,
  "statement": "SELECT projects.* FROM projects WHERE user_id = $1 ORDER BY created_at DESC",
  "parameters": "{'user_id': 123}",
  "threshold_ms": 100
}
```

### Excessive Queries Warning

When a request executes too many queries (potential N+1 problem):

```json
{
  "event": "excessive_queries",
  "request_id": "abc123",
  "path": "/api/v1/projects/",
  "query_count": 45,
  "max_allowed": 20,
  "message": "Possible N+1 query problem"
}
```

## Development Features

### Response Headers

In development mode (`ENVIRONMENT=development`), the middleware adds query statistics to response headers:

```
X-Query-Count: 5
X-Query-Time-Ms: 45.23
```

You can inspect these in your browser's network tab or with curl:

```bash
curl -I http://localhost:8000/api/v1/projects/ \
  -H "Authorization: Bearer your-token"
```

## Architecture

### Event Listeners

The middleware uses SQLAlchemy event listeners to track query timing:

1. **before_cursor_execute**: Records query start time
2. **after_cursor_execute**: Calculates duration and logs if needed

### Dual Engine Support

The middleware supports both sync and async database engines:

- **Sync Engine**: Used by Alembic migrations and `init_db()`
- **Async Engine**: Used by FastAPI endpoints (asyncpg)

### Request Context

The middleware uses request-local storage to track query statistics per request:

```python
with track_request_queries(request_id):
    # All queries in this context are tracked
    stats = get_current_query_stats()
```

## Performance Impact

### Development

- Minimal overhead (~1-2% performance impact)
- Useful for identifying slow queries and N+1 problems
- Enable with `ENABLE_QUERY_LOGGING=true`

### Production

- Zero overhead when disabled (`ENABLE_QUERY_LOGGING=false`)
- Event listeners are still registered but only log slow queries
- No request statistics tracking
- No response headers

## Troubleshooting

### Slow Queries

If you see slow query warnings:

1. **Check Indexes**: Ensure proper indexes exist
2. **Optimize Query**: Use `EXPLAIN ANALYZE` to understand query plan
3. **Add Eager Loading**: Use `joinedload()` or `selectinload()` to avoid N+1
4. **Cache Results**: Consider caching frequently accessed data

Example of fixing N+1 with eager loading:

```python
# Bad: N+1 query problem
projects = session.query(Project).all()
for project in projects:
    print(project.owner.name)  # Triggers a query for each project

# Good: Eager loading
from sqlalchemy.orm import joinedload

projects = session.query(Project).options(
    joinedload(Project.owner)
).all()
for project in projects:
    print(project.owner.name)  # No additional queries
```

### Excessive Queries

If you see excessive query warnings:

1. **Identify N+1 Problems**: Look for loops that access relationships
2. **Use Eager Loading**: Load related objects in a single query
3. **Batch Operations**: Group multiple operations into fewer queries
4. **Review Relationships**: Check lazy vs eager loading settings

### Missing Statistics

If query statistics aren't appearing:

1. **Check Configuration**: Ensure `ENABLE_QUERY_LOGGING=true`
2. **Check Logs**: Look for `database_timing_middleware_enabled` log
3. **Check Path**: Excluded paths won't show statistics
4. **Restart Server**: Ensure latest configuration is loaded

## Excluded Paths

The following paths are excluded from query tracking to avoid noise:

- `/health`
- `/docs`
- `/redoc`
- `/openapi.json`
- `/favicon.ico`
- `/`

## Example Scenarios

### Scenario 1: Detecting Slow Queries

```bash
# Enable query logging
ENABLE_QUERY_LOGGING=true
SLOW_QUERY_THRESHOLD_MS=50

# Start server and make requests
# Check logs for slow_query_async warnings
```

### Scenario 2: Finding N+1 Problems

```bash
# Enable query logging with low threshold
ENABLE_QUERY_LOGGING=true
MAX_QUERIES_PER_REQUEST=10

# Make requests to endpoints with relationships
# Check logs for excessive_queries warnings
```

### Scenario 3: Production Monitoring

```bash
# Disable full logging but keep slow query detection
ENABLE_QUERY_LOGGING=false
SLOW_QUERY_THRESHOLD_MS=200

# Only slow queries will be logged
# No request statistics overhead
```

## Integration with Existing Middleware

The database timing middleware integrates seamlessly with existing middleware:

```python
# Middleware order (from main.py)
1. CORSMiddleware (executes first)
2. SecurityHeadersMiddleware
3. RequestIDMiddleware (adds X-Request-ID)
4. SlidingWindowSessionMiddleware
5. MetricsMiddleware
6. DatabaseTimingMiddleware (executes before request processing)
```

The request ID from `RequestIDMiddleware` is automatically used for tracking queries.

## Best Practices

1. **Development**: Enable query logging to catch performance issues early
2. **Staging**: Use moderate thresholds to test under realistic conditions
3. **Production**: Disable query logging or use high thresholds (200ms+)
4. **Monitoring**: Review logs regularly for slow queries and N+1 problems
5. **Optimization**: Fix issues before they reach production

## Related Files

- `/backend/app/middleware/database_timing.py` - Middleware implementation
- `/backend/app/core/config.py` - Configuration settings
- `/backend/app/main.py` - Middleware registration
- `/backend/app/db/session.py` - Database engine setup

## Further Reading

- [SQLAlchemy Events](https://docs.sqlalchemy.org/en/20/core/event.html)
- [FastAPI Middleware](https://fastapi.tiangolo.com/advanced/middleware/)
- [Structlog Documentation](https://www.structlog.org/)
- [N+1 Query Problem](https://stackoverflow.com/questions/97197/what-is-the-n1-selects-problem)
