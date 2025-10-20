# Workflow Canvas Nodes

Custom React Flow node components for qontinui's workflow canvas. This directory contains all node visualizations for the 30+ action types supported by qontinui.

## Overview

Each action type in qontinui has a corresponding visual node component that renders in the React Flow canvas. These nodes provide:

- **Visual representation** of action types with icons and colors
- **Configuration summary** showing key action parameters
- **Connection handles** for linking actions together
- **Execution state** indicators (running, completed, failed)
- **Multi-output support** for branching actions (IF, LOOP, SWITCH)
- **Consistent styling** based on action categories

## Architecture

```
nodes/
├── BaseNode.tsx              # Shared base component
├── handles.tsx               # Connection handle components
├── node-icons.tsx            # Icon system for all action types
├── node-utils.ts             # Utility functions
├── node-registry.ts          # Action type → component mapping
├── nodes.css                 # All node styling
│
├── ControlFlowNodes.tsx      # IF, LOOP, SWITCH, BREAK, CONTINUE, TRY_CATCH
├── GuiActionNodes.tsx        # CLICK, TYPE, FIND, WAIT, SCREENSHOT, etc.
├── DataOperationNodes.tsx    # SET_VARIABLE, FILTER, MAP, SORT, etc.
├── SpecialNodes.tsx          # START, END, COMMENT, GROUP, MERGE
│
└── index.ts                  # Main export file
```

## Node Categories

### 1. Control Flow Nodes (Blue/Purple)

**Multi-output nodes with conditional/looping logic:**

- **IF** - 2 outputs (true/false)
- **LOOP** - 2 outputs (loop/exit)
- **SWITCH** - N outputs (case_0, case_1, ..., default)
- **TRY_CATCH** - 2 outputs (success/error)
- **BREAK** - Terminal node (no outputs)
- **CONTINUE** - Terminal node (no outputs)

### 2. GUI Action Nodes (Green/Cyan/Amber)

**Mouse actions (Green):**
- CLICK, DOUBLE_CLICK, RIGHT_CLICK
- MOUSE_MOVE, MOUSE_DOWN, MOUSE_UP
- DRAG, SCROLL

**Keyboard actions (Cyan):**
- TYPE, KEY_PRESS, HOTKEY
- KEY_DOWN, KEY_UP

**Find actions (Amber):**
- FIND, FIND_STATE_IMAGE
- VANISH, EXISTS, WAIT

### 3. Data Operation Nodes (Orange/Purple/Pink/Teal)

**Variable operations (Orange):**
- SET_VARIABLE, GET_VARIABLE

**Collection operations (Purple):**
- FILTER, MAP, REDUCE, SORT

**String operations (Pink):**
- STRING_OPERATION (concat, substring, replace, etc.)

**Math operations (Teal):**
- MATH_OPERATION (add, subtract, multiply, etc.)

### 4. Special Nodes

- **START** - Entry point (green)
- **END** - Exit point (red)
- **COMMENT** - Annotations (yellow, dashed)
- **GROUP** - Visual grouping (gray, dashed)
- **MERGE** - Merge point (blue)
- **GO_TO_STATE** - State transition (indigo)
- **RUN_PROCESS** - Sub-workflow (violet)

## Usage

### Basic Usage with React Flow

```tsx
import ReactFlow from '@xyflow/react';
import { NODE_TYPES } from '@/components/workflow-canvas/nodes';
import '@/components/workflow-canvas/nodes/nodes.css';

function WorkflowCanvas() {
  const nodes = [
    {
      id: '1',
      type: 'CLICK', // Action type
      position: { x: 100, y: 100 },
      data: {
        action: {
          id: '1',
          type: 'CLICK',
          config: { /* ... */ },
          position: [100, 100],
        },
        executionState: 'idle',
      },
    },
  ];

  return (
    <ReactFlow
      nodes={nodes}
      nodeTypes={NODE_TYPES}
      // ... other props
    />
  );
}
```

### Creating a Node from an Action

