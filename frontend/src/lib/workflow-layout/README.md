# Workflow Auto-Layout System

Sophisticated graph layout algorithms for automatically positioning workflow actions in a visually pleasing and readable manner.

## Features

- **Multiple Layout Algorithms**: Hierarchical, Tree, Force-Directed, Circular, and Horizontal layouts
- **Intelligent Branch Handling**: Special handling for IF, LOOP, and SWITCH control flow actions
- **Overlap Reduction**: Iterative algorithm ensures nodes don't overlap
- **Configurable**: Extensive configuration options for spacing, sizing, and centering
- **Performance**: Efficiently handles large graphs with 100+ nodes

## Quick Start

```typescript
import { autoLayoutWorkflow, LayoutStyle } from './lib/workflow-layout/auto-layout';
import type { Workflow } from './lib/action-schema/action-types';

// Create your workflow
const workflow: Workflow = {
  id: 'my-workflow',
  name: 'My Workflow',
  version: '1.0.0',
  format: 'graph',
  actions: [
    { id: 'a1', type: 'CLICK', config: {...}, position: [0, 0] },
    { id: 'a2', type: 'TYPE', config: {...}, position: [0, 0] },
    { id: 'a3', type: 'CLICK', config: {...}, position: [0, 0] },
  ],
  connections: {
    a1: { main: [[{ action: 'a2', type: 'main', index: 0 }]] },
    a2: { main: [[{ action: 'a3', type: 'main', index: 0 }]] },
  },
};

// Apply auto-layout
autoLayoutWorkflow(workflow);

// Now all actions have optimized positions
console.log(workflow.actions[0].position); // [x, y]
```

## Layout Styles

### Hierarchical (Default)

Top-to-bottom hierarchical layout using the Sugiyama algorithm. Best for workflows with clear execution order.

```typescript
autoLayoutWorkflow(workflow, {}, LayoutStyle.HIERARCHICAL);
```

**Best for:**
- Linear workflows
- Workflows with clear layers
- Decision trees
- General purpose

**Characteristics:**
- Nodes arranged in horizontal layers
- Vertical position based on execution order
- Branches spread vertically
- Clean, readable structure

### Horizontal

Left-to-right flow similar to hierarchical but rotated 90 degrees.

```typescript
autoLayoutWorkflow(workflow, {}, LayoutStyle.HORIZONTAL);
```

**Best for:**
- Workflows displayed in wide viewports
- Time-based sequences
- Pipeline visualizations

**Characteristics:**
- Nodes arranged in vertical layers
- Horizontal position based on execution order
- Branches spread horizontally

### Tree

Optimized tree layout with parent nodes centered over children.

```typescript
autoLayoutWorkflow(workflow, {}, LayoutStyle.TREE);
```

**Best for:**
- Strictly hierarchical workflows
- Decision trees
- Workflows with no cycles or cross-connections

**Characteristics:**
- Parent nodes centered over children
- Compact vertical spacing
- Natural tree structure

### Force-Directed

Physics-based layout using repulsive and attractive forces.

```typescript
autoLayoutWorkflow(workflow, {}, LayoutStyle.FORCE_DIRECTED);
```

**Best for:**
- Complex interconnected graphs
- Exploring graph structure
- Workflows with many cross-connections

**Characteristics:**
- Connected nodes pulled together
- Unconnected nodes pushed apart
- Organic, balanced appearance
- May take longer to compute

### Circular

Nodes arranged in a circle.

```typescript
autoLayoutWorkflow(workflow, {}, LayoutStyle.CIRCULAR);
```

**Best for:**
- Small workflows (< 20 nodes)
- Cyclic workflows
- Presentations and demos

**Characteristics:**
- Equal spacing around circle
- Compact layout
- Good for showing all nodes at once

## Configuration

### Custom Configuration

