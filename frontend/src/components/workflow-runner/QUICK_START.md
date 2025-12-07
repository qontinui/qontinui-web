# Variable Monitor - Quick Start Guide

Get started with the Workflow Variable Monitor in 5 minutes.

## Installation

The component is already installed in your project. Just import and use!

```tsx
import { VariableMonitor } from "@/components/workflow-runner";
```

## Basic Usage

```tsx
function MyWorkflowRunner() {
  const runId = "workflow-run-123"; // Your workflow run ID

  return <VariableMonitor runId={runId} />;
}
```

That's it! The component will:

- Auto-refresh every second
- Display current variables in a table
- Show change history in a timeline
- Provide global variables view
- Allow searching and filtering

## Common Scenarios

### 1. Disable Auto-refresh for Completed Workflows

```tsx
const isComplete = workflow.status === "completed";

<VariableMonitor runId={runId} refreshInterval={isComplete ? 0 : 1000} />;
```

### 2. Start with History Tab

```tsx
<VariableMonitor runId={runId} defaultTab="history" />
```

### 3. Slower Refresh for Long Workflows

```tsx
<VariableMonitor runId={runId} refreshInterval={5000} />
```

### 4. Add to Dashboard

```tsx
<div className="grid grid-cols-3 gap-6">
  <div className="col-span-1">
    <ExecutionStatus runId={runId} />
  </div>
  <div className="col-span-2">
    <VariableMonitor runId={runId} />
  </div>
</div>
```

### 5. Custom Hook for Advanced Use

```tsx
import { useWorkflowVariables } from "@/hooks/useWorkflowVariables";

function CustomView() {
  const { flattenedVariables, history, refetch } = useWorkflowVariables(runId);

  return (
    <div>
      <button onClick={refetch}>Refresh</button>
      {flattenedVariables.map((v) => (
        <div>
          {v.name}: {JSON.stringify(v.value)}
        </div>
      ))}
    </div>
  );
}
```

## Features at a Glance

| Feature               | Description                                      |
| --------------------- | ------------------------------------------------ |
| **Real-time Updates** | Auto-refresh with configurable interval          |
| **Three Tabs**        | Current values, change history, global variables |
| **Search**            | Filter variables by name                         |
| **Scope Filters**     | Filter by execution/workflow/global scope        |
| **JSON Expansion**    | Expand complex objects and arrays                |
| **Copy to Clipboard** | Copy any variable value                          |
| **Export**            | Download all variables as JSON                   |
| **Timeline View**     | Visual history of all changes                    |
| **Type Detection**    | Automatic type detection and display             |

## API Requirements

Make sure these endpoints are implemented:

```
GET /api/v1/workflow-runs/{run_id}/variables
GET /api/v1/workflow-runs/{run_id}/variable-changes
```

Response format:

```json
{
  "run_id": "...",
  "variables": {
    "timestamp": "2025-11-23T10:15:30Z",
    "execution": { "var1": "value1" },
    "workflow": { "var2": "value2" },
    "global": { "var3": "value3" }
  },
  "fetched_at": "2025-11-23T10:15:30Z"
}
```

## Props Reference

### VariableMonitor

| Prop                      | Type     | Default   | Description                                     |
| ------------------------- | -------- | --------- | ----------------------------------------------- |
| `runId`                   | string   | required  | Workflow run ID                                 |
| `refreshInterval`         | number   | 1000      | Auto-refresh interval in ms (0 = disabled)      |
| `defaultTab`              | string   | "current" | Initial tab: "current" \| "history" \| "global" |
| `onRefreshIntervalChange` | function | -         | Callback when interval changes                  |

### VariableHistory

| Prop              | Type   | Default  | Description                                |
| ----------------- | ------ | -------- | ------------------------------------------ |
| `runId`           | string | required | Workflow run ID                            |
| `refreshInterval` | number | 1000     | Auto-refresh interval in ms (0 = disabled) |

## TypeScript Types

Import types from:

```tsx
import type {
  WorkflowVariable,
  VariableChange,
  VariableSnapshot,
  VariableScope,
} from "@/types/workflow-variables";
```

## Styling

Components use the project's dark theme:

- Dark background: `#1A1A1B`
- Cyan accent: `#00D9FF`
- Responsive design
- Smooth animations

## Need More Help?

- See `README.md` for full documentation
- Check `VariableMonitor.example.tsx` for examples
- Review `/src/types/workflow-variables.ts` for type definitions
- Test with `/src/hooks/useWorkflowVariables.ts` hook

## Troubleshooting

**Variables not showing?**

- Verify `runId` is correct
- Check API endpoints are working
- Look for errors in browser console

**Slow performance?**

- Increase `refreshInterval` (e.g., 5000ms)
- Use scope filters to reduce items
- Disable auto-refresh when not needed

**Need custom behavior?**

- Use `useWorkflowVariables` hook directly
- Build custom UI with the data
- See examples for inspiration

## Next Steps

1. Add `VariableMonitor` to your workflow runner page
2. Test with a running workflow
3. Customize refresh interval based on needs
4. Explore advanced features in full docs
5. Add keyboard shortcuts (coming soon!)

Happy monitoring!
