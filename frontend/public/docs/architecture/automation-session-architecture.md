# Automation Session Lifecycle Architecture

## Overview

This document describes the complete architecture for automation session lifecycle, from initiation through execution, data capture, video generation, and retention policies.

## Architecture Diagram

```mermaid
graph TB
    subgraph "Client: Automation Runner"
        Runner[Automation Runner<br/>Python/Tauri]
        Runner -->|1. WebSocket Connect| WSAuth[Authentication<br/>JWT Token]
        Runner -->|2. Initiate Session| SessionStart[Session Start Event]
        Runner -->|3. Stream Data| EventStream[Event Stream:<br/>- Logs<br/>- Screenshots<br/>- Input Events]
    end

    subgraph "FastAPI Backend Layer"
        WSAuth --> WSEndpoint[WebSocket Endpoint<br/>/ws/automation/runner]

        subgraph "WebSocket Manager"
            WSEndpoint --> WSM[WebSocket Manager]
            WSM -->|Broadcast| WSClients[Connected Clients<br/>Real-time Monitoring]
            WSM -->|Rate Limiting| RateLimit[60 msgs/min]
            WSM -->|Heartbeat| Ping[Ping/Pong<br/>120s timeout]
        end

        subgraph "Session Management Endpoints"
            API[FastAPI Endpoints<br/>/api/v1/automation]
            API -->|GET /sessions| ListSessions[List Sessions<br/>Pagination & Filtering]
            API -->|GET /sessions/:id| GetSession[Session Details]
            API -->|GET /sessions/:id/timeline| Timeline[Timeline Events<br/>Logs + Screenshots]
            API -->|GET /sessions/:id/image-recognition| ImageStats[Image Recognition Stats]
            API -->|GET /screenshots/:id/inputs| ScreenshotInputs[Screenshot w/ Inputs]
        end
    end

    subgraph "Data Processing Pipeline"
        SessionStart -->|Create| SessionRecord[AutomationSession Record]
        EventStream -->|Process Logs| LogHandler[Log Handler]
        EventStream -->|Process Screenshots| ScreenshotHandler[Screenshot Handler]
        EventStream -->|Process Input Events| InputHandler[Input Event Handler]

        LogHandler -->|Store| LogDB[(AutomationLog)]
        ScreenshotHandler -->|Upload| S3Upload[S3/MinIO Upload]
        ScreenshotHandler -->|Store Metadata| ScreenshotDB[(AutomationScreenshot)]
        InputHandler -->|Store| InputDB[(AutomationInputEvent)]

        InputHandler -->|Link Screenshots| AssocHandler[Association Handler<br/>±2.5s window]
        AssocHandler -->|Create Links| AssocDB[(ScreenshotInputAssociation)]
    end

    subgraph "SQLAlchemy Models"
        SessionModel[AutomationSession<br/>- session_id<br/>- user_id<br/>- project_id<br/>- status<br/>- runner_version<br/>- runner_os<br/>- configuration_snapshot<br/>- created_at<br/>- ended_at]

        LogModel[AutomationLog<br/>- id<br/>- session_id<br/>- sequence_number<br/>- level<br/>- message<br/>- log_data JSONB<br/>- timestamp<br/>- created_at]

        ScreenshotModel[AutomationScreenshot<br/>- id<br/>- session_id<br/>- name<br/>- storage_path<br/>- width/height<br/>- content_type<br/>- automation_metadata JSONB<br/>- timestamp<br/>- presigned_url]

        InputEventModel[AutomationInputEvent<br/>- id<br/>- session_id<br/>- event_type<br/>- mouse_x/y<br/>- mouse_button<br/>- drag_* fields<br/>- text_typed<br/>- screenshot_before_id<br/>- screenshot_after_id<br/>- timestamp]

        AssocModel[ScreenshotInputAssociation<br/>- id<br/>- screenshot_id<br/>- log_id<br/>- input_type<br/>- input_data JSONB<br/>- timestamp_diff_ms]

        VideoModel[AutomationVideo<br/>- id<br/>- session_id<br/>- s3_key<br/>- duration_seconds<br/>- fps<br/>- quality<br/>- file_size_bytes<br/>- created_at]
    end

    subgraph "Object Storage: S3/MinIO"
        S3Upload -->|Store| S3Bucket[S3 Bucket<br/>automation-screenshots/]
        S3Bucket -->|Generate| Presigned[Presigned URLs<br/>15min expiry]
        S3Bucket -->|Store Videos| S3Video[automation-videos/]
    end

    subgraph "Background Jobs: ARQ"
        ARQPool[ARQ Redis Pool]

        subgraph "Video Generation Job"
            VideoJob[Video Export Job]
            VideoJob -->|Fetch Screenshots| S3Bucket
            VideoJob -->|Process with OpenCV| VideoGen[Video Generator<br/>- Frame Renderer<br/>- Action Overlays<br/>- Timeline Bar<br/>- Status Badges]
            VideoGen -->|Configure| VideoOpts[Video Options<br/>- Quality: 480p/720p/1080p<br/>- FPS: 30<br/>- Transitions<br/>- Overlays]
            VideoGen -->|Output| VideoFile[MP4 Video File]
            VideoFile -->|Upload| S3Video
            VideoFile -->|Store Metadata| VideoModel
        end

        subgraph "Cleanup Jobs"
            CleanupScheduler[Scheduled Cleanup<br/>Daily 2:00 AM UTC]
            CleanupScheduler -->|Session Cleanup| SessionCleanup[Cleanup Old Sessions<br/>90 days retention]
            CleanupScheduler -->|Screenshot Cleanup| S3Cleanup[S3 Object Cleanup<br/>90 days retention]
            CleanupScheduler -->|Video Cleanup| VideoCleanup[Video Cleanup<br/>90 days retention]
        end
    end

    subgraph "Data Retention Policies"
        RetentionPolicy[Retention Policies]
        RetentionPolicy -->|90 days| SessionRetention[Session Records<br/>AutomationSession]
        RetentionPolicy -->|90 days| LogRetention[Log Records<br/>AutomationLog]
        RetentionPolicy -->|90 days| ScreenshotRetention[Screenshot Records<br/>AutomationScreenshot]
        RetentionPolicy -->|90 days| VideoRetention[Video Records<br/>AutomationVideo]
        RetentionPolicy -->|90 days| S3ObjectRetention[S3 Objects<br/>Screenshots & Videos]

        SessionRetention -->|CASCADE DELETE| LogRetention
        SessionRetention -->|CASCADE DELETE| ScreenshotRetention
        SessionRetention -->|CASCADE DELETE| AssocDB
        SessionRetention -->|CASCADE DELETE| InputDB
    end

    subgraph "WebSocket Streaming to Frontend"
        WSM -->|Real-time Events| FrontendWS[Frontend WebSocket Client]
        FrontendWS -->|session_started| SessionUI[Session Monitor UI]
        FrontendWS -->|log| LogUI[Log Stream UI]
        FrontendWS -->|screenshot| ScreenshotUI[Screenshot Preview UI]
        FrontendWS -->|input_event| InputUI[Input Event UI]
        FrontendWS -->|session_ended| CompleteUI[Session Complete UI]
        FrontendWS -->|error| ErrorUI[Error Display UI]
        FrontendWS -->|policy_violation| PolicyUI[Policy Violation UI]
    end

    subgraph "Input Event Recording Architecture"
        InputCapture[Input Event Capture]
        InputCapture -->|Mouse Events| MouseEvents[Mouse Events<br/>- clicked: x, y, button<br/>- moved: x, y<br/>- dragged: from_x/y, to_x/y, path, speed]
        InputCapture -->|Keyboard Events| KeyboardEvents[Keyboard Events<br/>- text_typed: text, char_count]

        MouseEvents -->|Send via WebSocket| InputHandler
        KeyboardEvents -->|Send via WebSocket| InputHandler

        InputHandler -->|Associate| ScreenshotLinking[Screenshot Linking Logic<br/>Time window: ±2.5s]
        ScreenshotLinking -->|Before (-100ms)| BeforeLink[screenshot_before_id]
        ScreenshotLinking -->|During (±100ms)| DuringLink[Direct association]
        ScreenshotLinking -->|After (+100ms)| AfterLink[screenshot_after_id]
    end

    %% Connect models to database tables
    SessionRecord -.->|maps to| SessionModel
    LogDB -.->|maps to| LogModel
    ScreenshotDB -.->|maps to| ScreenshotModel
    InputDB -.->|maps to| InputEventModel
    AssocDB -.->|maps to| AssocModel

    %% Video generation trigger
    SessionStart -->|On Session End| ARQPool
    ARQPool -->|Enqueue| VideoJob

    %% Styling
    classDef storage fill:#e1f5ff,stroke:#0288d1,stroke-width:2px
    classDef processing fill:#fff9c4,stroke:#f57f17,stroke-width:2px
    classDef model fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef websocket fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    classDef retention fill:#ffebee,stroke:#c62828,stroke-width:2px

    class S3Bucket,S3Video,Presigned,S3ObjectRetention storage
    class VideoGen,VideoJob,AssocHandler,ScreenshotLinking processing
    class SessionModel,LogModel,ScreenshotModel,InputEventModel,AssocModel,VideoModel model
    class WSM,WSEndpoint,FrontendWS,WSClients websocket
    class RetentionPolicy,SessionRetention,LogRetention,ScreenshotRetention,VideoRetention retention
```

