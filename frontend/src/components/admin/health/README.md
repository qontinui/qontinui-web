# Admin Health Dashboard

A comprehensive real-time health monitoring dashboard for system administrators.

## Overview

The Health Dashboard provides a unified view of system health, Redis status, security warnings, session statistics, and resource metrics. It features auto-refresh, manual refresh, and export capabilities.

## Components

### HealthDashboardTab
Main dashboard component that integrates all health monitoring cards.

**Features:**
- Auto-refresh every 30 seconds (toggleable)
- Manual refresh button
- Export to JSON/CSV
- Real-time monitoring with React Query
- Visual indicators for critical alerts

### HealthOverviewCard
High-level system status overview showing:
- API server status
- Database status
- Redis cache status
- System uptime
- Active sessions count
- Critical alerts count

### RedisStatusCard
Redis cache monitoring with:
- Connection status (live indicator)
- Operating mode (Redis vs In-Memory fallback)
- Memory usage with progress bar
- Connected clients count
- Total keys stored
- Cache hit rate
- Uptime tracking
- Warning banners for critical states

### SecurityWarningsCard
Security alert management featuring:
- Alert severity levels (low, medium, high, critical)
- Alert types: device mismatch, suspicious login, failed login, new device, token anomaly
- Mark alerts as resolved
- Filter resolved/unresolved alerts
- Scrollable list with timestamps
- User email association

### SessionStatsCard
Session analytics with charts:
- Total active sessions
- Active users now
- Sessions today count
- Average session duration
- Standard vs Remember Me distribution
- Pie chart showing session type breakdown
- Bar chart showing hourly session trends
- Remember Me adoption percentage

### SystemMetricsCard
Resource monitoring with gauges:
- CPU usage with progress bar
- Memory usage (MB and percentage)
- Disk storage usage (GB and percentage)
- Database connection pool status
- System uptime
- Last backup timestamp
- Color-coded warnings (green/yellow/red)
- Critical and warning alerts

### AlertBadge & StatusDot
Reusable status indicator components:
- Color-coded badges for different statuses
- Pulsing status dots for live indicators
- Configurable sizes and colors
- Support for all severity levels

## Services

### health-service.ts
API client for health monitoring endpoints:

**Methods:**
- `getHealthOverview()` - Overall system health
- `getRedisStatus()` - Redis cache status
- `getSecurityWarnings()` - Security alerts
- `getSessionStats()` - Session statistics
- `getSystemMetrics()` - Resource metrics
- `exportHealthReport()` - Generate export data
- `downloadHealthReportJSON()` - Download JSON report
- `downloadHealthReportCSV()` - Download CSV report
- `resolveSecurityWarning()` - Mark warning as resolved

## Usage

### Navigation
1. Login as admin user (superuser)
2. Navigate to `/admin`
3. Click the "Health" tab in the navigation

### Features

#### Auto-Refresh
- Enabled by default (30-second interval)
- Toggle via "Auto-Refresh On/Off" button
- All data updates automatically when enabled

#### Manual Refresh
- Click "Refresh" button to update all data immediately
- Shows loading spinner during refresh
- Toast notification on completion

#### Export Reports
Two export formats available:

**JSON Export:**
- Complete health data in JSON format
- Includes all metrics and warnings
- Suitable for programmatic analysis
- Timestamped filename

**CSV Export:**
- Summary metrics in CSV format
- System overview and Redis info
- Last 10 security warnings
- Suitable for spreadsheet analysis

#### Critical Alert Notifications
- Fixed notification badge appears when critical alerts detected
- Shows alert count
- Prompts to check Security Warnings section

## Data Types

See `health-service.ts` for full TypeScript interface definitions:

- `HealthOverview` - System-wide health status
- `RedisStatus` - Redis cache metrics
- `SecurityWarning` - Security alert details
- `SessionStats` - Session analytics
- `SystemMetrics` - Resource usage data
- `HealthExportData` - Export file structure

## Styling

Built with:
- Tailwind CSS for styling
- Shadcn UI components (Card, Button, Badge, Progress, etc.)
- Recharts for data visualization
- Dark mode support
- Responsive grid layouts
- Color-coded status indicators

## Status Colors

- **Green**: Healthy, normal operation
- **Yellow**: Warning, degraded performance
- **Red**: Critical, requires attention
- **Gray**: Disabled or not available
- **Blue**: Informational

## API Endpoints Required

The dashboard expects these backend endpoints:

- `GET /api/v1/admin/health/overview`
- `GET /api/v1/admin/health/redis`
- `GET /api/v1/admin/health/security-warnings`
- `GET /api/v1/admin/health/sessions`
- `GET /api/v1/admin/system/health` (existing)
- `POST /api/v1/admin/health/security-warnings/{id}/resolve`

**Note:** The service includes fallback data if endpoints don't exist yet, so the UI will still render with placeholder values.

## Future Enhancements

Potential additions:
- Browser push notifications for critical alerts
- Alert threshold configuration
- Historical data charts
- Performance trends
- Email notifications
- Custom refresh intervals
- Alert acknowledgment workflow
- Metric comparisons over time
