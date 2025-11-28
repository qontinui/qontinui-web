# Canvas Store Quick Reference

A one-page cheat sheet for the Canvas store.

## Import

```typescript
// Recommended: Use new path
import { useCanvasStore, useWorkflow, useSelectedNodes } from "@/stores/canvas";

// Backward compatible: Old path still works
import { useCanvasStore } from "@/stores/canvas-store";
```

## Selector Hooks (Optimized)

```typescript
// Workflow
const workflow = useWorkflow();
const isDirty = useIsDirty();
const validationResult = useValidationResult();

// Actions
const actions = useActions();
const action = useActionById(id);

// Connections
const connections = useConnections();
const isConnecting = useIsConnecting();
const connectingFrom = useConnectingFrom();

// Selection
const selectedNodes = useSelectedNodes();
const selectedEdges = useSelectedEdges();
const hasSelection = useHasSelection();

// Clipboard
const canPaste = useCanPaste();

// History
const canUndo = useCanUndo();
const canRedo = useCanRedo();
const historyIndex = useHistoryIndex();
const historyLength = useHistoryLength();

// Viewport
const viewport = useViewport();
const zoom = useZoom();
const isDragging = useIsDragging();
const isPanning = useIsPanning();

// Preferences
const showMinimap = useShowMinimap();
const showGrid = useShowGrid();
const snapToGrid = useSnapToGrid();
const gridSize = useGridSize();
```

## Actions Reference

### Workflow Actions

```typescript
const { setWorkflow, clearWorkflow, saveWorkflow, validateWorkflow } =
  useCanvasStore();

setWorkflow(workflow); // Load workflow
clearWorkflow(); // Clear current
await saveWorkflow(); // Save to backend
const result = validateWorkflow(); // Validate
```

### Action CRUD

```typescript
const {
  addAction,
  updateAction,
  deleteAction,
  deleteActions,
  duplicateAction,
  moveAction,
  moveActions,
  getActionById,
  findActionsByType,
} = useCanvasStore();

addAction(newAction);
updateAction(id, { position: [x, y] });
deleteAction(id);
deleteActions([id1, id2, id3]);
duplicateAction(id, { x: 50, y: 50 });
moveAction(id, [x, y]);
moveActions([{ actionId: id, position: [x, y] }]);
const action = getActionById(id);
const actions = findActionsByType("http-request");
```

### Connections

```typescript
const {
  addConnection,
  deleteConnection,
  deleteConnectionsForAction,
  startConnecting,
  finishConnecting,
  cancelConnecting,
  getConnectionsForAction,
} = useCanvasStore();

addConnection(sourceId, "main", 0, targetId, 0);
deleteConnection(sourceId, "main", 0, targetId);
deleteConnectionsForAction(actionId);
startConnecting(actionId, "main", 0);
finishConnecting(targetId, 0);
cancelConnecting();
const conns = getConnectionsForAction(actionId);
```

### Selection

```typescript
const {
  selectNode,
  selectNodes,
  selectEdge,
  clearSelection,
  selectAll,
  invertSelection,
} = useCanvasStore();

selectNode(id); // Single select
selectNode(id, true); // Multi-select
selectNodes([id1, id2]);
selectEdge(edgeId);
clearSelection();
selectAll();
invertSelection();
```

### Clipboard

```typescript
const { copy, paste, cut, duplicate } = useCanvasStore();

copy(); // Copy selection
paste(); // Paste with offset
paste({ x: 100, y: 100 }); // Paste at position
cut(); // Cut (copy + delete)
duplicate(); // Duplicate in place
```

### History

```typescript
const { undo, redo, canUndo, canRedo, recordHistory } = useCanvasStore();

undo();
redo();
const canUndoNow = canUndo();
const canRedoNow = canRedo();
recordHistory("Custom action");
```

### Viewport

```typescript
const {
  setViewport,
  fitView,
  zoomIn,
  zoomOut,
  resetZoom,
  setDragging,
  setPanning,
} = useCanvasStore();

setViewport({ x: 0, y: 0, zoom: 1 });
fitView();
zoomIn();
zoomOut();
resetZoom();
setDragging(true);
setPanning(true);
```

### Preferences

```typescript
const { toggleMinimap, toggleGrid, toggleSnapToGrid, setGridSize } =
  useCanvasStore();

toggleMinimap();
toggleGrid();
toggleSnapToGrid();
setGridSize(20);
```

