# Execution Results Display Components

Components for displaying workflow execution results with expectations evaluation.

## Components

### ExecutionResultsDisplay

Full display component showing all execution results including checkpoints, assertions, and errors.

### ExecutionResultsBadge

Compact badge showing pass/fail status, ideal for lists and tables.

## Usage Examples

### Basic Usage

```tsx
import {
  ExecutionResultsDisplay,
  ExecutionResultsBadge,
  WorkflowExecutionResult,
} from "@/components/expectations";

// In your component
function WorkflowResultsPage({ result }: { result: WorkflowExecutionResult }) {
  return (
    <div className="space-y-6">
      <ExecutionResultsDisplay result={result} />
    </div>
  );
}
```

### Badge in a List

```tsx
import { ExecutionResultsBadge } from "@/components/expectations";

function WorkflowRunsList({ runs }: { runs: WorkflowRun[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Run ID</th>
          <th>Status</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.id}>
            <td>{run.id}</td>
            <td>
              <ExecutionResultsBadge
                result={run.execution_result}
                showDuration={false}
              />
            </td>
            <td>{formatTimestamp(run.completed_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

### Badge with Duration

```tsx
<ExecutionResultsBadge
  result={executionResult}
  showDuration={true}
  showIcon={true}
/>
```

### Custom Styling

```tsx
<ExecutionResultsDisplay
  result={result}
  className="max-w-4xl mx-auto"
/>

<ExecutionResultsBadge
  result={result}
  className="text-lg px-4 py-2"
/>
```

## Props

### ExecutionResultsDisplay

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `result` | `WorkflowExecutionResult` | Yes | The execution result to display |
| `className` | `string` | No | Additional CSS classes |

### ExecutionResultsBadge

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `result` | `WorkflowExecutionResult` | Required | The execution result to display |
| `showDuration` | `boolean` | `false` | Show execution duration in badge |
| `showIcon` | `boolean` | `true` | Show pass/fail icon |
| `className` | `string` | - | Additional CSS classes |

## WorkflowExecutionResult Type

The components expect a `WorkflowExecutionResult` object with the following structure:

```typescript
interface WorkflowExecutionResult {
  success: boolean;
  success_criteria?: SuccessCriteria;
  checkpoint_results: CheckpointValidationResult[];
  actions_passed: number;
  actions_failed: number;
  total_duration_ms: number;
  exceeded_max_duration: boolean;
  console_errors?: string[];
  network_errors?: string[];
  states_visited: string[];
  error?: string;
}
```

## Features

### ExecutionResultsDisplay

- Overall success/failure status with color-coded icon
- Success criteria evaluation details
- Actions summary (passed/failed counts)
- Checkpoint results with:
  - OCR assertion results
  - Claude review results
  - Screenshots
  - Duration and error messages
- States visited during workflow
- Console and network errors
- Overall error message

### ExecutionResultsBadge

- Compact pass/fail indicator
- Optional duration display
- Optional icon display
- Color-coded (green for pass, red for fail)
- Warning icon for exceeded duration

## Checkpoint Display

Each checkpoint shows:

1. **Header**: Name, status badge, duration
2. **OCR Assertions**: Each assertion with:
   - Type and pattern
   - Pass/fail status
   - Description
   - Error message if failed
   - Actual vs. expected values
3. **Claude Reviews**: Each review with:
   - Instruction given to Claude
   - Observations
   - Confidence score
   - Pass/fail status
4. **Screenshot**: Path to captured screenshot
5. **Error**: Any error message from checkpoint

## Styling

Both components use the project's design system:

- Badge component for status indicators
- Card component for structured layout
- Lucide React icons for visual elements
- Tailwind CSS for responsive design
- Dark mode support

## Example Data

```typescript
const mockResult: WorkflowExecutionResult = {
  success: true,
  success_criteria: {
    type: "all_actions_pass",
    description: "All actions must complete successfully",
  },
  checkpoint_results: [
    {
      checkpoint_name: "login_complete",
      passed: true,
      assertion_results: [
        {
          type: "text_present",
          pattern: "Welcome",
          passed: true,
          description: "Check if welcome message is displayed",
        },
      ],
      screenshot_path: "/screenshots/checkpoint_1.png",
      duration_ms: 1234,
    },
  ],
  actions_passed: 5,
  actions_failed: 0,
  total_duration_ms: 12345,
  exceeded_max_duration: false,
  states_visited: ["login_page", "dashboard", "settings"],
};
```

## Integration with Workflow Execution

Typically used after workflow execution completes:

```tsx
async function executeWorkflowWithExpectations(workflowId: string) {
  const result = await api.executeWorkflow(workflowId);

  return (
    <div>
      <h1>Workflow Execution Results</h1>
      <ExecutionResultsDisplay result={result} />

      {!result.success && (
        <div className="mt-4">
          <h2>Troubleshooting</h2>
          {/* Additional debugging info */}
        </div>
      )}
    </div>
  );
}
```
