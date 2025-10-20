# Workflow Converter

Converts sequential action lists into graph format workflows with automatic layout and control flow handling.

## Features

- Linear workflow conversion with automatic connections
- Control flow handling (IF, LOOP, SWITCH, TRY_CATCH)
- Intelligent auto-layout positioning
- Full type safety and validation
- Customizable spacing and layout options

## Quick Start

```typescript
import { convertSequentialToGraph } from '@/lib/workflow-converter';

const actions = [
  { id: '1', type: 'CLICK', config: {...}, position: [0, 0] },
  { id: '2', type: 'TYPE', config: {...}, position: [0, 0] },
  { id: '3', type: 'CLICK', config: {...}, position: [0, 0] }
];

const workflow = convertSequentialToGraph(actions, {
  workflowName: 'My Workflow',
  layout: { horizontalSpacing: 250 }
});
```

See full documentation in the module files.