## Component Responsibilities

### 1. FastAPI Endpoints (Session Management)

**Location:** `/backend/app/api/v1/endpoints/automation.py`

**Responsibilities:**
- Session querying and filtering
- Timeline event aggregation (logs + screenshots)
- Image recognition statistics
- Screenshot-to-input association queries
- Pagination and data retrieval

**Key Endpoints:**
- `GET /api/v1/automation/sessions` - List sessions with stats
- `GET /api/v1/automation/sessions/{id}` - Session details
- `GET /api/v1/automation/sessions/{id}/timeline` - Chronological events
- `GET /api/v1/automation/sessions/{id}/image-recognition` - AI/CV stats
- `GET /api/v1/automation/screenshots/{id}/inputs` - Input associations

### 2. WebSocket Manager

**Location:** `/backend/app/services/websocket_manager.py`

**Responsibilities:**
- Connection lifecycle management
- Real-time event broadcasting
- Rate limiting (60 messages/minute)
- Heartbeat monitoring (120s timeout)
- Presence tracking
- Graceful disconnect handling

**WebSocket Endpoint:** `/api/v1/ws/automation/runner?token=<jwt>`

**Message Types:**
- Client → Server: `session_start`, `log`, `screenshot`, `input_event`, `session_end`, `heartbeat`
- Server → Client: `connected`, `session_started`, `log_received`, `screenshot_received`, `input_event_received`, `session_ended`, `heartbeat_ack`, `error`, `policy_violation`

