# Health Dashboard Component Structure

## File Organization

```
frontend/
├── src/
│   ├── app/(app)/admin/
│   │   └── page.tsx                    [Modified] Added Health tab
│   │
│   ├── components/admin/health/
│   │   ├── AlertBadge.tsx              [New] Status badges and dots
│   │   ├── HealthOverviewCard.tsx      [New] System overview
│   │   ├── RedisStatusCard.tsx         [New] Redis monitoring
│   │   ├── SecurityWarningsCard.tsx    [New] Security alerts
│   │   ├── SessionStatsCard.tsx        [New] Session analytics
│   │   ├── SystemMetricsCard.tsx       [New] Resource metrics
│   │   ├── HealthDashboardTab.tsx      [New] Main dashboard
│   │   ├── index.ts                    [New] Exports
│   │   ├── README.md                   [New] Documentation
│   │   └── STRUCTURE.md                [New] This file
│   │
│   └── services/admin/
│       └── health-service.ts           [New] API client
│
└── HEALTH_DASHBOARD_IMPLEMENTATION.md  [New] Implementation summary
```

## Component Hierarchy

```
AdminDashboard (page.tsx)
└── Tabs
    └── TabsContent value="health"
        └── HealthDashboardTab
            ├── Header Controls
            │   ├── Auto-refresh toggle
            │   ├── Manual refresh button
            │   └── Export button
            │
            ├── HealthOverviewCard
            │   ├── API Status
            │   ├── Database Status
            │   ├── Redis Status
            │   ├── Uptime
            │   ├── Active Sessions
            │   └── Critical Alerts
            │
            ├── Grid (2 columns)
            │   ├── RedisStatusCard
            │   │   ├── Connection Status
            │   │   ├── Mode Indicator
            │   │   ├── Memory Usage
            │   │   └── Stats (Clients, Keys, Uptime, Hit Rate)
            │   │
            │   └── SystemMetricsCard
            │       ├── CPU Gauge
            │       ├── Memory Gauge
            │       ├── Disk Gauge
            │       ├── DB Connections
            │       └── Warning Banners
            │
            └── Grid (2 columns)
                ├── SecurityWarningsCard
                │   ├── Summary Stats
                │   ├── Scrollable Alert List
                │   │   └── Alert Items
                │   │       ├── Type Icon
                │   │       ├── Severity Badge
                │   │       ├── Message
                │   │       ├── Timestamp
                │   │       └── Resolve Button
                │   └── Show/Hide Toggle
                │
                └── SessionStatsCard
                    ├── Key Metrics
                    ├── Distribution Bars
                    ├── Adoption Banner
                    └── Charts
                        ├── Pie Chart
                        └── Bar Chart
```

## Data Flow

```
[Backend API Endpoints]
         ↓
[healthService API Client]
         ↓
[React Query Hooks] (auto-refresh every 30s)
         ↓
[HealthDashboardTab] (state management)
         ↓
[Individual Cards] (display data)
         ↓
[User Interface] (charts, gauges, alerts)
```

## Import Relationships

```
HealthDashboardTab
├── imports HealthOverviewCard
├── imports RedisStatusCard
├── imports SecurityWarningsCard
├── imports SessionStatsCard
├── imports SystemMetricsCard
└── imports healthService

Each Card Component
├── imports AlertBadge/StatusDot
├── imports UI components (Card, Button, Progress, etc.)
├── imports Icons from lucide-react
└── imports type definitions from healthService

healthService
├── imports authService (for auth headers)
├── imports ApiConfig (for base URLs)
└── exports TypeScript interfaces
```

## State Management

```
HealthDashboardTab Component State:
├── lastUpdated: Date
├── autoRefresh: boolean
└── React Query State (per endpoint):
    ├── data: T | null
    ├── isLoading: boolean
    ├── refetch: () => Promise
    └── error: Error | null

SecurityWarningsCard Component State:
├── showResolved: boolean
└── resolvingIds: Set<string>
```

## Styling Architecture

```
Tailwind CSS Classes
├── Layout
│   ├── grid grid-cols-* (responsive grids)
│   ├── space-y-* (vertical spacing)
│   └── gap-* (grid gaps)
│
├── Components
│   ├── Card (bg-card border-border)
│   ├── Progress bars (h-2 bg-muted)
│   └── Buttons (variant outline/ghost)
│
├── Colors
│   ├── Green: healthy states
│   ├── Yellow: warning states
│   ├── Red: critical states
│   ├── Blue: informational
│   └── Gray: disabled/muted
│
└── Dark Mode
    └── All colors have dark: variants
```

