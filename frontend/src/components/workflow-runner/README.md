# Workflow Variable Monitor

Real-time variable monitoring components for workflow execution. Track variable changes, view current values, and monitor workflow state during execution.

## Features

- **Real-time Updates**: Auto-refresh with configurable intervals (default: 1000ms)
- **Tabbed Interface**: Current values, change history, and global variables
- **Advanced Filtering**: Search by name, filter by scope (execution/workflow/global)
- **JSON Highlighting**: Expandable JSON values for complex objects and arrays
- **Scope Badges**: Color-coded badges for execution, workflow, and global scopes
- **Change Timeline**: Visual timeline showing variable changes with old → new transitions
- **Export**: Export variables and history as JSON
- **Copy to Clipboard**: Quick copy for individual variable values
- **Type Detection**: Automatic type detection and display

## Components

### `VariableMonitor`

Main component for monitoring workflow variables.

```tsx
import { VariableMonitor } from '@/components/workflow-runner';

function WorkflowRunner({ runId }: { runId: string }) {
  return (
    <VariableMonitor
      runId={runId}
      refreshInterval={1000}
      defaultTab="current"
      onRefreshIntervalChange={(interval) => console.log('Interval:', interval)}
    />
  );
}
```

**Props:**
- `runId` (string, required): Workflow run ID
- `refreshInterval` (number, optional): Auto-refresh interval in ms (default: 1000, 0 = disabled)
- `defaultTab` (string, optional): Initial tab - "current" | "history" | "global" (default: "current")
- `onRefreshIntervalChange` (function, optional): Callback when refresh interval changes

### `VariableHistory`

Standalone timeline component for variable changes.

```tsx
import { VariableHistory } from '@/components/workflow-runner';

function ChangeLog({ runId }: { runId: string }) {
  return <VariableHistory runId={runId} refreshInterval={1000} />;
}
```

**Props:**
- `runId` (string, required): Workflow run ID
- `refreshInterval` (number, optional): Auto-refresh interval in ms (default: 1000, 0 = disabled)

## Hooks

### `useWorkflowVariables`

Custom hook for fetching and managing workflow variables with auto-refresh.

```tsx
import { useWorkflowVariables } from '@/hooks/useWorkflowVariables';

function CustomMonitor({ runId }: { runId: string }) {
  const {
    variables,           // Full API response
    variablesSnapshot,   // Current snapshot
    flattenedVariables,  // Flat array of WorkflowVariable objects
    history,             // Array of changes
    historyTotal,        // Total number of changes
    isLoading,           // Combined loading state
    error,               // Combined error state
    refetch,             // Refetch all data
  } = useWorkflowVariables(runId, 1000);

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      {flattenedVariables.map((variable) => (
        <div key={`${variable.scope}-${variable.name}`}>
          {variable.name}: {JSON.stringify(variable.value)}
        </div>
      ))}
    </div>
  );
}
```

**Parameters:**
- `runId` (string): Workflow run ID
- `refreshInterval` (number, optional): Auto-refresh interval in ms (default: 1000)
- `enabled` (boolean, optional): Whether to run the query (default: true)

**Returns:**
- `variables`: Full API response (`VariablesResponse`)
- `variablesSnapshot`: Current snapshot (`VariableSnapshot`)
- `flattenedVariables`: Flat array of all variables (`WorkflowVariable[]`)
- `history`: Array of changes (`VariableChange[]`)
- `historyTotal`: Total number of changes
- `isLoading`: Combined loading state
- `error`: Combined error state
- `refetch()`: Refetch all data
- `isFetching`: Whether currently fetching

### `useVariableHistory`

Standalone hook for fetching only variable change history.

```tsx
import { useVariableHistory } from '@/hooks/useWorkflowVariables';

function HistoryPanel({ runId }: { runId: string }) {
  const { data, isLoading, error } = useVariableHistory(runId, 1000);

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      {data?.history.changes.map((change) => (
        <div key={change.id}>
          {change.variable_name}: {change.change_type}
        </div>
      ))}
    </div>
  );
}
```

