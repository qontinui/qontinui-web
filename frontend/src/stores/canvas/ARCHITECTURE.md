# Canvas Store Architecture

## Overview

The Canvas store has been refactored from a monolithic 945-line file into 8 focused slices following the **Single Responsibility Principle**. Each slice manages a specific aspect of the canvas state.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Canvas Store                              │
│                    (Combined via Zustand)                        │
└─────────────────────────────────────────────────────────────────┘
                               │
                               │ combines
                               ▼
        ┌──────────────────────────────────────────────┐
        │                                              │
        ▼                                              ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│   Workflow    │  │    Action     │  │  Connection   │  │   Selection   │
│     Slice     │  │     Slice     │  │     Slice     │  │     Slice     │
├───────────────┤  ├───────────────┤  ├───────────────┤  ├───────────────┤
│ • workflow    │  │ • addAction   │  │ • isConnecting│  │ • selectedNodes│
│ • isDirty     │  │ • updateAction│  │ • connecting  │  │ • selectedEdges│
│ • validation  │  │ • deleteAction│  │   From        │  │ • selectNode  │
│ • setWorkflow │  │ • moveAction  │  │ • addConn     │  │ • selectAll   │
│ • validate    │  │ • getAction   │  │ • deleteConn  │  │ • clearSel    │
└───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘

┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│   Clipboard   │  │    History    │  │   Viewport    │  │  Preferences  │
│     Slice     │  │     Slice     │  │     Slice     │  │     Slice     │
├───────────────┤  ├───────────────┤  ├───────────────┤  ├───────────────┤
│ • clipboard   │  │ • history[]   │  │ • viewport    │  │ • showMinimap │
│   Nodes       │  │ • historyIndex│  │   {x,y,zoom}  │  │ • showGrid    │
│ • clipboard   │  │ • undo()      │  │ • isDragging  │  │ • snapToGrid  │
│   Connections │  │ • redo()      │  │ • isPanning   │  │ • gridSize    │
│ • copy()      │  │ • canUndo()   │  │ • zoomIn()    │  │ • toggles     │
│ • paste()     │  │ • canRedo()   │  │ • zoomOut()   │  │ • setGridSize │
│ • cut()       │  │ • record()    │  │ • fitView()   │  │               │
│ • duplicate() │  │ • clear()     │  │ • setPanning  │  │               │
└───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘
```

## Data Flow

```
┌─────────────┐
│    User     │
│   Action    │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────┐
│      Component calls action         │
│  e.g., addAction(newAction)         │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│    Action Slice updates state       │
│    (via Immer middleware)           │
└──────┬──────────────────────────────┘
       │
       ├──────────────────────┬────────────────────┐
       ▼                      ▼                    ▼
┌──────────────┐   ┌──────────────────┐   ┌──────────────┐
│   Workflow   │   │  History Slice   │   │  Selection   │
│  isDirty=true│   │  recordHistory() │   │    Slice     │
└──────────────┘   └──────────────────┘   └──────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│   Component re-renders (selective)  │
│   (only if subscribed to changed    │
│    state via selectors)             │
└─────────────────────────────────────┘
```

## Slice Responsibilities

### 1. Workflow Slice
**Responsibility**: Core workflow data and validation

**Owns**:
- Current workflow object
- Dirty state tracking
- Validation results
- Load/save operations

**Dependencies**: None (root slice)

**Used by**: All other slices that modify workflow

---

### 2. Action Slice
**Responsibility**: Action CRUD operations

**Owns**:
- Action creation, updates, deletion
- Action queries (getById, findByType)
- Bulk action operations

**Dependencies**:
- Workflow Slice (reads/writes workflow.actions)
- History Slice (records changes)
- Selection Slice (updates selection on delete)

**Used by**: Components that manipulate actions

---

### 3. Connection Slice
**Responsibility**: Connection management

**Owns**:
- Connection creation/deletion
- Connection dragging state
- Connection queries

**Dependencies**:
- Workflow Slice (reads/writes workflow.connections)
- History Slice (records changes)

**Used by**: Connection-related UI components

---

### 4. Selection Slice
**Responsibility**: Selection state

**Owns**:
- Selected nodes/edges
- Multi-selection logic
- Select all/invert/clear

**Dependencies**:
- Workflow Slice (queries available nodes)

**Used by**:
- Clipboard Slice (copies selection)
- Components that render selection

---

### 5. Clipboard Slice
**Responsibility**: Copy/paste operations

**Owns**:
- Clipboard buffer (nodes + connections)
- Copy/paste/cut/duplicate logic

**Dependencies**:
- Workflow Slice (reads/writes actions)
- Selection Slice (reads selection)
- Action Slice (uses action utilities)
- History Slice (records changes)

**Used by**: Keyboard shortcuts, context menus

---

### 6. History Slice
**Responsibility**: Undo/redo functionality

**Owns**:
- History stack
- History index
- Undo/redo logic
- History size management

**Dependencies**:
- Workflow Slice (snapshots workflow)

**Used by**:
- All slices that modify state (via recordHistory)
- Undo/redo UI controls

---

### 7. Viewport Slice
**Responsibility**: Pan, zoom, viewport

**Owns**:
- Viewport position (x, y)
- Zoom level
- Pan/drag state
- Zoom operations

**Dependencies**: None (independent)

**Used by**: Canvas rendering components

---

### 8. Preferences Slice
**Responsibility**: UI preferences

**Owns**:
- Grid settings
- Minimap visibility
- Snap to grid
- Grid size

**Dependencies**: None (independent)

**Used by**:
- Canvas rendering (grid, snap)
- UI preference panels

**Persisted**: Yes (via localStorage)

## Middleware Stack

```
Component
    ↓
