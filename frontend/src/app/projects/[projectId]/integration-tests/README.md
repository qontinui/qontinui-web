# Integration Tests Page

## Overview

The Integration Tests page provides a comprehensive testing environment for automation workflows using historical data as a simulated environment. This is **separate from the Verify pages** and focuses on testing the automation workflows themselves, not external applications.

## Key Concepts

1. **Tests automation workflows themselves** - Not external apps
2. **No separate test cases** - Workflows ARE the tests
3. **Uses historical data** from automation runs for simulation
4. **RANDOM selection** from matches makes each test different (like live automation)
5. **Runs immediately by default**, with optional visualization modes

## Location

```
/mnt/c/qontinui/qontinui-web/frontend/src/app/projects/[projectId]/integration-tests/page.tsx
```

## File Structure

```
frontend/src/
├── app/projects/[projectId]/integration-tests/
│   └── page.tsx                           # Main page component
├── components/integration-tests/
│   ├── WorkflowSelector.tsx               # Workflow selection with checkboxes
│   ├── HistoricalDataStatus.tsx           # Historical data statistics panel
│   ├── TestExecutionPanel.tsx             # Real-time execution progress
│   ├── TestResultsPanel.tsx               # Test results display
│   ├── VisualizationModeSelector.tsx      # Visualization mode selector
│   └── index.ts                           # Barrel export
├── types/
│   └── integration-tests.ts               # TypeScript types
└── services/
    └── integration-tests-service.ts       # API service
```

## Components

### 1. WorkflowSelector

**Purpose**: Select which workflows to test

**Props**:

```typescript
interface WorkflowSelectorProps {
  workflows: Workflow[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  disabled?: boolean;
}
```

**Features**:

- Checkbox selection for each workflow
- Select All / Clear buttons
- Shows workflow metadata (actions count, category)
- Visual indication of selection
- Disabled state during test execution

### 2. HistoricalDataStatus

**Purpose**: Display statistics about available historical data

**Props**:

```typescript
interface HistoricalDataStatusProps {
  stats: HistoricalDataStats | null;
  loading?: boolean;
  error?: string | null;
}
```

**Displays**:

- Number of automation runs imported
- Total recorded actions
- State coverage percentage (with visual progress bar)
- Unique states covered
- Transitions recorded
- Last updated time (relative format)

### 3. TestExecutionPanel

**Purpose**: Show real-time test execution progress

**Props**:

```typescript
interface TestExecutionPanelProps {
  execution: WorkflowTestExecution | null;
  totalWorkflows: number;
  completedWorkflows: number;
}
```

**Features**:

- Current workflow being tested
- Current step and action
- Which historical match was randomly selected
- Progress bars (per-workflow and overall)
- Error display with details
- Visual status indicators

### 4. TestResultsPanel

**Purpose**: Display test results for completed workflows

**Props**:

```typescript
interface TestResultsPanelProps {
  results: WorkflowTestResult[];
  loading?: boolean;
  onViewDetails?: (workflowId: string) => void;
}
```

**Features**:

- Summary statistics (passed/failed counts)
- Overall success rate with visual progress
- Per-workflow results with pass/fail status
- Step counts and success rates
- Duration for each workflow
- Random matches used indicator
- "View Details" link for failures
- Note about random match selection

### 5. VisualizationModeSelector

**Purpose**: Select visualization mode for test execution

**Props**:

```typescript
type VisualizationMode = "none" | "screenshots" | "state-visualization";
interface VisualizationModeSelectorProps {
  mode: VisualizationMode;
  onModeChange: (mode: VisualizationMode) => void;
  disabled?: boolean;
}
```

**Modes**:

- **None (Immediate)** - Fastest execution, no visual feedback (recommended)
- **Screenshots** - Capture screenshots at each step for debugging
- **State Visualization** - Show state transitions with fixed positions

