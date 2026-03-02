"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StateImageCreationDialog } from "./StateImageCreationDialog";
import { Play, RefreshCw, Download, BarChart3 } from "lucide-react";
import { useAnalysisPanelState } from "./_hooks/useAnalysisPanelState";
import { OverviewTab } from "./_components/OverviewTab";
import { PatternsTab } from "./_components/PatternsTab";
import { StrategiesTab } from "./_components/StrategiesTab";
import { SimilarityTab } from "./_components/SimilarityTab";

export function AnalysisPanel() {
  const {
    analysis,
    isAnalyzing,
    updatePattern,
    evaluations,
    selectedStrategy,
    selectStrategy,
    evaluating,
    activeTab,
    setActiveTab,
    selectedPatterns,
    setSelectedPatterns,
    showStateImageDialog,
    setShowStateImageDialog,
    handleStartAnalysis,
    handleEvaluateStrategy,
    handleCreateStateImages,
    handleStateImageCreation,
    canAnalyze,
    strategyTypes,
    bestStrategy,
  } = useAnalysisPanelState();

  return (
    <div className="flex flex-col h-full space-y-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <h3 className="text-sm font-medium">Analysis & Results</h3>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleStartAnalysis}
            disabled={!canAnalyze || isAnalyzing}
            className="border-border-default hover:border-brand-primary"
          >
            {isAnalyzing ? (
              <>
                <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Play className="w-3 h-3 mr-1" />
                Analyze
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleCreateStateImages}
            disabled={
              !selectedStrategy || !analysis || selectedPatterns.size === 0
            }
            className="border-border-default hover:border-brand-secondary"
            title={
              selectedPatterns.size === 0
                ? "Select patterns first"
                : "Create StateImages from selected patterns"
            }
          >
            <Download className="w-3 h-3 mr-1" />
            Create StateImages
          </Button>
        </div>
      </div>

      {!analysis ? (
        <Card className="flex-1 flex items-center justify-center bg-surface-raised/50 border-border-default">
          <div className="text-center">
            <BarChart3 className="w-12 h-12 mx-auto mb-2 text-text-muted" />
            <p className="text-sm text-text-muted">
              Run analysis to see results
            </p>
          </div>
        </Card>
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <TabsList className="grid grid-cols-4 w-full bg-surface-raised border-b border-border-subtle flex-shrink-0">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="patterns">Patterns</TabsTrigger>
            <TabsTrigger value="strategies">Strategies</TabsTrigger>
            <TabsTrigger value="similarity">Similarity</TabsTrigger>
          </TabsList>

          <TabsContent
            value="overview"
            className="flex-1 space-y-4 overflow-y-auto p-2"
          >
            <OverviewTab
              analysis={analysis}
              bestStrategy={bestStrategy}
              selectStrategy={selectStrategy}
            />
          </TabsContent>

          <TabsContent
            value="patterns"
            className="flex-1 space-y-2 overflow-y-auto p-2"
          >
            <PatternsTab
              patterns={analysis.extractedPatterns}
              selectedPatterns={selectedPatterns}
              setSelectedPatterns={setSelectedPatterns}
              updatePattern={updatePattern}
            />
          </TabsContent>

          <TabsContent
            value="strategies"
            className="flex-1 space-y-2 overflow-y-auto p-2"
          >
            <StrategiesTab
              strategyTypes={strategyTypes}
              evaluations={evaluations}
              selectedStrategy={selectedStrategy}
              selectStrategy={selectStrategy}
              evaluating={evaluating}
              handleEvaluateStrategy={handleEvaluateStrategy}
              analysis={analysis}
            />
          </TabsContent>

          <TabsContent
            value="similarity"
            className="flex-1 overflow-y-auto p-2"
          >
            <SimilarityTab analysis={analysis} />
          </TabsContent>
        </Tabs>
      )}

      {/* StateImage Creation Dialog */}
      {showStateImageDialog && analysis && selectedStrategy && (
        <StateImageCreationDialog
          isOpen={showStateImageDialog}
          onClose={() => setShowStateImageDialog(false)}
          patterns={analysis.extractedPatterns.filter((p) =>
            selectedPatterns.has(p.id)
          )}
          strategy={selectedStrategy}
          onCreateStateImage={handleStateImageCreation}
        />
      )}
    </div>
  );
}
