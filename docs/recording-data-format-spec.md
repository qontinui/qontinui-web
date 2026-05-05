# Recording Data Format Specification

## Overview

This document defines the expected format for recording data collected from external tools. The data will be uploaded to qontinui-web for automated state structure creation.

---

## File Structure

### Option 1: ZIP Archive Format (Recommended)
```
recording_session_20250113.zip
├── metadata.json          # Recording metadata
├── frames/                # Screenshot directory
│   ├── frame_0000.png
│   ├── frame_0001.png
│   ├── frame_0002.png
│   └── ...
├── interactions.json      # User interaction events
└── context.json          # Window and application context
```

### Option 2: Single JSON Format (For Simple Cases)
```json
{
  "metadata": { /* ... */ },
  "frames": [ /* base64 encoded images or URLs */ ],
  "interactions": [ /* ... */ ],
  "context": [ /* ... */ ]
}
```

---

## 1. metadata.json

### Schema
```json
{
  "recordingId": "uuid-v4",
  "version": "1.0",
  "recordingStartTime": "2025-01-13T10:30:00.000Z",
  "recordingEndTime": "2025-01-13T10:35:30.000Z",
  "duration": 330000,
  "recorder": {
    "name": "RecorderApp",
    "version": "2.1.0",
    "platform": "windows" | "macos" | "linux" | "web"
  },
  "system": {
    "os": "Windows 11",
    "osVersion": "22H2",
    "screenResolution": {
      "width": 1920,
      "height": 1080
    },
    "dpi": 96,
    "locale": "en-US"
  },
  "targetApplication": {
    "name": "MyApp",
    "version": "3.2.1",
    "type": "desktop" | "web" | "mobile",
    "url": "https://example.com/app" // For web apps
  },
  "frameRate": 2.0,
  "totalFrames": 660,
  "annotations": {
    "description": "User performing login and navigation workflow",
    "tags": ["login", "navigation", "user-workflow"],
    "author": "user@example.com"
  }
}
```

### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `recordingId` | UUID | Yes | Unique identifier for this recording session |
| `version` | String | Yes | Format version (currently "1.0") |
| `recordingStartTime` | ISO 8601 | Yes | Timestamp when recording started |
| `recordingEndTime` | ISO 8601 | Yes | Timestamp when recording ended |
| `duration` | Integer | Yes | Total duration in milliseconds |
| `recorder.name` | String | Yes | Name of recording tool |
| `recorder.version` | String | No | Version of recording tool |
| `recorder.platform` | Enum | Yes | Platform: windows, macos, linux, web |
| `system.screenResolution` | Object | Yes | Screen dimensions (width, height in pixels) |
| `system.dpi` | Integer | No | Screen DPI for coordinate scaling |
| `targetApplication.name` | String | Yes | Application being recorded |
| `targetApplication.type` | Enum | Yes | Application type |
| `frameRate` | Float | Yes | Frames captured per second |
| `totalFrames` | Integer | Yes | Total number of frames in recording |

---

## 2. frames/ Directory

### Frame Naming Convention
```
frame_[SEQUENCE].png

Where:
  SEQUENCE = 4-digit zero-padded frame number (0000, 0001, 0002, ...)

Examples:
  frame_0000.png  # First frame
  frame_0001.png  # Second frame
  frame_0042.png  # 43rd frame
  frame_1337.png  # 1338th frame
```

### Frame Image Requirements
- **Format**: PNG (preferred), JPEG (acceptable), WebP (acceptable)
- **Color Space**: RGB or RGBA
- **Resolution**: Full screen resolution (from metadata.system.screenResolution)
- **Compression**: Lossless for PNG, high quality (90+) for JPEG
- **Size Limit**: 10 MB per frame (larger frames may be rejected)

### Frame Metadata (Optional)
For each frame, optional sidecar JSON can be provided:

```
frame_0042.json
```

