"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  AlertCircle,
  Layers,
  FileImage,
  GitBranch,
  Grid3X3,
  ScanLine,
  Type,
  MousePointerClick,
} from "lucide-react";
import { ExtractionProgressBar } from "../ExtractionProgressBar";
import { StateExplorerView } from "../StateExplorerView";
import { PageAnalysisView } from "../PageAnalysisView";
import { TransitionsView } from "../TransitionsView";
import { PlaywrightResultsView } from "../PlaywrightResultsView";
import { PlaywrightStateExplorerView } from "../PlaywrightStateExplorerView";
import { EdgeDetectionView } from "../../vision-extraction/EdgeDetectionView";
import { SAM3SegmentationView } from "../../vision-extraction/SAM3SegmentationView";
import { OCRDetectionView } from "../../vision-extraction/OCRDetectionView";
import { VisionExtractionPrompt } from "../VisionExtractionPrompt";
import type { VisionExtractionResponse } from "@/services/vision-extraction-service";
import type {
  ExtractionSessionDetail,
  ExtractionAnnotation,
} from "@/services/extraction-service";
import type { StateMachineState, InferredTransition } from "@/types/extraction";
import type {
  PlaywrightExtractionJob,
  PlaywrightExtractionResults,
} from "@/hooks/use-playwright-extraction";
import type { ResultsSubTab, MainTab, ConfigSubTab } from "../_hooks";

interface ResultsTabContentProps {
  hasActiveExtraction: boolean;
  isLoadingDetail: boolean;
  extractionDetail: ExtractionSessionDetail | null;
  extractionIsComplete: boolean;
  resultsSubTab: ResultsSubTab;
  setResultsSubTab: (tab: ResultsSubTab) => void;
  setMainTab: (tab: MainTab) => void;
  setConfigSubTab: (tab: ConfigSubTab) => void;
  stateMachineStates: StateMachineState[];
  annotations: ExtractionAnnotation[];
  activeExtractionId: string | null;
  transitions: InferredTransition[];
  visionResults: VisionExtractionResponse | null;
  isRunningVision: boolean;
  selectedScreenshotForVision: string | null;
  onRunVisionExtraction: (screenshotBase64: string) => void;
  playwrightJob: PlaywrightExtractionJob | null;
  playwrightResults: PlaywrightExtractionResults | null;
}