```tsx
import { Action } from '@/lib/action-schema/action-types';
import { getNodeComponent, getNodeSummary } from '@/components/workflow-canvas/nodes';

function createNodeFromAction(action: Action, position: { x: number; y: number }) {
  return {
    id: action.id,
    type: action.type,
    position,
    data: {
      action,
      executionState: 'idle',
      onNodeClick: (id) => console.log('Node clicked:', id),
      onNodeDoubleClick: (id) => console.log('Node double-clicked:', id),
    },
  };
}
```

### Handling Multi-Output Nodes

```tsx
// IF node with true/false branches
const ifNode = {
  id: 'if-1',
  type: 'IF',
  data: {
    action: {
      id: 'if-1',
      type: 'IF',
      config: {
        condition: { type: 'expression', expression: 'x > 10' },
        thenActions: ['action-2'],
        elseActions: ['action-3'],
      },
      position: [200, 200],
    },
  },
};

// Connections from IF node
const edges = [
  {
    id: 'e1',
    source: 'if-1',
    sourceHandle: 'true',  // True branch
    target: 'action-2',
  },
  {
    id: 'e2',
    source: 'if-1',
    sourceHandle: 'false', // False branch
    target: 'action-3',
  },
];
```

### Setting Execution State

```tsx
// Update node execution state
const updateNodeState = (nodeId: string, state: 'running' | 'completed' | 'failed') => {
  setNodes((nodes) =>
    nodes.map((node) =>
      node.id === nodeId
        ? { ...node, data: { ...node.data, executionState: state } }
        : node
    )
  );
};

// During workflow execution
updateNodeState('action-1', 'running');
// ... after action completes
updateNodeState('action-1', 'completed');
```

## Node Components

### BaseNode

The foundation for all node types. Provides:

```tsx
<BaseNode
  id="action-1"
  data={{
    action: /* Action object */,
    executionState: 'idle' | 'running' | 'completed' | 'failed' | 'skipped',
    error?: string,
    onNodeClick?: (id) => void,
    onNodeDoubleClick?: (id) => void,
  }}
  showInputHandle={true}
  showOutputHandle={true}
  outputHandleIds={['main']}
  className="custom-class"
  compact={false}
/>
```

### MultiOutputNode

Variant for actions with multiple outputs (IF, LOOP, SWITCH, TRY_CATCH):

```tsx
<MultiOutputNode
  {...props}
  outputLabels={[
    { id: 'true', label: 'True', color: 'bg-green-500 text-white' },
    { id: 'false', label: 'False', color: 'bg-red-500 text-white' },
  ]}
/>
```

### CompactNode

Smaller variant for simple actions (WAIT, GET_VARIABLE):

```tsx
<CompactNode {...props} />
```

## Handle System

### Connection Handles

Each node has connection points (handles) for linking actions:

- **Input handle** (left side) - Single handle for incoming connections
- **Output handles** (right side) - One or more handles for outgoing connections

### Multi-Output Configuration

For actions with multiple outputs:

```tsx
import { MultiOutputHandles } from '@/components/workflow-canvas/nodes';

// IF node outputs
<MultiOutputHandles
  outputs={[
    { id: 'true', label: 'True', color: '#10b981' },
    { id: 'false', label: 'False', color: '#ef4444' },
  ]}
  showLabels={true}
/>

// SWITCH node outputs (dynamic based on cases)
<MultiOutputHandles
  outputs={getSwitchOutputHandles(caseCount)}
/>
```

### Handle IDs by Action Type

- **Standard actions**: `main`
- **IF**: `true`, `false`
- **LOOP**: `loop`, `main`
- **TRY_CATCH**: `main`, `error`
- **SWITCH**: `case_0`, `case_1`, ..., `default`

## Styling

### Category Colors

Node borders are colored by category:

