"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Database, Globe, AlertCircle } from "lucide-react";
import { VariableHistory } from "./VariableHistory";
import { useVariableMonitorState } from "./_hooks/useVariableMonitorState";
import type { VariableMonitorTab } from "./_hooks/useVariableMonitorState";
import { VariableTable } from "./_components/VariableRow";
import { VariableMonitorHeader } from "./_components/VariableMonitorHeader";
import { VariableMonitorToolbar } from "./_components/VariableMonitorToolbar";

interface VariableMonitorProps {
  runId: string;
  refreshInterval?: number;
  defaultTab?: VariableMonitorTab;
  onRefreshIntervalChange?: (interval: number) => void;
}

export function VariableMonitor({
  runId,
  refreshInterval = 1000,
  defaultTab = "current",
  onRefreshIntervalChange,
}: VariableMonitorProps) {
  const state = useVariableMonitorState({
    runId,
    refreshInterval,
    defaultTab,
    onRefreshIntervalChange,
  });

  if (state.isLoading) {
    return (
      <Card className="bg-surface-raised border-border-subtle p-8">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-brand-primary" />
          <span className="ml-3 text-text-muted">Loading variables...</span>
        </div>
      </Card>
    );
  }

  if (state.error) {
    return (
      <Card className="bg-surface-raised border-border-subtle p-8">
        <div className="flex items-center justify-center py-12 text-center">
          <AlertCircle className="w-8 h-8 text-red-500 mr-3" />
          <div>
            <p className="text-red-500 font-medium">Failed to load variables</p>
            <p className="text-sm text-text-muted mt-2">
              {(state.error as Error).message}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => state.refetch()}
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
    <Card className="bg-surface-raised border-border-subtle">
      <VariableMonitorHeader
        isRefreshing={state.isRefreshing}
        isFetching={state.isFetching}
        refreshInterval={state.refreshInterval}
        onToggleRefresh={state.toggleRefresh}
        onRefetch={() => state.refetch()}
        onExport={state.handleExport}
      />

      <Tabs
        value={state.activeTab}
        onValueChange={(v) => state.setActiveTab(v as VariableMonitorTab)}
        className="flex-1"
      >
        <div className="border-b border-border-subtle px-6">
          <TabsList className="bg-transparent p-0 h-auto gap-1">
            <TabsTrigger
              value="current"
              className="data-[state=active]:bg-brand-primary/10 data-[state=active]:text-brand-primary rounded-t-md"
            >
              Current Values
              <Badge variant="secondary" className="ml-2">
                {state.filteredVariables.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="data-[state=active]:bg-brand-primary/10 data-[state=active]:text-brand-primary rounded-t-md"
            >
              Change History
              <Badge variant="secondary" className="ml-2">
                {state.history.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="global"
              className="data-[state=active]:bg-brand-primary/10 data-[state=active]:text-brand-primary rounded-t-md"
            >
              Global Variables
              <Badge variant="secondary" className="ml-2">
                {state.globalVariables.length}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="current" className="p-6">
          <VariableMonitorToolbar
            searchTerm={state.searchTerm}
            onSearchChange={state.setSearchTerm}
            scopeFilter={state.scopeFilter}
            onScopeFilterChange={state.setScopeFilter}
          />
          <ScrollArea className="h-[500px]">
            <VariableTable
              variables={state.filteredVariables}
              emptyIcon={<Database className="w-16 h-16" />}
              emptyTitle={
                state.searchTerm ? "No matching variables" : "No variables"
              }
              emptyDescription={
                state.searchTerm
                  ? "Try a different search term"
                  : "Variables will appear here during workflow execution"
              }
            />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="history" className="p-6">
          <VariableHistory
            runId={runId}
            refreshInterval={state.isRefreshing ? refreshInterval : 0}
          />
        </TabsContent>

        <TabsContent value="global" className="p-6">
          <ScrollArea className="h-[500px]">
            <VariableTable
              variables={state.globalVariables}
              emptyIcon={<Globe className="w-16 h-16" />}
              emptyTitle="No global variables"
              emptyDescription="Global variables are shared across all workflow executions"
            />
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </Card>
  );
}