```json
{
  "frameNumber": 42,
  "timestamp": "2025-01-13T10:30:15.250Z",
  "relativeTime": 15250,
  "quality": {
    "sharpness": 0.87,
    "brightness": 0.65,
    "contrast": 0.72
  },
  "windowInfo": {
    "activeWindow": "MyApp - Dashboard",
    "windowBounds": {
      "x": 100, "y": 50,
      "width": 1720, "height": 980
    }
  },
  "userAnnotations": {
    "notes": "User clicked submit button",
    "highlightAreas": [
      { "x": 450, "y": 320, "width": 120, "height": 40, "label": "Submit Button" }
    ]
  }
}
```

---

## 3. interactions.json

### Schema
```json
{
  "interactions": [
    {
      "id": "uuid-v4",
      "timestamp": "2025-01-13T10:30:15.250Z",
      "relativeTime": 15250,
      "frameNumber": 42,
      "type": "click" | "drag" | "key" | "scroll" | "hover",

      // Type-specific fields (see below)
      "coordinates": { "x": 450, "y": 320 },
      "button": "left" | "right" | "middle",

      // Optional context
      "targetElement": {
        "text": "Submit",
        "role": "button",
        "boundingBox": { "x": 440, "y": 310, "width": 130, "height": 45 }
      },

      // Optional metadata
      "metadata": {
        "duration": 150,
        "modifiers": ["ctrl", "shift"],
        "confidence": 0.95
      }
    }
  ]
}
```

### Interaction Types

#### Click Event
```json
{
  "type": "click",
  "coordinates": { "x": 450, "y": 320 },
  "button": "left" | "right" | "middle",
  "clickCount": 1,
  "metadata": {
    "modifiers": ["ctrl"],
    "duration": 120
  }
}
```

#### Drag Event
```json
{
  "type": "drag",
  "startCoordinates": { "x": 100, "y": 200 },
  "endCoordinates": { "x": 400, "y": 250 },
  "path": [
    { "x": 100, "y": 200, "time": 0 },
    { "x": 150, "y": 210, "time": 50 },
    { "x": 250, "y": 230, "time": 150 },
    { "x": 400, "y": 250, "time": 300 }
  ],
  "button": "left",
  "metadata": {
    "duration": 300,
    "velocity": 1.2
  }
}
```

#### Keyboard Event
```json
{
  "type": "key",
  "action": "press" | "release" | "type",
  "key": "Enter",
  "keyCode": 13,
  "char": "\n",
  "text": "username@example.com", // For 'type' action
  "metadata": {
    "modifiers": ["shift"],
    "isCombo": false,
    "duration": 50
  }
}
```

**Keyboard Event Variants**:

**Single Key Press**:
```json
{
  "type": "key",
  "action": "press",
  "key": "Enter",
  "keyCode": 13
}
```

**Text Input Sequence**:
```json
{
  "type": "key",
  "action": "type",
  "text": "username@example.com",
  "keys": [
    { "key": "u", "time": 0 },
    { "key": "s", "time": 50 },
    { "key": "e", "time": 120 }
    // ... (can be omitted if just text is sufficient)
  ]
}
```

**Keyboard Shortcut**:
```json
{
  "type": "key",
  "action": "press",
  "key": "s",
  "metadata": {
    "modifiers": ["ctrl"],
    "isCombo": true
  }
}
```

#### Scroll Event
```json
{
  "type": "scroll",
  "coordinates": { "x": 800, "y": 400 }, // Scroll position
  "delta": { "x": 0, "y": 120 }, // Scroll amount
  "direction": "up" | "down" | "left" | "right",
  "scrollType": "wheel" | "trackpad" | "scrollbar",
  "metadata": {
    "duration": 200,
    "inertia": true
  }
}
```

#### Hover Event
```json
{
  "type": "hover",
  "coordinates": { "x": 450, "y": 320 },
  "metadata": {
    "duration": 1500, // How long hovered
    "triggered": true // Did hover cause visual change?
  }
}
```