## API Endpoint Mapping

```
Component               → Endpoint
─────────────────────────────────────────────────────
HealthOverviewCard      → /api/v1/admin/health/overview
RedisStatusCard         → /api/v1/admin/health/redis
SecurityWarningsCard    → /api/v1/admin/health/security-warnings
SessionStatsCard        → /api/v1/admin/health/sessions
SystemMetricsCard       → /api/v1/admin/system/health (existing)
```

## Key Technologies

```
React & Next.js
├── React 19.1.0
├── Next.js 15.5.2
└── TypeScript 5

UI Framework
├── Tailwind CSS 4
├── Shadcn UI (Radix UI)
└── Lucide React (icons)

Data Fetching
├── TanStack React Query 5
├── Fetch API
└── Auth via authService

Charts
├── Recharts 3.2.1
│   ├── PieChart
│   ├── BarChart
│   └── ResponsiveContainer

Notifications
└── Sonner (toast)
```

## Responsive Breakpoints

```
Mobile First Approach:

Base (< 640px)
└── Single column, stacked cards

md: (>= 768px)
└── Two column grids

lg: (>= 1024px)
└── Three column grids for metrics

xl: (>= 1280px)
└── Optimized spacing and sizing
```

## Color Palette

```
Status Colors:
├── Healthy:   Green   (#10b981, hsl(142, 76%, 36%))
├── Warning:   Yellow  (#eab308, hsl(48, 96%, 53%))
├── Critical:  Red     (#ef4444, hsl(0, 84%, 60%))
├── Info:      Blue    (#3b82f6, hsl(217, 91%, 60%))
└── Disabled:  Gray    (#6b7280, hsl(220, 9%, 46%))

Chart Colors:
├── Standard Sessions:  Blue   (#3b82f6)
└── Remember Me:        Green  (#10b981)
```

## Performance Characteristics

```
Bundle Impact:
├── Admin page: 356 KB (includes health dashboard)
├── First Load JS: ~214 KB shared
└── Health components: ~40-50 KB estimated

Query Caching:
├── React Query cache per endpoint
├── 30s stale time
├── Auto-refetch when tab active
└── Background refetch when enabled

Re-render Optimization:
├── React Query prevents unnecessary fetches
├── Component memoization via card structure
└── Conditional rendering for loading states
```

## Testing Strategy

```
Unit Tests (Recommended):
├── AlertBadge: status variants
├── Each Card: with mock data
├── healthService: API methods
└── Export functions: JSON/CSV

Integration Tests:
├── HealthDashboardTab: data fetching
├── Card interactions: refresh, resolve
└── Export workflow: download files

E2E Tests:
├── Admin login → Health tab
├── View all cards with data
├── Export reports
└── Mark warnings resolved
```

## File Sizes

```
Component Sizes:
├── AlertBadge.tsx              3.8 KB
├── HealthOverviewCard.tsx      6.3 KB
├── RedisStatusCard.tsx         9.1 KB
├── SecurityWarningsCard.tsx    9.6 KB
├── SessionStatsCard.tsx        8.8 KB
├── SystemMetricsCard.tsx      11.3 KB
├── HealthDashboardTab.tsx      8.2 KB
└── health-service.ts           7.8 KB

Total: ~65 KB (TypeScript source)
```

## Quick Reference

### Add a new health metric card:

1. Create new card component in `components/admin/health/`
2. Import in `HealthDashboardTab.tsx`
3. Add to grid layout
4. Create React Query hook for data
5. Export from `index.ts`

### Add a new API endpoint:

1. Add method to `healthService` class
2. Define TypeScript interface for response
3. Create React Query hook in `HealthDashboardTab`
4. Pass data to card component

### Customize refresh interval:

```typescript
// In HealthDashboardTab.tsx
const REFRESH_INTERVAL = 30000 // Change this value (milliseconds)
```

### Add new status type:

```typescript
// In AlertBadge.tsx
const statusConfig = {
  your_new_status: {
    color: 'bg-purple-500/10 text-purple-600',
    icon: YourIcon,
    label: 'Your Label',
  },
}
```