## Common Patterns

### Load a workflow

```typescript
const { setWorkflow } = useCanvasStore();

const loadWorkflow = async (id: string) => {
  const workflow = await fetchWorkflow(id);
  setWorkflow(workflow);
};
```

### Add and select an action

```typescript
const { addAction, selectNode } = useCanvasStore();

const handleAddAction = (type: string, position: [number, number]) => {
  const action = {
    id: generateId(),
    type,
    position,
    config: {},
    inputs: [],
    outputs: [],
  };
  addAction(action);
  selectNode(action.id);
};
```

### Delete selected nodes

```typescript
const selectedNodes = useSelectedNodes();
const { deleteActions } = useCanvasStore();

const handleDelete = () => {
  if (selectedNodes.length > 0) {
    deleteActions(selectedNodes);
  }
};
```

### Create a connection

```typescript
const { isConnecting, connectingFrom, finishConnecting } = useCanvasStore();

const handleNodeClick = (nodeId: string) => {
  if (isConnecting && connectingFrom) {
    finishConnecting(nodeId, 0);
  }
};
```

### Undo/Redo with keyboard

```typescript
const { undo, redo, canUndo, canRedo } = useCanvasStore();

useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "z" && !e.shiftKey && canUndo()) {
        e.preventDefault();
        undo();
      } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        if (canRedo()) {
          e.preventDefault();
          redo();
        }
      }
    }
  };

  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [undo, redo, canUndo, canRedo]);
```

### Copy/Paste with keyboard

```typescript
const { copy, paste, cut, duplicate } = useCanvasStore();
const hasSelection = useHasSelection();

useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "c" && hasSelection) {
        e.preventDefault();
        copy();
      } else if (e.key === "v") {
        e.preventDefault();
        paste();
      } else if (e.key === "x" && hasSelection) {
        e.preventDefault();
        cut();
      } else if (e.key === "d" && hasSelection) {
        e.preventDefault();
        duplicate();
      }
    }
  };

  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [copy, paste, cut, duplicate, hasSelection]);
```

## Performance Tips

### ✅ DO: Use selector hooks

```typescript
// Good: Only re-renders when selectedNodes changes
const selectedNodes = useSelectedNodes();
```

### ❌ DON'T: Subscribe to entire state

```typescript
// Bad: Re-renders on ANY state change
const state = useCanvasStore();
const selectedNodes = state.selectedNodes;
```

### ✅ DO: Use multiple specific selectors

```typescript
// Good: Separate subscriptions
const workflow = useWorkflow();
const selectedNodes = useSelectedNodes();
const zoom = useZoom();
```

### ❌ DON'T: Use one broad selector

```typescript
// Bad: Re-renders if any of these change
const { workflow, selectedNodes, zoom } = useCanvasStore();
```

### ✅ DO: Memoize derived state

```typescript
const actions = useActions();
const selectedNodes = useSelectedNodes();

const selectedActions = useMemo(
  () => actions.filter((a) => selectedNodes.includes(a.id)),
  [actions, selectedNodes]
);
```

## Type Imports

```typescript
import type {
  CanvasStore,
  Workflow,
  Action,
  Connection,
  Connections,
  Viewport,
  ValidationError,
  ValidationResult,
} from "@/stores/canvas";
```

## Files

```
stores/canvas/
├── types.ts              - Type definitions
├── workflow-slice.ts     - Workflow state
├── action-slice.ts       - Action CRUD
├── connection-slice.ts   - Connections
├── selection-slice.ts    - Selection
├── clipboard-slice.ts    - Copy/paste
├── history-slice.ts      - Undo/redo
├── viewport-slice.ts     - Pan/zoom
├── preferences-slice.ts  - UI settings
├── index.ts             - Main export
└── utils.ts             - Utilities
```

## Testing

```typescript
import { createActionSlice } from "@/stores/canvas/action-slice";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

describe("ActionSlice", () => {
  it("should add action", () => {
    const store = create(immer(createActionSlice));
    const action = {
      /* ... */
    };

    store.getState().addAction(action);

    expect(store.getState().workflow.actions).toHaveLength(1);
  });
});
```

## More Info

- See `README.md` for full documentation
- See `MIGRATION.md` for migration guide
- See `ARCHITECTURE.md` for architecture details
