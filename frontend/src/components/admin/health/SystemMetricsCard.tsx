/**
 * SystemMetricsCard Component
 *
 * Displays system resource metrics including CPU, memory, disk usage,
 * and database connections with visual gauges and progress bars.
 */

import { Cpu, HardDrive, Activity, Database, Server } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { SystemMetrics } from '@/services/admin/health-service'

interface SystemMetricsCardProps {
  data: SystemMetrics | null
  loading?: boolean
}

export function SystemMetricsCard({ data, loading }: SystemMetricsCardProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            System Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">Loading system metrics...</div>
        </CardContent>
      </Card>
    )
  }

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            System Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">
            No system metrics available
          </div>
        </CardContent>
      </Card>
    )
  }

  const getUsageColor = (percent: number) => {
    if (percent >= 90) return 'bg-red-500'
    if (percent >= 75) return 'bg-yellow-500'
    return 'bg-green-500'
  }

  const getUsageStatus = (percent: number) => {
    if (percent >= 90) return 'critical'
    if (percent >= 75) return 'warning'
    return 'healthy'
  }

  const formatUptime = (hours: number) => {
    if (hours < 24) return `${Math.round(hours)}h`
    const days = Math.floor(hours / 24)
    const remainingHours = Math.round(hours % 24)
    return `${days}d ${remainingHours}h`
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5" />
          System Metrics
        </CardTitle>
        <CardDescription>Real-time resource usage and performance</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Resource Usage Gauges */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* CPU Usage */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Cpu className="h-4 w-4 text-muted-foreground" />
                CPU Usage
              </div>
              <span
                className={`text-sm font-medium ${
                  data.cpu_usage >= 90
                    ? 'text-red-600'
                    : data.cpu_usage >= 75
                    ? 'text-yellow-600'
                    : 'text-green-600'
                }`}
              >
                {data.cpu_usage.toFixed(1)}%
              </span>
            </div>
            <div className="space-y-2">
              <Progress
                value={data.cpu_usage}
                className="h-3"
              />
              <div className="text-xs text-muted-foreground text-center">
                {getUsageStatus(data.cpu_usage) === 'critical'
                  ? 'Critical load'
                  : getUsageStatus(data.cpu_usage) === 'warning'
                  ? 'High load'
                  : 'Normal'}
              </div>
            </div>
          </div>

          {/* Memory Usage */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Activity className="h-4 w-4 text-muted-foreground" />
                Memory
              </div>
              <span
                className={`text-sm font-medium ${
                  data.memory.usage_percent >= 90
                    ? 'text-red-600'
                    : data.memory.usage_percent >= 75
                    ? 'text-yellow-600'
                    : 'text-green-600'
                }`}
              >
                {data.memory.usage_percent.toFixed(1)}%
              </span>
            </div>
            <div className="space-y-2">
              <Progress
                value={data.memory.usage_percent}
                className="h-3"
              />
              <div className="text-xs text-muted-foreground text-center">
                {data.memory.used_mb.toFixed(0)} MB / {data.memory.total_mb.toFixed(0)} MB
              </div>
            </div>
          </div>

          {/* Disk Usage */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <HardDrive className="h-4 w-4 text-muted-foreground" />
                Storage
              </div>
              <span
                className={`text-sm font-medium ${
                  data.storage.usage_percent >= 90
                    ? 'text-red-600'
                    : data.storage.usage_percent >= 75
                    ? 'text-yellow-600'
                    : 'text-green-600'
                }`}
              >
                {data.storage.usage_percent.toFixed(1)}%
              </span>
            </div>
            <div className="space-y-2">
              <Progress
                value={data.storage.usage_percent}
                className="h-3"
              />
              <div className="text-xs text-muted-foreground text-center">
                {data.storage.used_gb.toFixed(1)} GB / {data.storage.total_gb.toFixed(1)} GB
              </div>
            </div>
          </div>
        </div>

        {/* Database Connections */}
        <div className="p-4 rounded-lg border bg-muted/30">
          <div className="flex items-center gap-2 mb-3">
            <Database className="h-5 w-5 text-muted-foreground" />
            <h4 className="font-medium">Database Connections</h4>
          </div>
          <div className="grid grid-cols-3 gap-4 mb-3">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Active</div>
              <div className="text-xl font-bold">{data.database_connections.active}</div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Idle</div>
              <div className="text-xl font-bold">{data.database_connections.idle}</div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Max</div>
              <div className="text-xl font-bold">{data.database_connections.max}</div>
            </div>
          </div>
          <div className="space-y-1">
            <Progress
              value={(data.database_connections.active / data.database_connections.max) * 100}
              className="h-2"
            />
            <div className="text-xs text-muted-foreground text-center">
              {((data.database_connections.active / data.database_connections.max) * 100).toFixed(
                1
              )}
              % utilization
            </div>
          </div>
        </div>

        {/* System Info */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">System Uptime</div>
            <div className="text-2xl font-bold">{formatUptime(data.uptime_hours)}</div>
          </div>
          {data.last_backup && (
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Last Backup</div>
              <div className="text-sm font-medium">
                {new Date(data.last_backup).toLocaleString()}
              </div>
            </div>
          )}
        </div>

        {/* Resource Warnings */}
        {data.cpu_usage >= 90 && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
            <Cpu className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-600">
              <span className="font-medium">CPU Critical:</span> System CPU usage is at{' '}
              {data.cpu_usage.toFixed(1)}%. Performance may be impacted.
            </div>
          </div>
        )}

        {data.memory.usage_percent >= 90 && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
            <Activity className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-600">
              <span className="font-medium">Memory Critical:</span> System memory usage is at{' '}
              {data.memory.usage_percent.toFixed(1)}%. Consider increasing available memory.
            </div>
          </div>
        )}

        {data.storage.usage_percent >= 90 && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
            <HardDrive className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-600">
              <span className="font-medium">Storage Critical:</span> Disk usage is at{' '}
              {data.storage.usage_percent.toFixed(1)}%. Free up space to prevent issues.
            </div>
          </div>
        )}

        {data.cpu_usage >= 75 && data.cpu_usage < 90 && (
          <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-start gap-2">
            <Cpu className="h-4 w-4 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-yellow-600">
              <span className="font-medium">CPU Warning:</span> System CPU usage is at{' '}
              {data.cpu_usage.toFixed(1)}%. Monitor for continued high usage.
            </div>
          </div>
        )}

        {data.memory.usage_percent >= 75 && data.memory.usage_percent < 90 && (
          <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-start gap-2">
            <Activity className="h-4 w-4 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-yellow-600">
              <span className="font-medium">Memory Warning:</span> System memory usage is at{' '}
              {data.memory.usage_percent.toFixed(1)}%. Monitor usage closely.
            </div>
          </div>
        )}

        {data.storage.usage_percent >= 75 && data.storage.usage_percent < 90 && (
          <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-start gap-2">
            <HardDrive className="h-4 w-4 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-yellow-600">
              <span className="font-medium">Storage Warning:</span> Disk usage is at{' '}
              {data.storage.usage_percent.toFixed(1)}%. Consider cleanup soon.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
