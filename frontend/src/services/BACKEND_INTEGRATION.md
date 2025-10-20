# Backend Execution Integration

Comprehensive documentation for the qontinui backend execution integration, connecting the Python graph executor to the React Flow canvas.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Components](#components)
3. [API Reference](#api-reference)
4. [WebSocket Protocol](#websocket-protocol)
5. [Event Types](#event-types)
6. [State Synchronization](#state-synchronization)
7. [Error Handling](#error-handling)
8. [Usage Examples](#usage-examples)
9. [Deployment Guide](#deployment-guide)
10. [Troubleshooting](#troubleshooting)

## Architecture Overview

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    React Frontend                            │
│                                                              │
│  ┌────────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │ WorkflowCanvas │→ │ExecutionPanel│→ │ ExecutionStore  │ │
│  └────────────────┘  └──────────────┘  └─────────────────┘ │
│           │                                      │           │
│           │                                      ↓           │
│           │                              ┌──────────────┐   │
│           └─────────────────────────────→│BackendAPI    │   │
│                                           └──────────────┘   │
└────────────────────────────────────────────────│─────────────┘
                                                 │
                                   ┌─────────────┴──────────────┐
                                   │    HTTP/WebSocket          │
                                   └─────────────┬──────────────┘
                                                 │
┌─────────────────────────────────────────────────────────────┐
│                    Python Backend                            │
│                                                              │
│  ┌────────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │  FastAPI       │→ │ExecutionMgr  │→ │ GraphExecutor   │ │
│  │  execution_api │  │              │  │                 │ │
│  └────────────────┘  └──────────────┘  └─────────────────┘ │
│           │                                      │           │
│           │                                      ↓           │
│           │                              ┌──────────────┐   │
│           └──────────────────────────────│ActionExecutor│   │
│                                          └──────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Execution Start**
   - User clicks "Execute" in WorkflowCanvas
   - ExecutionStore calls BackendAPI.executeWorkflow()
   - Backend creates ExecutionContext and starts GraphExecutor
   - Returns execution ID and WebSocket URL

2. **Event Streaming**
   - Frontend establishes WebSocket connection
   - Backend emits events during execution
   - ExecutionStore processes events and updates state
   - Canvas visualization updates in real-time

3. **State Synchronization**
   - ExecutionStore maintains action states
   - Periodic polling for status updates (fallback)
   - Canvas nodes reflect execution state visually

## Components

### Frontend Components

#### 1. BackendAPI (`backend-api.ts`)
- **Purpose**: HTTP client for backend communication
- **Key Methods**:
  - `executeWorkflow()`: Start execution
  - `getExecutionStatus()`: Query status
  - `pauseExecution()`: Pause running execution
  - `resumeExecution()`: Resume paused execution
  - `cancelExecution()`: Cancel execution
  - `streamExecutionEvents()`: WebSocket event streaming
- **Features**:
  - Automatic retry with exponential backoff
  - Request timeout handling
  - Type-safe responses

#### 2. ExecutionStore (`execution-store.ts`)
- **Purpose**: Zustand store for execution state
- **State**:
  - `currentExecution`: Active execution handle
  - `actionStates`: Per-action execution states
  - `executionEvents`: Event history
  - `executionHistory`: Past executions
- **Actions**:
  - `startExecution()`: Begin workflow execution
  - `pauseExecution()`: Pause execution
  - `resumeExecution()`: Resume execution
  - `cancelExecution()`: Cancel execution
- **Features**:
  - Real-time state updates
  - Event processing
  - Statistics calculation

#### 3. ExecutionWebSocket (`execution-websocket.ts`)
- **Purpose**: Advanced WebSocket manager
- **Features**:
  - Automatic reconnection with exponential backoff
  - Heartbeat/keepalive mechanism
  - Message queuing for offline mode
  - Connection state management
  - Event replay on reconnection

#### 4. Execution Visualization (`execution-visualization.ts`)
- **Purpose**: Visual state updates on canvas
- **Functions**:
  - `updateNodeExecutionState()`: Update node visuals
  - `updateEdgeExecutionState()`: Update edge visuals
  - `highlightExecutionPath()`: Show execution path
  - `calculateExecutionProgress()`: Progress metrics

### Backend Components

#### 1. ExecutionAPI (`execution_api.py`)
- **Purpose**: FastAPI REST and WebSocket endpoints
- **Endpoints**:
  - `POST /api/execute`: Start execution
  - `GET /api/execution/{id}/status`: Get status
  - `POST /api/execution/{id}/pause`: Pause
  - `POST /api/execution/{id}/resume`: Resume
  - `POST /api/execution/{id}/cancel`: Cancel
  - `WS /api/execution/{id}/stream`: Event stream
- **Features**:
  - CORS support
  - Request validation
  - Error handling

#### 2. ExecutionManager (`execution_manager.py`)
- **Purpose**: Manages concurrent executions
- **Key Functions**:
  - `start_execution()`: Create and start execution
  - `get_status()`: Query execution state
  - `subscribe_to_events()`: Register event listener
  - Event emission and distribution
- **Features**:
  - Concurrent execution support
  - Event queue management
  - Execution history tracking

## API Reference

### REST API

#### Start Execution

```http
POST /api/execute
Content-Type: application/json

{
  "workflow": {
    "id": "workflow-123",
    "name": "My Workflow",
    "actions": [...],
    "connections": {...}
  },
  "options": {
    "initialVariables": {"key": "value"},
    "debugMode": false,
    "breakpoints": ["action-1"],
    "stepMode": false,
    "timeout": 300,
    "continueOnError": false
  }
}

Response: 200 OK
{
  "execution_id": "exec-123",
  "workflow_id": "workflow-123",
  "workflow_name": "My Workflow",
  "start_time": "2025-10-16T12:00:00Z",
  "status": "running",
  "stream_url": "/api/execution/exec-123/stream"
}
```

#### Get Execution Status

```http
GET /api/execution/{execution_id}/status

Response: 200 OK
{
  "execution_id": "exec-123",
  "workflow_id": "workflow-123",
  "status": "running",
  "start_time": "2025-10-16T12:00:00Z",
  "end_time": null,
  "current_action": "action-2",
  "progress": 45.5,
  "total_actions": 10,
  "completed_actions": 4,
  "failed_actions": 0,
  "skipped_actions": 1,
  "action_states": {
    "action-1": "completed",
    "action-2": "running",
    "action-3": "pending"
  },
  "error": null,
  "variables": {"key": "value"}
}
```

#### Pause Execution

```http
POST /api/execution/{execution_id}/pause

Response: 200 OK
{
  "message": "Execution paused"
}
```

#### Resume Execution

```http
POST /api/execution/{execution_id}/resume

Response: 200 OK
{
  "message": "Execution resumed"
}
```

#### Step Execution

```http
POST /api/execution/{execution_id}/step

Response: 200 OK
{
  "message": "Execution stepped"
}
```

#### Cancel Execution

```http
POST /api/execution/{execution_id}/cancel

Response: 200 OK
{
  "message": "Execution cancelled"
}
```

#### Get Execution History

```http
GET /api/workflow/{workflow_id}/history?limit=50

Response: 200 OK
[
  {
    "execution_id": "exec-123",
    "workflow_id": "workflow-123",
    "workflow_name": "My Workflow",
    "start_time": "2025-10-16T12:00:00Z",
    "end_time": "2025-10-16T12:05:00Z",
    "status": "completed",
    "duration": 300000,
    "total_actions": 10,
    "completed_actions": 10,
    "failed_actions": 0,
    "error": null
  }
]
```

## WebSocket Protocol

### Connection

```javascript
const ws = new WebSocket('ws://localhost:8000/api/execution/exec-123/stream');
```

### Message Format

All messages are JSON-encoded.

#### Event Message (Server → Client)

```json
{
  "event_id": "evt-456",
  "type": "action_start",
  "execution_id": "exec-123",
  "timestamp": "2025-10-16T12:00:00Z",
  "action_id": "action-1",
  "action_type": "find",
  "data": {
    "message": "Starting action"
  }
}
```

#### Ping Message (Client → Server)

```json
{
  "type": "ping"
}
```

#### Pong Message (Server → Client)

```json
{
  "type": "pong"
}
```

### Connection Lifecycle

1. **Connect**: Client establishes WebSocket connection
2. **Subscribe**: Server registers client for events
3. **Stream**: Server sends events as they occur
4. **Heartbeat**: Client sends ping every 30s, server responds with pong
5. **Disconnect**: Either side closes connection
6. **Reconnect**: Client automatically reconnects with exponential backoff

### Reconnection Strategy

```typescript
// Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (max)
const delay = Math.min(
  initialDelay * Math.pow(2, attempt - 1),
  maxDelay
);
```

## Event Types

### Workflow Events

#### workflow_start
```json
{
  "type": "workflow_start",
  "data": {
    "workflow_id": "workflow-123",
    "workflow_name": "My Workflow",
    "total_actions": 10
  }
}
```

#### workflow_complete
```json
{
  "type": "workflow_complete",
  "data": {
    "status": "completed",
    "summary": {
      "total_actions": 10,
      "completed": 10,
      "failed": 0
    }
  }
}
```

#### workflow_error
```json
{
  "type": "workflow_error",
  "data": {
    "error": "Execution failed: Connection timeout"
  }
}
```

### Action Events

#### action_start
```json
{
  "type": "action_start",
  "action_id": "action-1",
  "action_type": "find"
}
```

#### action_complete
```json
{
  "type": "action_complete",
  "action_id": "action-1",
  "action_type": "find",
  "data": {
    "success": true,
    "result": {
      "found": true,
      "position": [100, 200]
    },
    "duration": 150
  }
}
```

#### action_error
```json
{
  "type": "action_error",
  "action_id": "action-1",
  "action_type": "find",
  "data": {
    "error": "Element not found",
    "stack": "..."
  }
}
```

#### action_skip
```json
{
  "type": "action_skip",
  "action_id": "action-1",
  "action_type": "find",
  "data": {
    "reason": "Condition not met"
  }
}
```

### Control Events

#### breakpoint
```json
{
  "type": "breakpoint",
  "action_id": "action-1",
  "action_type": "find"
}
```

#### variable_update
```json
{
  "type": "variable_update",
  "data": {
    "variables": {
      "counter": 5,
      "result": "success"
    }
  }
}
```

#### log
```json
{
  "type": "log",
  "data": {
    "message": "Processing item 5/10",
    "level": "info"
  }
}
```

## State Synchronization

### Frontend State Updates

1. **WebSocket Events** (primary)
   - Real-time event streaming
   - Low latency updates
   - Automatic reconnection

2. **HTTP Polling** (fallback)
   - Poll every 1 second
   - Used when WebSocket unavailable
   - Stops when execution completes

### State Consistency

```typescript
// ExecutionStore ensures consistency
processExecutionEvent(event: ExecutionEvent) {
  switch (event.type) {
    case 'action_start':
      updateActionState(event.actionId, {
        status: 'running',
        startTime: event.timestamp
      });
      break;

    case 'action_complete':
      updateActionState(event.actionId, {
        status: 'completed',
        endTime: event.timestamp,
        duration: calculateDuration(...)
      });
      break;
  }
}
```

### Visual Updates

```typescript
// Update canvas nodes in real-time
useEffect(() => {
  const nodes = updateNodesExecutionState(
    canvasNodes,
    actionStates,
    { showGlow: true, animate: true }
  );
  setNodes(nodes);
}, [actionStates]);
```

## Error Handling

### Network Errors

#### Connection Timeout
```typescript
try {
  await backendAPI.executeWorkflow(workflow);
} catch (error) {
  if (error.code === 'ETIMEDOUT') {
    // Show timeout error
    showError('Request timed out. Please try again.');
  }
}
```

#### WebSocket Disconnection
```typescript
ws.onclose = (event) => {
  if (!isManualClose) {
    // Automatic reconnection
    scheduleReconnect();
  }
};
```

### Execution Errors

#### Action Failure
```json
{
  "type": "action_error",
  "action_id": "action-1",
  "data": {
    "error": "Element not found",
    "continue": true
  }
}
```

#### Workflow Failure
```json
{
  "type": "workflow_error",
  "data": {
    "error": "Critical error: System unavailable",
    "fatal": true
  }
}
```

### Error Recovery

```typescript
// Retry failed requests
async function requestWithRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      await delay(1000 * Math.pow(2, i));
    }
  }
}
```

## Usage Examples

### Basic Execution

```typescript
import { useExecutionStore } from '@/stores/execution-store';
import { useCanvasStore } from '@/stores/canvas-store';

function ExecutionControls() {
  const { workflow } = useCanvasStore();
  const { startExecution, pauseExecution, cancelExecution, isExecuting } = useExecutionStore();

  const handleExecute = async () => {
    if (!workflow) return;

    try {
      await startExecution(workflow);
    } catch (error) {
      console.error('Execution failed:', error);
    }
  };

  return (
    <div>
      <button onClick={handleExecute} disabled={isExecuting}>
        Execute
      </button>
      <button onClick={pauseExecution} disabled={!isExecuting}>
        Pause
      </button>
      <button onClick={cancelExecution} disabled={!isExecuting}>
        Cancel
      </button>
    </div>
  );
}
```

### Debug Mode with Breakpoints

```typescript
const handleDebugExecution = async () => {
  await startExecution(workflow, {
    debugMode: true,
    breakpoints: ['action-1', 'action-5'],
    stepMode: false
  });
};
```

### Step-by-Step Execution

```typescript
const { startExecution, stepExecution } = useExecutionStore();

// Start in step mode
await startExecution(workflow, { stepMode: true });

// Execute next action
await stepExecution();
```

### Event Monitoring

```typescript
const { executionEvents } = useExecutionStore();

useEffect(() => {
  const lastEvent = executionEvents[executionEvents.length - 1];
  if (lastEvent?.type === 'action_complete') {
    console.log('Action completed:', lastEvent.actionId);
  }
}, [executionEvents]);
```

### Real-Time Visualization

```typescript
import { updateNodesExecutionState } from '@/components/workflow-canvas/execution-visualization';

function WorkflowCanvas() {
  const { actionStates } = useExecutionStore();
  const [nodes, setNodes] = useNodesState([]);

  useEffect(() => {
    const updatedNodes = updateNodesExecutionState(
      nodes,
      actionStates,
      { showGlow: true, animate: true }
    );
    setNodes(updatedNodes);
  }, [actionStates]);

  // ... render canvas
}
```

## Deployment Guide

### Backend Deployment

#### 1. Install Dependencies

```bash
cd qontinui
pip install fastapi uvicorn websockets pydantic
```

#### 2. Start Server

```bash
# Development
python -m qontinui.api.execution_api

# Production with uvicorn
uvicorn qontinui.api.execution_api:app --host 0.0.0.0 --port 8000 --workers 4
```

#### 3. Docker Deployment

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY qontinui /app/qontinui
COPY requirements.txt /app/

RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 8000

CMD ["uvicorn", "qontinui.api.execution_api:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Frontend Configuration

#### 1. Environment Variables

```env
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
```

#### 2. Production Configuration

```typescript
// backend-api.ts
const DEFAULT_CONFIG: BackendAPIConfig = {
  baseUrl: process.env.NEXT_PUBLIC_API_URL || 'https://api.example.com',
  wsUrl: process.env.NEXT_PUBLIC_WS_URL || 'wss://api.example.com',
  timeout: 30000,
  retries: 3,
};
```

### CORS Configuration

```python
# execution_api.py
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://app.example.com"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## Troubleshooting

### Common Issues

#### 1. WebSocket Connection Fails

**Symptoms**: Events not streaming, connection closes immediately

**Solutions**:
- Check WebSocket URL format (ws:// vs wss://)
- Verify CORS configuration
- Check firewall/proxy settings
- Ensure backend is running

#### 2. Execution Stuck in "Running" State

**Symptoms**: Progress bar not updating, no new events

**Solutions**:
- Check backend logs for errors
- Verify action executor is working
- Check for infinite loops in workflow
- Restart backend server

#### 3. High Memory Usage

**Symptoms**: Slow performance, browser/server crashes

**Solutions**:
- Limit event history size
- Clear old executions from history
- Reduce WebSocket message frequency
- Implement event pruning

#### 4. Events Arrive Out of Order

**Symptoms**: UI updates in wrong sequence

**Solutions**:
- Use event timestamps for ordering
- Implement event sequence numbers
- Check network latency
- Enable event buffering

### Debug Tools

#### Enable Debug Logging

```typescript
// Frontend
localStorage.setItem('debug', 'execution:*');

// Backend
import logging
logging.basicConfig(level=logging.DEBUG)
```

#### Monitor WebSocket Traffic

```javascript
// Browser DevTools > Network > WS tab
// Or use websocket debugging tools
```

#### Inspect Execution State

```typescript
// Redux DevTools integration
import { devtools } from 'zustand/middleware';

export const useExecutionStore = create<ExecutionStore>()(
  devtools(
    (set, get) => ({
      // ... store implementation
    }),
    { name: 'ExecutionStore' }
  )
);
```

## Performance Optimization

### Backend Optimizations

1. **Async Execution**: Use asyncio for concurrent operations
2. **Event Batching**: Group multiple events into batches
3. **Connection Pooling**: Reuse database/resource connections
4. **Worker Processes**: Scale with multiple uvicorn workers

### Frontend Optimizations

1. **Selective Re-renders**: Use React.memo and useMemo
2. **Event Throttling**: Limit UI update frequency
3. **Virtual Scrolling**: For large event lists
4. **WebSocket Buffering**: Batch event processing

## Security Considerations

1. **Authentication**: Add JWT tokens to API requests
2. **Authorization**: Verify user permissions for workflows
3. **Input Validation**: Validate all workflow definitions
4. **Rate Limiting**: Prevent API abuse
5. **Secure WebSocket**: Use WSS (WebSocket Secure) in production

## Future Enhancements

1. **Execution Replay**: Replay past executions for debugging
2. **Live Collaboration**: Multiple users watching same execution
3. **Performance Metrics**: Detailed timing and profiling
4. **Execution Snapshots**: Save/restore execution state
5. **Advanced Debugging**: Set conditional breakpoints

---

**Version**: 1.0.0
**Last Updated**: 2025-10-16
**Maintainer**: Joshua Spinak
