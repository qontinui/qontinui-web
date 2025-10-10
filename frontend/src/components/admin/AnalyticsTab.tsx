"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { TrendingUp, Users, Activity, Target, Calendar, BarChart3 } from "lucide-react"
import { toast } from "sonner"
import { authService } from "@/services/service-factory"

interface AnalyticsData {
  dau: number
  wau: number
  mau: number
  retention_7day: number
  retention_30day: number
  avg_session_duration: number
  new_users_today: number
  new_users_week: number
  new_users_month: number
  active_projects_week: number
  total_sessions_today: number
  conversion_rate: number
}

export default function AnalyticsTab() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAnalytics()
  }, [])

  const loadAnalytics = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      const accessToken = authService.tokenManager.getAccessToken()

      if (!accessToken) {
        toast.error('Not authenticated')
        return
      }

      const response = await fetch(`${apiUrl}/api/v1/admin/analytics`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      })

      if (response.ok) {
        const data = await response.json()
        setAnalytics(data)
      } else {
        toast.error('Failed to load analytics')
      }
    } catch (error) {
      console.error('Failed to load analytics:', error)
      toast.error('Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${Math.round(minutes)}m`
    const hours = Math.floor(minutes / 60)
    const mins = Math.round(minutes % 60)
    return `${hours}h ${mins}m`
  }

  if (loading) {
    return <div className="text-center text-muted-foreground">Loading analytics...</div>
  }

  if (!analytics) {
    return (
      <div className="text-center">
        <Card className="bg-card border-border">
          <CardContent className="p-8">
            <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">Analytics Coming Soon</h3>
            <p className="text-muted-foreground">
              Detailed analytics and insights will be available once we have sufficient usage data.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Active Users */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Active Users</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Daily Active Users</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analytics.dau}</div>
              <p className="text-xs text-muted-foreground">Last 24 hours</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Weekly Active Users</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analytics.wau}</div>
              <p className="text-xs text-muted-foreground">Last 7 days</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Monthly Active Users</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analytics.mau}</div>
              <p className="text-xs text-muted-foreground">Last 30 days</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* User Growth */}
      <div>
        <h3 className="text-lg font-semibold mb-4">User Growth</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">New Users Today</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analytics.new_users_today}</div>
              <p className="text-xs text-muted-foreground">Since midnight</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">New Users This Week</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analytics.new_users_week}</div>
              <p className="text-xs text-muted-foreground">Last 7 days</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">New Users This Month</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analytics.new_users_month}</div>
              <p className="text-xs text-muted-foreground">Last 30 days</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Engagement Metrics */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Engagement</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">7-Day Retention</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analytics.retention_7day.toFixed(1)}%</div>
              <p className="text-xs text-muted-foreground">Users returning after 7 days</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">30-Day Retention</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analytics.retention_30day.toFixed(1)}%</div>
              <p className="text-xs text-muted-foreground">Users returning after 30 days</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Session Duration</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatDuration(analytics.avg_session_duration)}</div>
              <p className="text-xs text-muted-foreground">Per session</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Conversion & Activity */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Conversion & Activity</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Conversion Rate</CardTitle>
              <Target className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analytics.conversion_rate.toFixed(1)}%</div>
              <p className="text-xs text-muted-foreground">Visitors → Registered users</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Projects</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analytics.active_projects_week}</div>
              <p className="text-xs text-muted-foreground">Modified in last 7 days</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Sessions Today</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analytics.total_sessions_today}</div>
              <p className="text-xs text-muted-foreground">Total logins today</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Insights */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Key Insights</CardTitle>
          <CardDescription>Automated observations based on current metrics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {analytics.retention_7day > 50 && (
              <div className="flex items-start gap-2 text-sm">
                <div className="h-2 w-2 rounded-full bg-green-500 mt-1.5" />
                <div>
                  <span className="font-medium">Strong 7-day retention</span> - Users are coming back
                  within the first week, indicating good product-market fit.
                </div>
              </div>
            )}
            {analytics.retention_7day < 30 && (
              <div className="flex items-start gap-2 text-sm">
                <div className="h-2 w-2 rounded-full bg-yellow-500 mt-1.5" />
                <div>
                  <span className="font-medium">Low 7-day retention</span> - Consider improving onboarding
                  or early user experience.
                </div>
              </div>
            )}
            {analytics.wau > 0 && analytics.dau / analytics.wau > 0.5 && (
              <div className="flex items-start gap-2 text-sm">
                <div className="h-2 w-2 rounded-full bg-green-500 mt-1.5" />
                <div>
                  <span className="font-medium">High daily engagement</span> - Users are visiting frequently
                  throughout the week.
                </div>
              </div>
            )}
            {analytics.conversion_rate < 5 && (
              <div className="flex items-start gap-2 text-sm">
                <div className="h-2 w-2 rounded-full bg-yellow-500 mt-1.5" />
                <div>
                  <span className="font-medium">Low conversion rate</span> - Consider optimizing the
                  signup flow or landing page.
                </div>
              </div>
            )}
            {analytics.new_users_week > 0 && (
              <div className="flex items-start gap-2 text-sm">
                <div className="h-2 w-2 rounded-full bg-blue-500 mt-1.5" />
                <div>
                  <span className="font-medium">Growing user base</span> - {analytics.new_users_week} new
                  users joined this week.
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
