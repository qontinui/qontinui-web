"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Activity, LogIn, Settings, Upload, Trash2, Edit, Eye } from "lucide-react"

interface ActivityLog {
  id: number
  action: string
  description: string
  timestamp: string
  ip_address?: string
  user_agent?: string
}

interface ActivityFeedProps {
  activities: ActivityLog[]
}

export function ActivityFeed({ activities }: ActivityFeedProps) {
  const getActivityIcon = (action: string) => {
    const lowerAction = action.toLowerCase()

    if (lowerAction.includes('login') || lowerAction.includes('signin')) {
      return <LogIn className="w-4 h-4" />
    }
    if (lowerAction.includes('upload')) {
      return <Upload className="w-4 h-4" />
    }
    if (lowerAction.includes('delete')) {
      return <Trash2 className="w-4 h-4" />
    }
    if (lowerAction.includes('edit') || lowerAction.includes('update')) {
      return <Edit className="w-4 h-4" />
    }
    if (lowerAction.includes('view')) {
      return <Eye className="w-4 h-4" />
    }
    if (lowerAction.includes('setting')) {
      return <Settings className="w-4 h-4" />
    }

    return <Activity className="w-4 h-4" />
  }

  const getActivityColor = (action: string) => {
    const lowerAction = action.toLowerCase()

    if (lowerAction.includes('login') || lowerAction.includes('signin')) {
      return 'text-[#00FF88]'
    }
    if (lowerAction.includes('delete')) {
      return 'text-red-400'
    }
    if (lowerAction.includes('upload') || lowerAction.includes('create')) {
      return 'text-[#00D9FF]'
    }
    if (lowerAction.includes('edit') || lowerAction.includes('update')) {
      return 'text-[#BD00FF]'
    }

    return 'text-gray-400'
  }

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60))

    if (diffInHours < 1) {
      const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60))
      if (diffInMinutes < 1) return 'Just now'
      return `${diffInMinutes} min ago`
    }
    if (diffInHours < 24) return `${diffInHours} hours ago`

    const diffInDays = Math.floor(diffInHours / 24)
    if (diffInDays === 1) return 'Yesterday'
    if (diffInDays < 7) return `${diffInDays} days ago`

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    })
  }

  const getBrowserInfo = (userAgent?: string) => {
    if (!userAgent) return null

    if (userAgent.includes('Chrome')) return 'Chrome'
    if (userAgent.includes('Firefox')) return 'Firefox'
    if (userAgent.includes('Safari')) return 'Safari'
    if (userAgent.includes('Edge')) return 'Edge'

    return 'Unknown'
  }

  return (
    <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#BD00FF]/20 rounded-lg flex items-center justify-center">
            <Activity className="w-5 h-5 text-[#BD00FF]" />
          </div>
          <div>
            <CardTitle className="text-xl">Recent Activity</CardTitle>
            <CardDescription>Your recent account actions and login history</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {activities.length === 0 ? (
          <div className="text-center py-8">
            <Activity className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">No recent activity</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-3">
              {activities.map((activity, index) => (
                <div
                  key={activity.id}
                  className="flex items-start gap-3 p-4 rounded-lg bg-[#0A0A0B]/50 border border-gray-800/50 hover:border-gray-700/50 transition-colors"
                >
                  {/* Icon */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    getActivityColor(activity.action).replace('text-', 'bg-').replace('400', '500/20')
                  }`}>
                    <div className={getActivityColor(activity.action)}>
                      {getActivityIcon(activity.action)}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-sm font-medium text-white">
                        {activity.action}
                      </p>
                      <span className="text-xs text-gray-500 whitespace-nowrap">
                        {formatTimestamp(activity.timestamp)}
                      </span>
                    </div>

                    <p className="text-sm text-gray-400 mb-2">
                      {activity.description}
                    </p>

                    {/* Metadata */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {activity.ip_address && (
                        <Badge
                          variant="outline"
                          className="text-xs bg-gray-800/30 border-gray-700 text-gray-400"
                        >
                          IP: {activity.ip_address}
                        </Badge>
                      )}
                      {activity.user_agent && getBrowserInfo(activity.user_agent) && (
                        <Badge
                          variant="outline"
                          className="text-xs bg-gray-800/30 border-gray-700 text-gray-400"
                        >
                          {getBrowserInfo(activity.user_agent)}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
