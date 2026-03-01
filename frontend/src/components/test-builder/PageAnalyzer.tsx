"use client";

import {
  ScanSearch,
  Monitor,
  Network,
  Play,
  Trash2,
  AlertCircle,
  X,
  Check,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { usePageAnalyzer } from "./_hooks/usePageAnalyzer";
import { UIBridgeAnalysisTab } from "./_components/UIBridgeAnalysisTab";
import { VisionAnalysisTab } from "./_components/VisionAnalysisTab";
import { ApiRequestTab } from "./_components/ApiRequestTab";
import { StepOutputTab } from "./_components/StepOutputTab";
import { AnalysisResultsTable } from "./_components/AnalysisResultsTable";
import type { PageAnalyzerProps } from "./page-analyzer-types";

export type {
  BoundingBox,
  DetectedElement,
  PageAnalysis,
  UIBridgeElement,
  UIBridgeSnapshot,
  ApiRequestAnalysis,
  StepOutput,
  LiveBrowserElement,
  LiveBrowserAnalysis,
  AnalysisSourceType,
  CollectedAnalysis,
  CollectedAnalysisSet,
  AnalysisData,
  PageAnalyzerProps,
} from "./page-analyzer-types";

export function PageAnalyzer({
  onAnalysisComplete,
  onError,
  initialAnalyses,
}: PageAnalyzerProps) {
  const {
    analyses,
    expandedId,
    setExpandedId,
    activeTab,
    setActiveTab,
    isAnalyzing,
    error,
    setError,
    uiBridgeUrl,
    setUiBridgeUrl,
    uiBridgeTarget,
    setUiBridgeTarget,
    runUIBridgeAnalysis,
    selectedMonitor,
    setSelectedMonitor,
    runVisionAnalysis,
    savedRequests,
    selectedRequestId,
    setSelectedRequestId,
    loadingRequests,
    loadSavedRequests,
    runApiRequestAnalysis,
    taskRuns,
    selectedTaskRunId,
    setSelectedTaskRunId,
    loadingTaskRuns,
    loadTaskRuns,
    taskRunOutput,
    loadStepOutput,
    removeAnalysis,
    clearAll,
    getPromptContext,
  } = usePageAnalyzer({ onAnalysisComplete, onError, initialAnalyses });

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScanSearch className="size-5 text-brand-primary" />
          <h3 className="text-sm font-semibold text-text-primary">
            Page Analyzer
          </h3>
          {analyses.length > 0 && (
            <Badge variant="info">{analyses.length}</Badge>
          )}
        </div>
        {analyses.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-red-400 hover:text-red-300"
            onClick={clearAll}
          >
            <Trash2 className="size-3.5 mr-1" />
            Clear All
          </Button>
        )}
      </div>

      {/* Analysis Method Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full">
          <TabsTrigger value="ui_bridge" className="flex-1 gap-1.5">
            <ScanSearch className="size-3.5" />
            UI Bridge
          </TabsTrigger>
          <TabsTrigger value="vision" className="flex-1 gap-1.5">
            <Monitor className="size-3.5" />
            Vision
          </TabsTrigger>
          <TabsTrigger value="api_request" className="flex-1 gap-1.5">
            <Network className="size-3.5" />
            API Request
          </TabsTrigger>
          <TabsTrigger value="step_output" className="flex-1 gap-1.5">
            <Play className="size-3.5" />
            Step Output
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ui_bridge" className="mt-3">
          <UIBridgeAnalysisTab
            uiBridgeUrl={uiBridgeUrl}
            setUiBridgeUrl={setUiBridgeUrl}
            uiBridgeTarget={uiBridgeTarget}
            setUiBridgeTarget={setUiBridgeTarget}
            isAnalyzing={isAnalyzing}
            onRun={runUIBridgeAnalysis}
          />
        </TabsContent>

        <TabsContent value="vision" className="mt-3">
          <VisionAnalysisTab
            selectedMonitor={selectedMonitor}
            setSelectedMonitor={setSelectedMonitor}
            isAnalyzing={isAnalyzing}
            onRun={runVisionAnalysis}
          />
        </TabsContent>

        <TabsContent value="api_request" className="mt-3">
          <ApiRequestTab
            savedRequests={savedRequests}
            selectedRequestId={selectedRequestId}
            setSelectedRequestId={setSelectedRequestId}
            loadingRequests={loadingRequests}
            isAnalyzing={isAnalyzing}
            onRefresh={loadSavedRequests}
            onRun={runApiRequestAnalysis}
          />
        </TabsContent>

        <TabsContent value="step_output" className="mt-3">
          <StepOutputTab
            taskRuns={taskRuns}
            selectedTaskRunId={selectedTaskRunId}
            setSelectedTaskRunId={setSelectedTaskRunId}
            loadingTaskRuns={loadingTaskRuns}
            isAnalyzing={isAnalyzing}
            taskRunOutput={taskRunOutput}
            onRefresh={loadTaskRuns}
            onRun={loadStepOutput}
          />
        </TabsContent>
      </Tabs>

      {/* Error Display */}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-red-500/30 bg-red-500/5">
          <AlertCircle className="size-4 text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-red-400">{error}</p>
          </div>
          <button
            onClick={() => setError(null)}
            className="p-0.5 text-red-400/60 hover:text-red-400"
          >
            <X className="size-3" />
          </button>
        </div>
      )}

      {/* Collected Analyses */}
      <AnalysisResultsTable
        analyses={analyses}
        expandedId={expandedId}
        setExpandedId={setExpandedId}
        removeAnalysis={removeAnalysis}
      />

      {/* Use in AI Generation Button */}
      {analyses.length > 0 && (
        <div className="border-t border-border-subtle/50 pt-3">
          <div className="flex items-center gap-2 mb-2">
            <Check className="size-4 text-green-400" />
            <span className="text-xs text-text-secondary">
              {analyses.length}{" "}
              {analyses.length === 1 ? "analysis" : "analyses"} ready for AI
              test generation
            </span>
          </div>
          <Button
            variant="brand-primary"
            size="sm"
            className="w-full gap-2"
            onClick={() => {
              const context = getPromptContext();
              navigator.clipboard.writeText(context).then(() => {
                // Could show a toast here
              });
              onAnalysisComplete({
                type: "collected",
                data: {
                  analyses,
                  collected_at: new Date().toISOString(),
                },
              });
            }}
          >
            <Sparkles className="size-3.5" />
            Use in AI Generation
          </Button>
          <p className="text-[10px] text-text-muted mt-1.5 text-center">
            Copies analysis context to clipboard and sends data to the AI
            generator.
          </p>
        </div>
      )}
    </div>
  );
}
