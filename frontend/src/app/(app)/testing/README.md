# Testing Dashboard

A comprehensive testing dashboard for viewing historical test results, coverage trends, reliability metrics, and deficiency management in the Qontinui platform.

## Directory Structure

```
frontend/src/
├── app/(app)/testing/
│   ├── page.tsx                    # Main testing dashboard
│   ├── runs/
│   │   ├── page.tsx                # All test runs list
│   │   └── [id]/
│   │       └── page.tsx            # Individual test run details
│   └── deficiencies/
│       └── page.tsx                # Deficiency management page
├── components/testing/
│   ├── index.ts                    # Component exports
│   ├── TestRunsList.tsx            # Paginated table of test runs
│   ├── TestRunDetails.tsx          # Detailed view of a test run
│   ├── DeficiencyList.tsx          # Filterable list of deficiencies
│   ├── DeficiencyCard.tsx          # Expandable deficiency card
│   ├── CoverageTrendChart.tsx      # Line chart for coverage trends
│   ├── ReliabilityStats.tsx        # Transition reliability metrics
│   └── StateGraphVisualization.tsx # Interactive state graph
├── hooks/
│   └── useTesting.ts               # React Query hooks for testing data
└── services/
    └── testing-service.ts          # API service for testing endpoints
```

## Features

### 1. Test Runs Dashboard
- **Paginated List**: View all test runs with filtering and sorting
- **Status Indicators**: Visual indicators for completed, failed, and running tests
- **Coverage Metrics**: See coverage percentage and states covered
- **Success Rates**: View transition success rates
- **Deficiency Counts**: Quick view of deficiencies found
- **Export Functionality**: Export test runs as JSON, CSV, or PDF

### 2. Test Run Details
- **Comprehensive Overview**: Duration, coverage, success rate, deficiencies
- **Transition Results**: Detailed list of all transitions with status and timing
- **State Coverage**: Per-state visit counts and success rates
- **Deficiencies**: All deficiencies found during the run
- **Screenshots**: Visual evidence of transitions and deficiencies
- **Error Messages**: Detailed error information

### 3. Coverage Trends
- **Line Chart**: Interactive chart showing coverage over time
- **Multiple Metrics**: Coverage %, states covered, test run count
- **Date Range Filtering**: View trends for specific periods
- **Summary Statistics**: Average coverage, total runs, latest coverage

### 4. Reliability Statistics
- **Overall Success Rate**: Aggregate success metrics
- **Most Reliable Transitions**: Top performing transitions
- **Least Reliable Transitions**: Problematic transitions needing attention
- **State Reliability**: Per-state success rates and visit counts
- **Average Transition Time**: Performance metrics

### 5. State Graph Visualization
- **Interactive Graph**: Visual representation of state transitions
- **Color-Coded Nodes**: Success rates indicated by color
- **Edge Labels**: Success rates and action types on transitions
- **Layout**: Dagre automatic layout for optimal viewing
- **MiniMap**: Navigate large graphs easily
- **Statistics**: Total states, transitions, and average success rate

