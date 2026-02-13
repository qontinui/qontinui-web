# Screenshot Infrastructure Guide

## Overview

This document provides a comprehensive guide to everything involving screenshots in the Qontinui Web application. It covers how screenshots are obtained, where they're stored, how storage differs between manual uploads and WebSocket uploads, and all operations that can be performed with screenshots.

## Architecture Visualization

A detailed visual architecture diagram is available at:
**Admin Panel → Architecture → Screenshot Infrastructure Button**

This interactive diagram shows all components, storage layers, and data flows.

## How Screenshots Are Obtained

### 1. Manual Upload (User-Initiated)

**Location:** `/automation-builder/screenshots`

**Component:** `ScreenshotUploadTab.tsx`

**Process:**
1. User selects image files via file input dialog
2. Files are validated:
   - Must be image MIME types (PNG, JPEG, GIF, WebP)
   - Size validated (min 10x10 pixels)
   - Magic bytes checked for security
   - Max file size: 10MB per image
3. Images are uploaded to S3/MinIO via API
4. Local copy stored in IndexedDB for offline access
5. Metadata saved to PostgreSQL database

**API Endpoint:** `POST /api/v1/projects/{project_id}/images`

**Code Location:**
- Frontend: `src/components/ScreenshotTab/ScreenshotUploadTab.tsx:86-180`
- Backend: `backend/app/api/v1/endpoints/images.py`

### 2. WebSocket Streaming (Runner-Initiated)

**Component:** `RunnerWebSocket`

**Process:**
1. Runner executes automation and captures screenshots
2. Screenshots uploaded to S3 with presigned URLs
3. WebSocket sends screenshot event with metadata:
   - Presigned URL for image access
   - Dimensions (width/height)
   - Automation metadata (state, actions, mouse position, etc.)
   - Recognition results and detected elements
4. Frontend receives event and displays in real-time
5. Metadata stored in PostgreSQL

**WebSocket Event Type:** `screenshot`

**Code Location:**
- Frontend: `src/lib/runner-websocket.ts:29-59`
- Backend: `backend/app/api/v1/endpoints/automation_ws.py`

## Storage Architecture

### Three-Tier Storage System

#### 1. IndexedDB (Browser Local Storage)

**Purpose:** Local caching for offline access and fast loading

**Database:** `qontinui-screenshots-db`

**Schema:**
```typescript
interface StoredScreenshot {
  id: string;
  name: string;
  url: string; // base64 data URL
  size: number;
  uploadedAt: Date;
  description?: string;
  tags?: string[];
  projectName?: string;
}
```

**Operations:**
- `getAll()` - Retrieve all screenshots
- `getByProject(projectName)` - Get screenshots for specific project
- `get(id)` - Get single screenshot
- `add(screenshot)` - Store new screenshot
- `update(screenshot)` - Update existing screenshot
- `delete(id)` - Remove screenshot
- `clear()` - Delete all screenshots
- `count()` - Get total screenshot count
- `renameProject(oldName, newName)` - Bulk rename project association

**Code Location:** `src/lib/screenshot-db.ts`

**When Used:**
- Manual uploads (immediate local storage)
- Offline access
- Fast initial page load
- Project-specific screenshot management

#### 2. S3/MinIO (Cloud Object Storage)

**Purpose:** Persistent cloud storage for screenshots

**Configuration:**
- Bucket configured in backend settings
- Supports both AWS S3 and MinIO (self-hosted)
- Path-style addressing for MinIO compatibility

**Upload Flow:**
```
User Upload → API Validation → S3 Upload → Presigned URL Generated
```

**Features:**
- Presigned URLs for secure temporary access (7-day expiration)
- Automatic retry logic (max 3 attempts)
- Content-type validation
- Magic byte verification
- Metadata tagging

**Code Location:**
- Service: `backend/app/services/object_storage.py`
- API: `backend/app/api/v1/endpoints/images.py`

**When Used:**
- All uploaded screenshots (manual + WebSocket)
- Persistent storage
- Cross-device access
- Backup and recovery

#### 3. PostgreSQL (Metadata Storage)

**Purpose:** Relational metadata and associations

