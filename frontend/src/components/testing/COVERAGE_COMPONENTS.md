# State Coverage Visualization Components

This document describes the state coverage visualization components for the Qontinui testing dashboard.

## Overview

The state coverage visualization system provides visual feedback on which states and transitions have been tested in model-based testing workflows. It helps identify coverage gaps and testing quality at a glance.

## Components

### 1. CoverageSummaryCard

A high-level summary card displaying key coverage metrics with trend indicators.

**Features:**

- State coverage percentage with progress bar
- Transition coverage percentage with progress bar
- Unique paths discovered count
- Total executions count
- Trend indicator (up/down/stable) comparing to previous test run
- Mini sparkline showing coverage trend over last 10 runs

**Usage:**

```tsx
import { CoverageSummaryCard } from "@/components/testing";

<CoverageSummaryCard projectId="project-uuid" workflowId="workflow-id" />;
```

**Props:**
| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `projectId` | string | Yes | The project UUID |
| `workflowId` | string | Yes | The workflow identifier |

**Metrics Explained:**

- **State Coverage**: Percentage of states that have been visited at least once
- **Transition Coverage**: Percentage of transitions that have been executed at least once
- **Unique Paths**: Number of distinct state transitions discovered
- **Total Executions**: Total number of transition attempts across all test runs

**Color Coding:**