### Interaction Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID | Yes | Unique identifier for this interaction |
| `timestamp` | ISO 8601 | Yes | Absolute timestamp |
| `relativeTime` | Integer | Yes | Milliseconds since recording start |
| `frameNumber` | Integer | No | Nearest frame number for this interaction |
| `type` | Enum | Yes | Interaction type |
| `coordinates` | Object | Conditional | Required for click, hover, scroll |
| `button` | Enum | Conditional | Required for click, drag |
| `targetElement` | Object | No | Detected UI element information |
| `metadata` | Object | No | Additional context |

---

## 4. context.json

### Schema
```json
{
  "contextEvents": [
    {
      "timestamp": "2025-01-13T10:30:15.250Z",
      "relativeTime": 15250,
      "frameNumber": 42,
      "eventType": "window_change" | "url_change" | "focus_change" | "app_launch" | "app_close",

      // Window context
      "windowInfo": {
        "title": "MyApp - Dashboard",
        "processName": "myapp.exe",
        "processId": 12345,
        "bounds": { "x": 100, "y": 50, "width": 1720, "height": 980 },
        "state": "maximized" | "minimized" | "normal",
        "zIndex": 1,
        "isModal": false
      },

      // Web application context
      "webContext": {
        "url": "https://example.com/dashboard",
        "title": "Dashboard - MyApp",
        "domain": "example.com",
        "pathname": "/dashboard",
        "hash": "",
        "loadComplete": true
      },

      // Application state
      "appState": {
        "authenticated": true,
        "userId": "user123",
        "sessionId": "session_abc"
      },

      // Performance indicators
      "performance": {
        "cpuUsage": 23.5,
        "memoryUsage": 512000000,
        "networkActivity": true,
        "isLoading": false
      },

      // Custom metadata
      "metadata": {
        "description": "User navigated to dashboard",
        "tags": ["navigation"]
      }
    }
  ]
}
```

### Context Event Types

#### window_change
```json
{
  "eventType": "window_change",
  "windowInfo": {
    "title": "New Window Title",
    "bounds": { "x": 0, "y": 0, "width": 1920, "height": 1080 },
    "state": "maximized"
  },
  "previousWindow": {
    "title": "Previous Window Title"
  }
}
```

#### url_change (Web Applications)
```json
{
  "eventType": "url_change",
  "webContext": {
    "url": "https://example.com/new-page",
    "previousUrl": "https://example.com/old-page",
    "navigation": "pushState" | "replaceState" | "reload" | "link",
    "loadTime": 1250
  }
}
```

#### focus_change
```json
{
  "eventType": "focus_change",
  "focusedElement": {
    "type": "input",
    "role": "textbox",
    "label": "Username",
    "placeholder": "Enter username",
    "boundingBox": { "x": 300, "y": 200, "width": 400, "height": 40 }
  },
  "previousFocus": {
    "type": "button",
    "label": "Submit"
  }
}
```

#### app_launch / app_close
```json
{
  "eventType": "app_launch",
  "windowInfo": {
    "processName": "myapp.exe",
    "processId": 12345,
    "commandLine": "myapp.exe --param value",
    "workingDirectory": "C:\\Program Files\\MyApp"
  }
}
```

---

## 5. Optional: annotations.json

### User-Provided Annotations
```json
{
  "annotations": [
    {
      "id": "uuid-v4",
      "type": "state" | "action" | "region" | "element",
      "frameNumber": 42,
      "timestamp": "2025-01-13T10:30:15.250Z",

      // State annotation
      "stateName": "Login Page",
      "stateDescription": "Initial login screen with email/password fields",
      "isInitialState": true,

      // Action annotation
      "actionName": "Submit Login",
      "actionDescription": "Click submit button after entering credentials",

      // Visual annotation
      "boundingBox": { "x": 440, "y": 310, "width": 130, "height": 45 },
      "label": "Submit Button",
      "role": "button",

      // Semantic information
      "semantics": {
        "purpose": "navigation" | "input" | "display" | "control",
        "importance": "high" | "medium" | "low",
        "isIdentifier": true // Should be used for state identification
      },

      // Relationships
      "relatedTo": ["annotation_id_1", "annotation_id_2"],
      "parentState": "state_id_1",

      "metadata": {
        "notes": "User notes here",
        "confidence": 1.0,
        "tags": ["primary-action", "authentication"]
      }
    }
  ]
}
```

