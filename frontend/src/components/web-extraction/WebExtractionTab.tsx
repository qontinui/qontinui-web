"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWebExtractionState } from "./_hooks";
import type { MainTab } from "./_hooks";
import { ConfigurationTabContent } from "./_components/ConfigurationTabContent";
import { ResultsTabContent } from "./_components/ResultsTabContent";

export default function WebExtractionTab() {
  const state = useWebExtractionState();

  const {
    projectId,
    extractions,
    createExtraction,
    extractionConfig,
    isDeletingAll,
    mainTab,
    setMainTab,
    configSubTab,
    setConfigSubTab,
    resultsSubTab,
    setResultsSubTab,
    playwrightJob,
    isStartingPlaywright,
    isPollingPlaywright,
    playwrightResults,
    activeExtractionId,
    extractionDetail,
    annotations,
    transitions,
    isLoadingDetail,
    visionResults,
    isRunningVision,
    selectedScreenshotForVision,
    stateMachineStates,
    rootRef,
    containerRef,
    tabsRef,
    contentRef,
    handleInitiateGlobalExtraction,
    handleSelectPreviousExtraction,
    handleDeleteExtraction,
    handleDeleteAllExtractions,
    handleStartPlaywrightExtraction,
    handleRunVisionExtraction,
  } = state;

  if (!projectId) {
    return (
      <div className="p-8">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please select a project to use web extraction.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Check if there's an active or completed extraction to show results
  const hasActiveExtraction = !!activeExtractionId;
  const extractionIsComplete = extractionDetail?.status === "completed";

  return (
    <div
      ref={rootRef}
      className="layout-full-height bg-surface-canvas relative web-extraction-root"
    >
      {/* Background dot grid pattern */}
      <div
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle, oklch(0.3 0.1 270) 1px, transparent 1px)`,
          backgroundSize: "24px 24px",
        }}
      />

      {/* Main content */}
      <div className="relative z-10 layout-full-height">
        {/* Header */}
        <header className="border-b border-brand-primary/20 bg-surface-canvas/90 backdrop-blur-sm shrink-0">
          <div className="container mx-auto px-6 py-4">
            <div className="flex items-center gap-3">
              <span className="text-sm text-brand-primary/60 font-mono uppercase tracking-widest pt-1">
                Web Extraction
              </span>
            </div>
          </div>
        </header>

        {/* Tabs & Content */}
        <div
          ref={containerRef}
          className="container mx-auto px-6 py-6 layout-full-height"
        >
          <Tabs
            ref={tabsRef}
            value={mainTab}
            onValueChange={(v) => setMainTab(v as MainTab)}
            className="w-full layout-full-height"
          >
            <div className="flex items-center gap-3 mb-6 shrink-0">
              <TabsList className="bg-surface-raised/80 border border-brand-primary/20 p-1 backdrop-blur-sm h-11">
                <TabsTrigger
                  value="configuration"
                  className="data-[state=active]:bg-brand-primary/20 data-[state=active]:text-brand-primary data-[state=active]:shadow-[0_0_20px_rgba(0,217,255,0.3)] font-mono px-6 h-9 transition-all"
                >
                  Configuration
                </TabsTrigger>
                <TabsTrigger
                  value="results"
                  className="data-[state=active]:bg-brand-secondary/20 data-[state=active]:text-brand-secondary data-[state=active]:shadow-[0_0_20px_rgba(189,0,255,0.3)] font-mono px-6 h-9 transition-all"
                >
                  Results
                  {hasActiveExtraction && extractionDetail && (
                    <Badge
                      variant={
                        extractionDetail?.status === "completed"
                          ? "default"
                          : extractionDetail?.status === "failed"
                            ? "destructive"
                            : "secondary"
                      }
                      className="ml-2 scale-75 origin-left"
                    >
                      {extractionDetail?.status}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              <Button
                onClick={handleInitiateGlobalExtraction}
                disabled={createExtraction.isPending}
                className="bg-brand-primary/10 text-brand-primary hover:bg-brand-primary/20 border border-brand-primary/40 font-mono h-11 px-6 shadow-[0_0_15px_rgba(0,217,255,0.1)] hover:shadow-[0_0_20px_rgba(0,217,255,0.2)] transition-all"
              >
                {createExtraction.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    EXTRACTING...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2 fill-current" />
                    Start Extraction
                  </>
                )}
              </Button>
            </div>

            {/* Configuration Tab */}
            <TabsContent
              value="configuration"
              className="mt-0 layout-full-height data-[state=inactive]:hidden"
            >
              <ConfigurationTabContent
                contentRef={contentRef}
                configSubTab={configSubTab}
                setConfigSubTab={setConfigSubTab}
                extractionConfig={extractionConfig}
                playwrightJob={playwrightJob}
                isStartingPlaywright={isStartingPlaywright}
                isPollingPlaywright={isPollingPlaywright}
                onStartPlaywrightExtraction={handleStartPlaywrightExtraction}
                extractions={extractions}
                activeExtractionId={activeExtractionId}
                isDeletingAll={isDeletingAll}
                onSelectExtraction={handleSelectPreviousExtraction}
                onDeleteExtraction={handleDeleteExtraction}
                onDeleteAllExtractions={handleDeleteAllExtractions}
              />
            </TabsContent>

            {/* Results Tab */}
            <TabsContent
              value="results"
              className="mt-0 layout-full-height gap-4 data-[state=inactive]:hidden"
            >
              <ResultsTabContent
                hasActiveExtraction={hasActiveExtraction}
                isLoadingDetail={isLoadingDetail}
                extractionDetail={extractionDetail}
                extractionIsComplete={extractionIsComplete}
                resultsSubTab={resultsSubTab}
                setResultsSubTab={setResultsSubTab}
                setMainTab={setMainTab}
                setConfigSubTab={setConfigSubTab}
                stateMachineStates={stateMachineStates}
                annotations={annotations}
                activeExtractionId={activeExtractionId}
                transitions={transitions}
                visionResults={visionResults}
                isRunningVision={isRunningVision}
                selectedScreenshotForVision={selectedScreenshotForVision}
                onRunVisionExtraction={handleRunVisionExtraction}
                playwrightJob={playwrightJob}
                playwrightResults={playwrightResults}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
