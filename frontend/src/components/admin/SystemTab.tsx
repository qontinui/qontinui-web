"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Server, Database, HardDrive, Cpu, AlertCircle, CheckCircle, Clock, Activity } from "lucide-react"
import { toast } from "sonner"
import { httpClient } from "@/services/service-factory"

interface SystemHealth {
  api_status: "healthy" | "degraded" | "down"
  database_status: "healthy" | "degraded" | "down"
  database_connections: {
    active: number
    idle: number
    max: number
  }
  storage: {
    total_gb: number
    used_gb: number
    available_gb: number
    usage_percent: number
  }
  memory: {
    total_mb: number
    used_mb: number
    available_mb: number
    usage_percent: number
  }
  cpu_usage: number
  uptime_hours: number
  last_backup: string | null
  recent_errors: Array<{
    timestamp: string
    message: string
    level: string
  }>
}

export default function SystemTab() {
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadSystemHealth()
    // Refresh every 30 seconds
    const interval = setInterval(loadSystemHealth, 30000)
    return () => clearInterval(interval)
  }, [])

  const loadSystemHealth = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      const url = `${apiUrl}/api/v1/admin/system/health`

      console.log('[SystemTab] Loading system health from:', url)

      const response = await httpClient.fetch(url)

      console.log('[SystemTab] Response status:', response.status, response.statusText)

      if (response.ok) {
        const data = await response.json()
        console.log('[SystemTab] System health loaded successfully')
        setHealth(data)
        setError(null)
      } else {
        const errorText = await response.text().catch(() => 'Unknown error')
        console.error('[SystemTab] Error response:', {
          status: response.status,
          statusText: response.statusText,
          errorText,
        })
        setError(`Failed to load system health: ${response.status} - ${errorText}`)
        toast.error('Failed to load system health')
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      setError(`Failed to load system health: ${errorMsg}`)
      console.error('[SystemTab] Exception:', err)
      toast.error('Failed to load system health')
    } finally {
      setLoading(false)
    }
  }

  const getStatusBadge = (status: "healthy" | "degraded" | "down") => {
    switch (status) {
      case "healthy":
        return <Badge className="bg-green-500/10 text-green-500"><CheckCircle className="h-3 w-3 mr-1" />Healthy</Badge>
      case "degraded":
        return <Badge className="bg-yellow-500/10 text-yellow-500"><AlertCircle className="h-3 w-3 mr-1" />Degraded</Badge>
      case "down":
        return <Badge className="bg-red-500/10 text-red-500"><AlertCircle className="h-3 w-3 mr-1" />Down</Badge>
    }
  }

  const formatUptime = (hours: number) => {
    if (hours < 24) return `${Math.round(hours)}h`
    const days = Math.floor(hours / 24)
    const remainingHours = Math.round(hours % 24)
    return `${days}d ${remainingHours}h`
  }

  if (loading) {
    return <div className="text-center text-muted-foreground">Loading system health...</div>
  }

  if (error) {
    return (
      <div className="text-center text-red-500 space-y-2">
        <div>Error loading system health</div>
        <div className="text-sm text-muted-foreground">{error}</div>
      </div>
    )
  }

  if (!health) {
    return (
      <div className="text-center">
        <Card className="bg-card border-border">
          <CardContent className="p-8">
            <Server className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">System Health Monitoring</h3>
            <p className="text-muted-foreground">
              System monitoring will be available once the backend health endpoints are configured.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* System Status Overview */}
      <div>
        <h3 className="text-lg font-semibold mb-4">System Status</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">API Status</CardTitle>
              <Server className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {getStatusBadge(health.api_status)}
              <p className="text-xs text-muted-foreground mt-2">
                Uptime: {formatUptime(health.uptime_hours)}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Database Status</CardTitle>
              <Database className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {getStatusBadge(health.database_status)}
              <p className="text-xs text-muted-foreground mt-2">
                {health.database_connections.active} active / {health.database_connections.max} max connections
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Resource Usage */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Resource Usage</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">CPU Usage</CardTitle>
              <Cpu className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{health.cpu_usage.toFixed(1)}%</div>
              <div className="w-full bg-muted rounded-full h-2 mt-2">
                <div
                  className={`h-2 rounded-full ${
                    health.cpu_usage > 80 ? "bg-red-500" : health.cpu_usage > 60 ? "bg-yellow-500" : "bg-green-500"
                  }`}
                  style={{ width: `${health.cpu_usage}%` }}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Memory Usage</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{health.memory.usage_percent.toFixed(1)}%</div>
              <p className="text-xs text-muted-foreground">
                {health.memory.used_mb.toFixed(0)} MB / {health.memory.total_mb.toFixed(0)} MB
              </p>
              <div className="w-full bg-muted rounded-full h-2 mt-2">
                <div
                  className={`h-2 rounded-full ${
                    health.memory.usage_percent > 80
                      ? "bg-red-500"
                      : health.memory.usage_percent > 60
                      ? "bg-yellow-500"
                      : "bg-green-500"
                  }`}
                  style={{ width: `${health.memory.usage_percent}%` }}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Storage Usage</CardTitle>
              <HardDrive className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{health.storage.usage_percent.toFixed(1)}%</div>
              <p className="text-xs text-muted-foreground">
                {health.storage.used_gb.toFixed(1)} GB / {health.storage.total_gb.toFixed(1)} GB
              </p>
              <div className="w-full bg-muted rounded-full h-2 mt-2">
                <div
                  className={`h-2 rounded-full ${
                    health.storage.usage_percent > 80
                      ? "bg-red-500"
                      : health.storage.usage_percent > 60
                      ? "bg-yellow-500"
                      : "bg-green-500"
                  }`}
                  style={{ width: `${health.storage.usage_percent}%` }}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Database Connections */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Database Connections</CardTitle>
          <CardDescription>Current connection pool status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-sm font-medium text-muted-foreground">Active</div>
              <div className="text-2xl font-bold">{health.database_connections.active}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Idle</div>
              <div className="text-2xl font-bold">{health.database_connections.idle}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Max</div>
              <div className="text-2xl font-bold">{health.database_connections.max}</div>
            </div>
          </div>
          <div className="w-full bg-muted rounded-full h-2 mt-4">
            <div
              className="h-2 rounded-full bg-blue-500"
              style={{
                width: `${(health.database_connections.active / health.database_connections.max) * 100}%`,
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Backup Status */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Backup Status</CardTitle>
          <CardDescription>Last database backup</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            {health.last_backup ? (
              <span>{new Date(health.last_backup).toLocaleString()}</span>
            ) : (
              <span className="text-muted-foreground">No backup recorded</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recent Errors */}
      {health.recent_errors && health.recent_errors.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle>Recent Errors</CardTitle>
            <CardDescription>Last {health.recent_errors.length} system errors</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {health.recent_errors.map((error, index) => (
                <div key={index} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                  <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{error.message}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {new Date(error.timestamp).toLocaleString()} • {error.level}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
