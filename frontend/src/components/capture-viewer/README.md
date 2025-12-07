# Capture Viewer Components

Production-ready React/TypeScript components for viewing captured video sessions with synchronized input events.

## Overview

The Capture Viewer provides a comprehensive interface for reviewing manual capture sessions, showing video playback synchronized with user input events (mouse clicks, keyboard input, scrolls, etc.). Users can jump to specific events, analyze interaction patterns, and request full-size screenshots for documentation.

## Components

### 1. VideoPlayer

A full-featured video player with timeline controls and synchronization capabilities.

**Features:**

- Play/pause controls
- Timeline scrubber with precise seeking
- Volume control and mute toggle
- Fullscreen support
- Keyboard shortcuts (Space, Arrow keys, M, F)
- External timestamp synchronization
- Current timestamp display (MM:SS.ms format)

**Props:**

```typescript
interface VideoPlayerProps {
  videoUrl: string;
  currentTimestamp: number;
  onTimestampChange: (timestamp: number) => void;
  onPlayingChange?: (isPlaying: boolean) => void;
}
```

**Keyboard Shortcuts:**

- `Space`: Play/Pause
- `←`: Skip backward 10s
- `→`: Skip forward 10s
- `M`: Mute/Unmute
- `F`: Fullscreen toggle

### 2. InputEventsSidePanel

Displays input events in a scrollable side panel with filtering and search capabilities.

**Features:**

- Auto-scrolling to current event during playback
- Visual highlighting of active events
- Detailed event information (position, keys, modifiers, element names)
- Search/filter by text
- Filter by event type (with counts)
- Click events to jump to timestamp
- Color-coded event types

**Props:**

```typescript
interface InputEventsSidePanelProps {
  events: InputEvent[];
  currentTimestamp: number;
  onEventClick: (timestamp: number) => void;
}

interface InputEvent {
  timestamp: number;
  eventType:
    | "mouse_click"
    | "mouse_drag"
    | "key_press"
    | "key_release"
    | "scroll";
  x?: number;
  y?: number;
  button?: string;
  key?: string;
  modifiers?: string[];
  elementName?: string;
}
```

**Event Types:**

- **Mouse Click** (blue): Click events with button and position
- **Mouse Drag** (purple): Drag operations
- **Key Press** (green): Keyboard input
- **Key Release** (gray): Key release events
- **Scroll** (orange): Scroll events

### 3. EventTimeline

Clickable timeline showing event markers with density visualization.

**Features:**

- Visual event markers on timeline
- Click timeline or markers to seek
- Hover tooltips with event details
- Event density graph
- Current time indicator
- Time markers every 10% of duration
- Event statistics summary

**Props:**

```typescript
interface EventTimelineProps {
  events: InputEvent[];
  duration: number;
  currentTime: number;
  onSeek: (timestamp: number) => void;
}
```

### 4. ScreenshotRequestPanel

Collapsible panel for requesting full-size screenshots based on event filters.

**Features:**

- Filter by event types (clicks, drags, keypresses, scrolls)
- Filter by mouse buttons (left, right, middle)
- Set maximum screenshot count (1-1000)
- Optional "after delay" capture for animations
- Request summary preview
- Form validation
- Async submission with loading state

**Props:**

```typescript
interface ScreenshotRequestPanelProps {
  sessionId: string;
  onRequest: (filter: ScreenshotFilter) => void;
}

interface ScreenshotFilter {
  eventTypes: string[];
  buttons: string[];
  maxCount: number;
  includeAfterDelayMs?: number;
}
```

## Main Page

### CaptureViewerPage

Location: `/mnt/c/qontinui/qontinui-web/frontend/src/app/projects/[projectId]/captures/[sessionId]/page.tsx`

**Features:**

- Loads capture session data
- Orchestrates component synchronization
- Manages global timestamp state
- Handles event exports (JSON download)
- Breadcrumb navigation
- Session statistics display

**Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Header: Session name, stats, export button                     │
├─────────────────────────────────────┬───────────────────────────┤
│  VIDEO PLAYER                       │  INPUT EVENTS SIDE PANEL  │
│  ┌───────────────────────────────┐  │  ┌─────────────────────┐ │
│  │                               │  │  │ Search & Filters    │ │
│  │     Video Content             │  │  ├─────────────────────┤ │
│  │                               │  │  │ • 00:01.234 Click   │ │
│  │                               │  │  │ • 00:02.567 Key Tab │ │
│  └───────────────────────────────┘  │  │ • 00:03.891 Key 'a' │ │
│  [Play/Pause] 00:03.9 / 02:45.0     │  │ • ...               │ │
├─────────────────────────────────────┤  └─────────────────────┘ │
│  EVENT TIMELINE                     │                           │
│  [Interactive timeline with markers]│                           │
├─────────────────────────────────────┤                           │
│  SCREENSHOT REQUEST PANEL           │                           │
│  [Collapsible filter panel]         │                           │
└─────────────────────────────────────┴───────────────────────────┘
```

## Usage Example

```typescript
import { CaptureViewerPage } from "@/app/projects/[projectId]/captures/[sessionId]/page";