**Tables:**
- Project-screenshot associations
- Screenshot metadata (name, upload date, dimensions)
- Runner session associations
- Automation metadata from WebSocket streams

**Stored Information:**
- Screenshot ID and name
- Project associations
- Upload timestamps
- Dimensions (width/height)
- Automation context (state, actions, positions)
- Recognition results
- Tags and descriptions

**When Used:**
- Querying screenshots by project
- Filtering by metadata
- Analytics and reporting
- Automation session tracking

## Storage Differences: Manual vs WebSocket

| Aspect | Manual Upload | WebSocket Stream |
|--------|--------------|------------------|
| **Trigger** | User file selection | Runner automation |
| **IndexedDB** | ✅ Stored immediately | ❌ Not stored locally |
| **S3/MinIO** | ✅ Uploaded via API | ✅ Uploaded by runner |
| **PostgreSQL** | ✅ Full metadata | ✅ + automation metadata |
| **Access** | Immediate (local + cloud) | Cloud only (presigned URL) |
| **Metadata** | Basic (name, size, tags) | Rich (automation context) |
| **Use Case** | State definition | Runtime monitoring |

### Key Differences

1. **Local Storage:**
   - Manual uploads are stored in IndexedDB for offline access
   - WebSocket screenshots skip IndexedDB (runner-generated, cloud-first)

2. **Metadata Richness:**
   - Manual uploads: user-provided metadata
   - WebSocket uploads: automation context, mouse positions, keyboard events, recognition results

3. **Access Pattern:**
   - Manual uploads: immediate local access, then cloud
   - WebSocket uploads: cloud access via presigned URLs

4. **Upload Path:**
   - Manual: Browser → API → S3
   - WebSocket: Runner → S3, Event → Browser

## Operations on Screenshots

### 1. Screenshot Upload
**Page:** `/automation-builder/screenshots`

**Component:** `ScreenshotUploadTab`

**Features:**
- Multi-file upload with drag-and-drop
- Upload progress tracking
- File type validation
- Size validation
- Automatic S3 upload + local caching

### 2. Screenshot Annotation
**Page:** `/automation-builder/annotations`

**Component:** `ScreenshotAnnotationTab`

**Features:**
- Draw regions (rectangular areas) on screenshots
- Mark specific locations (points)
- Create anchor regions for relative positioning
- Associate annotations with states
- Configure region properties:
  - Type: StateRegion or SearchRegion
  - Bounds (x, y, width, height)
  - Linked state objects
  - Reference state IDs

**Annotation Types:**
- **Regions:** Rectangular areas for pattern matching
- **Locations:** Point coordinates for clicks/interactions
- **Anchors:** Reference points for relative positioning

**Code Location:** `src/components/screenshot-annotation/ScreenshotAnnotationTab.tsx`

### 3. State Discovery
**Page:** `/automation-builder/state-discovery`

**Features:**
- Upload screenshots for automated state detection
- AI-powered pattern extraction
- Computer vision analysis
- Automatic region identification
- State similarity analysis

**Backend Processing:**
- `ComputerVisionService` - OpenCV-based analysis
- `AutomatedStateDiscoveryService` - ML pattern detection
- `StateDiscoveryFacade` - Orchestration layer

**Code Location:**
- Frontend: `src/components/state-discovery/StateDiscoveryTab.tsx`
- Backend: `backend/app/services/automated_state_discovery_service.py`

### 4. Image Extraction
**Page:** `/automation-builder/image-extraction`

**Component:** `ImageExtractionTab`

**Features:**
- Extract specific regions from screenshots
- Background removal
- Pattern optimization
- Region cropping and export

### 5. Pattern Matching Test
**Component:** `PatternMatchingTest`

**Features:**
- Test pattern recognition algorithms
- Visualize match results
- Confidence threshold tuning
- Multi-scale matching

### 6. Mock Execution
**Component:** `MockExecutor`

**Features:**
- Test automation logic without actual execution
- Use screenshots to simulate application states
- Validate transition logic
- Debug workflow behavior

**Uses screenshots for:**
- State verification
- Pattern matching simulation
- Visual feedback during testing

