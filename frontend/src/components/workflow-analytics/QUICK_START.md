# Quick Start Guide

## Installation

All dependencies are already included in your project:
- ✅ recharts (v3.2.1)
- ✅ lucide-react (v0.543.0)
- ✅ shadcn/ui components
- ✅ Tailwind CSS

## Files Created

```
frontend/src/components/workflow-analytics/
├── AnalyticsDashboard.tsx       (21KB) - Main analytics dashboard
├── WorkflowMetricsPanel.tsx     (28KB) - Single workflow metrics
├── PerformanceAnalyzer.tsx      (29KB) - Performance optimization
├── AnalyticsExample.tsx         (13KB) - Complete working example
├── index.ts                     (527B) - Export file
├── README.md                    (7.5KB) - Full documentation
└── QUICK_START.md              (this file)
```

## Quick Usage

### 1. Import Components

```tsx
import {
  AnalyticsDashboard,
  WorkflowMetricsPanel,
  PerformanceAnalyzer,
} from '@/components/workflow-analytics';
```

### 2. Use Analytics Dashboard

```tsx
import { workflowAnalyticsService } from '@/services/workflow-analytics-service';

function MyAnalyticsPage() {
  const [timeRange, setTimeRange] = useState({
    start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    end: new Date(),
  });

  const workflows = [/* your workflows */];
  const metrics = workflows.reduce((acc, w) => {
    acc[w.id] = workflowAnalyticsService.getWorkflowMetrics(w.id);
    return acc;
  }, {});

  return (
    <AnalyticsDashboard
      workflows={workflows}
      metrics={metrics}
      timeRange={timeRange}
      onTimeRangeChange={setTimeRange}
    />
  );
}
```

### 3. Use Workflow Metrics Panel

```tsx
import { workflowComplexityAnalyzer } from '@/services/workflow-complexity-analyzer';

function WorkflowDetails({ workflow }) {
  const metrics = workflowAnalyticsService.getWorkflowMetrics(workflow.id);
  const complexity = workflowComplexityAnalyzer.analyzeComplexity(workflow);
  const history = [/* execution history */];

  return (
    <WorkflowMetricsPanel
      workflow={workflow}
      metrics={metrics}
      complexityMetrics={complexity}
      executionHistory={history}
    />
  );
}
```

### 4. Use Performance Analyzer

```tsx
function OptimizePage({ workflow }) {
  const handleAnalyze = () => {
    console.log('Running analysis...');
  };

  const handleApplySuggestion = (suggestion) => {
    console.log('Applying:', suggestion);
  };

  return (
    <PerformanceAnalyzer
      workflow={workflow}
      onAnalyze={handleAnalyze}
      onApplySuggestion={handleApplySuggestion}
    />
  );
}
```

## Run the Example

See the complete working example:

```tsx
import { WorkflowAnalyticsExample } from '@/components/workflow-analytics/AnalyticsExample';

export default function Page() {
  return <WorkflowAnalyticsExample />;
}
```

## Key Features

### AnalyticsDashboard
- 📊 Multiple chart types (line, bar, pie)
- 📅 Time range selector (today, week, month, etc.)
- 🎯 Key metrics cards
- 📈 Top workflows tables
- 💾 Export functionality

### WorkflowMetricsPanel
- 🎨 Complexity gauge with rating
- 📉 Execution history timeline
- 📊 Performance trends
- 🔍 Detailed metrics breakdown
- ✅ Success/failure analysis

### PerformanceAnalyzer
- 🔥 Bottleneck heatmap
- 💡 Optimization suggestions
- ⚡ Parallelization opportunities
- ⏱️ Wait analysis
- 🔄 Loop optimization

## Data Sources

Components integrate with existing services:
- `workflowAnalyticsService` - Metrics and execution tracking
- `workflowComplexityAnalyzer` - Complexity analysis
- `workflowTestingService` - Test results

## Styling

All components are fully styled with Tailwind CSS and support:
- 🌓 Dark/light mode (via next-themes)
- 📱 Responsive design
- 🎨 Customizable via `className` prop
- ♿ Accessibility compliant

## Next Steps

1. **Integrate with your data**: Replace mock data with actual workflow data
2. **Add to navigation**: Create a route for `/analytics` or `/metrics`
3. **Customize**: Adjust colors, charts, or add custom metrics
4. **Extend**: Add real-time updates, alerts, or custom reports

## Troubleshooting

### Missing Types?
All types are imported from existing services. Make sure:
- `@/lib/action-schema/action-types` exists
- `@/services/workflow-analytics-service` exists
- `@/services/workflow-complexity-analyzer` exists

### Charts not rendering?
Ensure `recharts` is installed:
```bash
npm install recharts
```

### Icons missing?
Ensure `lucide-react` is installed:
```bash
npm install lucide-react
```

## Support

See `README.md` for full documentation and `AnalyticsExample.tsx` for complete working examples.
