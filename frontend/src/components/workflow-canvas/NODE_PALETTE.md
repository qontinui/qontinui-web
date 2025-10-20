# Node Palette System

Comprehensive documentation for the qontinui-web workflow canvas node palette system.

## Table of Contents

- [Overview](#overview)
- [Components](#components)
- [Usage Guide](#usage-guide)
- [Drag-and-Drop](#drag-and-drop)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Customization](#customization)
- [Architecture](#architecture)

## Overview

The Node Palette system provides an intuitive interface for browsing and adding nodes to the workflow canvas. It includes:

- **Categorized Node Browsing**: Nodes organized by category (Find, Mouse, Keyboard, Control Flow, Data, State)
- **Search Functionality**: Fuzzy search with keyboard navigation
- **Favorites**: Star nodes for quick access
- **Recent Nodes**: Track recently used nodes
- **Drag-and-Drop**: Drag nodes from palette to canvas
- **Click-to-Add**: Click to add nodes at viewport center
- **Quick Add Menu**: Right-click context menu for fast node addition

## Components

### NodePalette

Main palette component with categorized node list.

```tsx
import { NodePalette } from '@/components/workflow-canvas/NodePalette';

<NodePalette
  position="left"
  collapsible={true}
  showSearch={true}
  showRecent={true}
  showFavorites={true}
  onNodeAdd={(nodeType) => console.log('Added:', nodeType)}
  canvasRef={canvasRef}
/>
```

**Props:**
- `position?: 'left' | 'right' | 'floating'` - Palette placement
- `collapsible?: boolean` - Enable collapse/expand
- `showSearch?: boolean` - Show search functionality
- `showRecent?: boolean` - Show recent nodes section
- `showFavorites?: boolean` - Show favorites section
- `defaultCollapsed?: boolean` - Start in collapsed state
- `onNodeAdd?: (nodeType: ActionType) => void` - Callback when node is added
- `canvasRef?: RefObject<HTMLElement>` - Reference to canvas element for drop zone

### NodeSearch

Search component with fuzzy matching and keyboard navigation.

```tsx
import { NodeSearch } from '@/components/workflow-canvas/NodeSearch';

<NodeSearch
  onSelect={(nodeType) => addNode(nodeType)}
  onClose={() => setSearchOpen(false)}
  autoFocus={true}
  showHistory={true}
  maxResults={20}
/>
```

**Props:**
- `onSelect?: (nodeType: ActionType) => void` - Called when node is selected
- `onClose?: () => void` - Called when search should close
- `autoFocus?: boolean` - Auto-focus input on mount
- `showHistory?: boolean` - Show search history
- `maxResults?: number` - Maximum results to display
- `placeholder?: string` - Input placeholder text

### PaletteItem

Individual node item with drag handle and actions.

```tsx
import { PaletteItem } from '@/components/workflow-canvas/PaletteItem';

<PaletteItem
  metadata={NODE_METADATA.CLICK}
  onDragStart={handleDragStart}
  onAdd={handleAdd}
  compact={false}
  showCategory={true}
/>
```

**Props:**
- `metadata: NodeMetadata` - Node metadata from palette-config
- `onDragStart?: (nodeType, event) => void` - Drag start handler
- `onAdd?: (nodeType) => void` - Click to add handler
- `compact?: boolean` - Compact display mode
- `showCategory?: boolean` - Show category badge

### QuickAddMenu

Context menu for quick node addition at cursor position.

```tsx
import { QuickAddMenu, useQuickAddMenu } from '@/components/workflow-canvas/QuickAddMenu';

const { isOpen, position, open, close } = useQuickAddMenu();

<QuickAddMenu
  isOpen={isOpen}
  position={position}
  onSelect={(nodeType) => addNodeAtPosition(nodeType, position)}
  onClose={close}
/>
```

## Usage Guide

### Basic Setup

1. **Import the palette:**

```tsx
import { NodePalette } from '@/components/workflow-canvas/NodePalette';
import '@/components/workflow-canvas/NodePalette.css';
```

2. **Add to your canvas layout:**

```tsx
function WorkflowCanvas() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const { addAction } = useCanvasStore();

  const handleNodeAdd = (nodeType: ActionType) => {
    const newAction = createAction(nodeType, {}, [0, 0]);
    addAction(newAction);
  };

  return (
    <div className="workflow-editor">
      <NodePalette
        position="left"
        onNodeAdd={handleNodeAdd}
        canvasRef={canvasRef}
      />
      <div ref={canvasRef} className="canvas">
        {/* Canvas content */}
      </div>
    </div>
  );
}
```

### Using Search

1. **Open search**: Click search icon or press `Ctrl+K` / `Cmd+K`
2. **Type query**: Search by name, category, keywords, or tags
3. **Navigate**: Use arrow keys to navigate results
4. **Select**: Press `Enter` to add node
5. **Close**: Press `Esc` to close

### Managing Favorites

1. **Add to favorites**: Click star icon on any node
2. **Access favorites**: View in "Favorites" section at top of palette
3. **Remove from favorites**: Click star icon again
4. **Reorder**: Drag favorites to reorder (if enabled)

### Recent Nodes

- Automatically tracks last 10 used nodes
- Shows frequency of use
- Persists to localStorage
- View in "Recent" section

## Drag-and-Drop

### How It Works

1. **Start drag**: Click and hold on any node item
2. **Drag to canvas**: Move cursor over canvas area
3. **Visual feedback**: Ghost image follows cursor
4. **Drop**: Release to add node at drop position
5. **Grid snap**: Nodes snap to grid if enabled

### Implementation Details

```tsx
import { usePaletteDrag } from '@/components/workflow-canvas/palette-drag';

const dragHandlers = usePaletteDrag(canvasRef);

// On palette item:
<div
  draggable
  onDragStart={(e) => dragHandlers.onDragStart(nodeType, e)}
>
  {/* Item content */}
</div>

// On canvas:
<div
  onDragOver={dragHandlers.onDragOver}
  onDrop={dragHandlers.onDrop}
>
  {/* Canvas content */}
</div>
```

### Coordinate Conversion

The system automatically converts screen coordinates to workflow coordinates:

```typescript
// Screen to workflow conversion
const workflowPos = screenToWorkflow(
  screenX,
  screenY,
  canvasRect,
  viewport.zoom,
  viewport.x,
  viewport.y
);

// Grid snapping
const snappedPos = snapToGrid(workflowPos, gridSize);
```

### Cancel Drag

- Press `Escape` key during drag
- Drag outside canvas bounds
- Release before reaching canvas

## Keyboard Shortcuts

### Global Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` / `Cmd+K` | Open quick search |
| `Esc` | Close palette/search |

### Search Navigation

| Shortcut | Action |
|----------|--------|
| `↑` `↓` | Navigate results |
| `Enter` | Select highlighted node |
| `Tab` / `Shift+Tab` | Navigate results |
| `Esc` | Clear search / Close |

### Quick Add Menu

| Shortcut | Action |
|----------|--------|
| `↑` `↓` | Navigate menu |
| `Enter` | Add selected node |
| `Tab` | Navigate menu |
| `Esc` | Close menu |

## Configuration

### Node Metadata

Configure node appearance and behavior in `palette-config.ts`:

```typescript
export const NODE_METADATA: Record<ActionType, NodeMetadata> = {
  CLICK: {
    type: 'CLICK',
    displayName: 'Click',
    description: 'Click on an element or position',
    category: 'mouse',
    icon: MousePointerClick,
    keywords: ['click', 'mouse', 'press', 'select'],
    tags: ['interaction', 'basic'],
  },
  // ... more nodes
};
```

### Categories

Define custom categories:

```typescript
export const CATEGORIES: Record<NodeCategory, CategoryInfo> = {
  mouse: {
    id: 'mouse',
    label: 'Mouse',
    description: 'Mouse interactions and movements',
    color: '#10b981',
    icon: MousePointer,
    order: 2,
  },
  // ... more categories
};
```

### Search Weights

Customize search relevance:

```typescript
export const DEFAULT_SEARCH_WEIGHTS: SearchWeights = {
  displayName: 10,  // Highest priority
  description: 5,
  keywords: 8,
  category: 3,
  tags: 2,         // Lowest priority
};
```

## API Reference

### Stores

#### useFavoriteNodes

```typescript
const {
  favorites,           // FavoriteNodeEntry[]
  addFavorite,        // (nodeType: ActionType) => void
  removeFavorite,     // (nodeType: ActionType) => void
  toggleFavorite,     // (nodeType: ActionType) => void
  isFavorite,         // (nodeType: ActionType) => boolean
  getFavorites,       // () => FavoriteNodeEntry[]
  reorderFavorites,   // (nodeType, newOrder) => void
  clearFavorites,     // () => void
} = useFavoriteNodes();
```

#### useRecentNodes

```typescript
const {
  recentNodes,        // RecentNodeEntry[]
  addRecentNode,      // (nodeType: ActionType) => void
  getRecentNodes,     // (limit?: number) => RecentNodeEntry[]
  getFrequentNodes,   // (limit?: number) => RecentNodeEntry[]
  clearRecent,        // () => void
  removeRecentNode,   // (nodeType: ActionType) => void
  isRecent,           // (nodeType: ActionType) => boolean
} = useRecentNodes();
```

### Hooks

#### usePaletteDrag

```typescript
const {
  onDragStart,   // (nodeType, event) => void
  onDragEnd,     // (event) => void
  onDragOver,    // (event) => void
  onDrop,        // (event) => void
  isDragging,    // boolean
  draggedType,   // ActionType | null
} = usePaletteDrag(canvasRef);
```

#### useClickToAdd

```typescript
const {
  addNodeAtCenter,    // (nodeType: ActionType) => void
  addNodeAtPosition,  // (nodeType, x, y) => void
} = useClickToAdd();
```

#### useQuickAddMenu

```typescript
const {
  isOpen,    // boolean
  position,  // { x: number; y: number }
  open,      // (x: number, y: number) => void
  close,     // () => void
} = useQuickAddMenu();
```

### Utility Functions

```typescript
// Search nodes
searchNodes(query: string, weights?: SearchWeights): NodeMetadata[]

// Get nodes by category
getNodesByCategory(category: NodeCategory): NodeMetadata[]

// Get categories in order
getCategoriesOrdered(): CategoryInfo[]

// Check if multi-output
isMultiOutput(nodeType: ActionType): boolean

// Get output count
getNodeOutputCount(nodeType: ActionType): number
```

## Customization

### Custom Styling

Override CSS variables or classes:

```css
/* Custom palette width */
.node-palette--left {
  width: 320px;
}

/* Custom category colors */
.node-palette__category-header[data-category="mouse"] {
  border-left-color: #your-color;
}

/* Custom search styling */
.node-search__input {
  background: #your-background;
  border-radius: 12px;
}
```

### Custom Node Metadata

Add custom fields to node metadata:

```typescript
interface CustomNodeMetadata extends NodeMetadata {
  customField?: string;
  priority?: number;
}

export const CUSTOM_METADATA: Record<ActionType, CustomNodeMetadata> = {
  CLICK: {
    ...NODE_METADATA.CLICK,
    customField: 'value',
    priority: 1,
  },
  // ... more nodes
};
```

### Floating Palette

Use floating variant for draggable palette:

```tsx
import { FloatingPalette } from '@/components/workflow-canvas/NodePalette';

<FloatingPalette
  defaultPosition={{ x: 20, y: 20 }}
  onPositionChange={(pos) => console.log(pos)}
  onNodeAdd={handleNodeAdd}
/>
```

### Compact Mode

Use compact variant for space-constrained layouts:

```tsx
import { CompactPalette } from '@/components/workflow-canvas/NodePalette';

<CompactPalette
  onNodeAdd={handleNodeAdd}
  canvasRef={canvasRef}
/>
```

## Architecture

### Component Hierarchy

```
NodePalette
├── Header
│   ├── Title
│   └── Actions (Search, Collapse)
├── SearchPanel (conditional)
│   └── NodeSearch
│       ├── Input
│       ├── History Dropdown
│       ├── Results List
│       └── Keyboard Hints
├── Content
│   ├── Favorites Section (conditional)
│   │   └── PaletteItem[]
│   ├── Recent Section (conditional)
│   │   └── PaletteItem[]
│   └── Categories
│       └── Category[]
│           ├── CategoryHeader
│           └── CategoryContent
│               └── PaletteItem[]
└── Footer
    └── Usage Hints
```

### Data Flow

```
User Interaction
    ↓
Component Event Handler
    ↓
Store Update (Favorites/Recent)
    ↓
Canvas Store (addAction)
    ↓
Workflow Update
    ↓
UI Re-render
```

### State Management

- **Local State**: Component UI state (expanded categories, search query)
- **Zustand Stores**: Favorites and recent nodes (persisted to localStorage)
- **Canvas Store**: Workflow state and actions
- **React Flow**: Canvas viewport and node positions

### Performance Optimizations

1. **Memoization**: Category lists and search results
2. **Debounced Search**: 100ms debounce on search input
3. **Virtualization**: Could add for very large node lists
4. **Lazy Loading**: Categories load content only when expanded
5. **Event Delegation**: Minimize event listeners

### File Structure

```
workflow-canvas/
├── NodePalette.tsx           # Main palette component
├── NodePalette.css          # Comprehensive styles
├── NodePalette.test.tsx     # Test suite
├── PaletteItem.tsx          # Individual node item
├── NodeSearch.tsx           # Search component
├── QuickAddMenu.tsx         # Context menu
├── palette-config.ts        # Node metadata & config
├── palette-drag.ts          # Drag-and-drop system
└── NODE_PALETTE.md          # This documentation
```

### Integration Points

**With Canvas (React Flow):**
```typescript
// Convert drop position to workflow coordinates
const flowPosition = reactFlowInstance.screenToFlowPosition({
  x: screenX,
  y: screenY
});

// Add node to canvas
const newAction = createAction(nodeType, config, [flowPosition.x, flowPosition.y]);
addAction(newAction);
```

**With State Management:**
```typescript
// Update canvas state
const { addAction } = useCanvasStore();
addAction(newAction);

// Track recent usage
const { addRecentNode } = useRecentNodes();
addRecentNode(nodeType);
```

## Best Practices

### For Users

1. **Use Search**: Fastest way to find nodes (Ctrl+K)
2. **Favorite Often-Used Nodes**: Quick access from favorites section
3. **Learn Keyboard Shortcuts**: Navigate faster without mouse
4. **Drag for Precise Placement**: Click for center, drag for exact position

### For Developers

1. **Keep Metadata Complete**: Ensure all nodes have full metadata
2. **Update Keywords**: Add relevant keywords for better search
3. **Test Drag-and-Drop**: Verify coordinates conversion works correctly
4. **Customize Carefully**: Override styles in a separate file
5. **Monitor Performance**: Watch for lag with many nodes

## Troubleshooting

### Common Issues

**Drag not working:**
- Ensure `canvasRef` is properly passed
- Check if React Flow instance is available
- Verify `onDragOver` and `onDrop` are attached to canvas

**Search not finding nodes:**
- Check keywords in metadata
- Verify search weights configuration
- Ensure NODE_METADATA includes the node

**Favorites not persisting:**
- Check localStorage permissions
- Verify store persistence configuration
- Clear localStorage if corrupted

**Position incorrect on drop:**
- Verify viewport state is correct
- Check coordinate conversion logic
- Test grid snapping settings

## Examples

### Complete Integration

```tsx
import React, { useRef } from 'react';
import { ReactFlow } from '@xyflow/react';
import { NodePalette } from '@/components/workflow-canvas/NodePalette';
import { CanvasContextMenu } from '@/components/workflow-canvas/QuickAddMenu';
import { useCanvasStore } from '@/stores/canvas-store';
import { useRecentNodes } from '@/stores/recent-nodes';
import { createAction } from '@/lib/action-schema/action-types';
import '@/components/workflow-canvas/NodePalette.css';

function WorkflowEditor() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const { addAction } = useCanvasStore();
  const { addRecentNode } = useRecentNodes();

  const handleNodeAdd = (nodeType: ActionType) => {
    // Create action with default config
    const newAction = createAction(nodeType, {}, [0, 0]);

    // Add to canvas
    addAction(newAction);

    // Track in recent
    addRecentNode(nodeType);
  };

  return (
    <div className="workflow-editor">
      <NodePalette
        position="left"
        collapsible={true}
        showSearch={true}
        showRecent={true}
        showFavorites={true}
        onNodeAdd={handleNodeAdd}
        canvasRef={canvasRef}
      />

      <CanvasContextMenu
        onAddNode={(nodeType, position) => {
          const action = createAction(nodeType, {}, [position.x, position.y]);
          addAction(action);
          addRecentNode(nodeType);
        }}
      >
        <div ref={canvasRef} className="canvas">
          <ReactFlow />
        </div>
      </CanvasContextMenu>
    </div>
  );
}
```

## Version History

- **v1.0.0** - Initial implementation with full feature set
  - Categorized palette
  - Search with fuzzy matching
  - Drag-and-drop support
  - Favorites and recent nodes
  - Quick add menu
  - Comprehensive tests

## Contributing

When adding new nodes:

1. Add type to action-types.ts
2. Add metadata to palette-config.ts
3. Add component to node registry
4. Update tests
5. Update documentation

## License

Part of the qontinui-web project.
