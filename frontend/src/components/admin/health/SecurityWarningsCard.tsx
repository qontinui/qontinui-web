/**
 * SecurityWarningsCard Component
 *
 * Displays recent security alerts with severity indicators, timestamps, and resolution options.
 */

import { useState } from 'react'
import {
  Shield,
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  Smartphone,
  Lock,
  XCircle,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AlertBadge } from './AlertBadge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import type { SecurityWarning } from '@/services/admin/health-service'
import { healthService } from '@/services/admin/health-service'

interface SecurityWarningsCardProps {
  data: SecurityWarning[] | null
  loading?: boolean
  onRefresh?: () => void
}

const warningTypeIcons = {
  device_mismatch: Smartphone,
  suspicious_login: AlertTriangle,
  failed_login: XCircle,
  new_device: Smartphone,
  token_anomaly: Lock,
}

const warningTypeLabels = {
  device_mismatch: 'Device Mismatch',
  suspicious_login: 'Suspicious Login',
  failed_login: 'Failed Login',
  new_device: 'New Device',
  token_anomaly: 'Token Anomaly',
}

export function SecurityWarningsCard({ data, loading, onRefresh }: SecurityWarningsCardProps) {
  const [showResolved, setShowResolved] = useState(false)
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set())

  const handleResolve = async (warningId: string) => {
    setResolvingIds((prev) => new Set(prev).add(warningId))
    try {
      await healthService.resolveSecurityWarning(warningId)
      toast.success('Security warning resolved')
      onRefresh?.()
    } catch (error) {
      toast.error('Failed to resolve warning')
    } finally {
      setResolvingIds((prev) => {
        const next = new Set(prev)
        next.delete(warningId)
        return next
      })
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Security Warnings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">
            Loading security warnings...
          </div>
        </CardContent>
      </Card>
    )
  }

  const warnings = data || []
  const unresolvedWarnings = warnings.filter((w) => !w.resolved)
  const resolvedWarnings = warnings.filter((w) => w.resolved)
  const displayWarnings = showResolved ? warnings : unresolvedWarnings

  const criticalCount = unresolvedWarnings.filter((w) => w.severity === 'critical').length
  const highCount = unresolvedWarnings.filter((w) => w.severity === 'high').length
  const mediumCount = unresolvedWarnings.filter((w) => w.severity === 'medium').length

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Security Warnings
            </CardTitle>
            <CardDescription>
              {unresolvedWarnings.length > 0
                ? `${unresolvedWarnings.length} unresolved ${
                    unresolvedWarnings.length === 1 ? 'alert' : 'alerts'
                  }`
                : 'No active security warnings'}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowResolved(!showResolved)}
            className="flex items-center gap-2"
          >
            {showResolved ? (
              <>
                <EyeOff className="h-4 w-4" />
                Hide Resolved
              </>
            ) : (
              <>
                <Eye className="h-4 w-4" />
                Show Resolved ({resolvedWarnings.length})
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary Stats */}
        {unresolvedWarnings.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            {criticalCount > 0 && (
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Critical</div>
                <div className="text-2xl font-bold text-red-600">{criticalCount}</div>
              </div>
            )}
            {highCount > 0 && (
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">High</div>
                <div className="text-2xl font-bold text-orange-600">{highCount}</div>
              </div>
            )}
            {mediumCount > 0 && (
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Medium</div>
                <div className="text-2xl font-bold text-yellow-600">{mediumCount}</div>
              </div>
            )}
          </div>
        )}

        {/* Warnings List */}
        {displayWarnings.length > 0 ? (
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-3">
              {displayWarnings.map((warning) => {
                const Icon = warningTypeIcons[warning.type] || AlertTriangle
                const typeLabel = warningTypeLabels[warning.type] || 'Security Alert'

                return (
                  <div
                    key={warning.id}
                    className={`p-4 rounded-lg border ${
                      warning.resolved
                        ? 'bg-muted/30 border-muted'
                        : 'bg-card border-border hover:border-primary/50 transition-colors'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Icon
                        className={`h-5 w-5 flex-shrink-0 mt-0.5 ${
                          warning.resolved
                            ? 'text-muted-foreground'
                            : warning.severity === 'critical'
                            ? 'text-red-600'
                            : warning.severity === 'high'
                            ? 'text-orange-600'
                            : warning.severity === 'medium'
                            ? 'text-yellow-600'
                            : 'text-blue-600'
                        }`}
                      />
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">{typeLabel}</span>
                              <AlertBadge status={warning.severity} size="sm" />
                              {warning.resolved && (
                                <div className="flex items-center gap-1 text-xs text-green-600">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Resolved
                                </div>
                              )}
                            </div>
                            <p className="text-sm">{warning.message}</p>
                            {warning.details && (
                              <p className="text-xs text-muted-foreground">{warning.details}</p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <div className="flex items-center gap-3">
                            <span>{new Date(warning.timestamp).toLocaleString()}</span>
                            {warning.user_email && (
                              <span className="font-mono">{warning.user_email}</span>
                            )}
                          </div>
                          {!warning.resolved && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleResolve(warning.id)}
                              disabled={resolvingIds.has(warning.id)}
                              className="h-7 text-xs"
                            >
                              {resolvingIds.has(warning.id) ? 'Resolving...' : 'Mark Resolved'}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        ) : (
          <div className="text-center py-8">
            <Shield className="h-12 w-12 text-green-500 mx-auto mb-3" />
            <h3 className="text-lg font-medium mb-1">All Clear</h3>
            <p className="text-sm text-muted-foreground">
              {showResolved
                ? 'No security warnings to display'
                : 'No unresolved security warnings'}
            </p>
          </div>
        )}

        {/* Info Banner */}
        {unresolvedWarnings.length === 0 && resolvedWarnings.length > 0 && !showResolved && (
          <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-center">
            <p className="text-sm text-green-600">
              All security warnings have been resolved. Great job!
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
