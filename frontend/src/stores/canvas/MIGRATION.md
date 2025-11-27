# Canvas Store Migration Guide

This guide helps you migrate from the old monolithic `canvas-store.ts` to the new modular architecture.

## Overview

The Canvas store has been refactored into 8 focused slices, each with a single responsibility. The API remains the same, so **most code will work without changes** after updating imports.

## Quick Migration

### Step 1: Update Imports

**Before:**
```typescript
import { useCanvasStore } from '@/stores/canvas-store';
```

**After (Option 1 - Backward Compatible):**
```typescript
import { useCanvasStore } from '@/stores/canvas-store'; // Still works via re-export
```

**After (Option 2 - Recommended):**
```typescript
import { useCanvasStore } from '@/stores/canvas';
```

**After (Option 3 - Best Performance):**
```typescript
import {
  useWorkflow,
  useSelectedNodes,
  useCanUndo
} from '@/stores/canvas';
```

### Step 2: Use Selector Hooks (Optional but Recommended)

The new architecture provides optimized selector hooks that prevent unnecessary re-renders.

**Before:**
```typescript
function MyComponent() {
  const workflow = useCanvasStore((state) => state.workflow);
  const selectedNodes = useCanvasStore((state) => state.selectedNodes);
  const canUndo = useCanvasStore((state) => state.canUndo());
}
```

**After:**
```typescript
function MyComponent() {
  const workflow = useWorkflow();
  const selectedNodes = useSelectedNodes();
  const canUndo = useCanUndo();
}
```

## API Compatibility

### ✅ Fully Compatible (No Changes Needed)

All actions and state properties work exactly the same:

```typescript
// All these work identically
const {
  // Workflow
  setWorkflow,
  clearWorkflow,
  saveWorkflow,

  // Actions
  addAction,
  updateAction,
  deleteAction,
  duplicateAction,

  // Connections
  addConnection,
  deleteConnection,
  startConnecting,

  // Selection
  selectNode,
  selectAll,
  clearSelection,

  // Clipboard
  copy,
  paste,
  cut,
  duplicate,

  // History
  undo,
  redo,

  // Viewport
  zoomIn,
  zoomOut,
  setViewport,

  // Preferences
  toggleGrid,
  toggleMinimap,
} = useCanvasStore();
```

## Available Selector Hooks

### Workflow Selectors
```typescript
import {
  useWorkflow,           // () => Workflow | null
  useIsDirty,           // () => boolean
  useValidationResult,  // () => ValidationResult | null
} from '@/stores/canvas';
```

### Action Selectors
```typescript
import {
  useActions,           // () => Action[]
  useActionById,        // (id: string) => Action | undefined
} from '@/stores/canvas';
```

### Connection Selectors
```typescript
import {
  useConnections,       // () => Connections
  useIsConnecting,      // () => boolean
  useConnectingFrom,    // () => { actionId, outputType, outputIndex } | null
} from '@/stores/canvas';
```

### Selection Selectors
```typescript
import {
  useSelectedNodes,     // () => string[]
  useSelectedEdges,     // () => string[]
  useHasSelection,      // () => boolean
} from '@/stores/canvas';
```

### Clipboard Selectors
```typescript
import {
  useCanPaste,          // () => boolean
} from '@/stores/canvas';
```

### History Selectors
```typescript
import {
  useCanUndo,           // () => boolean
  useCanRedo,           // () => boolean
  useHistoryIndex,      // () => number
  useHistoryLength,     // () => number
} from '@/stores/canvas';
```

### Viewport Selectors
```typescript
import {
  useViewport,          // () => Viewport
  useZoom,              // () => number
  useIsDragging,        // () => boolean
  useIsPanning,         // () => boolean
} from '@/stores/canvas';
```

### Preferences Selectors
```typescript
import {
  useShowMinimap,       // () => boolean
  useShowGrid,          // () => boolean
  useSnapToGrid,        // () => boolean
  useGridSize,          // () => number
} from '@/stores/canvas';
```

## Migration Examples

### Example 1: Simple Component

**Before:**
```typescript
import { useCanvasStore } from '@/stores/canvas-store';

function ActionList() {
  const workflow = useCanvasStore((state) => state.workflow);
  const addAction = useCanvasStore((state) => state.addAction);

  return (
    <div>
      {workflow?.actions.map(action => (
        <div key={action.id}>{action.type}</div>
      ))}
    </div>
  );
}
```

**After (Optimized):**
```typescript
import { useActions } from '@/stores/canvas';
import { useCanvasStore } from '@/stores/canvas';

function ActionList() {
  const actions = useActions();
  const addAction = useCanvasStore((state) => state.addAction);

  return (
    <div>
      {actions.map(action => (
        <div key={action.id}>{action.type}</div>
      ))}
    </div>
  );
}
```

