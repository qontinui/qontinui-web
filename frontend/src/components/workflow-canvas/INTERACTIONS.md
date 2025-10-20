# Canvas Interactions Documentation

Complete guide to all interactive features in the qontinui-web workflow canvas.

## Table of Contents

1. [Context Menus](#context-menus)
2. [Tooltips](#tooltips)
3. [Hover Effects](#hover-effects)
4. [Selection](#selection)
5. [Connection Drawing](#connection-drawing)
6. [Keyboard Shortcuts](#keyboard-shortcuts)
7. [Mouse Gestures](#mouse-gestures)
8. [Touch Gestures](#touch-gestures)
9. [Alignment Tools](#alignment-tools)
10. [Zoom Controls](#zoom-controls)
11. [Grid Settings](#grid-settings)
12. [Customization](#customization)

---

## Context Menus

Right-click context menus provide quick access to common actions.

### Canvas Context Menu

Right-click on empty canvas space:

- **Add Node** → Opens submenu with node categories
  - Find Actions (Find, Find State Image, Vanish, Exists, Wait)
  - Mouse Actions (Click, Double Click, Right Click, Drag)
  - Keyboard Actions (Type, Key Press, Hotkey)
  - Control Flow (If, Loop, Switch)
- **Paste** (Ctrl+V) - Paste copied nodes
- **Select All** (Ctrl+A) - Select all nodes
- **Fit View** (Ctrl+F) - Fit all nodes in view
- **Auto Layout** (Ctrl+L) - Automatically arrange nodes
- **Grid Settings** → Configure grid appearance

### Node Context Menu

Right-click on a node:

- **Edit Properties** (Enter) - Open node configuration
- **Duplicate** (Ctrl+D) - Duplicate the node
- **Copy** (Ctrl+C) - Copy to clipboard
- **Cut** (Ctrl+X) - Cut to clipboard
- **Delete** (Del) - Delete the node
- **Enable/Disable** - Toggle node execution
- **Add to Favorites** - Add to favorites list
- **Create Snapshot** - Save node state
- **Add Comment** - Add annotation

### Edge Context Menu

Right-click on a connection:

- **Edit Connection** - Modify connection properties
- **Delete Connection** (Del) - Remove the connection
- **Add Intermediate Node** - Insert node in connection
- **Change Connection Type** → Main Flow, Error Handling, Success Condition, Parallel Execution

### Multi-Select Context Menu

Right-click when multiple nodes selected:

- **Align** → Left, Right, Top, Bottom, Center (H/V)
- **Distribute** → Horizontally, Vertically, Evenly
- **Group** - Group selected nodes
- **Copy All** (Ctrl+C) - Copy all selected
- **Duplicate All** (Ctrl+D) - Duplicate all selected
- **Delete All** (Del) - Delete all selected

---

## Tooltips

Hover tooltips provide contextual information.

### Node Tooltips

Hover over a node to see:

- **Action name and type** - Node identification
- **Configuration summary** - Key parameters
- **Input/output count** - Connection information
- **Execution status** - Running, Success, Error, Warning
- **Validation errors** - Configuration issues
- **Execution duration** - Performance metrics

### Handle Tooltips

Hover over connection handles:

- **Connection type** - Main, Error, Success, Parallel
- **Connected actions count** - Number of connections
- **Output index** - Which output port
- **Description** - Handle purpose

### Edge Tooltips

Hover over connections:

- **Source → Target** - Connection flow
- **Connection type** - Flow type indicator
- **Execution count** - How many times executed
- **Last execution time** - When last run

### Configuration

```typescript
// Default tooltip settings
{
  delay: 500,        // Show after 500ms hover
  placement: 'auto', // Smart positioning
  offset: 8,         // 8px from target
}
```

---

## Hover Effects

Visual feedback during interaction.

### Node Hover Effects

- **Highlight border** - Cyan border on hover
- **Show handles** - Connection points appear
- **Fade others** - Non-connected nodes fade to 40% opacity
- **Connected highlight** - Connected nodes show border
- **Scale animation** - 2% scale increase (1.02x)
- **Shadow glow** - Subtle glow effect

### Edge Hover Effects

- **Thicken line** - Width increases 2px → 4px
- **Animate flow** - Animated dash pattern
- **Highlight nodes** - Source and target highlight
- **Color change** - Selection color applied

### Handle Hover Effects

- **Enlarge** - 1.5x scale on hover
- **Show preview** - Connection line preview
- **Valid targets** - Green for valid, red for invalid
- **Shadow glow** - Indicates interactivity

### Performance

- **60 FPS animations** - Smooth transitions
- **150ms duration** - Quick but noticeable
- **Throttling** - Updates limited to 60 FPS
- **Proper z-index** - Layering maintained

---

## Selection

Multiple ways to select nodes and edges.

### Selection Methods

1. **Click** - Select single node/edge
2. **Shift+Click** - Add to selection
3. **Ctrl+Click** - Remove from selection
4. **Box Select** - Drag to select multiple
5. **Ctrl+A** - Select all nodes

### Box Selection

- **Drag** - Click and drag on canvas
- **Shift+Drag** - Add to existing selection
- **Ctrl+Drag** - Remove from selection
- **Visual feedback** - Dashed border box
- **Mode indicator** - Shows selection mode

### Selection Box Features

- **Real-time preview** - See selection as you drag
- **Multiple types** - Select nodes and edges together
- **Cancel** - Press Escape to cancel
- **Smart bounds** - Automatically calculates area

---

## Connection Drawing

Interactive connection creation.

### Creating Connections

1. **Click source handle** - Start connection
2. **Drag to target** - Move mouse to target handle
3. **Release on target** - Complete connection
4. **Or press Escape** - Cancel connection

### Visual Feedback

- **Preview line** - Bezier curve from source to cursor
- **Color coding** - Color matches connection type
- **Valid/invalid** - Green for valid, red for invalid
- **Target highlighting** - Valid targets glow
- **Info tooltip** - Shows connection type and instructions

### Connection Types

- **Main** (Cyan) - Normal flow
- **Error** (Red) - Error handling
- **Success** (Green) - Success condition
- **Parallel** (Purple) - Parallel execution

### Validation

- **Type checking** - Output type matches input type
- **Cycle detection** - Prevents circular dependencies
- **Connection limits** - Respects max connections
- **Visual feedback** - Invalid targets shown in red

---

## Keyboard Shortcuts

Comprehensive keyboard support for efficiency.

### Selection

| Shortcut | Action |
|----------|--------|
| `Ctrl+A` | Select all nodes |
| `Esc` | Deselect all |
| `Ctrl+Shift+I` | Invert selection |

### Editing

| Shortcut | Action |
|----------|--------|
| `Ctrl+C` | Copy selected nodes |
| `Ctrl+V` | Paste nodes |
| `Ctrl+X` | Cut selected nodes |
| `Ctrl+D` | Duplicate selected nodes |
| `Del` | Delete selected nodes |
| `Ctrl+Z` | Undo last action |
| `Ctrl+Shift+Z` | Redo last action |

### Navigation

| Shortcut | Action |
|----------|--------|
| `↑` `↓` `←` `→` | Pan canvas |
| `Space` | Pan mode (hold) |

### View

| Shortcut | Action |
|----------|--------|
| `+` | Zoom in |
| `-` | Zoom out |
| `0` | Reset zoom to 100% |
| `Ctrl+F` | Fit view to nodes |
| `Ctrl+M` | Toggle minimap |
| `Ctrl+G` | Toggle grid |

### Workflow

| Shortcut | Action |
|----------|--------|
| `Ctrl+L` | Auto layout nodes |
| `Ctrl+Enter` | Run workflow |
| `Ctrl+Shift+Enter` | Stop workflow |
| `Ctrl+S` | Save workflow |

### Alignment

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+L` | Align left |
| `Ctrl+Shift+R` | Align right |
| `Ctrl+Shift+T` | Align top |
| `Ctrl+Shift+B` | Align bottom |
| `Ctrl+Shift+H` | Distribute horizontally |
| `Ctrl+Shift+V` | Distribute vertically |

### Help

| Shortcut | Action |
|----------|--------|
| `?` | Show keyboard shortcuts |
| `Ctrl+/` | Show keyboard shortcuts |

---

## Mouse Gestures

Intuitive mouse-based interactions.

### Basic Gestures

- **Left Click** - Select node/edge
- **Right Click** - Context menu
- **Double Click Node** - Edit properties
- **Double Click Canvas** - Add node at position
- **Drag Node** - Move node
- **Drag Edge** - Reconnect edge

### Advanced Gestures

- **Space + Drag** - Pan canvas
- **Ctrl + Scroll** - Zoom in/out
- **Middle Mouse Drag** - Pan canvas
- **Alt + Drag Node** - Duplicate node
- **Shift + Drag Node** - Constrain to axis (horizontal/vertical)

### Multi-Select Gestures

- **Shift + Click** - Add to selection
- **Ctrl + Click** - Remove from selection
- **Box Select** - Drag on canvas to select multiple

---

## Touch Gestures

Touch-friendly interactions for tablets and touchscreens.

### Basic Touch

- **Tap** - Select node/edge
- **Long Press** - Context menu
- **Double Tap Node** - Edit properties
- **Double Tap Canvas** - Add node
- **Drag** - Move node or pan canvas

### Multi-Touch

- **Pinch** - Zoom in/out
- **Two Finger Drag** - Pan canvas
- **Two Finger Rotate** - Rotate selection (if enabled)

---

## Alignment Tools

Precisely align and distribute nodes.

### Alignment Options

- **Align Left** - Align to leftmost node
- **Align Right** - Align to rightmost node
- **Align Top** - Align to topmost node
- **Align Bottom** - Align to bottommost node
- **Center Horizontal** - Align to horizontal center
- **Center Vertical** - Align to vertical center

### Distribution Options

- **Distribute Horizontally** - Even horizontal spacing
- **Distribute Vertically** - Even vertical spacing
- **Distribute Evenly** - Even spacing in both directions

### Smart Guides

- **Snap to alignment** - Shows alignment guides
- **Snap distance** - 40px snap threshold
- **Visual feedback** - Temporary guide lines
- **Multiple guides** - Show all available alignments

---

## Zoom Controls

Flexible zoom options for different view needs.

### Zoom Levels

- **Minimum** - 10% (0.1x)
- **Maximum** - 400% (4x)
- **Default** - 100% (1x)
- **Step** - 10% per zoom action

### Zoom Methods

1. **Zoom Buttons** - Click +/- buttons
2. **Keyboard** - +, -, 0 keys
3. **Mouse Wheel** - Scroll to zoom
4. **Ctrl+Scroll** - Fine zoom control
5. **Pinch** - Touch zoom (mobile)

### Zoom Actions

- **Zoom In** (+) - Increase zoom 10%
- **Zoom Out** (-) - Decrease zoom 10%
- **Reset** (0) - Reset to 100%
- **Fit View** (Ctrl+F) - Fit all nodes
- **Zoom to Selection** - Fit selected nodes

### Zoom Display

- **Percentage** - Shows current zoom level
- **Limits indicator** - Shows min/max reached
- **Smooth animation** - 200ms duration

---

## Grid Settings

Customize grid appearance and behavior.

### Grid Options

- **Show Grid** - Toggle grid visibility
- **Snap to Grid** - Enable/disable snapping
- **Grid Size** - 5, 10, 15, 20, 25, 50 pixels
- **Grid Pattern** - Dots, lines, or cross
- **Grid Color** - Customizable color

### Grid Patterns

1. **Dots** - Small dots at intersections (default)
2. **Lines** - Full grid lines
3. **Cross** - Cross marks at intersections

### Snap Behavior

- **Snap Threshold** - 10px distance to snap
- **Node Snapping** - Snap to other nodes (40px)
- **Center Snapping** - Snap to center lines
- **Grid Snapping** - Snap to grid points

---

## Customization

Customize interactions to your preferences.

### Configuration Options

```typescript
interface CanvasInteractionsConfig {
  // Context menus
  contextMenus: {
    enabled: boolean;
    showIcons: boolean;
    showShortcuts: boolean;
    maxNestingLevel: number; // Default: 2
  };

  // Tooltips
  tooltips: {
    enabled: boolean;
    delay: number; // Default: 500ms
    maxWidth: number; // Default: 300px
    placement: 'auto' | 'top' | 'bottom' | 'left' | 'right';
  };

  // Hover effects
  hoverEffects: {
    enabled: boolean;
    duration: number; // Default: 150ms
    fadeOpacity: number; // Default: 0.4
    scaleAmount: number; // Default: 1.02
  };

  // Selection
  selection: {
    boxSelect: boolean;
    multiSelect: boolean;
    borderColor: string;
    fillColor: string;
  };

  // Gestures
  gestures: {
    panOnSpace: boolean;
    zoomOnCtrlScroll: boolean;
    middleMousePan: boolean;
    altDuplicate: boolean;
    shiftConstrain: boolean;
  };

  // Keyboard shortcuts
  shortcuts: {
    enabled: boolean;
    customShortcuts: Record<string, string>;
  };
}
```

### Theme Customization

```typescript
interface InteractionTheme {
  colors: {
    selection: string;
    hover: string;
    error: string;
    success: string;
    warning: string;
  };

  spacing: {
    tooltipOffset: number;
    contextMenuPadding: number;
    handleSize: number;
  };

  animation: {
    duration: number;
    easing: string;
  };
}
```

### Performance Settings

```typescript
interface PerformanceConfig {
  // Disable effects for large graphs
  disableAnimationsThreshold: number; // Default: 200 nodes

  // Throttle hover updates
  hoverThrottle: number; // Default: 16ms (60fps)

  // Debounce tooltip display
  tooltipDebounce: number; // Default: 500ms

  // Virtual rendering
  virtualizeNodes: boolean;
  virtualizeThreshold: number; // Default: 100 nodes
}
```

---

## Best Practices

### For Users

1. **Learn keyboard shortcuts** - Much faster than mouse
2. **Use box select** - Select multiple nodes quickly
3. **Space bar panning** - Quick navigation
4. **Right-click often** - Access context menus
5. **Hover for info** - Tooltips provide details

### For Developers

1. **Test all interactions** - Comprehensive test coverage
2. **Optimize performance** - Throttle and debounce
3. **Accessibility** - Keyboard navigation support
4. **Error handling** - Graceful degradation
5. **User feedback** - Clear visual indicators

---

## Troubleshooting

### Common Issues

**Context menu not showing**
- Check if right-click is enabled in browser
- Verify event handlers are attached
- Check z-index conflicts

**Tooltips delayed or not showing**
- Adjust tooltip delay setting
- Check if tooltips are enabled
- Verify tooltip content is provided

**Hover effects laggy**
- Reduce animation duration
- Increase throttle delay
- Disable effects for large graphs

**Selection box not working**
- Check if box select is enabled
- Verify canvas event handlers
- Check for conflicting event listeners

**Keyboard shortcuts not working**
- Check if shortcuts are enabled
- Verify no input field has focus
- Check for browser shortcut conflicts

### Performance Optimization

1. **Large graphs** - Enable virtualization
2. **Slow animations** - Reduce animation duration
3. **Memory issues** - Clear hover state regularly
4. **Event handlers** - Use event delegation
5. **Re-renders** - Memoize expensive calculations

---

## API Reference

### Context Menu API

```typescript
// Open canvas context menu
openCanvasMenu(position: { x: number; y: number })

// Open node context menu
openNodeMenu(position: { x: number; y: number }, nodeId: string)

// Open edge context menu
openEdgeMenu(position: { x: number; y: number }, edgeId: string)

// Open multi-select context menu
openMultiSelectMenu(position: { x: number; y: number }, nodeIds: string[])

// Close any open menu
closeMenu()
```

### Tooltip API

```typescript
// Show tooltip
TooltipManager.show(
  content: React.ReactNode,
  position: { x: number; y: number },
  placement: TooltipPlacement
)

// Hide tooltip
TooltipManager.hide()

// Subscribe to tooltip state
TooltipManager.subscribe(listener: (state: TooltipState | null) => void)
```

### Hover Effects API

```typescript
// Set hovered node
hoverEffects.setHoveredNode(nodeId: string | null)

// Set hovered edge
hoverEffects.setHoveredEdge(edgeId: string | null)

// Set hovered handle
hoverEffects.setHoveredHandle(
  handleId: string | null,
  handleType: 'source' | 'target' | null
)

// Clear hover state
hoverEffects.clearHover()

// Get current state
hoverEffects.getState(): HoverState

// Subscribe to changes
hoverEffects.subscribe(listener: (state: HoverState) => void)
```

### Selection API

```typescript
// Start selection
startSelection(
  position: { x: number; y: number },
  shiftKey: boolean,
  ctrlKey: boolean
)

// Update selection
updateSelection(position: { x: number; y: number })

// End selection
endSelection()

// Cancel selection
cancelSelection()
```

### Connection Drawing API

```typescript
// Start connection
startConnection(
  nodeId: string,
  handleId: string,
  position: { x: number; y: number },
  outputType: 'main' | 'error' | 'success' | 'parallel',
  outputIndex: number
)

// Update connection preview
updateConnection(position: { x: number; y: number })

// Complete connection
completeConnection(targetNodeId: string, targetIndex: number)

// Cancel connection
cancelConnection()
```

---

## Examples

### Custom Context Menu

```typescript
const customItems: ContextMenuItem[] = [
  {
    label: 'Custom Action',
    icon: <MyIcon />,
    shortcut: 'Ctrl+Q',
    onClick: () => console.log('Custom action'),
  },
  {
    label: 'Submenu',
    submenu: [
      { label: 'Option 1', onClick: () => {} },
      { label: 'Option 2', onClick: () => {} },
    ],
  },
];

<ContextMenu
  position={{ x: 100, y: 200 }}
  items={customItems}
  onClose={() => {}}
/>
```

### Custom Tooltip

```typescript
<Tooltip
  content={
    <div>
      <strong>Custom Tooltip</strong>
      <p>With rich content</p>
    </div>
  }
  delay={300}
  placement="top"
>
  <button>Hover me</button>
</Tooltip>
```

### Programmatic Alignment

```typescript
const { workflow, moveActions } = useCanvasStore();

function alignSelectedNodes(type: AlignmentType) {
  const selectedNodeIds = getSelectedNodeIds();
  const nodes = workflow.actions
    .filter(a => selectedNodeIds.includes(a.id))
    .map(a => ({ ...a, position: { x: a.position[0], y: a.position[1] } }));

  const updates = alignNodes(nodes, type);
  moveActions(updates);
}
```

---

## Version History

### v1.0.0 (Current)

- Initial release
- Context menus
- Tooltips
- Hover effects
- Selection box
- Connection drawing
- Keyboard shortcuts
- Mouse gestures
- Touch gestures
- Alignment tools
- Zoom controls
- Grid settings

### Future Enhancements

- Customizable shortcuts
- Macro recording
- Gesture customization
- Advanced alignment guides
- Snap to grid enhancements
- Multi-user cursors
- Collaborative gestures

---

## Support

For issues or questions:

- GitHub Issues: [qontinui-web/issues](https://github.com/jspinak/qontinui-web/issues)
- Documentation: [qontinui.com/docs](https://qontinui.com/docs)
- Discord: [qontinui Discord](https://discord.gg/qontinui)

---

## License

MIT License - see LICENSE file for details