### 7. Export/Download

**Formats:**
- **JSON Export:** State configurations with screenshot references
- **Python Code:** Generated automation scripts
- **Configuration Files:** For qontinui-runner

**Code Location:** `src/lib/state-exporter.ts`

### 8. Integration Testing
**Component:** `IntegrationTestDisplay`

**Features:**
- Visual test runner
- Screenshot-based assertions
- Coverage visualization
- State transition graphs

**Uses screenshots for:**
- Visual regression testing
- State coverage tracking
- Test result visualization

### 9. Real-Time Monitoring
**Component:** `RunnerMonitor`

**Features:**
- Live screenshot streaming from runner
- Automation session visualization
- Screenshot history for sessions
- Annotated screenshots with detected elements

**WebSocket Events:**
- Session start/end
- Screenshot capture with metadata
- Logs and error screenshots

### 10. Analytics
**Page:** `/analytics`

**Features:**
- Storage breakdown by project
- Screenshot count metrics
- Usage analytics

## Component Reference

### Upload Components
- **ScreenshotUploadTab** (`/automation-builder/screenshots`)
  - Multi-file upload
  - Progress tracking
  - Project association

### Annotation Components
- **ScreenshotAnnotationTab** (`/automation-builder/annotations`)
  - Region drawing
  - Location marking
  - Anchor creation

- **ScreenshotCanvas**
  - Interactive canvas for annotations
  - Zoom controls
  - Selection tools

- **RegionPropertiesPanel**
  - Region configuration
  - Type selection (StateRegion/SearchRegion)
  - State associations

- **LocationPropertiesPanel**
  - Location properties
  - Anchor configuration
  - Offset settings

### Selector Components
- **ScreenshotPicker**
  - Screenshot selection dialog
  - Thumbnail preview
  - Search/filter

- **ScreenshotThumbnailStrip**
  - Horizontal thumbnail strip
  - Quick selection
  - Scroll navigation

- **ProjectScreenshotSelector**
  - Project-specific screenshot picker
  - Filtered by current project

- **SnapshotScreenshotSelector**
  - Screenshot selection for snapshots
  - State association

### Display Components
- **ThumbnailCard**
  - Screenshot thumbnail with metadata
  - Quick actions (edit, delete)
  - Preview on hover

- **AnnotatedImage**
  - Screenshot with overlays
  - Region/location highlights
  - Interactive annotations

### Processing Components
- **BackgroundRemovalTab**
  - Remove screenshot backgrounds
  - Transparent PNG export
  - Mask visualization

- **PatternOptimizationTab**
  - Optimize patterns from screenshots
  - Multi-resolution testing
  - Confidence analysis

### Analysis Components
- **RegionAnalysisPanel**
  - Analyze screenshot regions
  - Pattern detection
  - Similarity scoring

- **AnalysisPanel**
  - Screenshot analysis results
  - Computer vision insights
  - State recommendations

## API Endpoints

### Image Upload
```
POST /api/v1/projects/{project_id}/images
```
- Upload screenshot to S3
- Validate file type and size
- Store metadata in PostgreSQL
- Return presigned URL

### Get Project Images
```
GET /api/v1/projects/{project_id}/images
```
- List all screenshots for project
- Include presigned URLs
- Filter by tags/metadata

### Delete Image
```
DELETE /api/v1/images/{image_id}
```
- Remove from S3
- Delete database metadata
- Clean up associations

### WebSocket Events
```
WS /api/v1/automation/ws
```
Event Types:
- `session_start` - Automation session begins
- `screenshot` - New screenshot captured
- `log` - Log messages
- `session_end` - Session complete

## File Paths