```typescript
import { AutoLayout } from './lib/workflow-layout/auto-layout';

const layout = new AutoLayout({
  nodeWidth: 200,              // Width of each node
  nodeHeight: 100,             // Height of each node
  horizontalSpacing: 250,      // Horizontal space between nodes
  verticalSpacing: 150,        // Vertical space between nodes
  branchOffset: 200,           // Vertical offset for branches
  centerPoint: [500, 400],     // Where to center the graph
  maxOverlapIterations: 15,    // Max iterations for overlap reduction
  minNodeSpacing: 30,          // Minimum spacing between nodes
});

layout.layout(workflow);
```

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `style` | `HIERARCHICAL` | Layout algorithm to use |
| `nodeWidth` | 180 | Width of each node in pixels |
| `nodeHeight` | 80 | Height of each node in pixels |
| `horizontalSpacing` | 200 | Horizontal space between nodes |
| `verticalSpacing` | 120 | Vertical space between nodes |
| `branchOffset` | 150 | Vertical offset for IF/LOOP branches |
| `centerPoint` | [400, 300] | Target center point for the graph |
| `maxOverlapIterations` | 10 | Maximum iterations for overlap reduction |
| `minNodeSpacing` | 20 | Minimum spacing between any two nodes |

## Advanced Usage

### Branch Handling

The auto-layout system automatically handles control flow actions:

#### IF Actions

```typescript
const workflow: Workflow = {
  // ...
  actions: [
    { id: 'check', type: 'IF', config: {...}, position: [0, 0] },
    { id: 'true-path', type: 'CLICK', config: {...}, position: [0, 0] },
    { id: 'false-path', type: 'TYPE', config: {...}, position: [0, 0] },
  ],
  connections: {
    check: {
      main: [
        [{ action: 'true-path', type: 'main', index: 0 }],   // Output 0: true
        [{ action: 'false-path', type: 'main', index: 0 }],  // Output 1: false
      ],
    },
  },
};

autoLayoutWorkflow(workflow);
// true-path will be positioned above the IF node
// false-path will be positioned below the IF node
```

#### LOOP Actions

```typescript
const workflow: Workflow = {
  // ...
  actions: [
    { id: 'loop', type: 'LOOP', config: {...}, position: [0, 0] },
    { id: 'loop-body', type: 'CLICK', config: {...}, position: [0, 0] },
  ],
  connections: {
    loop: {
      main: [[{ action: 'loop-body', type: 'main', index: 0 }]],
    },
  },
};

autoLayoutWorkflow(workflow);
// loop-body will be offset slightly from the LOOP node
```

#### SWITCH Actions

```typescript
const workflow: Workflow = {
  // ...
  actions: [
    { id: 'switch', type: 'SWITCH', config: {...}, position: [0, 0] },
    { id: 'case1', type: 'CLICK', config: {...}, position: [0, 0] },
    { id: 'case2', type: 'TYPE', config: {...}, position: [0, 0] },
    { id: 'case3', type: 'CLICK', config: {...}, position: [0, 0] },
    { id: 'default', type: 'TYPE', config: {...}, position: [0, 0] },
  ],
  connections: {
    switch: {
      main: [
        [{ action: 'case1', type: 'main', index: 0 }],
        [{ action: 'case2', type: 'main', index: 0 }],
        [{ action: 'case3', type: 'main', index: 0 }],
        [{ action: 'default', type: 'main', index: 0 }],
      ],
    },
  },
};

autoLayoutWorkflow(workflow);
// Cases will be evenly distributed vertically around the SWITCH node
```

### Custom Layout Class

For more control, use the `AutoLayout` class directly:

```typescript
import { AutoLayout, LayoutStyle } from './lib/workflow-layout/auto-layout';

const layout = new AutoLayout({
  nodeWidth: 250,
  horizontalSpacing: 300,
  centerPoint: [600, 500],
});

// Apply layout
layout.layout(workflow, LayoutStyle.HIERARCHICAL);

// Update configuration
layout.updateConfig({ branchOffset: 200 });

// Apply different style
layout.layout(workflow, LayoutStyle.TREE);

// Get current configuration
const config = layout.getConfig();
console.log(config.nodeWidth); // 250
```

### Handling Complex Graphs

#### Diamond Pattern (Multiple Paths Converge)

```typescript
const workflow: Workflow = {
  // ...
  actions: [
    { id: 'start', type: 'CLICK', config: {...}, position: [0, 0] },
    { id: 'branch1', type: 'CLICK', config: {...}, position: [0, 0] },
    { id: 'branch2', type: 'TYPE', config: {...}, position: [0, 0] },
    { id: 'merge', type: 'CLICK', config: {...}, position: [0, 0] },
  ],
  connections: {
    start: {
      main: [
        [{ action: 'branch1', type: 'main', index: 0 }],
        [{ action: 'branch2', type: 'main', index: 0 }],
      ],
    },
    branch1: { main: [[{ action: 'merge', type: 'main', index: 0 }]] },
    branch2: { main: [[{ action: 'merge', type: 'main', index: 0 }]] },
  },
};

autoLayoutWorkflow(workflow);
// Layout handles merge points intelligently
```

