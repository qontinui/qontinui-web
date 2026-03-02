"use client";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RefreshCw, Download, Database } from "lucide-react";

interface VariableMonitorHeaderProps {
  isRefreshing: boolean;
  isFetching: boolean;
  refreshInterval: number;
  onToggleRefresh: () => void;
  onRefetch: () => void;
  onExport: () => void;
}

export function VariableMonitorHeader({
  isRefreshing,
  isFetching,
  refreshInterval,
  onToggleRefresh,
  onRefetch,
  onExport,
}: VariableMonitorHeaderProps) {
  return (
    <div className="flex items-center justify-between p-6 border-b border-border-subtle">
      <div>
        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
          <Database className="w-5 h-5 text-brand-primary" />
          Variable Monitor
        </h2>
        <p className="text-sm text-text-muted mt-1">
          Real-time tracking of workflow variables
        </p>
      </div>

      <div className="flex items-center gap-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isRefreshing ? "default" : "outline"}
                size="sm"
                onClick={onToggleRefresh}
                className="gap-2"
              >
                <RefreshCw
                  className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`}
                />
                {isRefreshing ? "Auto-refresh ON" : "Auto-refresh OFF"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isRefreshing ? "Disable" : "Enable"} auto-refresh (
              {refreshInterval}ms)
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={onRefetch}
                disabled={isFetching}
              >
                <RefreshCw
                  className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh now</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onClick={onExport}>
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
            </TooltipTrigger>
            <TooltipContent>Export variables as JSON</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
