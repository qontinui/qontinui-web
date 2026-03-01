import React from "react";
import { Calendar, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DashboardHeaderProps {
  onTimeRangeChange: (preset: string) => void;
  onRefresh?: () => void;
  onExport: () => void;
}

export function DashboardHeader({
  onTimeRangeChange,
  onRefresh,
  onExport,
}: DashboardHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">
          Analytics Dashboard
        </h2>
        <p className="text-muted-foreground">
          Monitor workflow performance and execution metrics
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Select onValueChange={onTimeRangeChange} defaultValue="week">
          <SelectTrigger className="w-[180px]">
            <Calendar className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Select time range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="week">Last 7 days</SelectItem>
            <SelectItem value="month">Last 30 days</SelectItem>
            <SelectItem value="quarter">Last 3 months</SelectItem>
            <SelectItem value="year">Last year</SelectItem>
            <SelectItem value="custom">Custom range...</SelectItem>
          </SelectContent>
        </Select>
        {onRefresh && (
          <Button
            variant="outline"
            size="icon"
            onClick={onRefresh}
            title="Refresh data"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        )}
        <Button variant="outline" onClick={onExport}>
          <Download className="h-4 w-4 mr-2" />
          Export
        </Button>
      </div>
    </div>
  );
}