### 3. SQLAlchemy Models

#### AutomationSession
**Location:** `/backend/app/models/automation_session.py`

**Purpose:** Tracks automation test session lifecycle

**Key Fields:**
- `id` (UUID, PK)
- `user_id` (UUID, FK to users)
- `project_id` (Integer, FK to projects, nullable)
- `runner_version`, `runner_os`, `runner_hostname`
- `status` ("active", "completed", "failed")
- `configuration_snapshot` (JSONB)
- `created_at`, `ended_at`

**Relationships:**
- One-to-many: `logs`, `screenshots`, `input_events`

#### AutomationLog
**Location:** `/backend/app/models/automation_log.py`

**Purpose:** Sequential log entries with structured data

**Key Fields:**
- `id` (UUID, PK)
- `session_id` (UUID, FK)
- `sequence_number` (Integer)
- `level` (String: info, warning, error)
- `message` (Text)
- `log_data` (JSONB - flexible event data)
- `timestamp`

**Indexes:**
- Composite: `(session_id, sequence_number)`
- GIN index: `log_data` for JSONB queries

#### AutomationScreenshot
**Location:** `/backend/app/models/automation_screenshot.py`

**Purpose:** Screenshot metadata and S3 references

**Key Fields:**
- `id` (UUID, PK)
- `session_id` (UUID, FK)
- `name` (String)
- `storage_path` (S3 key)
- `width`, `height` (Integer)
- `content_type` (default: "image/png")
- `automation_metadata` (JSONB)
- `timestamp`
- `presigned_url` (nullable, generated on-demand)

