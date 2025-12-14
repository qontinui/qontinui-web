# Screenshot Storage for Test Results

This document describes the screenshot storage system for test execution results in qontinui-web.

## Overview

The screenshot storage service provides centralized management of test execution screenshots using MinIO (development) or AWS S3 (production). Screenshots are automatically organized by test run and step, with support for presigned URLs and bulk cleanup operations.

## Architecture

```
Runner → Backend API → screenshot_storage → MinIO/S3
                            ↓
                       Database (metadata)
```

## Service: `screenshot_storage`

Location: `app/services/screenshot_storage.py`

### Key Methods

#### `upload_screenshot(run_id, step_id, image_bytes, screenshot_type, metadata)`

Uploads a screenshot to storage with automatic organization.

**Parameters:**
- `run_id` (UUID): Test run identifier
- `step_id` (UUID): Test step/transition identifier
- `image_bytes` (bytes): Raw image data (PNG/JPEG)
- `screenshot_type` (str): Type of screenshot (step, error, before, after)
- `metadata` (dict, optional): Additional metadata to attach

**Returns:** Storage URL (string)

**Storage Path Format:**
```
test-screenshots/{run_id}/{step_id}_{timestamp}.{ext}
```

**Example:**
```python
from app.services.screenshot_storage import screenshot_storage

url = screenshot_storage.upload_screenshot(
    run_id=UUID("..."),
    step_id=UUID("..."),
    image_bytes=png_bytes,
    screenshot_type="error",
    metadata={"confidence": 0.95, "state": "login_page"}
)
```

#### `get_screenshot_url(path, expiration=3600)`

Generates a presigned URL for temporary access to a screenshot.

**Parameters:**
- `path` (str): Storage path/key for the screenshot
- `expiration` (int): URL expiration in seconds (default: 1 hour)

**Returns:** Presigned URL (string)

**Example:**
```python
url = screenshot_storage.get_screenshot_url(
    "test-screenshots/run-123/step-456_20240115.png",
    expiration=7200  # 2 hours
)
```

#### `delete_screenshots(run_id)`

Deletes all screenshots for a test run (bulk operation).

**Parameters:**
- `run_id` (UUID): Test run identifier

**Returns:** Number of screenshots deleted (int)

**Example:**
```python
count = screenshot_storage.delete_screenshots(run_id=UUID("..."))
print(f"Deleted {count} screenshots")
```

## Configuration

### Environment Variables

Configure storage backend in `.env`:

**Local Development (default):**
```env
STORAGE_BACKEND=local
```
Screenshots stored in `backend/uploads/test-screenshots/`

**MinIO Development:**
```env
STORAGE_BACKEND=minio
STORAGE_BUCKET_NAME=qontinui
STORAGE_REGION=us-east-1
STORAGE_ACCESS_KEY=minioadmin
STORAGE_SECRET_KEY=minioadmin
STORAGE_ENDPOINT_URL=http://localhost:9000
STORAGE_USE_SSL=false
```

**AWS S3 Production:**
```env
STORAGE_BACKEND=s3
STORAGE_BUCKET_NAME=qontinui-production
STORAGE_REGION=us-east-1
STORAGE_ACCESS_KEY=your-aws-access-key
STORAGE_SECRET_KEY=your-aws-secret-key
STORAGE_USE_SSL=true
```

### MinIO Setup (Development)

The MinIO service is automatically configured via `docker-compose.yml`:

```yaml
minio:
  image: minio/minio:latest
  ports:
    - "9000:9000"  # API
    - "9001:9001"  # Console
  environment:
    MINIO_ROOT_USER: minioadmin
    MINIO_ROOT_PASSWORD: minioadmin
```

Access MinIO console at: http://localhost:9001

**Credentials:**
- Username: `minioadmin`
- Password: `minioadmin`

**Bucket:** `qontinui` (automatically created on startup)

## Integration with Test Steps

The screenshot storage service is integrated with test step creation:

### Automatic Screenshot Upload

When a test step is created with a screenshot, the system:

1. Decodes base64 screenshot data
2. Validates image format and extracts dimensions
3. Uploads to MinIO/S3 via `screenshot_storage.upload_screenshot()`
4. Stores metadata in `test_screenshots` table
5. Returns presigned URL for access

### Database Schema

Table: `test_screenshots`

Key fields:
- `id` (UUID): Primary key
- `test_run_id` (UUID): Foreign key to test run
- `transition_execution_id` (UUID, nullable): Foreign key to transition
- `deficiency_id` (UUID, nullable): Foreign key to deficiency
- `screenshot_type` (enum): Type of screenshot
- `storage_path` (string): S3/MinIO key
- `width`, `height` (int): Image dimensions
- `screenshot_metadata` (JSONB): Additional metadata
- `captured_at` (timestamp): When screenshot was taken

## API Endpoints

### Upload Screenshot

**POST** `/api/v1/testing/runs/{run_id}/screenshots`

