# Video Upload Implementation

## Overview

Implemented a complete video upload and retrieval system for automation session recordings. The system allows runners to upload session videos to S3 storage and retrieve them via pre-signed URLs.

## Implementation Summary

### 1. Database Model

**File:** `/mnt/c/Users/jspin/Documents/qontinui_parent/qontinui-web/backend/app/models/automation_video.py`

Created `AutomationVideo` model with the following schema:
- `id`: Integer primary key
- `session_id`: String (unique, indexed) - automation session identifier
- `user_id`: UUID (foreign key to users table, indexed)
- `project_id`: Integer (foreign key to projects table, nullable, indexed)
- `s3_key`: String (unique) - S3 storage path
- `duration_seconds`: Integer (nullable) - video duration
- `fps`: Integer (nullable) - frames per second
- `quality`: String (nullable) - quality descriptor
- `file_size_bytes`: Integer - file size
- `created_at`: DateTime - upload timestamp

**Relationships:**
- Links to User model
- Links to Project model (optional)

### 2. Database Migration

**File:** `/mnt/c/Users/jspin/Documents/qontinui_parent/qontinui-web/backend/alembic/versions/4e5f6a7b8c9d_add_automation_videos_table.py`

Created Alembic migration to add the `automation_videos` table with:
- All necessary columns
- Foreign key constraints with cascade delete for users
- Indexes on: id, session_id (unique), user_id, project_id, s3_key (unique)

**To apply the migration:**
```bash
cd backend
alembic upgrade head
```

### 3. API Endpoints

**File:** `/mnt/c/Users/jspin/Documents/qontinui_parent/qontinui-web/backend/app/api/v1/endpoints/videos.py`

Implemented three endpoints:

#### POST `/api/v1/videos/sessions/{session_id}/upload-video`

Upload a video recording for an automation session.

**Request:**
- Method: POST
- Content-Type: multipart/form-data
- Path Parameter: `session_id` (string)
- Form Fields:
  - `file`: Video file (required)
  - `duration_seconds`: Integer (optional)
  - `fps`: Integer (optional)
  - `quality`: String (optional)
  - `project_id`: Integer (optional)

**Allowed Video Types:**
- video/mp4
- video/webm
- video/quicktime (.mov)
- video/x-matroska (.mkv)
- video/avi

**File Size Limit:** 500MB

**Response:**
```json
{
  "video_id": 123,
  "session_id": "abc-123",
  "s3_key": "videos/user-id/sessions/abc-123.mp4",
  "presigned_url": "https://...",
  "duration_seconds": 120,
  "fps": 30,
  "quality": "1080p",
  "size": 10485760,
  "content_type": "video/mp4",
  "created_at": "2025-11-16T19:00:00"
}
```

**Features:**
- Read-only mode check
- MIME type validation
- File size validation
- Storage quota checking
- Duplicate session check
- S3 upload with metadata
- Database record creation
- Storage usage tracking
- Pre-signed URL generation (1 hour expiry)

**S3 Key Format:** `videos/{user_id}/sessions/{session_id}.{extension}`

#### GET `/api/v1/videos/sessions/{session_id}/video`

Retrieve video information and generate a fresh pre-signed URL.

**Request:**
- Method: GET
- Path Parameter: `session_id` (string)

**Response:**
```json
{
  "video_id": 123,
  "session_id": "abc-123",
  "s3_key": "videos/user-id/sessions/abc-123.mp4",
  "presigned_url": "https://...",
  "duration_seconds": 120,
  "fps": 30,
  "quality": "1080p",
  "size": 10485760,
  "created_at": "2025-11-16T19:00:00",
  "expires_in_seconds": 3600
}
```

**Features:**
- User ownership verification
- S3 file existence check
- Fresh pre-signed URL generation (1 hour expiry)

#### DELETE `/api/v1/videos/sessions/{session_id}/video`

Delete a video recording.

**Request:**
- Method: DELETE
- Path Parameter: `session_id` (string)

**Response:**
```json
{
  "message": "Video deleted successfully",
  "session_id": "abc-123",
  "s3_key": "videos/user-id/sessions/abc-123.mp4"
}
```

**Features:**
- User ownership verification
- S3 file deletion
- Database record deletion
- Storage usage tracking cleanup

### 4. Router Registration

**File:** `/mnt/c/Users/jspin/Documents/qontinui_parent/qontinui-web/backend/app/api/v1/api.py`

Registered the videos router:
- Prefix: `/videos`
- Tags: `["videos"]`
- Full paths: `/api/v1/videos/sessions/{session_id}/...`

### 5. Model Export

**File:** `/mnt/c/Users/jspin/Documents/qontinui_parent/qontinui-web/backend/app/models/__init__.py`

Added `AutomationVideo` to model exports.

## S3 Configuration

The implementation uses the existing S3 configuration from `app/core/config.py`:

```python
# Object Storage (S3/MinIO)
STORAGE_BACKEND: str = "local" or "s3" or "minio"
STORAGE_BUCKET_NAME: str = "qontinui"
STORAGE_REGION: str = "us-east-1"
STORAGE_ACCESS_KEY: str | None = None
STORAGE_SECRET_KEY: str | None = None
STORAGE_ENDPOINT_URL: str | None = None  # For MinIO
STORAGE_USE_SSL: bool = True
```

### Environment Variables Required