**Relationships:**
- Many-to-many: `input_associations` (via ScreenshotInputAssociation)

#### AutomationInputEvent
**Location:** `/backend/app/models/automation.py`

**Purpose:** User input events (mouse, keyboard)

**Key Fields:**
- `id` (BigInteger, PK)
- `session_id` (UUID, FK)
- `event_type` ("mouse.clicked", "mouse.moved", "mouse.dragged", "keyboard.text_typed")
- `timestamp`
- **Mouse fields:** `mouse_x`, `mouse_y`, `mouse_button`
- **Drag fields:** `drag_from_x/y`, `drag_to_x/y`, `drag_duration`, `drag_path_points`, `drag_avg_speed`, `drag_max_speed`
- **Keyboard fields:** `text_typed`, `character_count`
- `screenshot_before_id`, `screenshot_after_id` (nullable FKs)

**Indexes:**
- Composite: `(session_id, timestamp)`
- Single: `event_type`

#### ScreenshotInputAssociation
**Location:** `/backend/app/models/screenshot_input_association.py`

**Purpose:** Links screenshots to input events based on temporal proximity

**Key Fields:**
- `id` (UUID, PK)
- `screenshot_id` (UUID, FK)
- `log_id` (UUID, FK to AutomationLog)
- `input_type` (String)
- `input_data` (JSONB)
- `timestamp_diff_ms` (Integer - time delta between screenshot and event)

**Association Logic:**
- Time window: ±2.5 seconds from input event
- Classification:
  - `before`: > 100ms before event
  - `during`: within ±100ms of event
  - `after`: > 100ms after event

#### AutomationVideo
**Location:** `/backend/app/models/automation_video.py`

**Purpose:** Video recording metadata

**Key Fields:**
- `id` (Integer, PK)
- `session_id` (String, unique)
- `user_id` (UUID, FK)
- `project_id` (Integer, FK, nullable)
- `s3_key` (String, unique)
- `duration_seconds`, `fps`, `quality`
- `file_size_bytes`
- `created_at`

### 4. S3/MinIO (Screenshot Storage)

**Location:** `/backend/app/services/object_storage.py`

**Responsibilities:**
- Screenshot upload and storage
- Video file storage
- Presigned URL generation (15-minute expiry)
- Object lifecycle management

**Bucket Structure:**
```
automation-screenshots/
  ├── {user_id}/
  │   ├── {session_id}/
  │   │   ├── screenshot_001.png
  │   │   ├── screenshot_002.png
  │   │   └── ...

automation-videos/
  ├── {user_id}/
  │   ├── {session_id}.mp4
  │   └── ...
```

**Configuration:**
- Local development: MinIO on port 9000
- Production: AWS S3 with IAM roles

### 5. Video Generation Libraries

**Location:** `/backend/app/services/video_export.py`

**Technologies:**
- **OpenCV (cv2)**: Video encoding, frame rendering
- **NumPy**: Image array manipulation
- **Pillow**: Image loading and processing

**Components:**

#### VideoFrameRenderer
Renders individual frames with overlays:
- Action type indicators
- Click/type visualization
- Bounding boxes for FIND actions
- Timeline progress bar
- Success/failure badges
- Active state badges

#### VideoExporter
Main export orchestration:
- Fetches screenshots from S3
- Renders frames with overlays
- Applies smooth transitions
- Outputs MP4 with H.264 codec

**Video Options:**
- **Quality presets:** 480p, 720p, 1080p
- **FPS:** Default 30fps
- **Frame duration:** Default 1.5s per action
- **Features:** Overlays, timeline, text, transitions

**Output Format:**
- Codec: MP4V (H.264)
- Container: MP4
- Audio: None (silent video)

### 6. ARQ (Background Jobs)

**Location:** `/backend/app/worker/`

**Purpose:** Asynchronous task execution with Redis

**Configuration:**
- Redis connection pool
- Task queue management
- Job result storage
- Retry logic

**Jobs:**