## Page Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  INTEGRATION TESTS                                              [Run All ▶] │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  WORKFLOWS                         EXECUTION                                │
│  ┌─────────────────────────┐       ┌───────────────────────────────────────┐│
│  │ ☑ Login Workflow        │       │ Running: Checkout Workflow            ││
│  │ ☑ Checkout Workflow     │       │ Step 4/7: Click "proceed_btn"         ││
│  │ ☐ Admin Workflow        │       │ Match selected: #847 of 23 available  ││
│  │ ☑ Search Workflow       │       │ ████████████░░░░░░░░ 57%              ││
│  └─────────────────────────┘       └───────────────────────────────────────┘│
│                                                                             │
│  HISTORICAL DATA                   RESULTS                                  │
│  ┌─────────────────────────┐       ┌───────────────────────────────────────┐│
│  │ Automation runs: 156    │       │ ✓ Login Workflow         PASSED       ││
│  │ Total actions: 12,847   │       │   7/7 steps (random matches used)     ││
│  │ State coverage: 94%     │       │                                       ││
│  │ Last run: 3 hours ago   │       │ ✗ Checkout Workflow      FAILED       ││
│  └─────────────────────────┘       │   Step 4/7: unexpected state          ││
│                                    │   [View Details]                      ││
│  VISUALIZATION (optional)          │                                       ││
│  ┌─────────────────────────┐       │ ○ Search Workflow        PENDING      ││
│  │ ○ None (immediate)      │       └───────────────────────────────────────┘│
│  │ ○ Screenshots           │                                               │
│  │ ○ State visualization   │       Note: Each run uses random historical   │
│  │   (fixed positions)     │       matches, making tests vary like live    │
│  └─────────────────────────┘       automation.                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## API Service

The `IntegrationTestsService` provides methods for:

### Available Methods

```typescript
class IntegrationTestsService {
  // Get historical data statistics
  getHistoricalDataStats(
    request: GetHistoricalDataStatsRequest
  ): Promise<GetHistoricalDataStatsResponse>;

  // Start integration test run
  runIntegrationTests(
    request: RunIntegrationTestsRequest
  ): Promise<RunIntegrationTestsResponse>;

  // Poll test status (while running)
  getTestRunStatus(
    request: GetTestRunStatusRequest
  ): Promise<GetTestRunStatusResponse>;

  // Get final test results
  getTestRunSummary(testRunId: string): Promise<IntegrationTestRunSummary>;

  // Get detailed workflow test results
  getWorkflowTestDetails(
    testRunId: string,
    workflowId: string
  ): Promise<WorkflowTestResult>;

  // Cancel running test
  cancelTestRun(testRunId: string): Promise<void>;

  // Delete test results
  deleteTestRun(testRunId: string): Promise<void>;

  // List all test runs
  listTestRuns(
    projectId: string,
    page?: number,
    pageSize?: number
  ): Promise<PaginatedResults>;
}
```

### Backend Endpoints Expected

The service expects these backend API endpoints:

```
GET    /api/integration-tests/historical-data/:projectId
POST   /api/integration-tests/run
GET    /api/integration-tests/status/:testRunId
GET    /api/integration-tests/summary/:testRunId
GET    /api/integration-tests/details/:testRunId/:workflowId
POST   /api/integration-tests/cancel/:testRunId
DELETE /api/integration-tests/:testRunId
GET    /api/integration-tests/runs/:projectId
```

## Usage Flow

### 1. Initial Load

```typescript
// On page mount:
1. Load workflows from AutomationContext
2. Fetch historical data statistics
3. Initialize with default visualization mode (none)
```

### 2. Test Execution

```typescript
// When user clicks "Run All":
1. POST to /api/integration-tests/run with selected workflows
2. Receive testRunId
3. Start polling /api/integration-tests/status/:testRunId every 1 second
4. Update UI with current execution state
5. Continue until status is 'completed' or 'failed'
6. Load final results
```

### 3. Real-time Updates

```typescript
// During execution (polled every 1 second):
- Update current workflow being tested
- Update current step/action
- Show which random match was selected
- Update progress bars
- Display any errors immediately
```

### 4. Results Display

```typescript
// After completion:
- Show pass/fail summary
- Display per-workflow results
- Highlight failures with details
- Show random matches used
- Enable "View Details" for investigation
```

