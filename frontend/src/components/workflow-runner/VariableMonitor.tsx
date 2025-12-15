"use client";

/**
 * VariableMonitor - Real-time workflow variable monitoring component
 *
 * Features:
 * - Tabbed interface (Current Values, Change History, Global Variables)
 * - Table view with name, value, scope, and last updated
 * - JSON syntax highlighting for complex values
 * - Scope badges with different colors
 * - Auto-refresh with configurable interval
 * - Search/filter variables by name
 * - Expandable JSON values for objects/arrays
 * - Copy value to clipboard
 * - Export variables as JSON
 */

import { useState, useMemo } from "react";
import {
  useWorkflowVariables,
  formatVariableValue,
} from "@/hooks/useWorkflowVariables";
import type {
  WorkflowVariable,
  VariableScope,
} from "@/types/workflow-variables";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Search,
  Copy,
  Download,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Loader2,
  Activity,
  Database,
  Globe,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { VariableHistory } from "./VariableHistory";

interface VariableMonitorProps {
  /** Workflow run ID */
  runId: string;

  /** Auto-refresh interval in milliseconds (default: 1000ms, 0 = disabled) */
  refreshInterval?: number;

  /** Initial tab (default: "current") */
  defaultTab?: "current" | "history" | "global";

  /** Callback when refresh interval changes */
  onRefreshIntervalChange?: (interval: number) => void;
}

/**
 * Get badge variant for variable scope
 */
function getScopeBadgeVariant(
  scope: VariableScope
): "default" | "secondary" | "outline" {
  switch (scope) {
    case "execution":
      return "default"; // Cyan
    case "workflow":
      return "secondary"; // Gray
    case "global":
      return "outline"; // White outline
    default:
      return "default";
  }
}

/**
 * Get icon for variable scope
 */
function getScopeIcon(scope: VariableScope) {
  switch (scope) {
    case "execution":
      return <Activity className="w-3 h-3" />;
    case "workflow":
      return <Database className="w-3 h-3" />;
    case "global":
      return <Globe className="w-3 h-3" />;
    default:
      return null;
  }
}

/**
 * Format timestamp as relative time
 */
function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 1) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;

  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

/**
 * VariableRow - Displays a single variable with expandable JSON
 */