**Authentication:** Runner token required

**Content-Type:** `multipart/form-data`

**Form Fields:**
- `metadata`: JSON string with screenshot metadata
- `image`: Binary image file (PNG/JPEG, max 10MB)

**Example Request:**
```bash
curl -X POST \
  http://localhost:8000/api/v1/testing/runs/{run_id}/screenshots \
  -H "Authorization: Bearer {runner_token}" \
  -F "image=@screenshot.png" \
  -F 'metadata={"screenshot_id": "...", "screenshot_type": "error", ...}'
```

**Response:**
```json
{
  "screenshot_id": "...",
  "run_id": "...",
  "image_url": "https://...",
  "thumbnail_url": "https://...",
  "uploaded_at": "2025-01-15T10:30:00Z",
  "file_size_bytes": 125643
}
```

## Storage Organization

Screenshots are organized by test run:

```
qontinui/                           # Bucket
├── test-screenshots/               # Prefix for all test screenshots
│   ├── {run_id_1}/                # Test run 1
│   │   ├── {step_id}_20250115_103000.png
│   │   ├── {step_id}_20250115_103015.png
│   │   └── {step_id}_20250115_103030_thumbnail.png
│   ├── {run_id_2}/                # Test run 2
│   │   └── ...
│   └── ...
```

## Metadata Attachment

Screenshots can have custom metadata attached:

```python
screenshot_storage.upload_screenshot(
    run_id=run_id,
    step_id=step_id,
    image_bytes=image_bytes,
    screenshot_type="error",
    metadata={
        "confidence": 0.95,
        "state": "login_page",
        "transition_id": "login->dashboard",
        "error_message": "Element not found"
    }
)
```

Metadata is stored in S3/MinIO object metadata and in the database `screenshot_metadata` JSONB field.

## Cleanup and Retention

### Manual Cleanup

Delete all screenshots for a test run:

```python
from app.services.screenshot_storage import screenshot_storage

count = screenshot_storage.delete_screenshots(run_id)
```

### Automatic Cleanup

Screenshots can be automatically cleaned up when:
- Test run is deleted (cascade delete in database)
- Retention period expires (background job)

Configure retention in environment:

```env
SCREENSHOT_RETENTION_DAYS=30  # Keep screenshots for 30 days
```

## Testing

Run the test script to verify configuration:

```bash
cd backend
poetry run python test_screenshot_storage.py
```

This will:
1. Upload test screenshots
2. Generate presigned URLs
3. Verify metadata
4. Test bulk deletion
5. Verify cleanup

## Troubleshooting

### Issue: Screenshots not uploading

**Check:**
1. MinIO/S3 credentials are correct
2. Bucket exists and is accessible
3. Network connectivity to MinIO/S3 endpoint

**Logs:**
```bash
grep "screenshot_upload" backend/logs/app.log
```

### Issue: Presigned URLs not working

**Check:**
1. URL expiration time is valid
2. Storage backend is correctly configured
3. For MinIO, ensure `STORAGE_USE_SSL=false` in development

### Issue: Bucket not found

**Solution:**
Start MinIO and create bucket:
```bash
docker compose up -d minio
docker compose up minio-client  # Creates bucket
```

Or create manually via MinIO console (http://localhost:9001).

## Production Deployment

### AWS S3 Setup

1. Create S3 bucket: `qontinui-production`
2. Configure IAM user with permissions:
   - `s3:PutObject`
   - `s3:GetObject`
   - `s3:DeleteObject`
   - `s3:ListBucket`
3. Set environment variables in production:
   ```env
   STORAGE_BACKEND=s3
   STORAGE_BUCKET_NAME=qontinui-production
   STORAGE_REGION=us-east-1
   STORAGE_ACCESS_KEY={IAM_ACCESS_KEY}
   STORAGE_SECRET_KEY={IAM_SECRET_KEY}
   ```

### CloudFront CDN (Optional)

For improved performance, use CloudFront:

```env
USE_CLOUDFRONT=true
CLOUDFRONT_DOMAIN=d123abc.cloudfront.net
CLOUDFRONT_DISTRIBUTION_ID=E123ABC456DEF
```

Setup:
```bash
poetry run python scripts/setup_cloudfront.py --bucket qontinui-production
```

## Best Practices

1. **Always use presigned URLs** for screenshot access (security)
2. **Set appropriate expiration times** (default: 1 hour for viewing, 7 days for storage)
3. **Clean up old screenshots** regularly to reduce storage costs
4. **Use metadata** to store context (state, transition, confidence)
5. **Generate thumbnails** for UI previews
6. **Monitor storage usage** via MinIO console or CloudWatch

## API Reference

See also:
- `app/services/screenshot_storage.py` - Main service implementation
- `app/services/test_screenshot_service.py` - Test screenshot integration
- `app/api/v1/endpoints/testing.py` - API endpoints
- `app/models/test_screenshot.py` - Database model