export function ResultsTabContent({
  hasActiveExtraction,
  isLoadingDetail,
  extractionDetail,
  extractionIsComplete,
  resultsSubTab,
  setResultsSubTab,
  setMainTab,
  setConfigSubTab,
  stateMachineStates,
  annotations,
  activeExtractionId,
  transitions,
  visionResults,
  isRunningVision,
  selectedScreenshotForVision,
  onRunVisionExtraction,
  playwrightJob,
  playwrightResults,
}: ResultsTabContentProps) {
  if (!hasActiveExtraction) {
    return (
      <div className="py-12">
        <Alert className="bg-surface-raised/60 border-brand-secondary/30 backdrop-blur-sm shadow-[0_0_15px_rgba(189,0,255,0.05)]">
          <AlertCircle className="h-4 w-4 text-brand-secondary" />
          <AlertDescription className="text-text-secondary font-mono">
            PROCESS HALTED: No active extraction detected. Initialize a scan or
            select a previous entry from the archive.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoadingDetail) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-brand-secondary" />
          <p className="text-brand-secondary font-mono animate-pulse uppercase tracking-widest text-xs">
            Synchronizing Buffer...
          </p>
        </div>
      </div>
    );
  }

  if (!extractionDetail) {
    return (
      <Alert className="bg-red-500/10 border-red-500/30">
        <AlertCircle className="h-4 w-4 text-red-500" />
        <AlertDescription className="text-red-400 font-mono">
          ERROR: Failed to retrieve extraction telemetry.
        </AlertDescription>
      </Alert>
    );
  }

  const extractionId =
    extractionDetail?.stats?.screenshot_extraction_id ||
    activeExtractionId ||
    undefined;

  return (
    <>
      {/* Extraction Progress Bar - single horizontal line */}
      <ExtractionProgressBar session={extractionDetail} />

      {/* Results Sub-tabs */}
      {extractionIsComplete && (
        <Tabs
          value={resultsSubTab}
          onValueChange={(v) => setResultsSubTab(v as ResultsSubTab)}
          className="layout-full-height"
        >
          <TabsList className="bg-surface-raised/80 border border-brand-success/20 p-1 backdrop-blur-sm w-fit mb-4">
            <TabsTrigger
              value="state-explorer"
              className="data-[state=active]:bg-brand-primary/20 data-[state=active]:text-brand-primary font-mono flex items-center gap-2"
            >
              <Layers className="h-4 w-4" />
              DOM States
            </TabsTrigger>
            <TabsTrigger
              value="page-analysis"
              className="data-[state=active]:bg-brand-success/20 data-[state=active]:text-brand-success font-mono flex items-center gap-2"
            >
              <FileImage className="h-4 w-4" />
              DOM Elements
            </TabsTrigger>
            <TabsTrigger
              value="transitions"
              className="data-[state=active]:bg-brand-secondary/20 data-[state=active]:text-brand-secondary font-mono flex items-center gap-2"
            >
              <GitBranch className="h-4 w-4" />
              Transitions
              {transitions.length > 0 && (
                <Badge
                  variant="outline"
                  className="ml-2 bg-brand-secondary/5 text-brand-secondary border-brand-secondary/20"
                >
                  {transitions.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="sam3"
              className="data-[state=active]:bg-brand-success/10 font-mono flex items-center gap-2"
            >
              <Grid3X3 className="h-4 w-4" />
              SAM3
              {visionResults && (
                <Badge
                  variant="outline"
                  className="ml-2 bg-brand-success/5 text-brand-success border-brand-success/20"
                >
                  {visionResults.sam3_results.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="edge"
              className="data-[state=active]:bg-brand-success/10 font-mono flex items-center gap-2"
            >
              <ScanLine className="h-4 w-4" />
              Edge
              {visionResults && (
                <Badge
                  variant="outline"
                  className="ml-2 bg-brand-success/5 text-brand-success border-brand-success/20"
                >
                  {visionResults.edge_results.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="ocr"
              className="data-[state=active]:bg-brand-success/10 font-mono flex items-center gap-2"
            >
              <Type className="h-4 w-4" />
              OCR
              {visionResults && (
                <Badge
                  variant="outline"
                  className="ml-2 bg-brand-success/5 text-brand-success border-brand-success/20"
                >
                  {visionResults.ocr_results.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="playwright"
              className="data-[state=active]:bg-green-500/20 data-[state=active]:text-green-400 font-mono flex items-center gap-2"
            >
              <MousePointerClick className="h-4 w-4" />
              State Collector
              {playwrightJob && (
                <Badge
                  variant={
                    playwrightJob.status === "completed"
                      ? "default"
                      : playwrightJob.status === "failed"
                        ? "destructive"
                        : "secondary"
                  }
                  className="ml-1 scale-75"
                >
                  {playwrightJob.status}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="state-explorer"
            className="flex-1 flex flex-col min-h-0 mt-0 data-[state=inactive]:hidden"
          >
            <StateExplorerView
              states={stateMachineStates}
              annotations={annotations}
              extractionId={extractionId}
            />
          </TabsContent>

          <TabsContent
            value="page-analysis"
            className="flex-1 flex flex-col min-h-0 mt-0 data-[state=inactive]:hidden"
          >
            <PageAnalysisView
              states={stateMachineStates}
              annotations={annotations}
              extractionId={extractionId}
            />
          </TabsContent>

          <TabsContent
            value="transitions"
            className="flex-1 flex flex-col min-h-0 mt-0 data-[state=inactive]:hidden"
          >
            <TransitionsView
              transitions={transitions}
              states={stateMachineStates}
            />
          </TabsContent>

          <TabsContent value="sam3" className="flex-1 min-h-0 mt-0">
            {visionResults ? (
              <SAM3SegmentationView
                screenshotSource={selectedScreenshotForVision || ""}
                segments={visionResults.sam3_results}
                maskOverlayImage={visionResults.sam3_overlay}
                imageWidth={visionResults.image_width}
                imageHeight={visionResults.image_height}
              />
            ) : (
              <VisionExtractionPrompt
                isRunning={isRunningVision}
                onRunExtraction={onRunVisionExtraction}
                extractionId={extractionId}
                technique="SAM3 Segmentation"
              />
            )}
          </TabsContent>

          <TabsContent value="edge" className="flex-1 min-h-0 mt-0">
            {visionResults ? (
              <EdgeDetectionView
                screenshotSource={selectedScreenshotForVision || ""}
                results={visionResults.edge_results}
                edgeOverlayImage={visionResults.edge_overlay}
                imageWidth={visionResults.image_width}
                imageHeight={visionResults.image_height}
              />
            ) : (
              <VisionExtractionPrompt
                isRunning={isRunningVision}
                onRunExtraction={onRunVisionExtraction}
                extractionId={extractionId}
                technique="Edge Detection"
              />
            )}
          </TabsContent>

          <TabsContent value="ocr" className="layout-full-height mt-0">
            {visionResults ? (
              <OCRDetectionView
                screenshotSource={selectedScreenshotForVision || ""}
                results={visionResults.ocr_results}
                ocrOverlayImage={visionResults.ocr_overlay}
                imageWidth={visionResults.image_width}
                imageHeight={visionResults.image_height}
              />
            ) : (
              <VisionExtractionPrompt
                isRunning={isRunningVision}
                onRunExtraction={onRunVisionExtraction}
                extractionId={extractionId}
                technique="OCR"
              />
            )}
          </TabsContent>

          <TabsContent
            value="playwright"
            className="mt-0 layout-full-height data-[state=inactive]:hidden"
          >
            {playwrightJob?.status === "completed" && playwrightResults ? (
              <PlaywrightStateExplorerView results={playwrightResults} />
            ) : playwrightJob ? (
              <PlaywrightResultsView
                job={playwrightJob}
                results={playwrightResults}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
                <MousePointerClick className="h-16 w-16 text-green-400/30" />
                <div className="text-center">
                  <h3 className="text-lg font-medium mb-2 text-green-400">
                    No State Collector Results
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4 max-w-md">
                    Run the Playwright State Collector from the Configuration
                    tab to extract clickable elements and build states for your
                    automation.
                  </p>
                  <Button
                    variant="outline"
                    className="border-green-500/30 text-green-400 hover:bg-green-500/10"
                    onClick={() => {
                      setMainTab("configuration");
                      setConfigSubTab("playwright-collector");
                    }}
                  >
                    <MousePointerClick className="h-4 w-4 mr-2" />
                    Go to State Collector
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}

      {/* Show message if no state machine available */}
      {extractionIsComplete && stateMachineStates.length === 0 && (
        <div className="mt-4">
          <Alert className="bg-surface-raised/60 border-brand-primary/30 backdrop-blur-sm">
            <AlertCircle className="h-4 w-4 text-brand-primary" />
            <AlertDescription className="text-text-secondary font-mono">
              WARNING: State Machine empty. Telmetry might be delayed or
              unavailable for this session.
            </AlertDescription>
          </Alert>
        </div>
      )}
    </>
  );
}