#### Video Export Job
**Trigger:** Session end event
**Process:**
1. Fetch all session screenshots from S3
2. Load action timeline data
3. Render frames with overlays
4. Encode to MP4
5. Upload to S3
6. Store metadata in AutomationVideo table

**Progress Tracking:** Optional callback for progress updates

#### Cleanup Jobs
**Location:** `/backend/app/worker/tasks/cleanup_tasks.py`

**Schedule:** Daily at 2:00 AM UTC

**Tasks:**
1. `cleanup_expired_sessions` - Remove sessions > 90 days old
2. `cleanup_expired_device_sessions` - Remove device sessions > 90 days
3. `cleanup_token_blacklist` - Remove expired JWT tokens
4. `cleanup_old_analytics_events` - Remove analytics > 90 days (placeholder)

**S3 Cleanup:** Separate job removes S3 objects for deleted sessions

## Data Flow

### Session Lifecycle

```
1. Session Initiation
   Runner → WebSocket Auth → Create AutomationSession record
   └─> Status: "active"

2. Execution Phase
   Loop for each action:
   ├─> Capture screenshot → Upload to S3 → Store AutomationScreenshot
   ├─> Log action → Store AutomationLog
   ├─> Record input event → Store AutomationInputEvent
   └─> Link screenshots to inputs → Store ScreenshotInputAssociation

3. Session Completion
   Runner → Send session_end event
   ├─> Update AutomationSession.status = "completed"
   ├─> Set AutomationSession.ended_at
   └─> Enqueue video generation job

4. Video Generation (Background)
   ARQ Job:
   ├─> Fetch screenshots from S3
   ├─> Render video with OpenCV
   ├─> Upload MP4 to S3
   └─> Store AutomationVideo metadata

5. Data Retention
   Daily cleanup job:
   ├─> Delete sessions > 90 days old
   ├─> CASCADE delete logs, screenshots, associations
   └─> Delete S3 objects for deleted sessions
```

### Input Event Recording Flow

```
1. Input Event Capture (Runner)
   User performs action (click, type, drag)
   └─> Runner captures:
       ├─> Event type
       ├─> Coordinates (x, y)
       ├─> Timestamp
       ├─> Event-specific data (button, text, path)

2. WebSocket Transmission
   Runner → WebSocket → Backend
   └─> Message type: "input_event"

3. Input Event Storage
   Backend → handle_input_event()
   ├─> Parse event data
   ├─> Create AutomationInputEvent record
   └─> Store in database

4. Screenshot Association
   Backend → link_screenshots_to_input()
   ├─> Query screenshots within ±2.5s window
   ├─> Calculate time deltas
   ├─> Classify association type (before/during/after)
   ├─> Create ScreenshotInputAssociation records
   └─> Update input_event.screenshot_before_id & screenshot_after_id
```

### WebSocket Streaming Flow

```
1. Connection Establishment
   Runner → WebSocket connect with JWT token
   ├─> Authenticate user
   ├─> Check automation_streaming_enabled flag
   ├─> Verify monthly session limit
   └─> Send "connected" acknowledgment

2. Real-time Event Streaming
   Runner sends events:
   ├─> "log" → Process → Broadcast to monitoring clients
   ├─> "screenshot" → Upload S3 → Broadcast thumbnail
   ├─> "input_event" → Store → Link screenshots → Acknowledge
   └─> "heartbeat" → Update timestamp → Send "heartbeat_ack"

3. Frontend Monitoring
   Frontend WebSocket client receives:
   ├─> session_started → Initialize session UI
   ├─> log → Append to log stream
   ├─> screenshot → Display preview
   ├─> input_event → Show input visualization
   └─> session_ended → Display summary

4. Error Handling
   ├─> WebSocketDisconnect → Cleanup connection
   ├─> Timeout (120s) → Send ping → Close if no response
   ├─> Rate limit exceeded → Send error → Throttle
   └─> Policy violation → Send policy_violation → Close connection
```

## Data Retention Policy

### Retention Periods

