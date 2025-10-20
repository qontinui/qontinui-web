# Workflow Canvas Component

A React Flow-based visual workflow editor for qontinui's graph-based automation workflows.

## Overview

The Workflow Canvas provides a powerful, interactive graph editor for creating and managing workflow automations. It supports:

- Drag-and-drop node positioning
- Connection creation with validation
- Multi-output nodes (IF, SWITCH, TRY_CATCH)
- Keyboard shortcuts
- Auto-layout
- Read-only mode
- Minimap and controls
- Touch/gesture support

## Installation

Dependencies are already included in package.json:

```bash
npm install reactflow@11.11.4 zustand@4.5.0
```

## Basic Usage

```tsx
import { WorkflowCanvas } from '@/components/workflow-canvas';
import { Workflow } from '@/lib/action-schema/action-types';

function MyComponent() {
  const [workflow, setWorkflow] = useState<Workflow>({
    id: 'my-workflow',
    name: 'My Workflow',
    version: '1.0.0',
    format: 'graph',
    actions: [
      // ... your actions
    ],
    connections: {
      // ... your connections
    },
  });

  return (
    <div style={{ width: '100%', height: '600px' }}>
      <WorkflowCanvas
        workflow={workflow}
        onWorkflowChange={setWorkflow}
      />
    </div>
  );
}
```

## Props

### WorkflowCanvasProps

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `workflow` | `Workflow` | Yes | The workflow to display |
| `onWorkflowChange` | `(workflow: Workflow) => void` | Yes | Callback when workflow changes |
| `readonly` | `boolean` | No | Read-only mode (no editing) |
| `onNodeClick` | `(action: Action) => void` | No | Callback when a node is clicked |
| `onEdgeClick` | `(connection: Connection) => void` | No | Callback when an edge is clicked |
| `settings` | `Partial<CanvasSettings>` | No | Canvas settings override |
| `className` | `string` | No | Additional CSS class |
| `style` | `React.CSSProperties` | No | Container style |

## Features

### Node Types

The canvas automatically styles nodes based on their action category:

- **Find Actions** (Cyan): FIND, FIND_STATE_IMAGE, VANISH, EXISTS, WAIT
- **Mouse Actions** (Green): CLICK, DOUBLE_CLICK, RIGHT_CLICK, MOUSE_MOVE, DRAG, SCROLL
- **Keyboard Actions** (Purple): TYPE, KEY_PRESS, KEY_DOWN, KEY_UP, HOTKEY
- **Control Flow** (Orange): IF, LOOP, BREAK, CONTINUE, SWITCH, TRY_CATCH
- **Data Actions** (Blue): SET_VARIABLE, GET_VARIABLE, SORT, FILTER, MAP, REDUCE
- **State Actions** (Pink): GO_TO_STATE, RUN_PROCESS, SCREENSHOT

### Multi-Output Nodes

Some actions have multiple outputs:

- **IF**: 2 outputs (true/false branches)
- **SWITCH**: N+1 outputs (one per case + default)
- **TRY_CATCH**: 2 outputs (try/catch branches)

Outputs are positioned vertically on the right side of the node.

### Connection Types

Edges are color-coded by connection type:

- **Main** (Cyan): Normal execution flow
- **Error** (Red): Error handling
- **Success** (Green): Success conditions
- **Parallel** (Purple, dashed): Parallel execution

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Delete` / `Backspace` | Delete selected nodes/edges |
| `Ctrl/Cmd + A` | Select all nodes |
| `Ctrl/Cmd + F` | Fit view |
| `Ctrl/Cmd + L` | Auto layout |

### Connection Validation

The canvas validates connections automatically:

- Prevents self-connections
- Prevents duplicate connections
- Detects cycles
- Validates output counts
- Provides helpful error messages

## Configuration

### Canvas Settings

```tsx
<WorkflowCanvas
  workflow={workflow}
  onWorkflowChange={setWorkflow}
  settings={{
    snapToGrid: true,
    gridSize: 20,
    showGrid: true,
    showMinimap: true,
    showControls: true,
    minZoom: 0.1,
    maxZoom: 2,
    // ... more settings
  }}
/>
```

Available settings (see `canvas-types.ts` for full list):

- Grid display and snapping
- Zoom limits
- Minimap visibility
- Controls visibility
- Animation settings
- Interaction settings

### Custom Colors

Colors are defined in `canvas-config.ts`:

```typescript
export const COLORS = {
  primary: '#00D9FF',
  find: '#00D9FF',
  mouse: '#00FF88',
  keyboard: '#BD00FF',
  controlFlow: '#FF9D00',
  data: '#0088FF',
  state: '#FF0080',
  // ... more colors
};
```

## API

### Utility Functions

```typescript
import {
  workflowToReactFlow,
  reactFlowToWorkflow,
  validateConnection,
  fitViewport,
  autoLayout,
} from '@/components/workflow-canvas';

// Convert workflow to React Flow format
const { nodes, edges } = workflowToReactFlow(workflow);

// Convert back to workflow
const workflow = reactFlowToWorkflow(nodes, edges, 'id', 'name');

// Validate a connection attempt
const result = validateConnection(attempt, nodes, edges);

// Auto-layout nodes
const layoutedActions = autoLayout(workflow);

