# Canvas Store

The workflow-canvas Zustand store (`devtools(immer(persist(…)))`), composed from
one slice per responsibility.

## Import

```typescript
import { useCanvasStore } from "@/stores/canvas";
import type { CanvasStore, Viewport } from "@/stores/canvas";
```

`index.ts` also exports per-field selector hooks (`useWorkflow`,
`useSelectedNodes`, `useCanUndo`, `useViewport`, …).

Persistence: key `canvas-storage`; only `viewport`, `showMinimap`, `showGrid`,
`snapToGrid` and `gridSize` are persisted (asserted in `persist-contract.test.ts`).

## Slices

| File | Responsibility |
|------|----------------|
| `workflow-slice.ts` | Workflow state and validation |
| `action-slice.ts` | Action CRUD |
| `connection-slice.ts` | Connections between actions |
| `selection-slice.ts` | Node and edge selection |
| `clipboard-slice.ts` | Copy / cut / paste / duplicate |
| `history-slice.ts` | Undo / redo |
| `viewport-slice.ts` | Pan, zoom, viewport state |
| `preferences-slice.ts` | Minimap, grid and snap preferences |

Shared: `types.ts` (state and action types), `utils.ts` (helpers),
`index.ts` (the combined store and selector hooks).