Add these to your `.env` file:

```bash
# For AWS S3
STORAGE_BACKEND=s3
STORAGE_BUCKET_NAME=your-bucket-name
STORAGE_REGION=us-east-1
STORAGE_ACCESS_KEY=your-access-key
STORAGE_SECRET_KEY=your-secret-key

# Or for MinIO (local development)
STORAGE_BACKEND=minio
STORAGE_BUCKET_NAME=qontinui
STORAGE_REGION=us-east-1
STORAGE_ACCESS_KEY=minioadmin
STORAGE_SECRET_KEY=minioadmin
STORAGE_ENDPOINT_URL=http://localhost:9000
```

## Storage Quota Integration

The video upload endpoint integrates with the existing storage quota system:

**Storage Quotas:**
- Free tier: 25MB
- Hobby tier: 200MB
- Pro tier: 2GB

**Features:**
- Checks user's current storage usage
- Validates new upload won't exceed quota
- Tracks video uploads in `storage_usage` table
- File type: "video"

## Error Handling

All endpoints include comprehensive error handling:

1. **403 Forbidden**: Account in read-only mode
2. **400 Bad Request**: Invalid video type
3. **413 Request Entity Too Large**: File too large or quota exceeded
4. **404 Not Found**: Video or session not found
5. **409 Conflict**: Video already exists for session
6. **500 Internal Server Error**: S3 or database errors

## Security Features

1. **User Ownership Verification**: All operations verify the video belongs to the requesting user
2. **S3 Key Security**: Keys include user ID to prevent cross-user access
3. **Pre-signed URLs**: Temporary access (1 hour) instead of public URLs
4. **Storage Quota**: Prevents abuse with tier-based limits
5. **Read-Only Mode**: Blocks uploads when account is restricted

## Logging

All operations are logged with structured logging:
- Upload requests and completions
- S3 operations
- Database operations
- Errors and warnings
- Storage quota checks

Log keys include:
- `user_id`
- `session_id`
- `video_id`
- `s3_key`
- `file_size`

## Testing the Implementation

### 1. Apply Database Migration

```bash
cd backend
alembic upgrade head
```

### 2. Test Video Upload

```bash
curl -X POST \
  http://localhost:8000/api/v1/videos/sessions/test-session-123/upload-video \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test-video.mp4" \
  -F "duration_seconds=120" \
  -F "fps=30" \
  -F "quality=1080p"
```

### 3. Test Video Retrieval

```bash
curl -X GET \
  http://localhost:8000/api/v1/videos/sessions/test-session-123/video \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 4. Test Video Deletion

```bash
curl -X DELETE \
  http://localhost:8000/api/v1/videos/sessions/test-session-123/video \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Runner Integration

The runner (qontinui library) should call the upload endpoint after recording a session:

```python
import requests

def upload_session_video(session_id, video_path, auth_token, metadata=None):
    """Upload session video to backend."""
    url = f"https://api.example.com/api/v1/videos/sessions/{session_id}/upload-video"

    with open(video_path, 'rb') as f:
        files = {'file': f}
        data = metadata or {}
        headers = {'Authorization': f'Bearer {auth_token}'}

        response = requests.post(url, files=files, data=data, headers=headers)
        response.raise_for_status()

        return response.json()

# Example usage
metadata = {
    'duration_seconds': 120,
    'fps': 30,
    'quality': '1080p',
    'project_id': 456
}

result = upload_session_video(
    session_id='abc-123',
    video_path='/path/to/recording.mp4',
    auth_token='your-jwt-token',
    metadata=metadata
)

print(f"Video uploaded: {result['presigned_url']}")
```

## Future Enhancements

Potential improvements:
1. Video transcoding (convert to optimized formats)
2. Thumbnail generation
3. Video streaming support
4. Batch video operations
5. Video sharing links
6. Video analytics (view counts, duration watched)
7. Video compression before upload
8. Chunked upload for large files
9. Video preview/scrubbing support
10. Video download with watermarks for free tier

## Dependencies

No new dependencies were added. The implementation uses:
- FastAPI (existing)
- SQLAlchemy (existing)
- boto3 (existing for S3)
- structlog (existing for logging)

## Files Modified/Created

**Created:**
- `/mnt/c/Users/jspin/Documents/qontinui_parent/qontinui-web/backend/app/models/automation_video.py`
- `/mnt/c/Users/jspin/Documents/qontinui_parent/qontinui-web/backend/alembic/versions/4e5f6a7b8c9d_add_automation_videos_table.py`
- `/mnt/c/Users/jspin/Documents/qontinui_parent/qontinui-web/backend/app/api/v1/endpoints/videos.py`

**Modified:**
- `/mnt/c/Users/jspin/Documents/qontinui_parent/qontinui-web/backend/app/models/__init__.py`
- `/mnt/c/Users/jspin/Documents/qontinui_parent/qontinui-web/backend/app/api/v1/api.py`

## Notes

1. The implementation follows the existing patterns from the images endpoint
2. Video files are stored separately from images in the S3 bucket
3. The 500MB file size limit is configurable via `MAX_VIDEO_FILE_SIZE` constant
4. Pre-signed URL expiration (1 hour) is configurable via `VIDEO_PRESIGNED_URL_EXPIRATION` constant
5. The session_id is unique per video - only one video per session is allowed
6. Videos are automatically included in user storage quota calculations