// The page is automatically routed via Next.js
// Access via: /projects/{projectId}/captures/{sessionId}
```

Or use individual components:

```typescript
import {
  VideoPlayer,
  InputEventsSidePanel,
  EventTimeline,
  ScreenshotRequestPanel,
} from '@/components/capture-viewer';

function MyCustomViewer() {
  const [currentTimestamp, setCurrentTimestamp] = useState(0);

  return (
    <div>
      <VideoPlayer
        videoUrl="/api/video/123"
        currentTimestamp={currentTimestamp}
        onTimestampChange={setCurrentTimestamp}
      />
      <InputEventsSidePanel
        events={events}
        currentTimestamp={currentTimestamp}
        onEventClick={setCurrentTimestamp}
      />
    </div>
  );
}
```

## API Integration

The page currently uses mock data. To integrate with your backend API:

1. **Update `loadCaptureSession()` in page.tsx:**

```typescript
const loadCaptureSession = async () => {
  try {
    setLoading(true);
    const data = await captureService.getSession(projectId, sessionId);
    setSession(data);
  } catch (error) {
    toast.error("Failed to load capture session");
  } finally {
    setLoading(false);
  }
};
```

2. **Create a capture service:**

```typescript
// services/capture-service.ts
export const captureService = {
  async getSession(
    projectId: string,
    sessionId: string
  ): Promise<CaptureSession> {
    const response = await fetch(
      `/api/projects/${projectId}/captures/${sessionId}`
    );
    if (!response.ok) throw new Error("Failed to fetch session");
    return response.json();
  },

  async requestScreenshots(sessionId: string, filter: ScreenshotFilter) {
    const response = await fetch(`/api/captures/${sessionId}/screenshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(filter),
    });
    if (!response.ok) throw new Error("Failed to request screenshots");
    return response.json();
  },
};
```

## Expected Backend API Endpoints

### GET `/api/projects/:projectId/captures/:sessionId`

Returns capture session data:

```json
{
  "id": "session-123",
  "projectId": "proj-456",
  "name": "Login Flow Capture",
  "description": "User login and navigation",
  "videoUrl": "/api/captures/video/session-123",
  "duration": 165.0,
  "events": [...],
  "createdAt": "2025-11-26T10:00:00Z",
  "stats": {
    "totalEvents": 15,
    "mouseClicks": 3,
    "keyPresses": 10,
    "scrolls": 2
  }
}
```

### POST `/api/captures/:sessionId/screenshots`

Request body:

```json
{
  "eventTypes": ["mouse_click", "key_press"],
  "buttons": ["left"],
  "maxCount": 10,
  "includeAfterDelayMs": 500
}
```

Response:

```json
{
  "requestId": "req-789",
  "status": "processing",
  "estimatedCompletionTime": "2025-11-26T10:05:00Z"
}
```

## Dependencies

All required UI components are from the existing shadcn/ui library:

- Button
- Card
- Badge
- Input
- Label
- Checkbox
- Slider
- ScrollArea
- Tooltip
- Collapsible
- Dialog (for future enhancements)

## Synchronization Logic

The components maintain synchronization through:

1. **Centralized Timestamp State**: Main page manages `currentTimestamp`
2. **Bidirectional Communication**:
   - VideoPlayer reports time updates → triggers event highlighting
   - Event clicks → seek video to timestamp
   - Timeline clicks → seek video to timestamp
3. **Debounced Seeking**: Video only seeks if difference > 0.1s to avoid jitter
4. **Auto-scrolling**: Side panel scrolls to current event automatically

## Performance Considerations

- Event filtering is client-side (consider pagination for 10k+ events)
- Video seeking is throttled to prevent excessive operations
- Auto-scroll uses `smooth` behavior for better UX
- Event clustering in timeline for better visualization at scale

## Future Enhancements

1. **Video thumbnails on hover** over timeline
2. **Heatmap visualization** for interaction hotspots
3. **Event annotations** with user notes
4. **Playback speed control** (0.5x, 1x, 2x)
5. **Frame-by-frame stepping** for precise analysis
6. **Export to video** with event overlays
7. **Comparison mode** for multiple sessions
8. **AI-generated insights** from event patterns

## Browser Compatibility

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Requires HTML5 video support
- Fullscreen API support recommended

## Testing

Test with various scenarios:

- Short videos (< 1 min)
- Long videos (> 1 hour)
- High event density (100+ events/min)
- Different video formats (MP4, WebM)
- Mobile/responsive layouts
- Keyboard navigation
- Screen reader accessibility

## License

Part of the qontinui-web project.