### Frontend
```
src/
├── app/(app)/automation-builder/
│   ├── screenshots/page.tsx           # Upload page
│   ├── annotations/page.tsx           # Annotation page
│   ├── state-discovery/page.tsx       # State discovery
│   └── image-extraction/page.tsx      # Extraction tools
├── components/
│   ├── ScreenshotTab/
│   │   ├── ScreenshotUploadTab.tsx
│   │   ├── ScreenshotCanvas.tsx
│   │   ├── RegionPropertiesPanel.tsx
│   │   └── LocationPropertiesPanel.tsx
│   ├── screenshot-annotation/
│   │   └── ScreenshotAnnotationTab.tsx
│   ├── state-discovery/
│   │   ├── StateDiscoveryTab.tsx
│   │   ├── ScreenshotUploader.tsx
│   │   └── DirectPatternCreation.tsx
│   ├── annotations/
│   │   ├── ThumbnailCard.tsx
│   │   └── ScreenshotThumbnailStrip.tsx
│   ├── common/
│   │   └── ScreenshotPicker.tsx
│   └── runner/
│       └── RunnerMonitor.tsx          # WebSocket monitoring
├── lib/
│   ├── screenshot-db.ts               # IndexedDB operations
│   ├── runner-websocket.ts            # WebSocket client
│   └── api-client.ts                  # API calls
└── types/
    └── Screenshot.ts                  # Type definitions
```

### Backend
```
backend/
├── app/
│   ├── api/v1/endpoints/
│   │   ├── images.py                  # Upload endpoints
│   │   ├── automation_ws.py           # WebSocket handler
│   │   └── projects.py                # Project associations
│   └── services/
│       ├── object_storage.py          # S3/MinIO service
│       ├── computer_vision_service.py # CV analysis
│       └── automated_state_discovery_service.py
```

## Common Use Cases

### Use Case 1: Manual Screenshot Upload for State Definition
1. Navigate to `/automation-builder/screenshots`
2. Click "Upload" or drag files
3. Screenshots stored in IndexedDB + S3
4. Navigate to `/automation-builder/annotations`
5. Select screenshot and draw regions
6. Associate regions with states
7. Export configuration

### Use Case 2: Real-Time Screenshot Streaming
1. Start automation in qontinui-runner
2. Runner connects via WebSocket
3. Screenshots captured and uploaded to S3
4. WebSocket events sent to browser
5. View in RunnerMonitor component
6. Screenshots include automation metadata
7. Review session history

### Use Case 3: Automated State Discovery
1. Upload multiple screenshots
2. Service analyzes images with CV
3. Patterns extracted automatically
4. States suggested based on similarities
5. Review and refine suggestions
6. Export discovered states

### Use Case 4: Pattern Testing
1. Upload reference screenshot
2. Define pattern regions
3. Upload test screenshots
4. Run pattern matching
5. Visualize match results
6. Tune confidence thresholds

## Best Practices

### Upload
- Use PNG for UI screenshots (lossless)
- Keep screenshots under 5MB when possible
- Use descriptive names
- Tag screenshots for organization

### Storage
- IndexedDB for frequently-accessed screenshots
- S3 for archival and sharing
- Clean up old screenshots periodically
- Use project associations for organization

### Annotations
- Draw tight regions around elements
- Use anchor regions for stable references
- Test patterns on multiple screenshots
- Document region purposes

### WebSocket Streaming
- Monitor upload progress
- Handle disconnections gracefully
- Store important screenshots locally
- Review automation metadata

## Troubleshooting

### Upload Failures
- Check file size (max 10MB)
- Verify image format
- Ensure S3 credentials valid
- Check network connectivity

### IndexedDB Issues
- Clear browser cache if quota exceeded
- Check browser compatibility
- Verify permissions
- Use cleanup utilities

### WebSocket Problems
- Verify runner connection
- Check authentication token
- Monitor network tab
- Review WebSocket logs

### Performance
- Limit concurrent uploads
- Use thumbnail previews
- Implement pagination
- Cache presigned URLs

## Security Considerations

### Upload Security
- MIME type validation
- Magic byte verification
- File size limits
- Malware scanning (future)

### Access Control
- Project-based permissions
- Presigned URL expiration (7 days)
- User authentication required
- CORS configuration

### Storage Security
- Encrypted S3 buckets
- Secure presigned URLs
- Database encryption at rest
- Audit logging

## Future Enhancements

- AI-powered auto-tagging
- Duplicate detection
- Batch processing
- Video frame extraction
- Cloud storage optimization
- Advanced search
- Collaborative annotations
- Version history