## Types

### `WorkflowVariable`

```typescript
interface WorkflowVariable {
  name: string;                 // Variable name/key
  value: VariableValue;         // Current value
  scope: VariableScope;         // 'execution' | 'workflow' | 'global'
  last_updated: string;         // ISO timestamp
  last_modified_by?: string;    // Action ID
  type?: string;                // Inferred type
}
```

### `VariableChange`

```typescript
interface VariableChange {
  id: string;                   // Unique change ID
  variable_name: string;        // Variable that changed
  scope: VariableScope;         // Variable scope
  old_value: VariableValue | null;  // Previous value
  new_value: VariableValue | null;  // New value
  timestamp: string;            // ISO timestamp
  action_id?: string;           // Action that caused change
  action_name?: string;         // Action name/label
  change_type: 'created' | 'updated' | 'deleted';
}
```

### `VariableSnapshot`

```typescript
interface VariableSnapshot {
  timestamp: string;
  execution: Record<string, VariableValue>;
  workflow: Record<string, VariableValue>;
  global: Record<string, VariableValue>;
}
```

See `/src/types/workflow-variables.ts` for complete type definitions.

## API Endpoints

The components expect the following API endpoints to be available:

### Get Current Variables

```
GET /api/v1/workflow-runs/{run_id}/variables
```

**Response:**
```json
{
  "run_id": "workflow-run-123",
  "variables": {
    "timestamp": "2025-11-23T10:15:30Z",
    "execution": {
      "current_step": 5,
      "data": { "key": "value" }
    },
    "workflow": {
      "config": { "timeout": 3000 }
    },
    "global": {
      "api_key": "***"
    }
  },
  "fetched_at": "2025-11-23T10:15:30Z"
}
```

### Get Variable Changes

```
GET /api/v1/workflow-runs/{run_id}/variable-changes
```

**Response:**
```json
{
  "run_id": "workflow-run-123",
  "history": {
    "total": 42,
    "changes": [
      {
        "id": "change-1",
        "variable_name": "current_step",
        "scope": "execution",
        "old_value": 4,
        "new_value": 5,
        "timestamp": "2025-11-23T10:15:30Z",
        "action_id": "action-123",
        "action_name": "Step Counter",
        "change_type": "updated"
      }
    ],
    "next_cursor": "cursor-abc"
  },
  "fetched_at": "2025-11-23T10:15:30Z"
}
```

## Integration Guide

### Step 1: Add to Workflow Runner Page

```tsx
// app/(app)/workflows/[id]/run/page.tsx
import { VariableMonitor } from '@/components/workflow-runner';

export default function WorkflowRunPage({ params }: { params: { id: string } }) {
  const runId = params.id;

  return (
    <div className="p-8">
      <h1>Workflow Execution</h1>

      <div className="grid grid-cols-3 gap-6 mt-6">
        {/* Left: Execution controls */}
        <div className="col-span-1">
          <ExecutionControls runId={runId} />
        </div>

        {/* Right: Variable monitor */}
        <div className="col-span-2">
          <VariableMonitor runId={runId} />
        </div>
      </div>
    </div>
  );
}
```

### Step 2: Add to Tabs Layout

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { VariableMonitor } from '@/components/workflow-runner';

function WorkflowRunnerTabs({ runId }: { runId: string }) {
  return (
    <Tabs defaultValue="execution">
      <TabsList>
        <TabsTrigger value="execution">Execution</TabsTrigger>
        <TabsTrigger value="variables">Variables</TabsTrigger>
        <TabsTrigger value="logs">Logs</TabsTrigger>
      </TabsList>

      <TabsContent value="execution">
        <ExecutionView runId={runId} />
      </TabsContent>

      <TabsContent value="variables">
        <VariableMonitor runId={runId} />
      </TabsContent>

      <TabsContent value="logs">
        <LogsView runId={runId} />
      </TabsContent>
    </Tabs>
  );
}
```

### Step 3: Customize Refresh Interval

```tsx
import { useState } from 'react';
import { VariableMonitor } from '@/components/workflow-runner';