### 6. Deficiency Management
- **Filterable List**: Filter by severity, status, and search
- **Status Updates**: Update deficiency status (open, in progress, resolved, won't fix)
- **Detailed Cards**: Expandable cards with full information
- **Expected vs Actual**: Side-by-side comparison
- **Reproduction Steps**: Step-by-step instructions
- **Screenshots**: Visual evidence of deficiencies
- **Export**: Export deficiencies as JSON or CSV

## Components

### TestRunsList
**Props:**
- `projectId?: string` - Filter by project
- `workflowId?: string` - Filter by workflow

**Features:**
- Pagination (10 items per page)
- Status filtering (all, completed, failed, running)
- Date range filtering
- Sorting by date, coverage, duration
- Export individual runs
- Click to view details

### TestRunDetails
**Props:**
- `runId: string` - Test run ID

**Features:**
- Overview metrics card
- Tabbed interface (Transitions, Coverage, Deficiencies)
- Transition timeline with screenshots
- State coverage statistics
- Deficiency list

### DeficiencyList
**Props:**
- `projectId?: string` - Filter by project
- `testRunId?: string` - Filter by test run

**Features:**
- Search functionality
- Severity filtering (critical, high, medium, low)
- Status filtering (open, in progress, resolved, won't fix)
- Pagination (20 items per page)
- Export all deficiencies

### DeficiencyCard
**Props:**
- `deficiency: Deficiency` - Deficiency object

**Features:**
- Expandable/collapsible
- Status update dropdown
- Expected vs actual behavior
- Reproduction steps
- Error messages
- Screenshots with zoom

### CoverageTrendChart
**Props:**
- `projectId: string` - Project to show trends for
- `startDate?: string` - Start date filter
- `endDate?: string` - End date filter

**Features:**
- Multi-line chart (coverage, states, runs)
- Interactive tooltips
- Date range filtering
- Summary statistics

### ReliabilityStats
**Props:**
- `projectId: string` - Project to show stats for
- `workflowId?: string` - Optional workflow filter

**Features:**
- Overall success rate
- Top 5 most reliable transitions
- Top 5 least reliable transitions
- State reliability table
- Average transition times

### StateGraphVisualization
**Props:**
- `projectId: string` - Project ID
- `workflowId: string` - Workflow ID

**Features:**
- Interactive graph using @xyflow/react
- Dagre automatic layout
- Color-coded nodes by success rate
- Animated edges for problematic transitions
- MiniMap for navigation
- Controls for zoom/pan
- Summary statistics

## API Hooks

All hooks use `@tanstack/react-query` for caching and state management:

### useTestRuns(filters?: TestRunFilters)
Fetch paginated list of test runs with optional filters.

### useTestRun(id: string, enabled?: boolean)
Fetch a single test run with full details.

### useDeficiencies(filters?: DeficiencyFilters)
Fetch paginated list of deficiencies with optional filters.

### useUpdateDeficiency()
Mutation hook to update deficiency status and details.

### useCoverageTrends(projectId, startDate?, endDate?, enabled?)
Fetch coverage trends over time for a project.

### useReliabilityStats(projectId, workflowId?, enabled?)
Fetch reliability statistics for a project/workflow.

### useStateGraph(projectId, workflowId, enabled?)
Fetch state graph data for visualization.

### useExportTestRun()
Mutation hook to export test run data (JSON, CSV, PDF).

### useExportDeficiencies()
Mutation hook to export deficiencies (JSON, CSV).

## API Endpoints

The testing service expects these endpoints on the backend:

### Test Runs
- `GET /api/v1/testing/runs` - List test runs (with filters)
- `GET /api/v1/testing/runs/:id` - Get test run details
- `GET /api/v1/testing/runs/:id/export` - Export test run

### Deficiencies
- `GET /api/v1/testing/deficiencies` - List deficiencies (with filters)
- `PATCH /api/v1/testing/deficiencies/:id` - Update deficiency
- `GET /api/v1/testing/deficiencies/export` - Export deficiencies

### Analytics
- `GET /api/v1/testing/coverage-trends` - Get coverage trends
- `GET /api/v1/testing/reliability-stats` - Get reliability statistics
- `GET /api/v1/testing/state-graph` - Get state graph data

## Styling

All components use:
- **Tailwind CSS** for styling
- **Dark theme** with gradient backgrounds
- **Color scheme**:
  - Primary: `#00D9FF` (cyan)
  - Secondary: `#BD00FF` (purple)
  - Success: `#00FF88` (green)
  - Error: Red variants
  - Warning: Yellow variants
- **Responsive design** (mobile-friendly)
- **shadcn/ui** components for consistency

## Navigation

```
/testing                    # Main dashboard
/testing/runs               # All test runs
/testing/runs/:id           # Test run details
/testing/deficiencies       # Deficiency management
```

Query parameters:
- `?project=:id` - Filter by project
- `?run=:id` - Filter by test run
- `?workflow=:id` - Filter by workflow

## Dependencies

- `@tanstack/react-query` - Data fetching and caching
- `@xyflow/react` - State graph visualization
- `dagre` - Graph layout algorithm
- `recharts` - Coverage trend charts
- `date-fns` - Date formatting
- `lucide-react` - Icons
- `sonner` - Toast notifications

## Usage Example

```tsx
import { TestRunsList, CoverageTrendChart, ReliabilityStats } from '@/components/testing';

function MyTestingPage() {
  const projectId = 'project-123';

  return (
    <div>
      <TestRunsList projectId={projectId} />
      <CoverageTrendChart projectId={projectId} />
      <ReliabilityStats projectId={projectId} />
    </div>
  );
}
```

## Future Enhancements

- Real-time test run updates via WebSockets
- Deficiency assignment to team members
- Comments/discussion on deficiencies
- Test run comparison
- Trend analysis and predictions
- Automated deficiency categorization
- Integration with issue tracking systems
- PDF report generation
- Email notifications for critical deficiencies
