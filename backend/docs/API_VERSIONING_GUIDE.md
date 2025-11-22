# API Versioning and Documentation Enhancement Guide

## Overview

This guide documents the API versioning strategy and enhanced documentation implemented for the Qontinui backend API.

## API Versioning Middleware

### Location
`/backend/app/middleware/api_version.py`

### Features

The API versioning middleware provides:

1. **Version Header Reading**: Reads `Accept-Version` header from incoming requests
2. **Version Normalization**: Normalizes version formats (supports both "v1" and "1" formats)
3. **Version Validation**: Validates requested versions against supported versions
4. **Default Versioning**: Falls back to "v1" if no version is specified
5. **Request State Storage**: Stores version in `request.state.api_version` for endpoint access
6. **Response Headers**: Adds `API-Version` header to responses

### Usage

#### In Middleware Configuration (main.py)

```python
from app.middleware.api_version import APIVersionMiddleware

app.add_middleware(APIVersionMiddleware)
```

#### In Endpoints

```python
from fastapi import Request

@router.get("/data")
async def get_data(request: Request):
    version = request.state.api_version  # Access current API version
    if version == "v1":
        # Handle v1 logic
        pass
    elif version == "v2":
        # Handle v2 logic
        pass
```

### Configuration

Supported versions are defined in the middleware:

```python
SUPPORTED_VERSIONS = ["v1", "v2"]  # Add new versions as released
DEFAULT_VERSION = "v1"
```

## Deprecation Helper

### Location
`/backend/app/core/deprecation.py`

### Features

Provides utilities for marking endpoints as deprecated:

1. **Standard Headers**: Implements RFC 8594 (Sunset Header) and HTTP API Deprecation standards
2. **Deprecation Warnings**: Adds human-readable warnings
3. **Successor Links**: Points clients to replacement endpoints
4. **Version Tracking**: Tracks deprecated versions and their sunset dates

### Usage

#### Manual Deprecation Headers

```python
from fastapi import Response
from app.core.deprecation import add_deprecation_headers

@router.get("/api/v1/old-endpoint")
async def old_endpoint(response: Response):
    add_deprecation_headers(
        response,
        sunset_date="2025-12-31",
        successor="/api/v2/new-endpoint"
    )
    return {"data": "..."}
```

#### Automatic Version Deprecation

```python
from app.core.deprecation import auto_add_deprecation_if_needed

@router.get("/data")
async def get_data(request: Request, response: Response):
    auto_add_deprecation_if_needed(response, request.state.api_version)
    return {"data": "..."}
```

#### Check Version Deprecation Status

```python
from app.core.deprecation import is_version_deprecated, get_successor_version

is_deprecated, sunset_date = is_version_deprecated("v1")
if is_deprecated:
    successor = get_successor_version("v1")
    print(f"Version v1 will sunset on {sunset_date}, migrate to {successor}")
```

### Response Headers Added

- `Deprecation: true` - Boolean flag indicating deprecation
- `Sunset: 2025-12-31` - ISO 8601 date when endpoint will be removed
- `Link: </api/v2/endpoint>; rel="successor-version"` - URL to replacement endpoint
- `Warning: 299 - "Message"` - Human-readable deprecation message

## Enhanced API Documentation

### Enhanced Endpoints

The following endpoints have been enhanced with comprehensive OpenAPI documentation:

1. **Projects** (`/backend/app/api/v1/endpoints/projects.py`)
   - POST `/api/v1/projects/` - Create project
   - GET `/api/v1/projects/{project_id}` - Get project
   - DELETE `/api/v1/projects/{project_id}` - Delete project

### Documentation Enhancements

Each enhanced endpoint now includes:

#### 1. Response Examples

```python
@router.post(
    "/projects/",
    response_model=Project,
    status_code=status.HTTP_201_CREATED,
    responses={
        201: {
            "description": "Project created successfully",
            "content": {
                "application/json": {
                    "example": {
                        "id": 1,
                        "name": "My Test Project",
                        "description": "Project for testing automation",
                        "owner_id": "123e4567-e89b-12d3-a456-426614174000",
                        "organization_id": "789e4567-e89b-12d3-a456-426614174000",
                        "created_at": "2024-01-15T10:30:00Z",
                        "updated_at": "2024-01-15T10:30:00Z",
                        "configuration": {},
                    }
                }
            },
        },
    }
)
```

#### 2. Error Response Documentation

All common HTTP error codes are documented:

- **400 Bad Request**: Invalid request data
  ```json
  {"detail": "Project name is required"}
  ```

