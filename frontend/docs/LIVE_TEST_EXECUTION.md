# Live Test Execution Dashboard

Real-time test execution monitoring for the qontinui-web frontend.

## Overview

The Live Test Execution Dashboard provides real-time visibility into test execution, streaming live updates from the backend via WebSocket. It displays:

- Current test state and progress
- Live transition timeline with screenshots
- Success/failure indicators
- Elapsed time and performance metrics
- Connection status

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                        │
│  ┌───────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │  Testing Page │─→│ LiveTestExecution│─→│ TransitionTimeline│  │
│  └───────────────┘  └─────────────────┘  └──────────────────┘  │
│                             │                                   │
│                             ↓                                   │
│                   ┌──────────────────────┐                      │
│                   │ useTestingWebSocket  │                      │
│                   │  (Custom Hook)       │                      │
│                   └──────────────────────┘                      │
│                             │                                   │
└─────────────────────────────┼───────────────────────────────────┘
                              │ WebSocket
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     Backend (FastAPI)                           │
│                  /api/v1/testing/runs/{id}/stream               │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. `useTestingWebSocket` Hook

Custom React hook that manages WebSocket connection to receive live test updates.

**Location**: `src/hooks/useTestingWebSocket.ts`

**Features**:

- Automatic reconnection with exponential backoff
- Heartbeat mechanism (ping/pong every 30s)
- Connection state management
- Real-time elapsed time tracking
- Event-driven state updates

**Usage**:

```tsx
import { useTestingWebSocket } from "@/hooks/useTestingWebSocket";

const {
  state, // "idle" | "connecting" | "running" | "completed" | "failed" | "disconnected"
  currentState, // Current state name in the workflow
  currentAction, // Current action type being executed
  elapsedTime, // Elapsed time in seconds
  transitions, // Array of TransitionUpdate objects
  totalTransitions, // Total expected transitions
  successfulTransitions, // Count of successful transitions
  failedTransitions, // Count of failed transitions
  isConnected, // WebSocket connection status
} = useTestingWebSocket({
  testRunId: "test-run-uuid",
  enabled: true,
  onConnect: () => console.log("Connected"),
  onDisconnect: () => console.log("Disconnected"),
  onError: (error) => console.error("Error:", error),
  onTransitionComplete: (transition) =>
    console.log("Transition done:", transition),
  onTestComplete: (data) => console.log("Test complete:", data),
});
```

**WebSocket Message Types**:

| Type                  | Description             | Data Shape                                                      |
| --------------------- | ----------------------- | --------------------------------------------------------------- |
| `test_start`          | Test execution started  | `{ total_transitions: number }`                                 |
| `transition_start`    | Transition started      | `{ from_state, to_state, action_type, transition_id }`          |
| `transition_complete` | Transition succeeded    | `{ transition_id, duration_ms, screenshot_url, to_state }`      |
| `transition_failed`   | Transition failed       | `{ transition_id, duration_ms, error_message, screenshot_url }` |
| `test_complete`       | Test execution finished | `{ success: boolean, duration: number }`                        |
| `test_failed`         | Test execution failed   | `{}`                                                            |
| `pong`                | Heartbeat response      | `{}`                                                            |

### 2. `LiveTestExecution` Component

Main component that displays live test execution with real-time stats and timeline.

**Location**: `src/components/testing/LiveTestExecution.tsx`

**Features**:

- Header with status badge and connection indicator
- 4-panel stats grid (Elapsed Time, Current State, Current Action, Success Rate)
- Progress bar with transition counts
- Embedded transition timeline
- Auto-scrolling to current transition
- Connection error handling

**Props**:

```tsx
interface LiveTestExecutionProps {
  testRunId?: string; // Test run UUID (required for WebSocket connection)
  workflowName?: string; // Display name of the workflow
  onComplete?: (data: {
    // Callback when test completes
    success: boolean;
    duration: number;
  }) => void;
}
```

**Usage**:

```tsx
import { LiveTestExecution } from "@/components/testing/LiveTestExecution";

<LiveTestExecution
  testRunId="abc-123"
  workflowName="Login Flow Test"
  onComplete={(data) => {
    console.log("Test finished:", data.success ? "passed" : "failed");
    console.log("Duration:", data.duration, "seconds");
  }}
/>;
```

