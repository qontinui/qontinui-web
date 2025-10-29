# Workflow Canvas - Quick Start Guide

Get started with the React Flow canvas in 5 minutes.

## Installation

Dependencies are already installed:
```bash
✅ reactflow@11.11.4
✅ @xyflow/react@12.8.5
✅ zustand@4.5.0
```

## Basic Usage

### 1. Import the Component

```tsx
import { WorkflowCanvas } from '@/components/workflow-canvas';
import { Workflow } from '@/lib/action-schema/action-types';
```

### 2. Create a Simple Workflow

```tsx
const myWorkflow: Workflow = {
  id: 'my-first-workflow',
  name: 'Click Button',
  version: '1.0.0',
  format: 'graph',
  actions: [
    {
      id: 'action-1',
      type: 'FIND',
      position: [100, 100],
      config: {
        findBy: 'text',
        text: 'Submit',
        searchMultiple: false,
        searchRegions: [],
        score: 0.8,
      },
    },
    {
      id: 'action-2',
      type: 'CLICK',
      position: [100, 250],
      config: {
        findBy: 'text',
        text: 'Submit',
        searchMultiple: false,
        searchRegions: [],
        mouseButton: 'LEFT',
        numberOfClicks: 1,
        offsetX: 0,
        offsetY: 0,
      },
    },
  ],
  connections: {
    'action-1': {
      main: [[{ action: 'action-2', type: 'main', index: 0 }]],
    },
  },
};
```

### 3. Use the Canvas

```tsx
function MyComponent() {
  const [workflow, setWorkflow] = useState(myWorkflow);

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

## Common Patterns

### Branching with IF

```tsx
const branchingWorkflow: Workflow = {
  id: 'branching',
  name: 'Conditional Logic',
  version: '1.0.0',
  format: 'graph',
  actions: [
    {
      id: 'check',
      type: 'IF',
      position: [100, 100],
      config: {
        condition: 'found',
        operator: 'equals',
        value: true,
      },
    },
    {
      id: 'success',
      type: 'CLICK',
      position: [300, 100],
      config: { /* ... */ },
    },
    {
      id: 'failure',
      type: 'SCREENSHOT',
      position: [300, 250],
      config: { /* ... */ },
    },
  ],
  connections: {
    'check': {
      main: [
        [{ action: 'success', type: 'main', index: 0 }], // True branch
        [{ action: 'failure', type: 'main', index: 0 }], // False branch
      ],
    },
  },
};
```

### Error Handling with TRY_CATCH

```tsx
connections: {
  'try-action': {
    main: [[{ action: 'success-action', type: 'main', index: 0 }]],
    error: [[{ action: 'error-action', type: 'main', index: 0 }]],
  },
}
```

### Read-Only Mode

```tsx
<WorkflowCanvas
  workflow={workflow}
  onWorkflowChange={() => {}}
  readonly={true}
/>
```

### Handle Node Clicks

```tsx
<WorkflowCanvas
  workflow={workflow}
  onWorkflowChange={setWorkflow}
  onNodeClick={(action) => {
    console.log('Clicked action:', action.type);
    setSelectedAction(action);
  }}
/>
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Delete` | Delete selected nodes/edges |
| `Ctrl+A` | Select all nodes |
| `Ctrl+F` | Fit view to all nodes |
| `Ctrl+L` | Auto-layout nodes |

## Action Categories & Colors

| Category | Color | Actions |
|----------|-------|---------|
| Find | Cyan | FIND, VANISH, EXISTS, WAIT |
| Mouse | Green | CLICK, DRAG, SCROLL |
| Keyboard | Purple | TYPE, KEY_PRESS, HOTKEY |
| Control Flow | Orange | IF, LOOP, SWITCH, TRY_CATCH |
| Data | Blue | SET_VARIABLE, FILTER, MAP |
| State | Pink | GO_TO_STATE, RUN_PROCESS |

## Using createAction Helper

```tsx
import { createAction } from '@/lib/action-schema/action-types';