---

## 6. Example Complete Recording

### Minimal Example (Login Workflow)
```json
{
  "metadata": {
    "recordingId": "rec_20250113_103000",
    "version": "1.0",
    "recordingStartTime": "2025-01-13T10:30:00.000Z",
    "recordingEndTime": "2025-01-13T10:30:30.000Z",
    "duration": 30000,
    "recorder": { "name": "RecorderTool", "version": "1.0", "platform": "web" },
    "system": {
      "screenResolution": { "width": 1920, "height": 1080 }
    },
    "targetApplication": {
      "name": "MyWebApp",
      "type": "web",
      "url": "https://example.com"
    },
    "frameRate": 2.0,
    "totalFrames": 60
  },

  "frames": [
    {
      "frameNumber": 0,
      "timestamp": "2025-01-13T10:30:00.000Z",
      "imageUrl": "frames/frame_0000.png"
    },
    {
      "frameNumber": 1,
      "timestamp": "2025-01-13T10:30:00.500Z",
      "imageUrl": "frames/frame_0001.png"
    }
    // ... more frames
  ],

  "interactions": [
    {
      "id": "int_001",
      "timestamp": "2025-01-13T10:30:05.250Z",
      "relativeTime": 5250,
      "frameNumber": 10,
      "type": "click",
      "coordinates": { "x": 500, "y": 300 },
      "button": "left",
      "targetElement": {
        "text": "",
        "role": "textbox",
        "boundingBox": { "x": 450, "y": 280, "width": 400, "height": 40 }
      }
    },
    {
      "id": "int_002",
      "timestamp": "2025-01-13T10:30:06.000Z",
      "relativeTime": 6000,
      "frameNumber": 12,
      "type": "key",
      "action": "type",
      "text": "user@example.com"
    },
    {
      "id": "int_003",
      "timestamp": "2025-01-13T10:30:08.000Z",
      "relativeTime": 8000,
      "frameNumber": 16,
      "type": "key",
      "action": "press",
      "key": "Tab"
    },
    {
      "id": "int_004",
      "timestamp": "2025-01-13T10:30:09.000Z",
      "relativeTime": 9000,
      "frameNumber": 18,
      "type": "key",
      "action": "type",
      "text": "password123"
    },
    {
      "id": "int_005",
      "timestamp": "2025-01-13T10:30:12.000Z",
      "relativeTime": 12000,
      "frameNumber": 24,
      "type": "click",
      "coordinates": { "x": 650, "y": 450 },
      "button": "left",
      "targetElement": {
        "text": "Sign In",
        "role": "button",
        "boundingBox": { "x": 600, "y": 430, "width": 100, "height": 40 }
      }
    }
  ],

  "contextEvents": [
    {
      "timestamp": "2025-01-13T10:30:00.000Z",
      "relativeTime": 0,
      "eventType": "url_change",
      "webContext": {
        "url": "https://example.com/login",
        "title": "Login - MyWebApp"
      }
    },
    {
      "timestamp": "2025-01-13T10:30:15.000Z",
      "relativeTime": 15000,
      "eventType": "url_change",
      "webContext": {
        "url": "https://example.com/dashboard",
        "previousUrl": "https://example.com/login",
        "navigation": "link",
        "loadTime": 1250
      }
    }
  ]
}
```

---

## 7. Validation Rules

### Recording Validity Checks
1. **Metadata**:
   - ✓ Valid UUID for recordingId
   - ✓ Version is "1.0"
   - ✓ End time > start time
   - ✓ Duration matches end - start
   - ✓ Frame rate > 0
   - ✓ Total frames matches actual frame count