function VariableRow({ variable }: { variable: WorkflowVariable }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isComplex =
    typeof variable.value === "object" && variable.value !== null;

  const handleCopy = async () => {
    try {
      const text =
        typeof variable.value === "object"
          ? JSON.stringify(variable.value, null, 2)
          : String(variable.value);
      await navigator.clipboard.writeText(text);
      toast.success(`Copied "${variable.name}" to clipboard`);
    } catch (error) {
      toast.error("Failed to copy to clipboard");
    }
  };

  return (
    <>
      <TableRow className="hover:bg-gray-800/50 transition-colors">
        {/* Expand button for complex values */}
        <TableCell className="w-8">
          {isComplex && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="h-6 w-6 p-0"
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </Button>
          )}
        </TableCell>

        {/* Variable name */}
        <TableCell className="font-mono text-sm text-white">
          {variable.name}
        </TableCell>

        {/* Variable value */}
        <TableCell className="max-w-md">
          <div className="font-mono text-sm text-gray-300 truncate">
            {formatVariableValue(variable.value, 80)}
          </div>
        </TableCell>

        {/* Scope badge */}
        <TableCell>
          <Badge
            variant={getScopeBadgeVariant(variable.scope)}
            className="gap-1"
          >
            {getScopeIcon(variable.scope)}
            {variable.scope}
          </Badge>
        </TableCell>

        {/* Type */}
        <TableCell className="text-sm text-gray-400">{variable.type}</TableCell>

        {/* Last updated */}
        <TableCell className="text-sm text-gray-400">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                {formatRelativeTime(variable.last_updated)}
              </TooltipTrigger>
              <TooltipContent>
                {new Date(variable.last_updated).toLocaleString()}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </TableCell>

        {/* Actions */}
        <TableCell className="text-right">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopy}
                  className="h-8 w-8 p-0"
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy value</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </TableCell>
      </TableRow>

      {/* Expanded JSON view */}
      {isExpanded && isComplex && (
        <TableRow>
          <TableCell colSpan={7} className="bg-gray-900/50 p-4">
            <pre className="text-xs text-gray-300 overflow-x-auto">
              {JSON.stringify(variable.value, null, 2)}
            </pre>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export function VariableMonitor({
  runId,
  refreshInterval = 1000,
  defaultTab = "current",
  onRefreshIntervalChange,
}: VariableMonitorProps) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [searchTerm, setSearchTerm] = useState("");
  const [scopeFilter, setScopeFilter] = useState<VariableScope | "all">("all");
  const [isRefreshing, setIsRefreshing] = useState(true);

  const {
    flattenedVariables,
    variablesSnapshot,
    history,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useWorkflowVariables(runId, isRefreshing ? refreshInterval : 0);

  // Filter variables
  const filteredVariables = useMemo(() => {
    return flattenedVariables.filter((variable) => {
      // Search filter
      if (
        searchTerm &&
        !variable.name.toLowerCase().includes(searchTerm.toLowerCase())
      ) {
        return false;
      }

      // Scope filter
      if (scopeFilter !== "all" && variable.scope !== scopeFilter) {
        return false;
      }

      return true;
    });
  }, [flattenedVariables, searchTerm, scopeFilter]);

  // Separate variables by scope for the global tab
  const globalVariables = useMemo(() => {
    return flattenedVariables.filter((v) => v.scope === "global");
  }, [flattenedVariables]);

  // Handle export
  const handleExport = () => {
    try {
      const exportData = {
        run_id: runId,
        exported_at: new Date().toISOString(),
        variables: variablesSnapshot,
        history: history,
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `workflow-variables-${runId}-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success("Variables exported successfully");
    } catch (error) {
      toast.error("Failed to export variables");
    }
  };

  // Toggle auto-refresh
  const toggleRefresh = () => {
    const newValue = !isRefreshing;
    setIsRefreshing(newValue);
    if (onRefreshIntervalChange) {
      onRefreshIntervalChange(newValue ? refreshInterval : 0);
    }
  };

  if (isLoading) {
    return (
      <Card className="bg-[#1A1A1B] border-gray-800 p-8">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-[#00D9FF]" />
          <span className="ml-3 text-gray-400">Loading variables...</span>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-[#1A1A1B] border-gray-800 p-8">
        <div className="flex items-center justify-center py-12 text-center">
          <AlertCircle className="w-8 h-8 text-red-500 mr-3" />
          <div>
            <p className="text-red-500 font-medium">Failed to load variables</p>
            <p className="text-sm text-gray-400 mt-2">
              {(error as Error).message}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="mt-4"
            >
              Retry
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="bg-[#1A1A1B] border-gray-800">
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-gray-800">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Database className="w-5 h-5 text-[#00D9FF]" />
            Variable Monitor
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            Real-time tracking of workflow variables
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* Auto-refresh toggle */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={isRefreshing ? "default" : "outline"}
                  size="sm"
                  onClick={toggleRefresh}
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

          {/* Manual refresh */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetch()}
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

          {/* Export */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={handleExport}>
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export variables as JSON</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as unknown)}
        className="flex-1"
      >
        <div className="border-b border-gray-800 px-6">
          <TabsList className="bg-transparent p-0 h-auto gap-1">
            <TabsTrigger
              value="current"
              className="data-[state=active]:bg-[#00D9FF]/10 data-[state=active]:text-[#00D9FF] rounded-t-md"
            >
              Current Values
              <Badge variant="secondary" className="ml-2">
                {filteredVariables.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="data-[state=active]:bg-[#00D9FF]/10 data-[state=active]:text-[#00D9FF] rounded-t-md"
            >
              Change History
              <Badge variant="secondary" className="ml-2">
                {history.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="global"
              className="data-[state=active]:bg-[#00D9FF]/10 data-[state=active]:text-[#00D9FF] rounded-t-md"
            >
              Global Variables
              <Badge variant="secondary" className="ml-2">
                {globalVariables.length}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Current Values Tab */}
        <TabsContent value="current" className="p-6">
          {/* Search and filters */}
          <div className="flex items-center gap-4 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search variables..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-gray-900 border-gray-700"
              />
            </div>

            {/* Scope filter */}
            <div className="flex gap-2">
              {(["all", "execution", "workflow", "global"] as const).map(
                (scope) => (
                  <Button
                    key={scope}
                    variant={scopeFilter === scope ? "default" : "outline"}
                    size="sm"
                    onClick={() => setScopeFilter(scope)}
                    className="capitalize"
                  >
                    {scope === "all" ? "All" : scope}
                  </Button>
                )
              )}
            </div>
          </div>

          {/* Variables table */}
          <ScrollArea className="h-[500px]">
            {filteredVariables.length === 0 ? (
              <div className="text-center py-12">
                <Database className="w-16 h-16 mx-auto text-gray-600 mb-4" />
                <h3 className="text-xl font-semibold text-gray-300 mb-2">
                  {searchTerm ? "No matching variables" : "No variables"}
                </h3>
                <p className="text-gray-400">
                  {searchTerm
                    ? "Try a different search term"
                    : "Variables will appear here during workflow execution"}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Last Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredVariables.map((variable) => (
                    <VariableRow
                      key={`${variable.scope}-${variable.name}`}
                      variable={variable}
                    />
                  ))}
                </TableBody>
              </Table>
            )}
          </ScrollArea>
        </TabsContent>

        {/* Change History Tab */}
        <TabsContent value="history" className="p-6">
          <VariableHistory
            runId={runId}
            refreshInterval={isRefreshing ? refreshInterval : 0}
          />
        </TabsContent>

        {/* Global Variables Tab */}
        <TabsContent value="global" className="p-6">
          <ScrollArea className="h-[500px]">
            {globalVariables.length === 0 ? (
              <div className="text-center py-12">
                <Globe className="w-16 h-16 mx-auto text-gray-600 mb-4" />
                <h3 className="text-xl font-semibold text-gray-300 mb-2">
                  No global variables
                </h3>
                <p className="text-gray-400">
                  Global variables are shared across all workflow executions
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Last Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {globalVariables.map((variable) => (
                    <VariableRow key={variable.name} variable={variable} />
                  ))}
                </TableBody>
              </Table>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </Card>
  );
}