function AdaptiveMonitor({ runId, isRunning }: { runId: string; isRunning: boolean }) {
  const [interval, setInterval] = useState(1000);

  return (
    <VariableMonitor
      runId={runId}
      // Disable refresh when workflow is not running
      refreshInterval={isRunning ? interval : 0}
      onRefreshIntervalChange={setInterval}
    />
  );
}
```

## Styling

The components use the project's dark theme with cyan accents:

- **Background**: `bg-[#1A1A1B]` (dark gray)
- **Border**: `border-gray-800`
- **Primary accent**: `text-[#00D9FF]` (cyan)
- **Scope badges**:
  - Execution: Cyan (`variant="default"`)
  - Workflow: Gray (`variant="secondary"`)
  - Global: White outline (`variant="outline"`)

All components are responsive and follow the existing design system.

## Keyboard Shortcuts

Coming soon:
- `Ctrl/Cmd + F`: Focus search
- `Ctrl/Cmd + R`: Manual refresh
- `Ctrl/Cmd + E`: Export variables
- `Ctrl/Cmd + C`: Copy selected variable

## Performance Considerations

### Auto-refresh Recommendations

- **Active execution**: 1000ms (1 second)
- **Completed execution**: 0 (disabled)
- **Long-running workflows**: 2000-5000ms (2-5 seconds)
- **Debugging**: 500ms (0.5 seconds)

### Optimization Tips

1. **Disable refresh for completed workflows**:
   ```tsx
   <VariableMonitor runId={runId} refreshInterval={isComplete ? 0 : 1000} />
   ```

2. **Use TanStack Query cache**:
   The hooks use React Query which automatically caches responses and prevents duplicate requests.

3. **Filter before rendering**:
   Use the built-in search and scope filters to reduce DOM nodes.

4. **Lazy load complex values**:
   Complex objects/arrays are collapsed by default and only expanded on click.

## Troubleshooting

### Variables not updating

1. Check that `refreshInterval > 0`
2. Verify API endpoints are returning data
3. Check browser console for errors
4. Ensure `runId` is valid and exists

### Performance issues

1. Increase `refreshInterval` to reduce API calls
2. Filter variables to reduce rendered items
3. Check network tab for API response times
4. Consider pagination for large change histories

### Type errors

1. Ensure TypeScript types are imported from `@/types/workflow-variables`
2. Check that API responses match expected interfaces
3. Update types if API schema has changed

## Examples

See `VariableMonitor.example.tsx` for complete examples including:
- Basic usage
- Custom refresh intervals
- Dynamic run IDs
- Full dashboard integration
- Split view layouts
- Standalone history component
- Disabled auto-refresh
- Global variables only

## Testing

### Unit Tests (Coming Soon)

```tsx
import { render, screen } from '@testing-library/react';
import { VariableMonitor } from './VariableMonitor';

test('renders variable monitor', () => {
  render(<VariableMonitor runId="test-run-123" />);
  expect(screen.getByText('Variable Monitor')).toBeInTheDocument();
});
```

### Integration Tests (Coming Soon)

```tsx
import { test, expect } from '@playwright/test';

test('displays variables in real-time', async ({ page }) => {
  await page.goto('/workflows/123/run');
  await expect(page.locator('[data-testid="variable-monitor"]')).toBeVisible();
  // Wait for auto-refresh
  await page.waitForTimeout(1000);
  // Verify variables updated
});
```

## Contributing

When adding new features:
1. Update TypeScript types in `/src/types/workflow-variables.ts`
2. Add corresponding hook functions in `/src/hooks/useWorkflowVariables.ts`
3. Update component props and documentation
4. Add examples to `VariableMonitor.example.tsx`
5. Update this README

## License

Part of the Qontinui project. See main project LICENSE.
