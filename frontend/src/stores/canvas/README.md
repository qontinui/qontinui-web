# Canvas Store Architecture

This directory contains the refactored Canvas store, split into focused slices following the Single Responsibility Principle.

## Architecture Overview

The Canvas store has been refactored from a monolithic 945-line file into 9 focused slices, each with a single, clear responsibility. This improves:

- **Maintainability**: Each slice is easier to understand and modify
- **Testability**: Each slice can be tested independently
- **Reusability**: Slices can be composed in different ways
- **Performance**: Better code splitting and tree-shaking

## Directory Structure

```
canvas/
├── index.ts                  # Combined store and re-exports
├── types.ts                  # Shared TypeScript types
├── utils.ts                  # Shared utility functions
├── workflow-slice.ts         # Workflow state and validation
├── action-slice.ts           # Action CRUD operations
├── connection-slice.ts       # Connection management
├── selection-slice.ts        # Selection state
├── clipboard-slice.ts        # Clipboard operations
├── history-slice.ts          # Undo/redo functionality
├── viewport-slice.ts         # Pan/zoom/viewport state
├── preferences-slice.ts      # UI preferences
└── README.md                 # This file
```

## Slices

### 1. Workflow Slice (`workflow-slice.ts`)

**Responsibility**: Manages workflow state and validation

**State**:

- `workflow`: Current workflow data
- `isDirty`: Whether workflow has unsaved changes
- `validationResult`: Validation errors/warnings
- `isValidating`: Validation in progress

**Actions**:

- `setWorkflow()`: Load a workflow
- `clearWorkflow()`: Clear current workflow
- `saveWorkflow()`: Save workflow to backend
- `validateWorkflow()`: Validate workflow structure
- `clearValidation()`: Clear validation results

### 2. Action Slice (`action-slice.ts`)

**Responsibility**: Manages action CRUD operations

**Actions**:

- `addAction()`: Add a new action
- `updateAction()`: Update an existing action
- `deleteAction()`: Delete a single action
- `deleteActions()`: Delete multiple actions
- `duplicateAction()`: Duplicate an action
- `moveAction()`: Move a single action
- `moveActions()`: Move multiple actions
- `getActionById()`: Query action by ID
- `findActionsByType()`: Query actions by type

### 3. Connection Slice (`connection-slice.ts`)

**Responsibility**: Manages connections between actions

**State**:

- `isConnecting`: Whether user is currently dragging a connection
- `connectingFrom`: Source action/output being connected

**Actions**:

- `addConnection()`: Create a new connection
- `deleteConnection()`: Remove a connection
- `deleteConnectionsForAction()`: Remove all connections for an action
- `startConnecting()`: Begin connection drag
- `finishConnecting()`: Complete connection
- `cancelConnecting()`: Cancel connection drag
- `getConnectionsForAction()`: Query connections for an action

### 4. Selection Slice (`selection-slice.ts`)

**Responsibility**: Manages node and edge selection

**State**:

- `selectedNodes`: Array of selected node IDs
- `selectedEdges`: Array of selected edge IDs

**Actions**:

- `selectNode()`: Select a single node
- `selectNodes()`: Select multiple nodes
- `selectEdge()`: Select an edge
- `clearSelection()`: Clear all selections
- `selectAll()`: Select all nodes
- `invertSelection()`: Invert current selection

### 5. Clipboard Slice (`clipboard-slice.ts`)

**Responsibility**: Manages copy/paste/cut/duplicate operations

**State**:

- `clipboardNodes`: Copied actions
- `clipboardConnections`: Copied connections

**Actions**:

- `copy()`: Copy selected nodes to clipboard
- `paste()`: Paste from clipboard
- `cut()`: Cut selected nodes (copy + delete)
- `duplicate()`: Duplicate selected nodes (copy + paste)

### 6. History Slice (`history-slice.ts`)

**Responsibility**: Manages undo/redo functionality

**State**:

- `history`: Stack of workflow snapshots
- `historyIndex`: Current position in history
- `maxHistorySize`: Maximum history entries

**Actions**:

- `undo()`: Undo last change
- `redo()`: Redo next change
- `canUndo()`: Check if undo is available
- `canRedo()`: Check if redo is available
- `recordHistory()`: Record current state
- `clearHistory()`: Clear all history