const action = createAction(
  'CLICK',                    // type
  {                           // config
    findBy: 'text',
    text: 'Submit',
    searchMultiple: false,
    searchRegions: [],
    mouseButton: 'LEFT',
    numberOfClicks: 1,
    offsetX: 0,
    offsetY: 0,
  },
  [100, 100],                 // position [x, y]
  {                           // options
    id: 'my-click-action',
    name: 'Click Submit Button',
  }
);
```

## Utilities

### Convert Workflow

```tsx
import { workflowToReactFlow, reactFlowToWorkflow } from '@/components/workflow-canvas';

// To React Flow
const { nodes, edges } = workflowToReactFlow(workflow);

// From React Flow
const workflow = reactFlowToWorkflow(nodes, edges, 'workflow-id', 'Workflow Name');
```

### Auto-Layout

```tsx
import { autoLayout } from '@/components/workflow-canvas';

const layoutedActions = autoLayout(workflow);
const updatedWorkflow = {
  ...workflow,
  actions: layoutedActions,
};
```

### Validate Connection

```tsx
import { validateConnection } from '@/components/workflow-canvas';

const result = validateConnection(
  { source: 'action-1', target: 'action-2', sourceHandle: 'main-0', targetHandle: 'input-0' },
  nodes,
  edges
);

if (!result.valid) {
  console.error(result.message);
}
```

## Styling Options

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
    maxZoom: 2.0,
    defaultZoom: 1.0,
  }}
/>
```

## Complete Example

```tsx
'use client';

import React, { useState } from 'react';
import { WorkflowCanvas } from '@/components/workflow-canvas';
import { Workflow, createAction } from '@/lib/action-schema/action-types';

export function MyWorkflowEditor() {
  const [workflow, setWorkflow] = useState<Workflow>({
    id: 'example',
    name: 'Login Automation',
    version: '1.0.0',
    format: 'graph',
    actions: [
      createAction(
        'FIND',
        {
          findBy: 'text',
          text: 'Login',
          searchMultiple: false,
          searchRegions: [],
          score: 0.8,
        },
        [100, 100],
        { id: 'find-login', name: 'Find Login Button' }
      ),
      createAction(
        'CLICK',
        {
          findBy: 'text',
          text: 'Login',
          searchMultiple: false,
          searchRegions: [],
          mouseButton: 'LEFT',
          numberOfClicks: 1,
          offsetX: 0,
          offsetY: 0,
        },
        [100, 250],
        { id: 'click-login', name: 'Click Login' }
      ),
    ],
    connections: {
      'find-login': {
        main: [[{ action: 'click-login', type: 'main', index: 0 }]],
      },
    },
  });

  const handleSave = () => {
    console.log('Saving workflow:', workflow);
    // Save to backend
  };

  return (
    <div className="h-screen flex flex-col">
      <div className="p-4 bg-gray-800 flex justify-between items-center">
        <h1 className="text-xl font-bold">{workflow.name}</h1>
        <button
          onClick={handleSave}
          className="px-4 py-2 bg-blue-500 text-white rounded"
        >
          Save Workflow
        </button>
      </div>

      <div className="flex-1">
        <WorkflowCanvas
          workflow={workflow}
          onWorkflowChange={setWorkflow}
          onNodeClick={(action) => {
            console.log('Selected action:', action);
          }}
        />
      </div>
    </div>
  );
}
```

## Next Steps

1. **Explore Examples**: Check `WorkflowCanvas.example.tsx` for more patterns
2. **Read Full Docs**: See `README.md` for complete API reference
3. **Run Tests**: `npm test -- WorkflowCanvas.test.tsx`
4. **Customize**: Modify colors in `canvas-config.ts`

## Common Issues

### Canvas not rendering?
- Ensure parent has explicit height (e.g., `height: 600px`)
- Check that workflow has `format: 'graph'`

### Connections not working?
- Verify action IDs are unique
- Check that connection references exist in actions array
- Use validation utilities to debug

### Performance issues?
- Enable virtualization for >100 nodes
- Disable animations for >200 nodes
- Use auto-layout for complex workflows

## Support

- **Documentation**: `/src/components/workflow-canvas/README.md`
- **Examples**: `/src/components/workflow-canvas/WorkflowCanvas.example.tsx`
- **Tests**: `/src/components/workflow-canvas/WorkflowCanvas.test.tsx`
- **Report**: `/docs/AGENT_16_REACT_FLOW_IMPLEMENTATION_REPORT.md`

---

**Ready to build workflows!** 🚀
