# UI Bridge Integration for qontinui-web

This module integrates the UI Bridge framework for remote automation of the qontinui-web frontend.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ External Client (Runner / Python / AI)                                       │
│                                                                             │
│  client.ai.execute("click Start Extraction button")                        │
│       │                                                                     │
└───────┼─────────────────────────────────────────────────────────────────────┘
        │
        │ HTTP POST /__ui-bridge__/ai/execute
        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ qontinui-web Frontend (Next.js API Routes)                                   │
│                                                                             │
│  /api/ui-bridge/[...path]/route.ts                                         │
│       │                                                                     │
│       ▼                                                                     │
│  handlers.ts :: aiExecute()                                                 │
│       │                                                                     │
│       ├─────────────────────────────────────────┐                          │
│       │ Queue command                           │                          │
│       │ Wait for browser response               │                          │
│       ▼                                         │                          │
│  Command Queue (in-memory)                      │                          │
│                                                 │                          │
└─────────┬───────────────────────────────────────┼──────────────────────────┘
          │                                       │
          │ GET /api/ui-bridge/commands           │ POST /api/ui-bridge/commands
          │ (poll for pending commands)           │ (submit response)
          ▼                                       │
┌─────────────────────────────────────────────────┼──────────────────────────┐
│ Browser (React App)                             │                          │
│                                                 │                          │
│  UIBridgeCommandListener                        │                          │
│       │                                         │                          │
│       ▼                                         │                          │
│  useUIBridgeCommandHandler()                    │                          │
│       │                                         │                          │
│       │ Execute command                         │                          │
│       ▼                                         │                          │
│  UIBridgeRegistry ─────────────────────────────►│                          │
│       │                                                                     │
│       │ Query elements, execute actions                                     │
│       ▼                                                                     │
│  DOM (with data-ui-id attributes from SWC plugin)                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Components

### Server-Side (Next.js API)

- **handlers.ts**: Implements all UI Bridge API endpoints
  - Queues commands for browser execution
  - Maintains cached state (control snapshot, semantic snapshot)
  - Returns responses when browser completes execution

- **/api/ui-bridge/commands/route.ts**: Command queue API
  - `GET`: Poll for pending commands
  - `POST`: Submit command responses

### Client-Side (React)

- **UIBridgeWrapper**: Provider component that sets up UI Bridge
  - Enables AutoRegisterProvider for element discovery
  - Includes UIBridgeCommandListener for remote automation

- **useUIBridgeCommandHandler**: Hook that polls and executes commands
  - Polls every 500ms for pending commands
  - Executes commands using UIBridgeRegistry
  - Sends responses back to server

## Supported Commands

### Control Actions
- `getControlSnapshot`: Get all registered elements
- `getElementState`: Get state of a specific element
- `executeElementAction`: Execute action (click, type, etc.)
- `highlightElement`: Highlight element for debugging

### AI-Native Actions
- `aiSearch`: Search elements by text, role, accessibility
- `aiExecute`: Execute natural language instruction
- `aiAssert`: Make assertion about element state
- `aiAssertBatch`: Batch assertions
- `getSemanticSnapshot`: Get AI-friendly page snapshot
- `getPageSummary`: Get LLM-readable summary

## Usage

### From Python Client

```python
from ui_bridge import UIBridgeClient

client = UIBridgeClient("http://localhost:3001/__ui-bridge__")

# Search for an element
results = client.ai.search(text="Start Extraction")

# Execute natural language command
response = client.ai.execute("click the Start Extraction button")

# Make assertion
result = client.ai.assert_that("error message", "hidden")
```

### From qontinui-runner

The runner can control qontinui-web via the UI Bridge API:

```rust
// HTTP call to UI Bridge
let response = client
    .post("http://localhost:3001/__ui-bridge__/ai/execute")
    .json(&json!({ "instruction": "click Submit button" }))
    .send()
    .await?;
```

## SWC Plugin Integration

The `@qontinui/ui-bridge-swc-plugin` automatically instruments JSX elements:

```jsx
// Input (developer code)
<button onClick={handleSubmit}>Start Extraction</button>

// Output (after SWC transform)
<button
  onClick={handleSubmit}
  data-ui-id="ui-ExtractionPage-start-extraction-button"
  data-ui-type="button"
  data-ui-aliases="start extraction,extraction,start"
>
  Start Extraction
</button>
```

## Configuration

### Enable Remote Commands

Remote command listening is enabled by default in development:

```tsx
// In your layout or app wrapper
<UIBridgeWrapper enableRemoteCommands={true}>
  {children}
</UIBridgeWrapper>
```

### CORS Configuration

The `next.config.mjs` includes CORS headers for `/__ui-bridge__` routes:

```javascript
{
  source: '/__ui-bridge__/:path*',
  headers: [
    { key: 'Access-Control-Allow-Origin', value: '*' },
    // ...
  ],
}
```

## Alternative: WebSocket Relay

For lower latency, commands can be relayed via WebSocket instead of polling:

1. Runner sends `ui_bridge_command` message via existing WebSocket
2. Backend broadcasts to dashboard clients via Redis
3. Browser receives and executes command
4. Browser sends response via REST API

This approach reuses the existing WebSocket infrastructure but requires:
- Extending the dashboard WebSocket handler to process UI Bridge commands
- Correlation logic to match responses to requests

The polling approach is simpler and works well for most use cases.