### 3. `TransitionTimeline` Component

Vertical timeline displaying transitions as they execute, with expand/collapse for details.

**Location**: `src/components/testing/TransitionTimeline.tsx`

**Features**:

- Status icons (pending, running, completed, failed)
- Color-coded badges
- Expandable cards with screenshots
- Action type, duration, error messages
- Auto-scroll to current transition
- Visual timeline connectors

**Props**:

```tsx
interface TransitionTimelineProps {
  transitions: TransitionUpdate[]; // Array of transitions to display
  currentTransitionId?: string; // ID of currently executing transition
  autoScroll?: boolean; // Auto-scroll to current (default: true)
}
```

**TransitionUpdate Type**:

```tsx
interface TransitionUpdate extends TransitionResult {
  status: "pending" | "running" | "completed" | "failed";
}

interface TransitionResult {
  id: string;
  test_run_id: string;
  from_state: string;
  to_state: string;
  action_type: string;
  success: boolean;
  duration_ms: number;
  error_message: string | null;
  screenshot_url: string | null;
  executed_at: string;
}
```

**Usage**:

```tsx
import { TransitionTimeline } from "@/components/testing/TransitionTimeline";

<TransitionTimeline
  transitions={transitions}
  currentTransitionId={currentTransitionId}
  autoScroll={true}
/>;
```

## Integration

### Adding Live View to Testing Dashboard

The testing dashboard (`src/app/(app)/testing/page.tsx`) includes the live view as a tab:

```tsx
// URL parameters for auto-navigation
const testRunIdParam = searchParams.get("testRunId");
const workflowNameParam = searchParams.get("workflowName");

// Auto-switch to live view if testRunId is in URL
useEffect(() => {
  if (testRunIdParam) {
    setLiveTestRunId(testRunIdParam);
    if (workflowNameParam) {
      setLiveWorkflowName(workflowNameParam);
    }
    setSelectedView("live");
  }
}, [testRunIdParam, workflowNameParam]);
```

### Navigating to Live View

**From Code**:

```tsx
import { useRouter } from "next/navigation";

const router = useRouter();

// Start test and navigate to live view
const testRunId = "abc-123";
const workflowName = "Login Flow";
router.push(
  `/testing?testRunId=${testRunId}&workflowName=${encodeURIComponent(workflowName)}`
);
```

**From URL**:

```
/testing?testRunId=abc-123&workflowName=Login%20Flow
```

## Backend WebSocket Endpoint

The frontend connects to:

```
ws://localhost:8000/api/v1/testing/runs/{test_run_id}/stream
```

**Expected Message Format**:

```json
{
  "type": "transition_start",
  "test_run_id": "abc-123",
  "timestamp": "2025-01-15T10:30:00Z",
  "data": {
    "from_state": "LoginPage",
    "to_state": "DashboardPage",
    "action_type": "CLICK",
    "transition_id": "trans-456"
  }
}
```

**Connection Lifecycle**:

1. Frontend connects via WebSocket
2. Backend sends `test_start` message
3. For each transition:
   - Backend sends `transition_start`
   - Backend sends `transition_complete` or `transition_failed`
4. Backend sends `test_complete` or `test_failed`
5. Connection closes (or stays open for future tests)

**Heartbeat**:

- Frontend sends `{ "type": "ping" }` every 30 seconds
- Backend responds with `{ "type": "pong" }`
- Connection is considered dead if no pong after 5 seconds

## Styling

The components use Tailwind CSS with the qontinui design system:

**Color Scheme**:

- Primary: `#00D9FF` (cyan)
- Secondary: `#BD00FF` (purple)
- Success: `green-500`
- Error: `red-500`
- Warning: `yellow-500`
- Background: `#0A0A0B`, `#1A1A1B`

**Custom Scrollbar**:

```css
.custom-scrollbar::-webkit-scrollbar {
  width: 8px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 217, 255, 0.3);
  border-radius: 4px;
}
```

## Error Handling

### Connection Errors

If the WebSocket connection fails:

1. **Network Error**: Auto-reconnect with exponential backoff (1s, 2s, 4s, 8s, 16s, max 30s)
2. **Max Reconnection Attempts**: 5 attempts, then show "Disconnected" badge
3. **Display**: Red alert banner with error message

### Data Errors

- Invalid JSON: Log error, continue listening
- Unknown message type: Log warning, continue listening
- Missing fields: Use default values, log warning

## Testing

### Manual Testing

1. Start backend WebSocket server
2. Navigate to `/testing?testRunId=test-123`
3. Backend should stream test updates
4. Verify:
   - Stats update in real-time
   - Timeline shows transitions as they arrive
   - Progress bar advances
   - Auto-scrolling works
   - Screenshots appear in expanded transitions

### Mock WebSocket Server

```python
# backend/tests/test_websocket_streaming.py
import asyncio
from fastapi import WebSocket

async def mock_test_execution(websocket: WebSocket):
    await websocket.accept()

    # Test start
    await websocket.send_json({
        "type": "test_start",
        "test_run_id": "test-123",
        "timestamp": "2025-01-15T10:00:00Z",
        "data": {"total_transitions": 3}
    })

    # Transition 1
    await websocket.send_json({
        "type": "transition_start",
        "test_run_id": "test-123",
        "timestamp": "2025-01-15T10:00:01Z",
        "data": {
            "from_state": "LoginPage",
            "to_state": "DashboardPage",
            "action_type": "CLICK",
            "transition_id": "trans-1"
        }
    })

    await asyncio.sleep(2)

    await websocket.send_json({
        "type": "transition_complete",
        "test_run_id": "test-123",
        "timestamp": "2025-01-15T10:00:03Z",
        "data": {
            "transition_id": "trans-1",
            "duration_ms": 2000,
            "screenshot_url": "https://example.com/screenshot1.png",
            "to_state": "DashboardPage"
        }
    })

    # ... more transitions ...

    # Test complete
    await websocket.send_json({
        "type": "test_complete",
        "test_run_id": "test-123",
        "timestamp": "2025-01-15T10:00:10Z",
        "data": {"success": true, "duration": 10}
    })
```

## Future Enhancements

### Planned Features

1. **Replay Mode**: View past test runs with timeline scrubbing
2. **Comparison View**: Compare two test runs side-by-side
3. **Filtering**: Filter transitions by status, action type, duration
4. **Export**: Download timeline as PDF or video
5. **Annotations**: Add notes to specific transitions
6. **Alerts**: Browser notifications for test completion/failure
7. **Multi-Test**: Monitor multiple test runs simultaneously

### Performance Optimizations

1. **Virtual Scrolling**: For timelines with 100+ transitions
2. **Image Lazy Loading**: Already implemented
3. **WebSocket Compression**: Enable `permessage-deflate`
4. **Debouncing**: Batch rapid updates (>10/second)

## Troubleshooting

### WebSocket won't connect

**Symptoms**: "Disconnected" badge, no updates

**Solutions**:

1. Check backend is running on port 8000
2. Verify test run ID is valid
3. Check browser console for WebSocket errors
4. Ensure no CORS issues (backend should allow WebSocket origin)

### Transitions not appearing

**Symptoms**: Connected but timeline stays empty

**Solutions**:

1. Verify backend is sending messages in correct format
2. Check browser DevTools > Network > WS tab for messages
3. Ensure `test_run_id` in messages matches the connected run
4. Check console logs for parsing errors

### Auto-scroll not working

**Symptoms**: Timeline doesn't scroll to current transition

**Solutions**:

1. Verify `autoScroll={true}` prop is set
2. Check that `currentTransitionId` is being set correctly
3. Ensure timeline container has fixed height with `overflow-y-auto`

### High CPU usage

**Symptoms**: Browser becomes sluggish during long tests

**Solutions**:

1. Limit timeline to most recent 50 transitions (add pagination)
2. Collapse old transitions automatically
3. Disable auto-scroll for very long tests
4. Use virtual scrolling library (e.g., react-window)

## API Reference

See:

- `src/hooks/useTestingWebSocket.ts` - Hook implementation
- `src/components/testing/LiveTestExecution.tsx` - Main component
- `src/components/testing/TransitionTimeline.tsx` - Timeline component
- `src/services/testing-service.ts` - Type definitions