- **401 Unauthorized**: Not authenticated
  ```json
  {"detail": "Not authenticated"}
  ```

- **403 Forbidden**: Insufficient permissions
  ```json
  {"detail": "You do not have permission to create projects in this organization"}
  ```

- **404 Not Found**: Resource not found
  ```json
  {"detail": "Project not found"}
  ```

- **429 Too Many Requests**: Rate limit exceeded
  ```json
  {"detail": "Too many requests. Please try again later."}
  ```

#### 3. Multiple Error Examples

Some endpoints provide multiple error examples:

```python
responses={
    401: {
        "description": "Invalid credentials or user not verified",
        "content": {
            "application/json": {
                "examples": {
                    "bad_credentials": {
                        "summary": "Invalid username or password",
                        "value": {"detail": "LOGIN_BAD_CREDENTIALS"},
                    },
                    "not_verified": {
                        "summary": "Email not verified",
                        "value": {"detail": "LOGIN_USER_NOT_VERIFIED"},
                    },
                }
            }
        },
    }
}
```

## Benefits

### For API Clients

1. **Clear Documentation**: Comprehensive examples show exactly what to expect
2. **Error Handling**: Know all possible error responses in advance
3. **Version Awareness**: Clear indication of which API version is being used
4. **Migration Paths**: Deprecation headers guide upgrades to new versions

### For Developers

1. **Maintainability**: Centralized version management
2. **Standards Compliance**: Implements RFC standards for deprecation
3. **Backward Compatibility**: Easy to support multiple API versions
4. **Self-Documenting**: OpenAPI spec is generated automatically

## Best Practices

### When Adding New API Versions

1. Add version to `SUPPORTED_VERSIONS` in middleware
2. Update deprecation mappings in `deprecation.py`
3. Document migration path in API changelog
4. Set sunset dates for deprecated versions

### When Deprecating Endpoints

1. Add deprecation headers minimum 6 months before removal
2. Provide clear successor endpoint in Link header
3. Log deprecation usage for analytics
4. Send deprecation notices to API consumers

### When Documenting Endpoints

1. Always include success response example
2. Document all possible error codes (400, 401, 403, 404, 429, etc.)
3. Provide realistic example data
4. Keep descriptions concise but informative

## Testing

### Testing Version Negotiation

```bash
# Request v1 explicitly
curl -H "Accept-Version: v1" https://api.qontinui.io/api/v1/projects

# Request v2 explicitly
curl -H "Accept-Version: v2" https://api.qontinui.io/api/v1/projects

# Default to v1 (no header)
curl https://api.qontinui.io/api/v1/projects
```

### Checking Deprecation Headers

```bash
curl -I https://api.qontinui.io/api/v1/old-endpoint

# Response headers:
# Deprecation: true
# Sunset: Sun, 31 Dec 2025 23:59:59 GMT
# Link: </api/v2/new-endpoint>; rel="successor-version"
# Warning: 299 - "This endpoint is deprecated and will be removed after 2025-12-31"
```

## Integration with Main Application

### Adding Middleware to main.py

```python
from app.middleware.api_version import APIVersionMiddleware

# Add after other middleware
app.add_middleware(APIVersionMiddleware)
```

### Middleware Order

The middleware should be added in the correct order for proper execution:

1. CORS Middleware (added last, executes first)
2. Security Headers Middleware
3. Request ID Middleware
4. **API Version Middleware** (new)
5. Metrics Middleware
6. Rate Limiting

## Future Enhancements

### Planned Improvements

1. **Content Negotiation**: Support different response formats per version
2. **Automated Migration**: Tools to help clients migrate between versions
3. **Version Analytics**: Track which versions are most used
4. **Breaking Change Detection**: Automated checks for backward compatibility
5. **Deprecation Notices**: Email notifications to API consumers

### Version Roadmap

- **v1** (Current): Initial release, stable
- **v2** (Planned Q2 2025): Enhanced response schemas, new endpoints
- **v1 Sunset**: December 31, 2025 (12 months after v2 release)

## References

- [RFC 8594: The Sunset HTTP Header Field](https://datatracker.ietf.org/doc/html/rfc8594)
- [Draft: HTTP API Deprecation Header](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-deprecation-header)
- [RFC 8288: Web Linking](https://datatracker.ietf.org/doc/html/rfc8288)
- [RFC 7234: HTTP Caching (Warning Header)](https://datatracker.ietf.org/doc/html/rfc7234)
- [OpenAPI 3.0 Specification](https://swagger.io/specification/)
