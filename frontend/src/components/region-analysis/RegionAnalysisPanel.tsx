"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Loader2, Grid3x3 } from "lucide-react";
import { useRegionAnalysisPanel } from "./_hooks/useRegionAnalysisPanel";
import { AnalyzerSelector } from "./_components/AnalyzerSelector";
import { AnalysisOptions } from "./_components/AnalysisOptions";
import { AnalysisActions } from "./_components/AnalysisActions";
import type { RegionAnalysisPanelProps } from "./types";

export function RegionAnalysisPanel({
  annotationSetId,
  token,
  onAnalysisComplete,
}: RegionAnalysisPanelProps) {
  const {
    analyzers,
    selectedAnalyzers,
    analyzerConfigs,
    isLoadingAnalyzers,
    isRunning,
    fuseResults,
    setFuseResults,
    saveToDatabase,
    setSaveToDatabase,
    overlapThreshold,
    setOverlapThreshold,
    runInParallel,
    setRunInParallel,
    toggleAnalyzer,
    selectAll,
    clearAll,
    updateAnalyzerConfig,
    handleRunAnalysis,
    handleQuickAnalysis,
  } = useRegionAnalysisPanel({ annotationSetId, token, onAnalysisComplete });

  if (isLoadingAnalyzers) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Grid3x3 className="h-5 w-5" />
          Region Analysis Configuration
        </CardTitle>
        <CardDescription>
          Select region analyzers and configure parameters to detect UI regions
          and grids
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <AnalyzerSelector
          analyzers={analyzers}
          selectedAnalyzers={selectedAnalyzers}
          analyzerConfigs={analyzerConfigs}
          onToggleAnalyzer={toggleAnalyzer}
          onSelectAll={selectAll}
          onClearAll={clearAll}
          onUpdateConfig={updateAnalyzerConfig}
        />

        <Separator />

        <AnalysisOptions
          fuseResults={fuseResults}
          onFuseResultsChange={setFuseResults}
          overlapThreshold={overlapThreshold}
          onOverlapThresholdChange={setOverlapThreshold}
          runInParallel={runInParallel}
          onRunInParallelChange={setRunInParallel}
          saveToDatabase={saveToDatabase}
          onSaveToDatabaseChange={setSaveToDatabase}
        />

        <Separator />

        <AnalysisActions
          isRunning={isRunning}
          selectedCount={selectedAnalyzers.size}
          onRunAnalysis={handleRunAnalysis}
          onQuickAnalysis={handleQuickAnalysis}
        />
      </CardContent>
    </Card>
  );
}
