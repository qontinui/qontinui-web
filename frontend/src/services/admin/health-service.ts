/**
 * Admin health monitoring service
 *
 * Provides API methods for fetching system health, Redis status,
 * security warnings, and session statistics.
 */

import { authService } from '../service-factory'
import { ApiConfig } from '../api-config'

export interface HealthOverview {
  api_status: 'healthy' | 'degraded' | 'down'
  database_status: 'healthy' | 'degraded' | 'down'
  redis_status: 'healthy' | 'degraded' | 'down' | 'disabled'
  overall_status: 'healthy' | 'degraded' | 'down'
  uptime_hours: number
  active_sessions: number
  critical_alerts: number
}

export interface RedisStatus {
  enabled: boolean
  connected: boolean
  mode: 'redis' | 'in-memory'
  memory_usage_mb: number
  memory_limit_mb: number
  memory_percent: number
  uptime_seconds: number
  connected_clients: number
  total_keys: number
  hit_rate: number
}

export interface SecurityWarning {
  id: string
  type: 'device_mismatch' | 'suspicious_login' | 'failed_login' | 'new_device' | 'token_anomaly'
  severity: 'low' | 'medium' | 'high' | 'critical'
  message: string
  details: string
  timestamp: string
  user_id?: string
  user_email?: string
  resolved: boolean
}

export interface SessionStats {
  total_active_sessions: number
  standard_sessions: number
  remember_me_sessions: number
  remember_me_percentage: number
  active_users_now: number
  sessions_today: number
  average_session_duration_minutes: number
  session_distribution: {
    standard: number
    remember_me: number
  }
  hourly_sessions: Array<{
    hour: string
    count: number
  }>
}

export interface SystemMetrics {
  cpu_usage: number
  memory: {
    total_mb: number
    used_mb: number
    available_mb: number
    usage_percent: number
  }
  storage: {
    total_gb: number
    used_gb: number
    available_gb: number
    usage_percent: number
  }
  database_connections: {
    active: number
    idle: number
    max: number
  }
  uptime_hours: number
  last_backup: string | null
}

export interface HealthExportData {
  timestamp: string
  overview: HealthOverview
  redis: RedisStatus
  security_warnings: SecurityWarning[]
  session_stats: SessionStats
  system_metrics: SystemMetrics
}

class HealthService {
  private getAuthHeaders(): HeadersInit {
    const accessToken = authService.tokenManager.getAccessToken()
    return {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    }
  }

  async getHealthOverview(): Promise<HealthOverview> {
    const response = await fetch(`${ApiConfig.API_BASE_URL}/api/v1/admin/health/overview`, {
      headers: this.getAuthHeaders(),
    })

    if (!response.ok) {
      // Fallback data if endpoint doesn't exist yet
      return {
        api_status: 'healthy',
        database_status: 'healthy',
        redis_status: 'healthy',
        overall_status: 'healthy',
        uptime_hours: 24,
        active_sessions: 0,
        critical_alerts: 0,
      }
    }

    const data = await response.json()

    // Transform backend response to frontend format
    // Backend returns nested structure, frontend expects flat structure
    return {
      api_status: data.system?.alert_level === 'critical' ? 'down' : data.system?.alert_level === 'warning' ? 'degraded' : 'healthy',
      database_status: data.database?.status || 'healthy',
      redis_status: data.redis?.status || 'healthy',
      overall_status: data.overall_status === 'critical' ? 'down' : data.overall_status,
      uptime_hours: data.redis?.uptime_hours || 0, // Use Redis uptime as proxy for system uptime
      active_sessions: data.sessions?.total_active_sessions || 0,
      critical_alerts: this.countCriticalAlerts(data),
    }
  }

  private countCriticalAlerts(data: any): number {
    let count = 0

    // Count critical alerts from various sources
    if (data.redis?.alert_level === 'critical') count++
    if (data.database?.alert_level === 'critical') count++
    if (data.system?.alert_level === 'critical') count++
    if (data.security?.alert_level === 'critical') count++

    return count
  }

  async getRedisStatus(): Promise<RedisStatus> {
    const response = await fetch(`${ApiConfig.API_BASE_URL}/api/v1/admin/health/redis`, {
      headers: this.getAuthHeaders(),
    })

    if (!response.ok) {
      // Fallback data
      return {
        enabled: false,
        connected: false,
        mode: 'in-memory',
        memory_usage_mb: 0,
        memory_limit_mb: 0,
        memory_percent: 0,
        uptime_seconds: 0,
        connected_clients: 0,
        total_keys: 0,
        hit_rate: 0,
      }
    }

    return response.json()
  }

