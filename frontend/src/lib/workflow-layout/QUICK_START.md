# Quick Start Guide - Workflow Auto-Layout

## 30-Second Start

```typescript
import { autoLayoutWorkflow } from '@/lib/workflow-layout';

// Your workflow with unpositioned actions
const workflow = { ... };

// Apply auto-layout
autoLayoutWorkflow(workflow);

// Done! All actions now have optimized positions
```

## Common Use Cases

### 1. Default Layout (Hierarchical)
```typescript
import { autoLayoutWorkflow } from '@/lib/workflow-layout';

autoLayoutWorkflow(workflow);
```

### 2. Specific Layout Style
```typescript
import { autoLayoutWorkflow, LayoutStyle } from '@/lib/workflow-layout';

// Force-directed for complex graphs
autoLayoutWorkflow(workflow, {}, LayoutStyle.FORCE_DIRECTED);

// Circular for small workflows
autoLayoutWorkflow(workflow, {}, LayoutStyle.CIRCULAR);

// Tree for hierarchical workflows
autoLayoutWorkflow(workflow, {}, LayoutStyle.TREE);
```

### 3. Custom Spacing
```typescript
import { autoLayoutWorkflow } from '@/lib/workflow-layout';

autoLayoutWorkflow(workflow, {
  nodeWidth: 200,
  nodeHeight: 100,
  horizontalSpacing: 250,
  verticalSpacing: 150,
});
```

### 4. React Component
```typescript
import { autoLayoutWorkflow } from '@/lib/workflow-layout';

function AutoLayoutButton({ workflow, onUpdate }) {
  const handleClick = () => {
    const layoutWorkflow = JSON.parse(JSON.stringify(workflow));
    autoLayoutWorkflow(layoutWorkflow);
    onUpdate(layoutWorkflow);
  };

  return <button onClick={handleClick}>Auto Layout</button>;
}
```

### 5. Advanced Configuration
```typescript
import { AutoLayout, LayoutStyle } from '@/lib/workflow-layout';

const layout = new AutoLayout({
  nodeWidth: 250,
  horizontalSpacing: 300,
  branchOffset: 200,
  centerPoint: [500, 400],
  maxOverlapIterations: 15,
});

layout.layout(workflow, LayoutStyle.HIERARCHICAL);
```

## Layout Style Chooser

| Workflow Type | Recommended Style | Reason |
|---------------|-------------------|--------|
| Linear (A→B→C) | `HIERARCHICAL` | Clean, fast, clear flow |
| Decision tree | `TREE` | Compact, emphasizes hierarchy |
| Complex/interconnected | `FORCE_DIRECTED` | Natural clustering |
| Wide viewport | `HORIZONTAL` | Better use of space |
| Small/demo | `CIRCULAR` | Compact, all nodes visible |

## Configuration Cheat Sheet

### Spacing
```typescript
{
  nodeWidth: 180,         // Width of each node
  nodeHeight: 80,         // Height of each node
  horizontalSpacing: 200, // Space between layers
  verticalSpacing: 120,   // Space between nodes in layer
}
```

### Branch Control
```typescript
{
  branchOffset: 150,      // Vertical offset for IF/LOOP branches
}
```

### Quality vs Performance
```typescript
{
  maxOverlapIterations: 10,  // More = better quality, slower
  minNodeSpacing: 20,        // Larger = more spread out
}
```

### Positioning
```typescript
{
  centerPoint: [400, 300],   // Where to center the graph
}
```

## Troubleshooting

### Nodes Overlap
**Solution:** Increase spacing or iterations
```typescript
autoLayoutWorkflow(workflow, {
  horizontalSpacing: 250,
  verticalSpacing: 150,
  maxOverlapIterations: 15,
});
```

### Too Spread Out
**Solution:** Decrease spacing
```typescript
autoLayoutWorkflow(workflow, {
  horizontalSpacing: 150,
  verticalSpacing: 80,
  branchOffset: 100,
});
```

### Slow Performance
**Solution:** Use hierarchical, reduce iterations
```typescript
autoLayoutWorkflow(workflow, {
  maxOverlapIterations: 5,
}, LayoutStyle.HIERARCHICAL);
```

### Branches Not Separating
**Solution:** Increase branch offset
```typescript
autoLayoutWorkflow(workflow, {
  branchOffset: 200,
});
```

## Examples

See `examples.ts` for 10 complete examples:
- Linear workflow
- Conditional (IF) workflow
- Loop workflow
- Switch workflow
- Diamond pattern
- Error handling
- Custom configuration
- All layout styles
- Complex nested
- Large workflow

## Full Documentation

See `README.md` for comprehensive documentation including:
- All layout algorithms
- Configuration options
- API reference
- Integration examples
- Performance guidelines

## Need Help?

1. Check `README.md` for detailed docs
2. Look at `examples.ts` for working examples
3. Review `IMPLEMENTATION_SUMMARY.md` for technical details
4. Run tests: `tests/workflow-layout/auto-layout.test.ts`