#### Multiple Entry Points

```typescript
const workflow: Workflow = {
  // ...
  actions: [
    { id: 'entry1', type: 'CLICK', config: {...}, position: [0, 0] },
    { id: 'entry2', type: 'TYPE', config: {...}, position: [0, 0] },
    { id: 'step1', type: 'CLICK', config: {...}, position: [0, 0] },
    { id: 'step2', type: 'CLICK', config: {...}, position: [0, 0] },
  ],
  connections: {
    entry1: { main: [[{ action: 'step1', type: 'main', index: 0 }]] },
    entry2: { main: [[{ action: 'step2', type: 'main', index: 0 }]] },
  },
};

autoLayoutWorkflow(workflow);
// Both entry points start at same layer (leftmost)
```

## Algorithm Details

### Hierarchical Layout (Sugiyama)

The hierarchical layout uses a modified Sugiyama algorithm:

1. **Layer Assignment**: BFS traversal assigns each node to a horizontal layer
2. **Layer Positioning**: Nodes within each layer are centered vertically
3. **Branch Handling**: Special logic for IF/LOOP/SWITCH actions
4. **Overlap Reduction**: Iterative separation of overlapping nodes
5. **Centering**: Final adjustment to center the graph

**Time Complexity**: O(V + E) where V = vertices (actions), E = edges (connections)

**Space Complexity**: O(V)

### Force-Directed Layout

Uses a physics simulation with:
- **Repulsive forces**: Push all nodes apart (inverse square law)
- **Attractive forces**: Pull connected nodes together (spring force)
- **Cooling schedule**: Gradually reduce movement over iterations

**Iterations**: 100 (configurable via implementation)

**Time Complexity**: O(n²) per iteration, O(n² × i) total where i = iterations

**Space Complexity**: O(V)

### Overlap Reduction

Iterative algorithm that:
1. Detects all overlapping node pairs
2. Pushes nodes apart along their separation vector
3. Repeats until no overlaps or max iterations reached

**Max Iterations**: 10 (configurable)

**Guarantees**: No overlaps if `maxOverlapIterations` is sufficient

## Performance

### Benchmarks

| Workflow Size | Layout Time | Memory |
|---------------|-------------|--------|
| 10 nodes | < 10ms | Minimal |
| 50 nodes | < 50ms | Low |
| 100 nodes | < 200ms | Moderate |
| 500 nodes | < 1s | Higher |

### Optimization Tips

1. **Use hierarchical layout for large graphs**: Fastest algorithm (O(n))
2. **Limit force-directed to < 100 nodes**: O(n²) complexity
3. **Reduce `maxOverlapIterations` for speed**: Trade accuracy for performance
4. **Increase spacing for complex graphs**: Reduces overlap iterations needed

## Integration Examples

### React Component

```typescript
import { useEffect } from 'react';
import { autoLayoutWorkflow } from './lib/workflow-layout/auto-layout';

function WorkflowEditor({ workflow, setWorkflow }) {
  const handleAutoLayout = () => {
    // Create a copy to avoid mutation during layout
    const layoutWorkflow = JSON.parse(JSON.stringify(workflow));

    // Apply auto-layout
    autoLayoutWorkflow(layoutWorkflow);

    // Update state
    setWorkflow(layoutWorkflow);
  };

  return (
    <div>
      <button onClick={handleAutoLayout}>
        Auto Layout
      </button>
      {/* Render workflow */}
    </div>
  );
}
```

### With React Flow

