"use client";

import React, { useState } from "react";
import { useAutomation } from "@/contexts/automation-context";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, XCircle, Clock, AlertCircle } from "lucide-react";
import type { ExecutionRecord } from "@/contexts/automation-context";

export function ExecutionHistory() {
  const { executionRecords, schedules, workflows } = useAutomation();
  const [selectedScheduleFilter, setSelectedScheduleFilter] =
    useState<string>("all");
  const [selectedStatusFilter, setSelectedStatusFilter] =
    useState<string>("all");

  const getScheduleName = (scheduleId: string): string => {
    const schedule = schedules.find((s) => s.id === scheduleId);
    return schedule?.name || scheduleId;
  };

  const getProcessName = (processId: string): string => {
    const workflow = workflows.find((w) => w.id === processId);
    return workflow?.name || processId;
  };

  const formatDuration = (record: ExecutionRecord): string => {
    if (!record.endTime) {
      return "In progress...";
    }
    const duration = record.endTime.getTime() - record.startTime.getTime();
    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const filteredRecords = executionRecords.filter((record) => {
    if (
      selectedScheduleFilter !== "all" &&
      record.scheduleId !== selectedScheduleFilter
    ) {
      return false;
    }
    if (selectedStatusFilter !== "all") {
      if (selectedStatusFilter === "success" && !record.success) return false;
      if (selectedStatusFilter === "failed" && record.success) return false;
    }
    return true;
  });

  const sortedRecords = [...filteredRecords].sort(
    (a, b) => b.startTime.getTime() - a.startTime.getTime()
  );

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-4">
        <div className="flex-1">
          <Select
            value={selectedScheduleFilter}
            onValueChange={setSelectedScheduleFilter}
          >
            <SelectTrigger>
              <SelectValue placeholder="Filter by schedule" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Schedules</SelectItem>
              {schedules.map((schedule) => (
                <SelectItem key={schedule.id} value={schedule.id}>
                  {schedule.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1">
          <Select
            value={selectedStatusFilter}
            onValueChange={setSelectedStatusFilter}
          >
            <SelectTrigger>
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Execution Records */}
      <ScrollArea className="h-[550px]">
        <div className="space-y-3">
          {sortedRecords.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center text-muted-foreground">
                <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No execution history available.</p>
                <p className="text-sm mt-2">
                  {selectedScheduleFilter !== "all" ||
                  selectedStatusFilter !== "all"
                    ? "Try adjusting your filters."
                    : "Executions will appear here once schedules run."}
                </p>
              </CardContent>
            </Card>
          ) : (
            sortedRecords.map((record) => (
              <Card key={record.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-base flex items-center gap-2">
                        {record.success ? (
                          <CheckCircle2 className="h-5 w-5 text-green-600" />
                        ) : (
                          <XCircle className="h-5 w-5 text-red-600" />
                        )}
                        {getScheduleName(record.scheduleId)}
                      </CardTitle>
                      <CardDescription className="text-sm mt-1">
                        Process: {getProcessName(record.processId)}
                      </CardDescription>
                    </div>
                    <Badge variant={record.success ? "default" : "destructive"}>
                      {record.success ? "Success" : "Failed"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-muted-foreground">Started:</span>
                      <p className="font-medium">
                        {record.startTime.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Duration:</span>
                      <p className="font-medium">{formatDuration(record)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Iterations:</span>
                      <p className="font-medium">{record.iterationCount}</p>
                    </div>
                    {record.endTime && (
                      <div>
                        <span className="text-muted-foreground">Ended:</span>
                        <p className="font-medium">
                          {record.endTime.toLocaleString()}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Errors */}
                  {record.errors.length > 0 && (
                    <div className="mt-3 pt-3 border-t">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="h-4 w-4 text-red-600" />
                        <span className="text-sm font-medium text-red-600">
                          Errors:
                        </span>
                      </div>
                      <div className="space-y-1">
                        {record.errors.map((error, index) => (
                          <p
                            key={index}
                            className="text-sm text-muted-foreground bg-red-50 dark:bg-red-950 p-2 rounded"
                          >
                            {error}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Metadata */}
                  {Object.keys(record.metadata).length > 0 && (
                    <div className="mt-3 pt-3 border-t">
                      <span className="text-sm font-medium">Metadata:</span>
                      <div className="mt-1 space-y-1">
                        {Object.entries(record.metadata).map(([key, value]) => (
                          <div
                            key={key}
                            className="text-sm flex justify-between"
                          >
                            <span className="text-muted-foreground">
                              {key}:
                            </span>
                            <span className="font-medium">{String(value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