- Primary metric (state coverage): Cyan (#00D9FF)
- Secondary metric (transition coverage): Purple (#BD00FF)
- Tertiary metrics: Green (#00FF88) and Orange (#FFB800)

### 2. StateCoverageHeatMap

An interactive graph visualization showing state coverage with color-coded status indicators.

**Features:**

- Color-coded nodes based on test results:
  - **Green (Passing)**: 90%+ success rate
  - **Yellow (Partial)**: 70-90% success rate
  - **Red (Failing)**: <70% success rate
  - **Gray (Uncovered)**: Not yet tested
- Edge thickness scales with attempt count
- Dashed edges for untested transitions
- Interactive node clicks to view execution details
- Coverage breakdown panel showing counts by status
- Overall coverage percentage with stacked progress bar
- Automatic graph layout using Dagre
- MiniMap for navigation
- Zoom and pan controls

**Usage:**

```tsx
import { StateCoverageHeatMap } from "@/components/testing";

<StateCoverageHeatMap projectId="project-uuid" workflowId="workflow-id" />;
```

**Props:**
| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `projectId` | string | Yes | The project UUID |
| `workflowId` | string | Yes | The workflow identifier |

**Interactive Features:**

1. **Node Click**: Click any state node to view detailed execution statistics:
   - Total visits
   - Success rate
   - Successful attempts
   - Failed attempts
   - Execution breakdown visualization

2. **Coverage Panel**: Top-right panel shows real-time breakdown:
   - Passing states count
   - Partial states count
   - Failing states count
   - Untested states count
   - Total states count

3. **Graph Controls**:
   - Zoom in/out
   - Fit to view
   - Pan around
   - MiniMap navigation

**Edge Styling:**

- **Color**: Matches success rate (green/yellow/red/gray)
- **Width**: Scales logarithmically with attempt count (1-5px range)
- **Style**: Dashed for untested, solid for tested
- **Animation**: Animated for transitions with <70% success rate

### 3. StateGraphVisualization (Enhanced)

The original state graph visualization component remains available for comparison. It shows similar data but with a simpler visual style focused on success rates rather than coverage status.

**Key Differences from StateCoverageHeatMap:**

| Feature                | StateGraphVisualization  | StateCoverageHeatMap   |
| ---------------------- | ------------------------ | ---------------------- |
| **Primary Focus**      | Success rates            | Coverage status        |
| **Node Coloring**      | Gradient by success rate | Categorical by status  |
| **Uncovered States**   | Not differentiated       | Clearly marked in gray |
| **Node Details**       | On-graph only            | Click for modal dialog |
| **Coverage Breakdown** | Simple stats below       | Interactive panel      |
| **Edge Width**         | Fixed                    | Scales with attempts   |

**When to Use Which:**

- Use **StateCoverageHeatMap** when:
  - You need to identify untested states/transitions
  - You want clear status categories (pass/partial/fail/untested)
  - You need detailed per-node statistics
  - You're planning test coverage improvements

- Use **StateGraphVisualization** when:
  - You want to focus on success rate trends
  - You prefer simpler visualization without status categories
  - You're analyzing overall test quality rather than coverage

## Data Flow

```
Backend API (Port 8000)
    ↓
GET /api/v1/testing/state-graph?project_id=X&workflow_id=Y
    ↓
useStateGraph hook (useTesting.ts)
    ↓
Component receives StateGraphData
    ↓
Transform to ReactFlow nodes/edges
    ↓
Render with coverage coloring
```

## API Response Format

The components consume data from the `useStateGraph` hook, which returns:

```typescript
interface StateGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface GraphNode {
  id: string;
  label: string;
  visit_count: number;
  success_rate: number;
  type: "start" | "end" | "normal";
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  success_rate: number;
  attempt_count: number;
}
```

## Coverage Calculation

### State Coverage

```
state_coverage = (states_with_visits / total_states) * 100
```

A state is considered "covered" if `visit_count > 0`.

### Transition Coverage

```
transition_coverage = (transitions_with_attempts / total_transitions) * 100
```

A transition is considered "covered" if `attempt_count > 0`.

### Success Rate Categories

| Category  | Success Rate      | Color  | Meaning                                    |
| --------- | ----------------- | ------ | ------------------------------------------ |
| Passing   | 90% - 100%        | Green  | Reliably working                           |
| Partial   | 70% - 89%         | Yellow | Works most of the time, may need attention |
| Failing   | 0% - 69%          | Red    | Frequent failures, needs investigation     |
| Uncovered | N/A (no attempts) | Gray   | Not yet tested                             |

## Trend Calculation

The trend indicator compares the latest coverage percentage to the previous run:

- **Up** (↗): Coverage increased by more than 0.5%
- **Down** (↘): Coverage decreased by more than 0.5%
- **Stable** (→): Coverage changed by less than 0.5%

## Styling

All components follow the Qontinui design system:

**Background Colors:**

- Card background: `#1A1A1B` with 50% opacity
- Content background: `#0A0A0B` with 50% opacity
- Border: `gray-800` with 50% opacity

**Brand Colors:**

- Primary (Cyan): `#00D9FF`
- Secondary (Purple): `#BD00FF`
- Tertiary (Green): `#00FF88`
- Accent (Orange): `#FFB800`

**Status Colors:**

- Success/Passing: `green-500` (#10b981)
- Warning/Partial: `yellow-500` (#eab308)
- Error/Failing: `red-500` (#ef4444)
- Neutral/Uncovered: `gray-600` (#4a5568)

## Performance Considerations

### Caching

Both components use TanStack Query for data fetching with:

- 2-minute stale time for state graph data (expensive to compute)
- 1-minute stale time for coverage trends
- Automatic refetching on window focus
- Placeholder data to prevent loading flicker

### Graph Layout

The Dagre layout algorithm runs in the browser:

- Memoized to prevent recalculation on re-renders
- Only recalculates when graph data changes
- Layout settings: `rankdir: "LR"`, `nodesep: 100`, `ranksep: 150`

### Large Graphs

For workflows with many states:

- ReactFlow provides virtualization automatically
- MiniMap helps with navigation
- Controls allow zooming to focus areas
- Consider pagination for very large workflows (100+ states)

## Testing

To test the components in development:

1. Start the backend and ensure test run data exists
2. Navigate to `/testing/runs/[id]` where `[id]` is a test run UUID
3. The page will display all three components:
   - CoverageSummaryCard at the top
   - StateCoverageHeatMap in the middle
   - StateGraphVisualization at the bottom

**Sample Data Requirements:**

- At least one completed test run with state transitions
- Multiple test runs for trend calculation
- Mix of passing/failing states for full color range
- Some uncovered states to see gray nodes

## Troubleshooting

### Components Show "No data available"

**Cause**: No test runs have been executed for this workflow.

**Solution**: Run at least one test for the workflow via the testing dashboard or runner.

### Coverage percentage is 0% but states show visits

**Cause**: Mismatch between `visit_count` and coverage calculation.

**Check**: Verify the backend is populating `visit_count` correctly in the state graph API.

### Trend indicator not showing

**Cause**: Less than 2 test runs in the coverage trends data.

**Solution**: Run multiple tests over time to build trend history.

### Graph layout looks cramped

**Solution**: Adjust the Dagre layout settings in `StateCoverageHeatMap.tsx`:

```typescript
dagreGraph.setGraph({
  rankdir: "LR", // Try "TB" for top-to-bottom
  nodesep: 150, // Increase for more space between nodes
  ranksep: 200, // Increase for more space between ranks
});
```

### Click events not working on nodes

**Cause**: Event handler not properly attached.

**Check**: Verify `onNodeClick` is passed to `<ReactFlow>` and the node is clickable (not disabled).

## Future Enhancements

Potential improvements for future iterations:

1. **Filtering**: Filter graph by status (show only failing states)
2. **Path Highlighting**: Click to highlight a specific path through the graph
3. **Time Range Selection**: View coverage for specific date ranges
4. **Export**: Export graph as PNG/SVG
5. **Comparison Mode**: Compare coverage between two test runs side-by-side
6. **State Search**: Search for specific states in large graphs
7. **Execution Replay**: Click a transition to see its execution video/screenshots
8. **Coverage Goals**: Set and visualize coverage targets (e.g., "80% state coverage")
9. **Heatmap Animation**: Animate coverage changes over time
10. **AI Suggestions**: Suggest which states to test next based on coverage gaps

## Related Files

- **Components**: `src/components/testing/`
  - `CoverageSummaryCard.tsx`
  - `StateCoverageHeatMap.tsx`
  - `StateGraphVisualization.tsx`

- **Hooks**: `src/hooks/useTesting.ts`
  - `useStateGraph()`
  - `useCoverageTrends()`

- **Services**: `src/services/testing-service.ts`
  - `getStateGraph()`
  - `getCoverageTrends()`

- **Types**: `src/services/testing-service.ts`
  - `StateGraphData`
  - `GraphNode`
  - `GraphEdge`
  - `CoverageTrend`

- **Pages**: `src/app/(app)/testing/runs/[id]/page.tsx`

## Support

For questions or issues with these components, refer to:

- Main Testing README: `src/app/(app)/testing/README.md`
- Testing Service Documentation: `src/services/testing-service.ts`
- Backend Coverage Model: `backend/app/models/coverage_snapshot.py`