2. **Frames**:
   - ✓ Frame numbers sequential (0, 1, 2, ...)
   - ✓ Timestamps monotonically increasing
   - ✓ All frame files exist
   - ✓ Images readable and valid format
   - ✓ Resolution matches metadata

3. **Interactions**:
   - ✓ Timestamps within recording duration
   - ✓ Frame numbers valid (within totalFrames range)
   - ✓ Required fields present for each type
   - ✓ Coordinates within screen bounds

4. **Context**:
   - ✓ Context events chronologically ordered
   - ✓ Window bounds within screen resolution
   - ✓ URLs valid (if web application)

---

## 8. Data Privacy & Security

### Sensitive Data Handling
1. **PII Detection**:
   - Auto-detect email addresses, phone numbers, SSNs
   - Flag frames/interactions containing potential PII
   - Provide redaction options before upload

2. **Credential Masking**:
   - Keyboard events with passwords should be masked
   - `text` field can be "[REDACTED]" or "[PASSWORD]"
   - Original coordinates and timing preserved

3. **Metadata Stripping**:
   - Remove user-specific paths
   - Anonymize usernames
   - Strip IP addresses from URLs if needed

### Example Masked Interaction
```json
{
  "type": "key",
  "action": "type",
  "text": "[REDACTED_PASSWORD]",
  "metadata": {
    "isSensitive": true,
    "redactedLength": 12
  }
}
```

---

## 9. API Upload Specification

### Upload Endpoint
```
POST /api/recordings/upload
Content-Type: multipart/form-data
```

### Upload Parameters
```
- file: ZIP archive or JSON file
- projectId: UUID (target project)
- description: String (optional)
- tags: Array<String> (optional)
```

### Response
```json
{
  "success": true,
  "recordingId": "uuid-v4",
  "uploadedAt": "2025-01-13T10:35:00.000Z",
  "size": 52428800,
  "frameCount": 660,
  "interactionCount": 42,
  "status": "uploaded",
  "validationErrors": [],
  "validationWarnings": [
    "Frame 42 has low sharpness (0.45)"
  ]
}
```

### Error Response
```json
{
  "success": false,
  "error": "INVALID_FORMAT",
  "message": "metadata.json is missing or invalid",
  "details": {
    "field": "metadata.version",
    "issue": "Expected '1.0', got '0.9'"
  }
}
```

---

## 10. Best Practices for Recording

### For Recording Tool Developers
1. **High Frame Rate for Critical Moments**:
   - Increase frame rate during interactions (5-10 fps)
   - Lower rate during idle periods (1-2 fps)

2. **Capture Context Changes**:
   - Always log window switches, URL changes
   - Record focus changes for input fields

3. **Precise Timing**:
   - Use high-resolution timestamps (millisecond precision minimum)
   - Synchronize frame capture with interaction events

4. **Rich Metadata**:
   - Include target element information when possible
   - Detect UI elements using accessibility APIs

5. **Quality Assurance**:
   - Validate recording before upload
   - Check for missing frames or events
   - Ensure image quality sufficient for pattern matching

### For Users
1. **Clear Workflows**:
   - Record complete workflows from start to end
   - Avoid interruptions or unrelated actions

2. **Consistent Pacing**:
   - Don't rush through actions
   - Pause briefly after major state changes

3. **Multiple Recordings**:
   - Record same workflow multiple times
   - Helps system learn consistent patterns

4. **Annotations**:
   - Add manual annotations for ambiguous states
   - Label important UI elements

---

## 11. Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-01-13 | Initial specification |

---

## 12. Contact & Support

For questions about this specification or recording format issues:
- GitHub Issues: [qontinui-web/issues](https://github.com/qontinui/qontinui-web/issues)
- Documentation: [qontinui-web/docs](https://github.com/qontinui/qontinui-web/tree/main/docs)