```typescript
import { getLayoutedElements } from './lib/layout-utils';
import { autoLayoutWorkflow } from './lib/workflow-layout/auto-layout';

function convertWorkflowToReactFlow(workflow: Workflow) {
  // Apply auto-layout first
  autoLayoutWorkflow(workflow);

  // Convert to React Flow format
  const nodes = workflow.actions.map(action => ({
    id: action.id,
    type: 'actionNode',
    position: { x: action.position[0], y: action.position[1] },
    data: { action },
  }));

  const edges = Object.entries(workflow.connections).flatMap(([sourceId, conns]) =>
    (conns.main || []).flatMap((connArray, outputIndex) =>
      connArray.map((conn, connIndex) => ({
        id: `${sourceId}-${conn.action}-${outputIndex}-${connIndex}`,
        source: sourceId,
        target: conn.action,
        type: conn.type,
      }))
    )
  );

  return { nodes, edges };
}
```

### Automatic Layout on Add

```typescript
function addActionToWorkflow(
  workflow: Workflow,
  newAction: Action,
  connectToId?: string
) {
  // Add action
  workflow.actions.push(newAction);

  // Add connection if specified
  if (connectToId) {
    if (!workflow.connections[connectToId]) {
      workflow.connections[connectToId] = {};
    }
    workflow.connections[connectToId].main = [
      [{ action: newAction.id, type: 'main', index: 0 }],
    ];
  }

  // Re-layout entire workflow
  autoLayoutWorkflow(workflow);

  return workflow;
}
```

## Troubleshooting

### Nodes Still Overlap

**Problem**: After layout, some nodes still overlap.

**Solutions**:
- Increase `maxOverlapIterations` in configuration
- Increase `minNodeSpacing` for more separation
- Increase `horizontalSpacing` and `verticalSpacing`
- Use a different layout style (TREE or FORCE_DIRECTED handle overlaps differently)

### Layout Looks Cramped

**Problem**: Graph is too densely packed.

**Solutions**:
- Increase `horizontalSpacing` and `verticalSpacing`
- Increase `nodeWidth` and `nodeHeight` if nodes are actually larger
- Increase `branchOffset` for more branch separation

### Layout Too Spread Out

**Problem**: Nodes are too far apart.

**Solutions**:
- Decrease spacing values
- Decrease `branchOffset`
- Use TREE layout for more compact structure

### Branches Not Separating

**Problem**: IF/LOOP branches don't appear distinct.

**Solutions**:
- Increase `branchOffset` configuration
- Ensure connections are properly structured with separate arrays for each branch
- Try TREE layout which emphasizes hierarchical structure

### Poor Performance

**Problem**: Layout takes too long on large graphs.

**Solutions**:
- Use HIERARCHICAL layout (fastest)
- Avoid FORCE_DIRECTED on large graphs (O(n²))
- Reduce `maxOverlapIterations`
- Consider breaking large workflow into sub-workflows

## API Reference

### `autoLayoutWorkflow(workflow, config?, style?)`

Convenience function to apply auto-layout to a workflow.

**Parameters:**
- `workflow: Workflow` - The workflow to layout (modified in place)
- `config?: LayoutConfig` - Optional configuration
- `style?: LayoutStyle` - Optional layout style (default: HIERARCHICAL)

**Returns:** `void` (modifies workflow in place)

### `AutoLayout` Class

#### Constructor

```typescript
new AutoLayout(config?: LayoutConfig)
```

Creates a new AutoLayout instance with optional configuration.

#### Methods

##### `layout(workflow, style?)`

Applies layout to a workflow.

**Parameters:**
- `workflow: Workflow` - The workflow to layout
- `style?: LayoutStyle` - Optional layout style override

**Returns:** `void`

##### `updateConfig(config)`

Updates the configuration.

**Parameters:**
- `config: Partial<LayoutConfig>` - Configuration updates

**Returns:** `void`

##### `getConfig()`

Gets the current configuration.

**Returns:** `Required<LayoutConfig>`

### Types

#### `LayoutStyle`

```typescript
enum LayoutStyle {
  HIERARCHICAL = 'hierarchical',
  TREE = 'tree',
  FORCE_DIRECTED = 'force',
  CIRCULAR = 'circular',
  HORIZONTAL = 'horizontal',
}
```

#### `LayoutConfig`

```typescript
interface LayoutConfig {
  style?: LayoutStyle;
  nodeWidth?: number;
  nodeHeight?: number;
  horizontalSpacing?: number;
  verticalSpacing?: number;
  branchOffset?: number;
  centerPoint?: [number, number];
  maxOverlapIterations?: number;
  minNodeSpacing?: number;
}
```

## License

Part of the Qontinui project.