### Example 2: Toolbar Component

**Before:**
```typescript
import { useCanvasStore } from '@/stores/canvas-store';

function Toolbar() {
  const canUndo = useCanvasStore((state) => state.canUndo());
  const canRedo = useCanvasStore((state) => state.canRedo());
  const undo = useCanvasStore((state) => state.undo);
  const redo = useCanvasStore((state) => state.redo);

  return (
    <div>
      <button onClick={undo} disabled={!canUndo}>Undo</button>
      <button onClick={redo} disabled={!canRedo}>Redo</button>
    </div>
  );
}
```

**After (Optimized):**
```typescript
import { useCanUndo, useCanRedo } from '@/stores/canvas';
import { useCanvasStore } from '@/stores/canvas';

function Toolbar() {
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const { undo, redo } = useCanvasStore();

  return (
    <div>
      <button onClick={undo} disabled={!canUndo}>Undo</button>
      <button onClick={redo} disabled={!canRedo}>Redo</button>
    </div>
  );
}
```

### Example 3: Selection Panel

**Before:**
```typescript
import { useCanvasStore } from '@/stores/canvas-store';

function SelectionPanel() {
  const selectedNodes = useCanvasStore((state) => state.selectedNodes);
  const workflow = useCanvasStore((state) => state.workflow);
  const deleteAction = useCanvasStore((state) => state.deleteAction);

  const selectedActions = workflow?.actions.filter(a =>
    selectedNodes.includes(a.id)
  ) ?? [];

  return (
    <div>
      <h3>Selected: {selectedNodes.length}</h3>
      {selectedActions.map(action => (
        <div key={action.id}>
          {action.type}
          <button onClick={() => deleteAction(action.id)}>Delete</button>
        </div>
      ))}
    </div>
  );
}
```

**After (Optimized):**
```typescript
import { useSelectedNodes, useActions } from '@/stores/canvas';
import { useCanvasStore } from '@/stores/canvas';
import { useMemo } from 'react';

function SelectionPanel() {
  const selectedNodes = useSelectedNodes();
  const actions = useActions();
  const deleteAction = useCanvasStore((state) => state.deleteAction);

  const selectedActions = useMemo(() =>
    actions.filter(a => selectedNodes.includes(a.id)),
    [actions, selectedNodes]
  );

  return (
    <div>
      <h3>Selected: {selectedNodes.length}</h3>
      {selectedActions.map(action => (
        <div key={action.id}>
          {action.type}
          <button onClick={() => deleteAction(action.id)}>Delete</button>
        </div>
      ))}
    </div>
  );
}
```

## Performance Benefits

### Before (Monolithic Store)
- Component re-renders on ANY store change
- Hard to track which state is used where
- Difficult to optimize

### After (Modular Store)
- Components only re-render when their specific selectors change
- Clear separation of concerns
- Easy to optimize individual slices

## Testing

### Before
```typescript
import { useCanvasStore } from '@/stores/canvas-store';

// Had to mock entire store
```

### After
```typescript
import { createActionSlice } from '@/stores/canvas/action-slice';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

describe('ActionSlice', () => {
  it('should add action', () => {
    const store = create(immer(createActionSlice));
    // Test only the action slice
  });
});
```

## Common Issues and Solutions

### Issue 1: Import Errors

**Error:** `Module not found: Can't resolve '@/stores/canvas'`

**Solution:** Make sure you're using the correct path. The old path still works:
```typescript
import { useCanvasStore } from '@/stores/canvas-store'; // Works
```

### Issue 2: Type Errors

**Error:** Type mismatch after migration

**Solution:** Import types from the new location:
```typescript
import type { CanvasStore, Workflow, Action } from '@/stores/canvas';
```

### Issue 3: Selector Not Found

**Error:** `useWorkflow` is not exported

**Solution:** Import from the main index:
```typescript
import { useWorkflow } from '@/stores/canvas'; // Correct
// Not from individual slices
```

## Rollback Plan

If you need to rollback, the old monolithic store is preserved at:
```
/mnt/c/qontinui/qontinui-web/frontend/src/stores/canvas-store.ts.backup
```

Simply rename it back to `canvas-store.ts` if needed.

## Need Help?

- See `README.md` for full documentation
- Check `canvas-store.test.ts` for test examples
- Review individual slice files for implementation details

## Checklist

- [ ] Update imports to `@/stores/canvas`
- [ ] Replace manual selectors with provided hooks
- [ ] Add `useMemo` for derived state
- [ ] Update tests to use individual slices
- [ ] Remove unused state subscriptions
- [ ] Verify no performance regressions
