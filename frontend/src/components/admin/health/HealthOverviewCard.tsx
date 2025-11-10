/**
 * HealthOverviewCard Component
 *
 * Main overview card showing critical system health metrics at a glance.
 */

import { Activity, Database, Server, AlertCircle, Users, Clock } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertBadge, StatusDot } from './AlertBadge'
import type { HealthOverview } from '@/services/admin/health-service'

interface HealthOverviewCardProps {
  data: HealthOverview | null
  loading?: boolean
  lastUpdated?: Date
}

export function HealthOverviewCard({ data, loading, lastUpdated }: HealthOverviewCardProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            System Health Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">Loading health data...</div>
        </CardContent>
      </Card>
    )
  }

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            System Health Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">
            No health data available
          </div>
        </CardContent>
      </Card>
    )
  }

  const formatUptime = (hours: number | undefined) => {
    if (!hours || hours === 0) return '0h'
    if (hours < 24) return `${Math.round(hours)}h`
    const days = Math.floor(hours / 24)
    const remainingHours = Math.round(hours % 24)
    return `${days}d ${remainingHours}h`
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              System Health Overview
            </CardTitle>
            <CardDescription>
              Overall system status and key metrics
              {lastUpdated && (
                <span className="ml-2 text-xs">
                  Updated {lastUpdated.toLocaleTimeString()}
                </span>
              )}
            </CardDescription>
          </div>
          <AlertBadge status={data.overall_status} size="lg" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* API Status */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Server className="h-4 w-4" />
              API Server
            </div>
            <div className="flex items-center gap-2">
              <StatusDot status={data.api_status} pulsing={data.api_status === 'healthy'} />
              <AlertBadge status={data.api_status} showIcon={false} />
            </div>
          </div>

          {/* Database Status */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Database className="h-4 w-4" />
              Database
            </div>
            <div className="flex items-center gap-2">
              <StatusDot status={data.database_status} pulsing={data.database_status === 'healthy'} />
              <AlertBadge status={data.database_status} showIcon={false} />
            </div>
          </div>

          {/* Redis Status */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Activity className="h-4 w-4" />
              Redis Cache
            </div>
            <div className="flex items-center gap-2">
              <StatusDot status={data.redis_status} pulsing={data.redis_status === 'healthy'} />
              <AlertBadge status={data.redis_status} showIcon={false} />
            </div>
          </div>

          {/* Uptime */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Clock className="h-4 w-4" />
              Uptime
            </div>
            <div className="text-2xl font-bold">{formatUptime(data.uptime_hours)}</div>
          </div>

          {/* Active Sessions */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Users className="h-4 w-4" />
              Active Sessions
            </div>
            <div className="text-2xl font-bold">{(data.active_sessions ?? 0).toLocaleString()}</div>
          </div>

          {/* Critical Alerts */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              Critical Alerts
            </div>
            <div className="flex items-center gap-2">
              <div className={`text-2xl font-bold ${(data.critical_alerts ?? 0) > 0 ? 'text-red-600' : ''}`}>
                {data.critical_alerts ?? 0}
              </div>
              {(data.critical_alerts ?? 0) > 0 && (
                <span className="text-xs text-red-600">Requires attention</span>
              )}
            </div>
          </div>
        </div>

        {/* Warning Banner */}
        {data.critical_alerts > 0 && (
          <div className="mt-6 p-4 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-red-600">Critical Alerts Detected</div>
              <div className="text-sm text-red-600/80 mt-1">
                There {data.critical_alerts === 1 ? 'is' : 'are'} {data.critical_alerts} critical{' '}
                {data.critical_alerts === 1 ? 'alert' : 'alerts'} requiring immediate attention.
                Check the Security Warnings section for details.
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