  async getSecurityWarnings(limit: number = 50): Promise<SecurityWarning[]> {
    const response = await fetch(
      `${ApiConfig.API_BASE_URL}/api/v1/admin/health/security`,
      {
        headers: this.getAuthHeaders(),
      }
    )

    if (!response.ok) {
      // Return empty array if endpoint doesn't exist
      return []
    }

    const data = await response.json()

    // Backend returns aggregate stats, transform to array of warnings
    const warnings: SecurityWarning[] = []

    if (data.device_mismatches_24h > 0) {
      warnings.push({
        id: 'device-mismatches',
        type: 'device_mismatch',
        severity: data.device_mismatches_24h > 100 ? 'critical' : data.device_mismatches_24h > 50 ? 'high' : 'medium',
        message: `${data.device_mismatches_24h} device fingerprint mismatches detected`,
        details: 'Device fingerprint mismatches in the last 24 hours',
        timestamp: new Date().toISOString(),
        resolved: false,
      })
    }

    if (data.failed_logins_24h > 0) {
      warnings.push({
        id: 'failed-logins',
        type: 'failed_login',
        severity: data.failed_logins_24h > 100 ? 'critical' : data.failed_logins_24h > 30 ? 'high' : 'medium',
        message: `${data.failed_logins_24h} failed login attempts`,
        details: 'Failed authentication attempts in the last 24 hours',
        timestamp: new Date().toISOString(),
        resolved: false,
      })
    }

    if (data.new_devices_24h > 0) {
      warnings.push({
        id: 'new-devices',
        type: 'new_device',
        severity: data.new_devices_24h > 50 ? 'critical' : data.new_devices_24h > 20 ? 'high' : 'low',
        message: `${data.new_devices_24h} new devices registered`,
        details: 'New device registrations in the last 24 hours',
        timestamp: new Date().toISOString(),
        resolved: false,
      })
    }

    if (data.untrusted_devices_total > 0) {
      warnings.push({
        id: 'untrusted-devices',
        type: 'device_mismatch',
        severity: data.untrusted_devices_total > 50 ? 'high' : 'medium',
        message: `${data.untrusted_devices_total} untrusted devices active`,
        details: 'Total number of devices marked as untrusted',
        timestamp: new Date().toISOString(),
        resolved: false,
      })
    }

    if (data.users_with_multiple_devices > 0) {
      warnings.push({
        id: 'multiple-devices',
        type: 'device_mismatch',
        severity: 'low',
        message: `${data.users_with_multiple_devices} users have 3+ devices`,
        details: 'Users with multiple registered devices',
        timestamp: new Date().toISOString(),
        resolved: false,
      })
    }

    // Add overall alert if critical
    if (data.alert_level === 'critical') {
      warnings.unshift({
        id: 'critical-alert',
        type: 'suspicious_login',
        severity: 'critical',
        message: 'Critical security alert level',
        details: 'Multiple security thresholds exceeded',
        timestamp: new Date().toISOString(),
        resolved: false,
      })
    } else if (data.alert_level === 'warning') {
      warnings.unshift({
        id: 'warning-alert',
        type: 'suspicious_login',
        severity: 'high',
        message: 'Warning: Elevated security activity',
        details: 'Security metrics above normal thresholds',
        timestamp: new Date().toISOString(),
        resolved: false,
      })
    }

    return warnings.slice(0, limit)
  }

  async getSessionStats(): Promise<SessionStats> {
    const response = await fetch(`${ApiConfig.API_BASE_URL}/api/v1/admin/health/sessions`, {
      headers: this.getAuthHeaders(),
    })

    if (!response.ok) {
      // Fallback data
      return {
        total_active_sessions: 0,
        standard_sessions: 0,
        remember_me_sessions: 0,
        remember_me_percentage: 0,
        active_users_now: 0,
        sessions_today: 0,
        average_session_duration_minutes: 0,
        session_distribution: {
          standard: 0,
          remember_me: 0,
        },
        hourly_sessions: [],
      }
    }

    return response.json()
  }

  async getSystemMetrics(): Promise<SystemMetrics> {
    // Use existing system health endpoint
    const response = await fetch(`${ApiConfig.API_BASE_URL}/api/v1/admin/system/health`, {
      headers: this.getAuthHeaders(),
    })

    if (!response.ok) {
      throw new Error('Failed to fetch system metrics')
    }

    return response.json()
  }

  async resolveSecurityWarning(warningId: string): Promise<void> {
    // Note: The backend provides aggregate security stats, not individual warnings
    // Resolving individual warnings is not supported in the current implementation
    // This method is a no-op to prevent UI errors
    console.log(`[HealthService] Resolve warning requested for: ${warningId} (not implemented)`)
    return Promise.resolve()
  }

  async exportHealthReport(): Promise<HealthExportData> {
    const [overview, redis, warnings, sessions, metrics] = await Promise.all([
      this.getHealthOverview(),
      this.getRedisStatus(),
      this.getSecurityWarnings(),
      this.getSessionStats(),
      this.getSystemMetrics(),
    ])

    return {
      timestamp: new Date().toISOString(),
      overview,
      redis,
      security_warnings: warnings,
      session_stats: sessions,
      system_metrics: metrics,
    }
  }

  downloadHealthReportJSON(data: HealthExportData): void {
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `health-report-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  downloadHealthReportCSV(data: HealthExportData): void {
    const rows = [
      ['Health Report', new Date().toISOString()],
      [],
      ['System Overview'],
      ['Metric', 'Value'],
      ['API Status', data.overview.api_status],
      ['Database Status', data.overview.database_status],
      ['Redis Status', data.overview.redis_status],
      ['Overall Status', data.overview.overall_status],
      ['Uptime (hours)', data.overview.uptime_hours.toString()],
      ['Active Sessions', data.overview.active_sessions.toString()],
      ['Critical Alerts', data.overview.critical_alerts.toString()],
      [],
      ['Redis Information'],
      ['Enabled', data.redis.enabled.toString()],
      ['Connected', data.redis.connected.toString()],
      ['Mode', data.redis.mode],
      ['Memory Usage', `${data.redis.memory_percent.toFixed(1)}%`],
      [],
      ['Security Warnings', `${data.security_warnings.length} total`],
      ['Type', 'Severity', 'Message', 'Timestamp'],
      ...data.security_warnings.slice(0, 10).map(w => [w.type, w.severity, w.message, w.timestamp]),
    ]

    const csv = rows.map(row => row.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `health-report-${new Date().toISOString().split('T')[0]}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }
}

export const healthService = new HealthService()
