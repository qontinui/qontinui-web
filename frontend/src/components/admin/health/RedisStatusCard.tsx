/**
 * RedisStatusCard Component
 *
 * Displays Redis health, memory usage, connection status, and performance metrics.
 */

import { Database, Activity, HardDrive, Users, TrendingUp, Server } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { AlertBadge, StatusDot } from './AlertBadge'
import type { RedisStatus } from '@/services/admin/health-service'

interface RedisStatusCardProps {
  data: RedisStatus | null
  loading?: boolean
}

export function RedisStatusCard({ data, loading }: RedisStatusCardProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Redis Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">Loading Redis status...</div>
        </CardContent>
      </Card>
    )
  }

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Redis Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">
            No Redis data available
          </div>
        </CardContent>
      </Card>
    )
  }

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)

    if (days > 0) return `${days}d ${hours}h`
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  }

  const getMemoryStatus = (percent: number) => {
    if (percent >= 90) return 'critical'
    if (percent >= 75) return 'warning'
    return 'healthy'
  }

  const memoryStatus = getMemoryStatus(data.memory_percent ?? 0)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Redis Cache Status
            </CardTitle>
            <CardDescription>
              {data.enabled ? 'Redis cache active' : 'Using in-memory fallback'}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <StatusDot
              status={data.connected ? 'healthy' : data.enabled ? 'down' : 'disabled'}
              pulsing={data.connected}
              size="lg"
            />
            <AlertBadge
              status={data.connected ? 'healthy' : data.enabled ? 'down' : 'disabled'}
              label={data.connected ? 'Connected' : data.enabled ? 'Disconnected' : 'Disabled'}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Mode Indicator */}
        <div className="p-4 rounded-lg bg-muted/50 border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Mode</span>
            </div>
            <div className="text-sm font-mono">
              {data.mode === 'redis' ? (
                <span className="text-green-600 dark:text-green-400">Redis (Production)</span>
              ) : (
                <span className="text-yellow-600 dark:text-yellow-400">In-Memory (Fallback)</span>
              )}
            </div>
          </div>
        </div>

        {/* Memory Usage */}
        {data.enabled && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <HardDrive className="h-4 w-4 text-muted-foreground" />
                Memory Usage
              </div>
              <AlertBadge status={memoryStatus} size="sm" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {(data.memory_usage_mb ?? 0).toFixed(1)} MB / {(data.memory_limit_mb ?? 0).toFixed(1)} MB
                </span>
                <span className="font-medium">{(data.memory_percent ?? 0).toFixed(1)}%</span>
              </div>
              <Progress
                value={data.memory_percent ?? 0}
                className="h-2"
              />
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-4">
          {/* Connected Clients */}
          {data.enabled && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="h-4 w-4" />
                Clients
              </div>
              <div className="text-2xl font-bold">{data.connected_clients ?? 0}</div>
            </div>
          )}

          {/* Total Keys */}
          {data.enabled && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Database className="h-4 w-4" />
                Keys
              </div>
              <div className="text-2xl font-bold">{(data.total_keys ?? 0).toLocaleString()}</div>
            </div>
          )}

          {/* Uptime */}
          {data.enabled && data.uptime_seconds > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Activity className="h-4 w-4" />
                Uptime
              </div>
              <div className="text-2xl font-bold">{formatUptime(data.uptime_seconds)}</div>
            </div>
          )}

          {/* Hit Rate */}
          {data.enabled && data.hit_rate > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <TrendingUp className="h-4 w-4" />
                Hit Rate
              </div>
              <div className="text-2xl font-bold">{(data.hit_rate ?? 0).toFixed(1)}%</div>
            </div>
          )}
        </div>

        {/* Warnings */}
        {!data.enabled && (
          <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-start gap-3">
            <Activity className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-yellow-600">Redis Disabled</div>
              <div className="text-sm text-yellow-600/80 mt-1">
                The system is using in-memory storage. Session data and caches will not persist across restarts.
                Enable Redis for production environments.
              </div>
            </div>
          </div>
        )}

        {data.enabled && !data.connected && (
          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-3">
            <Database className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-red-600">Connection Failed</div>
              <div className="text-sm text-red-600/80 mt-1">
                Redis is enabled but connection failed. The system has fallen back to in-memory storage.
                Check Redis server status and connection settings.
              </div>
            </div>
          </div>
        )}

        {data.memory_percent >= 90 && data.connected && (
          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-3">
            <HardDrive className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-red-600">Memory Critical</div>
              <div className="text-sm text-red-600/80 mt-1">
                Redis memory usage is at {(data.memory_percent ?? 0).toFixed(1)}%. Consider increasing the memory limit
                or clearing old keys to prevent performance issues.
              </div>
            </div>
          </div>
        )}

        {data.memory_percent >= 75 && data.memory_percent < 90 && data.connected && (
          <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-start gap-3">
            <HardDrive className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-yellow-600">Memory Warning</div>
              <div className="text-sm text-yellow-600/80 mt-1">
                Redis memory usage is at {(data.memory_percent ?? 0).toFixed(1)}%. Monitor memory usage and
                consider cleanup if it continues to increase.
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
