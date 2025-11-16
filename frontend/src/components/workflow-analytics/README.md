# Workflow Analytics Components

Comprehensive analytics and performance monitoring UI components for workflow analysis in qontinui-web.

## Components

### 1. AnalyticsDashboard

A comprehensive analytics dashboard for monitoring workflow performance across your entire project.

**Features:**
- Time range selector (today, week, month, quarter, year, custom)
- Key metrics cards: total executions, success rate, average duration, total workflows
- Interactive charts:
  - Execution timeline (line chart)
  - Success rate by workflow (bar chart)
  - Duration by workflow (bar chart)
  - Workflow usage distribution
- Top workflows tables:
  - Most executed
  - Slowest workflows
  - Highest error rate
- Folder/tag filtering
- Export report functionality
- Refresh data button

**Props:**
```typescript
interface AnalyticsDashboardProps {
  workflows: Workflow[];
  metrics: Record<string, WorkflowMetrics>;
  timeRange: { start: Date; end: Date };
  onTimeRangeChange: (range: { start: Date; end: Date }) => void;
  className?: string;
}
```

**Usage:**
```tsx
import { AnalyticsDashboard } from '@/components/workflow-analytics';

<AnalyticsDashboard
  workflows={workflows}
  metrics={metricsMap}
  timeRange={{ start: startDate, end: endDate }}
  onTimeRangeChange={handleTimeRangeChange}
/>
```

### 2. WorkflowMetricsPanel

Detailed metrics and analysis for a single workflow.

**Features:**
- Overview cards:
  - Total runs
  - Success rate with trend
  - Average duration with trend
  - Last run timestamp
- Complexity section:
  - Complexity score gauge (0-100)
  - Detailed metrics table
  - Comparison indicators
  - Warning badges for cycles and disconnected components
- Execution history:
  - Timeline chart showing duration over time
  - Recent runs list with status
  - Success/failure breakdown
- Performance trends:
  - Duration over time chart
  - Success rate trend chart
  - Statistical summary

**Props:**
```typescript
interface WorkflowMetricsPanelProps {
  workflow: Workflow;
  metrics: WorkflowMetrics;
  complexityMetrics: ComplexityAnalysis;
  executionHistory: TestResult[];
  className?: string;
}
```

**Usage:**
```tsx
import { WorkflowMetricsPanel } from '@/components/workflow-analytics';
import { workflowComplexityAnalyzer } from '@/services/workflow-complexity-analyzer';

const complexityMetrics = workflowComplexityAnalyzer.analyzeComplexity(workflow);

<WorkflowMetricsPanel
  workflow={workflow}
  metrics={metrics}
  complexityMetrics={complexityMetrics}
  executionHistory={executionHistory}
/>
```

### 3. PerformanceAnalyzer

Performance analysis and optimization suggestions for workflows.

**Features:**
- Analyze button to run performance analysis
- Summary cards:
  - Current duration
  - Optimized duration (estimated)
  - Potential savings
  - Bottlenecks found
- Bottlenecks section:
  - Action timing heatmap (color-coded by severity)
  - Top bottlenecks list with severity badges
  - Percentage of total time for each bottleneck
- Optimization suggestions:
  - Categorized suggestions (parallelization, wait optimization, loop optimization, caching, action removal)
  - Impact estimates (time savings and percentage)
  - Apply or dismiss functionality
  - Severity indicators
- Parallelization opportunities:
  - Visual grouping of parallel actions
  - Duration comparison (sequential vs parallel)
  - Estimated speedup
- Wait analysis:
  - List of WAIT actions
  - Duration and suggestions
  - Potential savings
- Loop analysis:
  - Iteration estimates
  - Duration breakdown
  - Optimization suggestions

**Props:**
```typescript
interface PerformanceAnalyzerProps {
  workflow: Workflow;
  performanceData?: PerformanceData;
  onAnalyze: () => void;
  onApplySuggestion: (suggestion: OptimizationSuggestion) => void;
  className?: string;
}
```

**Usage:**
```tsx
import { PerformanceAnalyzer } from '@/components/workflow-analytics';

<PerformanceAnalyzer
  workflow={workflow}
  onAnalyze={handleAnalyze}
  onApplySuggestion={handleApplySuggestion}
/>
```

## Dependencies

All components use:
- **recharts** - For charts and data visualization
- **lucide-react** - For icons
- **shadcn/ui** - For UI components (Card, Button, Badge, Tabs, etc.)
- **Tailwind CSS** - For styling

## Type Definitions

The components use types from:
- `@/lib/action-schema/action-types` - Workflow and Action types
- `@/services/workflow-analytics-service` - WorkflowMetrics, ExecutionRecord
- `@/services/workflow-complexity-analyzer` - ComplexityAnalysis
- `@/services/workflow-testing-service` - TestResult

## Features

### Common Features Across All Components

1. **Responsive Design**: All components are fully responsive and work on mobile, tablet, and desktop
2. **Loading States**: Components handle loading states gracefully
3. **Empty States**: Informative empty states when no data is available
4. **Error Handling**: Robust error handling with user-friendly messages
5. **Export Functionality**: Data can be exported as JSON
6. **TypeScript**: Full TypeScript support with proper type definitions

### Chart Types Used

- **Line Charts**: Execution timelines, performance trends
- **Bar Charts**: Success rates, duration analysis, usage patterns
- **Pie Charts**: Success/failure breakdown
- **Area Charts**: Execution history, success rate trends
- **Radial Charts**: Complexity gauge
- **Heatmaps**: Action timing visualization

### Color Scheme

- **Success**: Green (#10b981)
- **Error/High Severity**: Red (#ef4444)
- **Warning/Medium Severity**: Orange (#f59e0b)
- **Primary**: Blue (#3b82f6)
- **Purple**: (#8b5cf6) for general data

## Integration Example

See `AnalyticsExample.tsx` for a complete working example that demonstrates how to integrate all three components together in a tabbed interface.

```tsx
import {
  AnalyticsDashboard,
  WorkflowMetricsPanel,
  PerformanceAnalyzer,
} from '@/components/workflow-analytics';

function AnalyticsPage() {
  return (
    <Tabs>
      <TabsList>
        <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
        <TabsTrigger value="metrics">Workflow Metrics</TabsTrigger>
        <TabsTrigger value="performance">Performance</TabsTrigger>
      </TabsList>

      <TabsContent value="dashboard">
        <AnalyticsDashboard ... />
      </TabsContent>

      <TabsContent value="metrics">
        <WorkflowMetricsPanel ... />
      </TabsContent>

      <TabsContent value="performance">
        <PerformanceAnalyzer ... />
      </TabsContent>
    </Tabs>
  );
}
```

## Performance Considerations

1. **Memoization**: Components use `useMemo` for expensive calculations
2. **Virtual Scrolling**: ScrollArea component for long lists
3. **Lazy Loading**: Charts only render when visible
4. **Optimized Re-renders**: Proper React optimization patterns

## Customization

All components accept a `className` prop for additional styling:

```tsx
<AnalyticsDashboard
  className="custom-analytics-styles"
  {...props}
/>
```

## Accessibility

- Semantic HTML structure
- ARIA labels where appropriate
- Keyboard navigation support
- Screen reader friendly
- Color contrast compliant

## Browser Support

Components support all modern browsers:
- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers

## Future Enhancements

Potential improvements for future versions:
- Real-time data updates via WebSockets
- Custom date range picker
- Comparison mode (compare two workflows)
- CSV/PDF export options
- Drill-down capabilities
- Alert/notification system for anomalies
- Custom metric definitions
- Saved views and dashboards
- Collaborative annotations
