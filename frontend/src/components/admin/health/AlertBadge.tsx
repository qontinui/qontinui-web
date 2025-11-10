/**
 * AlertBadge Component
 *
 * Color-coded status badge with icon for health monitoring.
 * Supports multiple severity levels with appropriate colors.
 */

import { CheckCircle, AlertCircle, AlertTriangle, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type AlertStatus = 'healthy' | 'degraded' | 'down' | 'disabled' | 'warning' | 'critical' | 'low' | 'medium' | 'high'

interface AlertBadgeProps {
  status: AlertStatus
  label?: string
  showIcon?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const statusConfig = {
  healthy: {
    color: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20',
    icon: CheckCircle,
    label: 'Healthy',
  },
  degraded: {
    color: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20',
    icon: AlertTriangle,
    label: 'Degraded',
  },
  down: {
    color: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
    icon: XCircle,
    label: 'Down',
  },
  disabled: {
    color: 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20',
    icon: AlertCircle,
    label: 'Disabled',
  },
  warning: {
    color: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20',
    icon: AlertTriangle,
    label: 'Warning',
  },
  critical: {
    color: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
    icon: XCircle,
    label: 'Critical',
  },
  low: {
    color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    icon: AlertCircle,
    label: 'Low',
  },
  medium: {
    color: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20',
    icon: AlertTriangle,
    label: 'Medium',
  },
  high: {
    color: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
    icon: AlertTriangle,
    label: 'High',
  },
}

const sizeConfig = {
  sm: {
    badge: 'text-xs px-2 py-0.5',
    icon: 'h-3 w-3',
  },
  md: {
    badge: 'text-sm px-2.5 py-1',
    icon: 'h-4 w-4',
  },
  lg: {
    badge: 'text-base px-3 py-1.5',
    icon: 'h-5 w-5',
  },
}

export function AlertBadge({
  status,
  label,
  showIcon = true,
  size = 'md',
  className,
}: AlertBadgeProps) {
  const config = statusConfig[status] || statusConfig.warning // Fallback to warning for unknown statuses
  const sizeStyles = sizeConfig[size]
  const Icon = config.icon
  const displayLabel = label || config.label

  return (
    <Badge
      className={cn(
        'inline-flex items-center gap-1.5 border',
        config.color,
        sizeStyles.badge,
        className
      )}
    >
      {showIcon && <Icon className={sizeStyles.icon} />}
      <span>{displayLabel}</span>
    </Badge>
  )
}

/**
 * Status indicator dot (for compact displays)
 */
interface StatusDotProps {
  status: AlertStatus
  size?: 'sm' | 'md' | 'lg'
  className?: string
  pulsing?: boolean
}

export function StatusDot({ status, size = 'md', className, pulsing = false }: StatusDotProps) {
  const dotSizes = {
    sm: 'h-2 w-2',
    md: 'h-3 w-3',
    lg: 'h-4 w-4',
  }

  const dotColors = {
    healthy: 'bg-green-500',
    degraded: 'bg-yellow-500',
    down: 'bg-red-500',
    disabled: 'bg-gray-500',
    warning: 'bg-yellow-500',
    critical: 'bg-red-500',
    low: 'bg-blue-500',
    medium: 'bg-yellow-500',
    high: 'bg-orange-500',
  }

  const dotColor = dotColors[status] || dotColors.warning // Fallback to warning for unknown statuses

  return (
    <div className={cn('relative inline-flex', className)}>
      <div
        className={cn(
          'rounded-full',
          dotSizes[size],
          dotColor,
          pulsing && 'animate-pulse'
        )}
      />
      {pulsing && (
        <div
          className={cn(
            'absolute inset-0 rounded-full animate-ping opacity-75',
            dotColor
          )}
        />
      )}
    </div>
  )
}
