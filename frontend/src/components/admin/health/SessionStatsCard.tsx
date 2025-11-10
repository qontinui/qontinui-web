/**
 * SessionStatsCard Component
 *
 * Displays active session statistics with charts showing distribution
 * between standard and remember_me sessions.
 */

import { Users, Clock, TrendingUp, Activity } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts'
import type { SessionStats } from '@/services/admin/health-service'

interface SessionStatsCardProps {
  data: SessionStats | null
  loading?: boolean
}

const COLORS = {
  standard: '#3b82f6', // blue
  remember_me: '#10b981', // green
}

export function SessionStatsCard({ data, loading }: SessionStatsCardProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Session Statistics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">Loading session data...</div>
        </CardContent>
      </Card>
    )
  }

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Session Statistics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">
            No session data available
          </div>
        </CardContent>
      </Card>
    )
  }

  const pieChartData = [
    { name: 'Standard Sessions', value: data.standard_sessions, color: COLORS.standard },
    { name: 'Remember Me', value: data.remember_me_sessions, color: COLORS.remember_me },
  ]

  const hourlyData = (data.hourly_sessions || []).slice(-12) // Last 12 hours

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Session Statistics
        </CardTitle>
        <CardDescription>Active sessions and user engagement metrics</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Key Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              Active Sessions
            </div>
            <div className="text-2xl font-bold">{data.total_active_sessions.toLocaleString()}</div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Activity className="h-4 w-4" />
              Active Users
            </div>
            <div className="text-2xl font-bold">{data.active_users_now.toLocaleString()}</div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <TrendingUp className="h-4 w-4" />
              Sessions Today
            </div>
            <div className="text-2xl font-bold">{data.sessions_today.toLocaleString()}</div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              Avg Duration
            </div>
            <div className="text-2xl font-bold">
              {data.average_session_duration_minutes.toFixed(0)}m
            </div>
          </div>
        </div>

        {/* Session Distribution */}
        <div className="space-y-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Standard Sessions</span>
              <span className="font-medium">{data.standard_sessions.toLocaleString()}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{
                  width: `${
                    data.total_active_sessions > 0
                      ? (data.standard_sessions / data.total_active_sessions) * 100
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Remember Me Sessions</span>
              <span className="font-medium">{data.remember_me_sessions.toLocaleString()}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all"
                style={{
                  width: `${
                    data.total_active_sessions > 0
                      ? (data.remember_me_sessions / data.total_active_sessions) * 100
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        </div>

        {/* Remember Me Adoption Rate */}
        <div className="p-4 rounded-lg bg-gradient-to-r from-green-500/10 to-blue-500/10 border border-green-500/20">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-muted-foreground">Remember Me Adoption</div>
              <div className="text-3xl font-bold text-green-600 dark:text-green-400">
                {data.remember_me_percentage.toFixed(1)}%
              </div>
            </div>
            {data.total_active_sessions > 0 && (
              <div className="text-right text-sm text-muted-foreground">
                <div>{data.remember_me_sessions} of {data.total_active_sessions}</div>
                <div>sessions</div>
              </div>
            )}
          </div>
        </div>

        {/* Charts */}
        {data.total_active_sessions > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Pie Chart */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Session Type Distribution</h4>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={pieChartData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {pieChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Hourly Sessions Bar Chart */}
            {hourlyData.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Sessions (Last 12 Hours)</h4>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={hourlyData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="hour"
                      className="text-xs"
                      tick={{ fontSize: 10 }}
                    />
                    <YAxis className="text-xs" tick={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '6px',
                      }}
                    />
                    <Bar dataKey="count" fill={COLORS.standard} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* No Sessions Message */}
        {data.total_active_sessions === 0 && (
          <div className="text-center py-8">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-50" />
            <h3 className="text-lg font-medium mb-1">No Active Sessions</h3>
            <p className="text-sm text-muted-foreground">
              There are currently no active user sessions
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