useCanvasStore
    ↓
┌──────────────────┐
│  DevTools        │ ← Debugging in browser
├──────────────────┤
│  Immer           │ ← Immutable updates (draft state)
├──────────────────┤
│  Persist         │ ← Save preferences to localStorage
├──────────────────┤
│  Slice Pattern   │ ← Combine individual slices
└──────────────────┘
    ↓
Zustand Store
```

## State Shape

```typescript
{
  // Workflow Slice
  workflow: Workflow | null,
  isDirty: boolean,
  validationResult: ValidationResult | null,
  isValidating: boolean,

  // Action Slice (no state, just actions)

  // Connection Slice
  isConnecting: boolean,
  connectingFrom: { actionId, outputType, outputIndex } | null,

  // Selection Slice
  selectedNodes: string[],
  selectedEdges: string[],

  // Clipboard Slice
  clipboardNodes: Action[],
  clipboardConnections: Connections,

  // History Slice
  history: HistoryState[],
  historyIndex: number,
  maxHistorySize: number,

  // Viewport Slice
  viewport: { x: number, y: number, zoom: number },
  isDragging: boolean,
  isPanning: boolean,

  // Preferences Slice
  showMinimap: boolean,
  showGrid: boolean,
  snapToGrid: boolean,
  gridSize: number,
}
```

## Selector Optimization

```
Component subscribes to specific selector
              ↓
┌──────────────────────────────────┐
│  useSelectedNodes()              │
│  Returns: state.selectedNodes    │
└──────────────────────────────────┘
              ↓
Component ONLY re-renders when selectedNodes changes
(not when other state like viewport, preferences, etc. changes)
```

## Benefits of This Architecture

### 1. Single Responsibility Principle
- Each slice has ONE clear purpose
- Easy to understand and maintain
- Changes are localized

### 2. Testability
- Test each slice independently
- Mock only what you need
- Clear test boundaries

### 3. Performance
- Selective re-renders via selectors
- Better code splitting
- Tree-shaking friendly

### 4. Scalability
- Easy to add new slices
- No risk of merge conflicts (separate files)
- Clear ownership

### 5. Developer Experience
- IntelliSense works better
- Easier to navigate
- Self-documenting structure

## File Size Comparison

**Before:**
```
canvas-store.ts: 945 lines (monolithic)
```

**After:**
```
types.ts:              142 lines
workflow-slice.ts:      93 lines
action-slice.ts:       164 lines
connection-slice.ts:   123 lines
selection-slice.ts:     77 lines
clipboard-slice.ts:    154 lines
history-slice.ts:       95 lines
viewport-slice.ts:      64 lines
preferences-slice.ts:   48 lines
index.ts:              138 lines
utils.ts:               68 lines
─────────────────────────────────
Total:               1,166 lines (with docs & organization)
Average per file:       ~106 lines
```

## Design Patterns Used

1. **Slice Pattern** (Zustand)
   - Compose store from smaller pieces
   - Each slice is a StateCreator

2. **Selector Pattern**
   - Pre-built selector hooks
   - Prevent unnecessary re-renders

3. **Factory Pattern**
   - `createWorkflowSlice()`, etc.
   - Reusable slice creators

4. **Facade Pattern**
   - `index.ts` provides single entry point
   - Hides internal complexity

5. **Strategy Pattern**
   - Different middleware strategies
   - Composable behavior

## Future Enhancements

1. **Async Actions**
   - Add middleware for async operations
   - Loading states per slice

2. **Computed Values**
   - Derived state with memoization
   - Computed selectors

3. **Slice Composition**
   - Cross-slice selectors
   - Composite operations

4. **Persistence**
   - Selective persistence per slice
   - Version migrations

5. **DevTools**
   - Time-travel debugging
   - Action replay
   - State diff visualization