## State Management

The page uses React state for:

```typescript
const [selectedWorkflowIds, setSelectedWorkflowIds] = useState<string[]>([]);
const [visualizationMode, setVisualizationMode] =
  useState<VisualizationMode>("none");
const [historicalStats, setHistoricalStats] =
  useState<HistoricalDataStats | null>(null);
const [isRunning, setIsRunning] = useState(false);
const [currentExecution, setCurrentExecution] =
  useState<WorkflowTestExecution | null>(null);
const [testResults, setTestResults] = useState<WorkflowTestResult[]>([]);
const [completedWorkflows, setCompletedWorkflows] = useState(0);
const [currentTestRunId, setCurrentTestRunId] = useState<string | null>(null);
```

## Key Features

### Random Match Selection

- Each action that uses pattern matching randomly selects from available historical matches
- Makes tests realistic and varied (like live automation)
- Displayed in real-time during execution
- Listed in results for reproducibility investigation

### Historical Data Simulation

- Uses actual automation run data for realistic testing
- No need to connect to external applications
- Tests run in isolation
- Repeatable with different random variations

### Immediate Execution

- Tests run immediately by default (visualization mode: none)
- Fast feedback loop
- Optional visualization for debugging

### Progress Tracking

- Real-time updates every second
- Per-workflow and overall progress
- Step-by-step execution visibility
- Clear error reporting

## Styling

The page uses Tailwind CSS with the existing component library:

- Card components for panels
- Button components for actions
- Progress bars for execution state
- Color coding: green (pass), red (fail), blue (running), purple (random selection)

## Accessibility

- Semantic HTML structure
- Proper ARIA labels on interactive elements
- Keyboard navigation support
- Screen reader friendly status updates
- Color is not the only indicator (icons + text)

## Performance Considerations

1. **Polling Optimization**: 1-second intervals for smooth updates without overwhelming
2. **Cleanup**: Intervals cleared on unmount or completion
3. **Lazy Loading**: Results loaded only when needed
4. **Efficient Re-renders**: State updates batched where possible

## Future Enhancements

Potential improvements:

1. WebSocket support for real-time updates (instead of polling)
2. Test run history with filtering/search
3. Export test results to various formats
4. Scheduled test runs
5. Test result comparisons (between runs)
6. Integration with CI/CD pipelines
7. Custom assertions and validations
8. Test coverage reporting
9. Performance metrics tracking
10. Flaky test detection

## Dependencies

### External Libraries

- React (hooks: useState, useEffect, useCallback, useRef)
- Next.js (useParams, navigation)
- Lucide React (icons)
- Tailwind CSS (styling)

### Internal Dependencies

- @/contexts/automation-context (workflows)
- @/components/ui/\* (Button, Card, Progress, etc.)
- @/services/integration-tests-service
- @/types/integration-tests

## Development Notes

### Adding New Visualization Modes

To add a new visualization mode:

1. Update the `VisualizationMode` type in `types/integration-tests.ts`
2. Add the mode to `visualizationModes` array in `VisualizationModeSelector.tsx`
3. Implement backend support for the new mode
4. Update documentation

### Customizing Polling Interval

Change the polling interval in `page.tsx`:

```typescript
// Current: poll every 1 second
pollIntervalRef.current = setInterval(pollTestStatus, 1000);

// Example: poll every 2 seconds
pollIntervalRef.current = setInterval(pollTestStatus, 2000);
```

### Error Handling

The page handles errors at multiple levels:

1. Historical data loading errors (displayed in panel)
2. Test execution errors (displayed in execution panel)
3. API errors (displayed via alerts)
4. Network errors (polling continues, logged to console)

## Testing

To test the integration tests page:

1. Ensure backend API endpoints are implemented
2. Create some workflows in the project
3. Run automation to generate historical data
4. Navigate to `/projects/[projectId]/integration-tests`
5. Select workflows and run tests
6. Verify UI updates in real-time
7. Check results display after completion

## Support

For issues or questions:

- Check backend API implementation
- Verify historical data exists
- Review browser console for errors
- Check network tab for API responses