- **Find actions** - Amber (#fbbf24)
- **Mouse actions** - Green (#10b981)
- **Keyboard actions** - Cyan (#06b6d4)
- **Control flow** - Blue (#3b82f6) / Purple (#8b5cf6)
- **Data operations** - Orange (#f97316)
- **State actions** - Indigo (#6366f1)
- **Special nodes** - Gray (#9ca3af)

### Execution States

Nodes display visual indicators for execution state:

- **Running** - Pulsing blue ring
- **Completed** - Green border + checkmark badge
- **Failed** - Red border + X badge
- **Skipped** - 50% opacity

### Customizing Styles

Override styles using CSS classes:

```css
/* Custom node styling */
.my-custom-node {
  border-width: 3px;
  border-color: #6366f1;
  background: linear-gradient(135deg, #dbeafe, #bfdbfe);
}

/* Custom handle styling */
.my-custom-node .node-handle {
  background: #6366f1;
  width: 16px;
  height: 16px;
}
```

## Utilities

### Node Utilities (node-utils.ts)

```tsx
import {
  getNodeCategory,
  getNodeSummary,
  getOutputCount,
  getOutputHandleIds,
  getNodeDimensions,
  validateNodeConfig,
  isTerminalNode,
  isBranchingNode,
} from '@/components/workflow-canvas/nodes';

// Get category for styling
const category = getNodeCategory('CLICK'); // 'mouse'

// Generate display summary
const summary = getNodeSummary(action); // "Click 'Login Button'"

// Get output configuration
const outputCount = getOutputCount(action); // 1 for CLICK, 2 for IF
const handleIds = getOutputHandleIds(action); // ['main'] or ['true', 'false']

// Get recommended dimensions
const dimensions = getNodeDimensions(action); // { width: 180, height: 80 }

// Validate configuration
const validation = validateNodeConfig(action);
if (!validation.valid) {
  console.error('Invalid config:', validation.errors);
}

// Check node type
if (isTerminalNode(action.type)) {
  // No outputs (BREAK, CONTINUE)
}

if (isBranchingNode(action.type)) {
  // Multiple outputs (IF, LOOP, SWITCH, TRY_CATCH)
}
```

### Icon System (node-icons.tsx)

```tsx
import { getNodeIcon, NodeIcon } from '@/components/workflow-canvas/nodes';

// Get icon component for action type
const Icon = getNodeIcon('CLICK'); // MousePointerClick from lucide-react

// Render icon
<NodeIcon actionType="CLICK" className="w-4 h-4" size={16} />
```

## Adding New Node Types

To add a new action type:

### 1. Define in Schema

```typescript
// action-types.ts
export type NewActionType = 'MY_NEW_ACTION';

export interface MyNewActionConfig {
  property1: string;
  property2: number;
}

export interface ActionConfigMap {
  // ... existing types
  MY_NEW_ACTION: MyNewActionConfig;
}
```

### 2. Create Node Component

```tsx
// In appropriate category file (e.g., GuiActionNodes.tsx)
export function MyNewActionNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as MyNewActionConfig;

  return (
    <BaseNode
      {...props}
      className="gui-action-node my-new-action-node border-blue-400"
    />
  );
}
```

### 3. Register in Registry

```typescript
// node-registry.ts
export const NODE_TYPES: Record<ActionType, NodeComponent> = {
  // ... existing types
  MY_NEW_ACTION: GuiActionNodes.MY_NEW_ACTION,
};
```

### 4. Add Icon

```typescript
// node-icons.tsx
import { MyIcon } from 'lucide-react';

const ACTION_ICONS: Record<ActionType, LucideIcon> = {
  // ... existing icons
  MY_NEW_ACTION: MyIcon,
};
```

### 5. Add Summary Logic

```typescript
// node-utils.ts
export function getNodeSummary(action: Action): string {
  switch (action.type) {
    // ... existing cases
    case 'MY_NEW_ACTION':
      const config = action.config as MyNewActionConfig;
      return `My action: ${config.property1}`;
  }
}
```

### 6. Add Styling (Optional)

```css
/* nodes.css */
.my-new-action-node {
  border-color: #3b82f6;
}

.my-new-action-node .node-header {
  background: linear-gradient(to bottom, #dbeafe, #bfdbfe);
}
```

## Testing

Example test for a node component:

```tsx
import { render, screen } from '@testing-library/react';
import { ClickNode } from './GuiActionNodes';
import { Action } from '@/lib/action-schema/action-types';

describe('ClickNode', () => {
  it('renders with correct summary', () => {
    const action: Action<'CLICK'> = {
      id: 'click-1',
      type: 'CLICK',
      config: {
        target: { text: 'Submit' },
      },
      position: [0, 0],
    };

    render(
      <ClickNode
        id="click-1"
        data={{ action }}
        selected={false}
        type="CLICK"
        // ... other required props
      />
    );

    expect(screen.getByText('Click "Submit"')).toBeInTheDocument();
  });

  it('shows execution state', () => {
    // Test execution state indicators
  });

  it('renders handles correctly', () => {
    // Test input/output handles
  });
});
```

## Best Practices

1. **Keep nodes compact** - Aim for 180x80px for standard nodes
2. **Show relevant info only** - Don't overcrowd the node with config details
3. **Use consistent colors** - Follow the category color scheme
4. **Handle errors gracefully** - Show error state in the node
5. **Support keyboard navigation** - Ensure nodes are focusable
6. **Test with different configs** - Validate node rendering with various configurations
7. **Optimize performance** - Memoize expensive calculations
8. **Support dark mode** - Use theme-aware colors

## Examples

### Complete Workflow Example

```tsx
import ReactFlow, { Background, Controls, MiniMap } from '@xyflow/react';
import { NODE_TYPES } from '@/components/workflow-canvas/nodes';
import '@xyflow/react/dist/style.css';
import '@/components/workflow-canvas/nodes/nodes.css';

function WorkflowCanvas() {
  const nodes = [
    {
      id: '1',
      type: 'CLICK',
      position: { x: 100, y: 100 },
      data: {
        action: {
          id: '1',
          type: 'CLICK',
          config: { target: { text: 'Login' } },
          position: [100, 100],
        },
      },
    },
    {
      id: '2',
      type: 'IF',
      position: { x: 300, y: 100 },
      data: {
        action: {
          id: '2',
          type: 'IF',
          config: {
            condition: { type: 'image_exists', imageId: 'success-icon' },
            thenActions: ['3'],
            elseActions: ['4'],
          },
          position: [300, 100],
        },
      },
    },
    {
      id: '3',
      type: 'SCREENSHOT',
      position: { x: 500, y: 50 },
      data: {
        action: {
          id: '3',
          type: 'SCREENSHOT',
          config: { region: 'fullscreen' },
          position: [500, 50],
        },
      },
    },
    {
      id: '4',
      type: 'WAIT',
      position: { x: 500, y: 150 },
      data: {
        action: {
          id: '4',
          type: 'WAIT',
          config: { duration: 2000 },
          position: [500, 150],
        },
      },
    },
  ];

  const edges = [
    { id: 'e1', source: '1', target: '2' },
    { id: 'e2', source: '2', sourceHandle: 'true', target: '3' },
    { id: 'e3', source: '2', sourceHandle: 'false', target: '4' },
  ];

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
```

## Troubleshooting

### Node not rendering

- Check that action type is registered in `NODE_TYPES`
- Verify action config matches the expected schema
- Check console for errors

### Handles not connecting

- Verify handle IDs match between source and target
- Check handle configuration in `handles.tsx`
- Ensure `sourceHandle` and `targetHandle` props are set correctly

### Styling issues

- Import `nodes.css` in your app
- Check that category colors are applied correctly
- Verify Tailwind classes are not being purged

### Performance issues

- Memoize node components if rendering many nodes
- Use React Flow's built-in optimization features
- Consider virtualizing large workflows

## Resources

- [React Flow Documentation](https://reactflow.dev)
- [Lucide Icons](https://lucide.dev)
- [Qontinui Action Schema](../../../lib/action-schema/action-types.ts)
- [N8N Analysis Summary](../../../../../../docs/N8N_ANALYSIS_SUMMARY.md)

## License

Part of the qontinui project. See main repository for license information.
