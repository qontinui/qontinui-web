/**
 * HealthDashboardTab Component
 *
 * Main health monitoring dashboard that integrates all health cards
 * with auto-refresh, manual refresh, and export functionality.
 */

'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Download, Activity } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { healthService } from '@/services/admin/health-service'
import { HealthOverviewCard } from './HealthOverviewCard'
import { RedisStatusCard } from './RedisStatusCard'
import { SecurityWarningsCard } from './SecurityWarningsCard'
import { SessionStatsCard } from './SessionStatsCard'
import { SystemMetricsCard } from './SystemMetricsCard'

const REFRESH_INTERVAL = 30000 // 30 seconds

export default function HealthDashboardTab() {
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [autoRefresh, setAutoRefresh] = useState(true)

  // Fetch health overview
  const {
    data: healthOverview,
    isLoading: overviewLoading,
    refetch: refetchOverview,
  } = useQuery({
    queryKey: ['admin', 'health', 'overview'],
    queryFn: () => healthService.getHealthOverview(),
    refetchInterval: autoRefresh ? REFRESH_INTERVAL : false,
  })

  // Fetch Redis status
  const {
    data: redisStatus,
    isLoading: redisLoading,
    refetch: refetchRedis,
  } = useQuery({
    queryKey: ['admin', 'health', 'redis'],
    queryFn: () => healthService.getRedisStatus(),
    refetchInterval: autoRefresh ? REFRESH_INTERVAL : false,
  })

  // Fetch security warnings
  const {
    data: securityWarnings,
    isLoading: warningsLoading,
    refetch: refetchWarnings,
  } = useQuery({
    queryKey: ['admin', 'health', 'security-warnings'],
    queryFn: () => healthService.getSecurityWarnings(),
    refetchInterval: autoRefresh ? REFRESH_INTERVAL : false,
  })

  // Fetch session stats
  const {
    data: sessionStats,
    isLoading: sessionsLoading,
    refetch: refetchSessions,
  } = useQuery({
    queryKey: ['admin', 'health', 'sessions'],
    queryFn: () => healthService.getSessionStats(),
    refetchInterval: autoRefresh ? REFRESH_INTERVAL : false,
  })

  // Fetch system metrics
  const {
    data: systemMetrics,
    isLoading: metricsLoading,
    refetch: refetchMetrics,
  } = useQuery({
    queryKey: ['admin', 'health', 'system-metrics'],
    queryFn: () => healthService.getSystemMetrics(),
    refetchInterval: autoRefresh ? REFRESH_INTERVAL : false,
  })

  const isLoading =
    overviewLoading ||
    redisLoading ||
    warningsLoading ||
    sessionsLoading ||
    metricsLoading

  // Update last updated timestamp
  useEffect(() => {
    if (!isLoading) {
      setLastUpdated(new Date())
    }
  }, [isLoading, healthOverview, redisStatus, securityWarnings, sessionStats, systemMetrics])

  const handleManualRefresh = async () => {
    const refreshPromises = [
      refetchOverview(),
      refetchRedis(),
      refetchWarnings(),
      refetchSessions(),
      refetchMetrics(),
    ]

    toast.promise(Promise.all(refreshPromises), {
      loading: 'Refreshing health data...',
      success: 'Health data refreshed successfully',
      error: 'Failed to refresh some health data',
    })
  }

  const handleExportJSON = async () => {
    try {
      const data = await healthService.exportHealthReport()
      healthService.downloadHealthReportJSON(data)
      toast.success('Health report exported as JSON')
    } catch (error) {
      toast.error('Failed to export health report')
    }
  }

  const handleExportCSV = async () => {
    try {
      const data = await healthService.exportHealthReport()
      healthService.downloadHealthReportCSV(data)
      toast.success('Health report exported as CSV')
    } catch (error) {
      toast.error('Failed to export health report')
    }
  }

  return (
    <div className="space-y-6">
      {/* Header with Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Activity className="h-5 w-5" />
            System Health Dashboard
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time monitoring of system health, security, and performance
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={autoRefresh ? 'bg-green-500/10 border-green-500/20' : ''}
          >
            {autoRefresh ? 'Auto-Refresh On' : 'Auto-Refresh Off'}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleManualRefresh}
            disabled={isLoading}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportJSON}
              className="flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
          </div>
        </div>
      </div>

      {/* Export Options Hint */}
      <div className="text-xs text-muted-foreground text-right">
        Last updated: {lastUpdated.toLocaleTimeString()} •{' '}
        {autoRefresh ? `Auto-refresh every ${REFRESH_INTERVAL / 1000}s` : 'Auto-refresh disabled'}
      </div>

      {/* Health Overview */}
      <HealthOverviewCard
        data={healthOverview || null}
        loading={overviewLoading}
        lastUpdated={lastUpdated}
      />

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RedisStatusCard data={redisStatus || null} loading={redisLoading} />
        <SystemMetricsCard data={systemMetrics || null} loading={metricsLoading} />
      </div>

      {/* Security and Sessions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SecurityWarningsCard
          data={securityWarnings || null}
          loading={warningsLoading}
          onRefresh={refetchWarnings}
        />
        <SessionStatsCard data={sessionStats || null} loading={sessionsLoading} />
      </div>

      {/* Export Options Details */}
      <div className="p-4 rounded-lg bg-muted/30 border">
        <h4 className="font-medium mb-2">Export Options</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <button
              onClick={handleExportJSON}
              className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
            >
              Download JSON Report
            </button>
            <p className="text-muted-foreground mt-1">
              Complete health data in JSON format for programmatic analysis
            </p>
          </div>
          <div>
            <button
              onClick={handleExportCSV}
              className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
            >
              Download CSV Report
            </button>
            <p className="text-muted-foreground mt-1">
              Summary health metrics in CSV format for spreadsheet analysis
            </p>
          </div>
        </div>
      </div>

      {/* Critical Alerts Notification */}
      {healthOverview && healthOverview.critical_alerts > 0 && (
        <div className="fixed bottom-4 right-4 max-w-md">
          <div className="p-4 rounded-lg bg-red-500 text-white shadow-lg">
            <div className="font-medium mb-1">Critical System Alerts</div>
            <div className="text-sm">
              {healthOverview.critical_alerts} critical{' '}
              {healthOverview.critical_alerts === 1 ? 'alert requires' : 'alerts require'}{' '}
              immediate attention
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