### 7. Viewport Slice (`viewport-slice.ts`)

**Responsibility**: Manages viewport state, pan, and zoom

**State**:

- `viewport`: { x, y, zoom }
- `isDragging`: Whether nodes are being dragged
- `isPanning`: Whether viewport is being panned

**Actions**:

- `setViewport()`: Set viewport position/zoom
- `fitView()`: Fit all actions in view
- `zoomIn()`: Zoom in
- `zoomOut()`: Zoom out
- `resetZoom()`: Reset to 100%
- `setDragging()`: Set drag state
- `setPanning()`: Set pan state

### 8. Preferences Slice (`preferences-slice.ts`)

**Responsibility**: Manages UI preferences

**State**:

- `showMinimap`: Minimap visibility
- `showGrid`: Grid visibility
- `snapToGrid`: Snap to grid enabled
- `gridSize`: Grid size in pixels

**Actions**:

- `toggleMinimap()`: Toggle minimap
- `toggleGrid()`: Toggle grid
- `toggleSnapToGrid()`: Toggle snap to grid
- `setGridSize()`: Set grid size

## Usage

### Basic Usage

```typescript
import { useCanvasStore } from "@/stores/canvas";

function MyComponent() {
  const workflow = useCanvasStore((state) => state.workflow);
  const addAction = useCanvasStore((state) => state.addAction);

  // Use workflow and addAction...
}
```

### Using Selector Hooks

For better performance, use the provided selector hooks:

```typescript
import { useWorkflow, useSelectedNodes, useCanUndo } from "@/stores/canvas";

function MyComponent() {
  const workflow = useWorkflow();
  const selectedNodes = useSelectedNodes();
  const canUndo = useCanUndo();

  // Component only re-renders when these specific values change
}
```

### Accessing Actions

```typescript
import { useCanvasStore } from "@/stores/canvas";

function MyComponent() {
  const { addAction, deleteAction, selectNode } = useCanvasStore();

  const handleAddAction = () => {
    const newAction = {
      id: "action-123",
      type: "http-request",
      position: [100, 100],
      // ... other properties
    };
    addAction(newAction);
  };
}
```

### Using Multiple Slices

Each slice is composable:

```typescript
function WorkflowEditor() {
  // Selection
  const selectedNodes = useSelectedNodes();
  const selectNode = useCanvasStore((state) => state.selectNode);

  // Actions
  const deleteAction = useCanvasStore((state) => state.deleteAction);

  // History
  const undo = useCanvasStore((state) => state.undo);
  const canUndo = useCanUndo();

  // Combine as needed...
}
```

## Testing

Each slice can be tested independently:

```typescript
import { createWorkflowSlice } from "./workflow-slice";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

describe("WorkflowSlice", () => {
  it("should set workflow", () => {
    const store = create(immer(createWorkflowSlice));
    const workflow = {
      /* ... */
    };

    store.getState().setWorkflow(workflow);

    expect(store.getState().workflow).toEqual(workflow);
    expect(store.getState().isDirty).toBe(false);
  });
});
```

## Migration Guide

If you're migrating from the old monolithic store:

### Before (Old)

```typescript
import { useCanvasStore } from "@/stores/canvas-store";
```

### After (New)

```typescript
import { useCanvasStore } from "@/stores/canvas";
// or
import { useWorkflow, useSelectedNodes } from "@/stores/canvas";
```

The API is identical, so no code changes are needed beyond the import path.

## Performance Tips

1. **Use selector hooks**: They prevent unnecessary re-renders
2. **Batch updates**: Multiple state changes in one action are batched
3. **Immer middleware**: Enables efficient immutable updates
4. **Selective subscriptions**: Only subscribe to what you need

## Future Enhancements

- [ ] Add tests for each slice
- [ ] Implement debounced history recording
- [ ] Add workflow validation logic
- [ ] Implement proper fitView calculation
- [ ] Add performance monitoring
- [ ] Consider splitting large slices further if needed

## Related Files

- `/stores/history-manager.ts`: Advanced history management (can be integrated)
- `/lib/action-schema/action-types.ts`: Type definitions for actions and workflows