// Fit viewport to nodes
const viewport = fitViewport(nodes, width, height, padding);
```

### Node Manipulation

```typescript
import {
  getSelectedNodes,
  getNodeById,
  updateNodePosition,
  updateNodeData,
} from '@/components/workflow-canvas';

// Get selected nodes
const selected = getSelectedNodes(nodes);

// Find node by ID
const node = getNodeById(nodes, 'action-1');

// Update position
const updated = updateNodePosition(nodes, 'action-1', { x: 100, y: 200 });

// Update data
const updated = updateNodeData(nodes, 'action-1', { selected: true });
```

### Edge Manipulation

```typescript
import {
  getConnectedEdges,
  getIncomingEdges,
  getOutgoingEdges,
  updateEdgeAnimation,
} from '@/components/workflow-canvas';

// Get all edges connected to a node
const connected = getConnectedEdges(edges, 'action-1');

// Get incoming edges
const incoming = getIncomingEdges(edges, 'action-1');

// Get outgoing edges
const outgoing = getOutgoingEdges(edges, 'action-1');

// Animate an edge
const animated = updateEdgeAnimation(edges, 'edge-1', true);
```

## Examples

### Simple Linear Workflow

```tsx
const workflow: Workflow = {
  id: 'simple',
  name: 'Simple Flow',
  version: '1.0.0',
  format: 'graph',
  actions: [
    createAction('CLICK', {...}, [100, 100], { id: 'a1' }),
    createAction('WAIT', {...}, [100, 250], { id: 'a2' }),
  ],
  connections: {
    'a1': { main: [[{ action: 'a2', type: 'main', index: 0 }]] },
  },
};
```

### Branching Workflow (IF)

```tsx
const workflow: Workflow = {
  id: 'branching',
  name: 'Branching Flow',
  version: '1.0.0',
  format: 'graph',
  actions: [
    createAction('IF', {...}, [100, 100], { id: 'if' }),
    createAction('CLICK', {...}, [300, 100], { id: 'true' }),
    createAction('SCREENSHOT', {...}, [300, 250], { id: 'false' }),
  ],
  connections: {
    'if': {
      main: [
        [{ action: 'true', type: 'main', index: 0 }],  // Output 0: true
        [{ action: 'false', type: 'main', index: 0 }], // Output 1: false
      ],
    },
  },
};
```

### Error Handling (TRY_CATCH)

```tsx
const workflow: Workflow = {
  id: 'error-handling',
  name: 'Error Handling',
  version: '1.0.0',
  format: 'graph',
  actions: [
    createAction('TRY_CATCH', {...}, [100, 100], { id: 'try' }),
    createAction('CLICK', {...}, [300, 100], { id: 'success' }),
    createAction('SCREENSHOT', {...}, [300, 250], { id: 'error' }),
  ],
  connections: {
    'try': {
      main: [[{ action: 'success', type: 'main', index: 0 }]],
      error: [[{ action: 'error', type: 'main', index: 0 }]],
    },
  },
};
```

### Read-Only Mode

```tsx
<WorkflowCanvas
  workflow={workflow}
  onWorkflowChange={() => {}} // No-op
  readonly={true}
/>
```

## File Structure

```
workflow-canvas/
├── index.ts                    # Module exports
├── README.md                   # This file
├── WorkflowCanvas.tsx          # Main component (650 lines)
├── WorkflowCanvas.css          # Styles (300 lines)
├── WorkflowCanvas.test.tsx     # Tests (450 lines)
├── WorkflowCanvas.example.tsx  # Examples (400 lines)
├── canvas-types.ts             # Type definitions (300 lines)
├── canvas-config.ts            # Configuration (400 lines)
├── canvas-utils.ts             # Utilities (500 lines)
├── CustomEdge.tsx              # Edge component (400 lines)
└── nodes/
    └── DefaultNode.tsx         # Node component (200 lines)
```

## Testing

Run tests:

```bash
npm test -- WorkflowCanvas.test.tsx
```

Test coverage:

- Workflow conversion (to/from React Flow)
- Connection validation
- Cycle detection
- Layout algorithms
- Viewport calculations
- Full roundtrip integrity

## Performance

The canvas is optimized for large workflows:

- Node virtualization for 100+ nodes
- Debounced layout recalculation
- Throttled viewport updates
- Conditional animations
- Efficient React Flow rendering

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (with touch support)

## Accessibility

- Keyboard navigation
- Focus indicators
- ARIA labels (via React Flow)
- Reduced motion support

## Migration from ProcessBuilder

The ProcessBuilder component uses a sequential format. To migrate:

1. Convert existing processes to graph format using conversion utilities
2. Update UI to use WorkflowCanvas instead of ProcessBuilder
3. Test workflows thoroughly

## Known Limitations

- Maximum recommended nodes: ~500 (performance degrades beyond this)
- Mobile experience is functional but desktop is optimal
- Large node labels may overflow (truncated with ellipsis)

## Contributing

When adding new features:

1. Update types in `canvas-types.ts`
2. Add configuration in `canvas-config.ts`
3. Implement utilities in `canvas-utils.ts`
4. Update main component as needed
5. Add tests to `WorkflowCanvas.test.tsx`
6. Add examples to `WorkflowCanvas.example.tsx`

## License

Part of qontinui - see main LICENSE file

## Version

**Version:** 1.0.0
**Date:** January 2025
**React Flow:** 11.11.4
**Author:** Agent 16 (Claude Code)
