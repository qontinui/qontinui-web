"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { toast } from "sonner"
import { Wifi, RefreshCcw, Info } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"

interface AutomationStreamingSettings {
  enabled: boolean
  sessions_limit: number | null
  sessions_used: number
  sessions_reset_at: string | null
}

interface AutomationStreamingCardProps {
  context?: 'profile' | 'connect-runner'
}

export function AutomationStreamingCard({ context = 'profile' }: AutomationStreamingCardProps) {
  const [settings, setSettings] = useState<AutomationStreamingSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem("access_token")
      console.log("[AutomationStreaming] Loading settings...")
      console.log("[AutomationStreaming] Token exists:", !!token)
      console.log("[AutomationStreaming] Token preview:", token?.substring(0, 20) + "...")

      const response = await fetch("/api/v1/users/me/automation-streaming", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      console.log("[AutomationStreaming] Response status:", response.status)
      console.log("[AutomationStreaming] Response ok:", response.ok)

      if (response.ok) {
        const data = await response.json()
        console.log("[AutomationStreaming] Settings loaded:", data)
        setSettings(data)
      } else {
        const errorText = await response.text()
        console.error("[AutomationStreaming] API error:", response.status, errorText)
        toast.error("Failed to load streaming settings")
      }
    } catch (error) {
      console.error("[AutomationStreaming] Exception:", error)
      toast.error("Failed to load streaming settings")
    } finally {
      setLoading(false)
    }
  }

  const toggleStreaming = async (enabled: boolean) => {
    try {
      setUpdating(true)
      const response = await fetch("/api/v1/users/me/automation-streaming/toggle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("access_token")}`,
        },
        body: JSON.stringify({ enabled }),
      })

      if (response.ok) {
        const data = await response.json()
        setSettings(data)
        toast.success(`Streaming ${enabled ? "enabled" : "disabled"} successfully`)
      } else {
        toast.error("Failed to update streaming settings")
      }
    } catch (error) {
      console.error("Failed to toggle streaming:", error)
      toast.error("Failed to update streaming settings")
    } finally {
      setUpdating(false)
    }
  }

  const resetLimit = async () => {
    try {
      setUpdating(true)
      const response = await fetch("/api/v1/users/me/automation-streaming/reset-limit", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("access_token")}`,
        },
      })

      if (response.ok) {
        const data = await response.json()
        setSettings(data)
        toast.success("Session limit reset successfully")
      } else {
        toast.error("Failed to reset session limit")
      }
    } catch (error) {
      console.error("Failed to reset limit:", error)
      toast.error("Failed to reset session limit")
    } finally {
      setUpdating(false)
    }
  }

  if (loading) {
    return (
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-xl">Automation Streaming</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (!settings) {
    return null
  }

  const usagePercentage = settings.sessions_limit
    ? (settings.sessions_used / settings.sessions_limit) * 100
    : 0

  const resetDate = settings.sessions_reset_at
    ? new Date(settings.sessions_reset_at).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null

  const isFreeUser = settings.sessions_limit !== null

  return (
    <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <Wifi className="w-5 h-5 text-[#00D9FF]" />
              <CardTitle className="text-xl">Automation Streaming</CardTitle>
            </div>
            <CardDescription>
              {context === 'connect-runner'
                ? 'Enable streaming to send automation data from the runner to the web interface'
                : 'Real-time automation monitoring via WebSocket'}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="streaming-toggle" className="text-gray-400">
              {settings.enabled ? "Enabled" : "Disabled"}
            </Label>
            <Switch
              id="streaming-toggle"
              checked={settings.enabled}
              onCheckedChange={toggleStreaming}
              disabled={updating}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {settings.enabled && (
          <>
            <Alert className="bg-[#00D9FF]/10 border-[#00D9FF]/30">
              <Info className="w-4 h-4 text-[#00D9FF]" />
              <AlertDescription className="text-gray-300">
                WebSocket streaming sends automation logs, screenshots, and events to the web
                interface for real-time monitoring and integration testing.
              </AlertDescription>
            </Alert>

            {isFreeUser && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Session Usage</span>
                  <span className="font-medium text-white">
                    {settings.sessions_used} / {settings.sessions_limit} sessions
                  </span>
                </div>
                <Progress value={usagePercentage} className="h-2" />
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>Free tier limit</span>
                  {resetDate && <span>Resets on {resetDate}</span>}
                </div>
                {settings.sessions_used >= (settings.sessions_limit || 0) && (
                  <Alert className="bg-yellow-500/10 border-yellow-500/30">
                    <Info className="w-4 h-4 text-yellow-500" />
                    <AlertDescription className="text-gray-300">
                      You've reached your monthly streaming limit. Upgrade to a paid plan for
                      unlimited sessions.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            {!isFreeUser && (
              <div className="text-center py-4">
                <div className="text-sm text-gray-400">
                  Unlimited streaming sessions available
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {settings.sessions_used} sessions used this month
                </div>
              </div>
            )}
          </>
        )}

        {!settings.enabled && (
          <div className="text-sm text-gray-400 py-2">
            Enable streaming to send automation data to the web interface for real-time monitoring
            and integration testing.
          </div>
        )}
      </CardContent>
    </Card>
  )
}
