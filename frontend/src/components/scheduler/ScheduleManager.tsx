"use client"

import React, { useState } from "react"
import { useAutomation } from "@/contexts/automation-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Play, Pause, Trash2, Edit, Plus, Calendar, Clock, RefreshCw } from "lucide-react"
import { ScheduleEditor } from "./ScheduleEditor"
import { ExecutionHistory } from "./ExecutionHistory"
import type { Schedule } from "@/contexts/automation-context"

export function ScheduleManager() {
  const {
    schedules,
    processes,
    updateSchedule,
    deleteSchedule,
    getSchedulerStatistics,
  } = useAutomation()

  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [activeTab, setActiveTab] = useState("schedules")

  const stats = getSchedulerStatistics()

  const handleToggleEnabled = (schedule: Schedule) => {
    updateSchedule({ ...schedule, enabled: !schedule.enabled })
  }

  const handleEdit = (schedule: Schedule) => {
    setSelectedSchedule(schedule)
    setIsEditorOpen(true)
  }

  const handleDelete = (scheduleId: string) => {
    if (confirm("Are you sure you want to delete this schedule?")) {
      deleteSchedule(scheduleId)
    }
  }

  const handleCreateNew = () => {
    setSelectedSchedule(null)
    setIsEditorOpen(true)
  }

  const handleCloseEditor = () => {
    setIsEditorOpen(false)
    setSelectedSchedule(null)
  }

  const getTriggerDisplay = (schedule: Schedule): string => {
    switch (schedule.triggerType) {
      case "TIME":
        return schedule.cronExpression || "Not configured"
      case "INTERVAL":
        return `Every ${schedule.intervalSeconds || 0}s`
      case "STATE":
        return `State: ${schedule.triggerState || "Not configured"}`
      case "MANUAL":
        return "Manual only"
      default:
        return "Unknown"
    }
  }

  const getProcessName = (processId: string): string => {
    const process = processes.find(p => p.id === processId)
    return process?.name || processId
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">Schedule Manager</h2>
          <p className="text-muted-foreground">
            Manage automated process execution schedules
          </p>
        </div>
        <Button onClick={handleCreateNew}>
          <Plus className="h-4 w-4 mr-2" />
          New Schedule
        </Button>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Schedules
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalSchedules}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Schedules
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.activeSchedules}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Executions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalExecutions}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Success Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.totalExecutions > 0
                ? `${Math.round((stats.successfulExecutions / stats.totalExecutions) * 100)}%`
                : "N/A"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
        <TabsList>
          <TabsTrigger value="schedules">Schedules</TabsTrigger>
          <TabsTrigger value="history">Execution History</TabsTrigger>
        </TabsList>

        <TabsContent value="schedules" className="flex-1">
          <ScrollArea className="h-[600px]">
            <div className="space-y-4">
              {schedules.length === 0 ? (
                <Card>
                  <CardContent className="pt-6 text-center text-muted-foreground">
                    <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No schedules configured yet.</p>
                    <p className="text-sm mt-2">
                      Click "New Schedule" to create your first automated schedule.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                schedules.map((schedule) => (
                  <Card key={schedule.id}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="flex items-center gap-2">
                            {schedule.name}
                            <Badge variant={schedule.enabled ? "default" : "secondary"}>
                              {schedule.enabled ? "Enabled" : "Disabled"}
                            </Badge>
                            <Badge variant="outline">{schedule.triggerType}</Badge>
                          </CardTitle>
                          <CardDescription>
                            {schedule.description || "No description"}
                          </CardDescription>
                        </div>
                        <Switch
                          checked={schedule.enabled}
                          onCheckedChange={() => handleToggleEnabled(schedule)}
                        />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Process:</span>
                            <p className="font-medium">{getProcessName(schedule.processId)}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Trigger:</span>
                            <p className="font-medium flex items-center gap-2">
                              {schedule.triggerType === "TIME" && <Clock className="h-4 w-4" />}
                              {schedule.triggerType === "INTERVAL" && <RefreshCw className="h-4 w-4" />}
                              {getTriggerDisplay(schedule)}
                            </p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Check Mode:</span>
                            <p className="font-medium">{schedule.checkMode.replace("_", " ")}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Schedule Type:</span>
                            <p className="font-medium">{schedule.scheduleType.replace("_", " ")}</p>
                          </div>
                          {schedule.maxIterations && (
                            <div>
                              <span className="text-muted-foreground">Max Iterations:</span>
                              <p className="font-medium">{schedule.maxIterations}</p>
                            </div>
                          )}
                          {schedule.lastExecutedAt && (
                            <div>
                              <span className="text-muted-foreground">Last Executed:</span>
                              <p className="font-medium">
                                {new Date(schedule.lastExecutedAt).toLocaleString()}
                              </p>
                            </div>
                          )}
                        </div>

                        <div className="flex gap-2 pt-2 border-t">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEdit(schedule)}
                          >
                            <Edit className="h-4 w-4 mr-2" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDelete(schedule.id)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="history" className="flex-1">
          <ExecutionHistory />
        </TabsContent>
      </Tabs>

      {/* Schedule Editor Dialog */}
      {isEditorOpen && (
        <ScheduleEditor
          schedule={selectedSchedule}
          isOpen={isEditorOpen}
          onClose={handleCloseEditor}
        />
      )}
    </div>
  )
}