| Data Type | Retention Period | Cleanup Method |
|-----------|------------------|----------------|
| AutomationSession | 90 days | ARQ daily job |
| AutomationLog | 90 days | CASCADE delete |
| AutomationScreenshot | 90 days | CASCADE delete |
| AutomationInputEvent | 90 days | CASCADE delete |
| ScreenshotInputAssociation | 90 days | CASCADE delete |
| AutomationVideo | 90 days | ARQ daily job + S3 cleanup |
| S3 Screenshots | 90 days | S3 lifecycle policy |
| S3 Videos | 90 days | S3 lifecycle policy |

### Cleanup Schedule

**Daily Job:** 2:00 AM UTC

**Process:**
1. Identify sessions with `created_at < NOW() - 90 days`
2. DELETE sessions (triggers CASCADE delete on related tables)
3. Delete S3 objects for deleted sessions
4. Log cleanup statistics

**Configuration:**
- `CLEANUP_SESSION_DAYS`: Default 90 days (configurable)
- `CLEANUP_ANALYTICS_DAYS`: Default 90 days (configurable)

### CASCADE Delete Behavior

When `AutomationSession` is deleted:
- All `AutomationLog` records → CASCADE DELETE
- All `AutomationScreenshot` records → CASCADE DELETE
- All `AutomationInputEvent` records → CASCADE DELETE
- All `ScreenshotInputAssociation` records → CASCADE DELETE

**Note:** `AutomationVideo` requires separate cleanup as it uses String session_id (not UUID FK)

## Security & Access Control

### Authentication
- JWT token-based authentication
- WebSocket token passed via query parameter
- User identity verified on each connection

### Authorization
- Users can only access their own sessions
- Project-level access control (if project_id set)
- Admin users have full access

### Rate Limiting
- WebSocket messages: 60 messages per minute per user
- API endpoints: Standard rate limits via SlowAPI

### Data Privacy
- Screenshots stored with user_id isolation
- Presigned URLs with 15-minute expiry
- S3 objects private by default

## Performance Considerations

### Database Indexes
- `automation_sessions`: `(user_id)`, `(project_id)`, `(status)`, `(created_at)`
- `automation_logs`: `(session_id, sequence_number)`, `(timestamp)`, GIN on `log_data`
- `automation_screenshots`: `(session_id)`, `(timestamp)`, `(name)`
- `automation_input_events`: `(session_id, timestamp)`, `(event_type)`

### Caching
- Presigned URLs cached for 15 minutes
- Session statistics cached (if implemented)

### Async Processing
- Video generation runs in background (ARQ)
- Screenshot uploads non-blocking
- Cleanup jobs scheduled off-peak hours

### Scalability
- Horizontal scaling: WebSocket manager supports multiple instances
- Redis for distributed state management
- S3 for unlimited object storage
- PostgreSQL read replicas for analytics queries

## Monitoring & Observability

### Structured Logging
- All operations logged with structlog
- Log levels: info, warning, error
- Context: user_id, session_id, job_id

### Metrics
- Session creation rate
- Screenshot upload latency
- Video generation duration
- Cleanup job statistics

### Error Tracking
- WebSocket disconnects
- S3 upload failures
- Video generation errors
- Cleanup job failures

## Future Enhancements

1. **Real-time Video Streaming:** Stream video generation progress to frontend
2. **Video Compression:** Implement H.264/H.265 for smaller file sizes
3. **Thumbnail Generation:** Create video thumbnails for quick preview
4. **Session Replay:** Interactive session replay in browser
5. **Advanced Analytics:** ML-based pattern recognition and anomaly detection
6. **Multi-region Storage:** Replicate to multiple S3 regions for redundancy
7. **Video Transcoding:** Support multiple quality levels (adaptive streaming)
8. **Collaborative Sessions:** Multiple users viewing same session live

## References

- [WebSocket Implementation Summary](/backend/docs/AUTOMATION_WEBSOCKET_IMPLEMENTATION_SUMMARY.md)
- [Video Export Implementation](/backend/docs/video-upload-implementation.md)
- [Background Tasks Documentation](/backend/docs/BACKGROUND_TASKS.md)
- [ARQ Documentation](https://arq-docs.helpmanual.io/)
- [OpenCV Video Writing](https://docs.opencv.org/4.x/dd/d43/tutorial_py_video_display.html)
