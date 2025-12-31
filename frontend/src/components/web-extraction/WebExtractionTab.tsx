/**
 * Web Extraction Tab Component
 *
 * Main component that orchestrates the web extraction workflow:
 * 1. Configure extraction settings (URLs, viewports, options) - persisted until logout
 * 2. Create and start extraction session
 * 3. Monitor extraction progress
 * 4. View and select discovered states
 * 5. Import states into project
 */

"use client";

import { useState, useEffect } from "react";
import { useProjectLoader } from "@/hooks/use-project-loader";
import {
  useExtractions,
  useCreateExtraction,
  useDeleteExtraction,
} from "@/hooks/use-extractions";
import { extractionService } from "@/services/service-factory";
import { ExtractionConfigPanel } from "./ExtractionConfigPanel";
import { ExtractionProgress } from "./ExtractionProgress";
import { StateList } from "./StateList";
import { ExportPanel } from "./ExportPanel";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  AlertCircle,
  History,
  Trash2,
  Settings,
  FileSearch,
} from "lucide-react";
import { toast } from "sonner";
import { runnerClient } from "@/lib/runner-client";
import { useAuth } from "@/contexts/auth-context";
import { useExtractionConfig } from "@/hooks/use-extraction-config";
import type {
  ExtractionSessionCreate,
  ExtractionSessionDetail,
  ExtractionAnnotation,
  StateImportRequest,
  ImportResult,
} from "@/services/extraction-service";

type MainTab = "configuration" | "results";
type ResultsSubTab = "progress" | "states" | "import";

export default function WebExtractionTab() {
  const { projectId } = useProjectLoader();
  const { data: extractions } = useExtractions(projectId || "", !!projectId);
  const createExtraction = useCreateExtraction();
  const deleteExtraction = useDeleteExtraction();
  const { getAccessToken } = useAuth();

  // Persistent config from hook
  const extractionConfig = useExtractionConfig();

  // State for delete all confirmation
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  // Main tab state - Configuration or Results
  const [mainTab, setMainTab] = useState<MainTab>("configuration");

  // Results sub-tab state
  const [resultsSubTab, setResultsSubTab] = useState<ResultsSubTab>("progress");

  const [activeExtractionId, setActiveExtractionId] = useState<string | null>(
    null
  );
  const [extractionDetail, setExtractionDetail] =
    useState<ExtractionSessionDetail | null>(null);
  const [annotations, setAnnotations] = useState<ExtractionAnnotation[]>([]);
  const [selectedStateIds, setSelectedStateIds] = useState<Set<string>>(
    new Set()
  );
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Load extraction detail when an extraction is selected
  useEffect(() => {
    if (!activeExtractionId) {
      setExtractionDetail(null);
      setAnnotations([]);
      setSelectedStateIds(new Set());
      return;
    }

    loadExtractionDetail(activeExtractionId);
  }, [activeExtractionId]);

  // Poll for updates when extraction is running
  useEffect(() => {
    if (!activeExtractionId || !extractionDetail) return;
    if (
      extractionDetail.status !== "running" &&
      extractionDetail.status !== "pending"
    ) {
      return;
    }

    const interval = setInterval(() => {
      loadExtractionDetail(activeExtractionId, true); // silent poll
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(interval);
  }, [activeExtractionId, extractionDetail?.status]);

  const loadExtractionDetail = async (extractionId: string, silent = false) => {
    try {
      // Only show loading spinner on initial load, not on polls
      if (!silent) {
        setIsLoadingDetail(true);
      }
      const detail = await extractionService.getExtractionDetail(extractionId);
      setExtractionDetail(detail);

      // Load annotations if extraction is completed
      if (detail.status === "completed") {
        const annots = await extractionService.getAnnotations(extractionId);
        setAnnotations(annots);
      }
    } catch (error) {
      console.error("Failed to load extraction detail:", error);
      if (!silent) {
        toast.error("Failed to load extraction details");
      }
    } finally {
      if (!silent) {
        setIsLoadingDetail(false);
      }
    }
  };

  const handleStartExtraction = async (config: ExtractionSessionCreate) => {
    if (!projectId) {
      toast.error("No project selected");
      return;
    }

    try {
      // First check if runner is available
      const runnerAvailable = await runnerClient.isAvailable();
      if (!runnerAvailable) {
        toast.error(
          "Desktop Runner is not connected. Please start the qontinui-runner application to perform web extraction."
        );
        return;
      }

      // Create the session in the backend
      const result = await createExtraction.mutateAsync({
        projectId,
        data: config,
      });

      setActiveExtractionId(result.id);
      setResultsSubTab("progress");
      // Switch to Results tab when extraction starts
      setMainTab("results");

      // Now trigger the actual extraction on the runner
      const extractionConfig = config.config ?? {};
      const authToken = await getAccessToken();
      const runnerResult = await runnerClient.startExtraction({
        urls: config.source_urls,
        viewports: extractionConfig.viewports ?? [[1920, 1080]],
        capture_hover_states: extractionConfig.capture_hover_states ?? true,
        capture_focus_states: extractionConfig.capture_focus_states ?? true,
        max_depth: extractionConfig.max_depth ?? 5,
        max_pages: extractionConfig.max_pages ?? 100,
        session_id: result.id,
        backend_url: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
        auth_token: authToken || undefined,
      });

      if (!runnerResult.success) {
        console.error("Runner extraction failed:", runnerResult.error);
        toast.error(
          `Failed to start extraction on runner: ${runnerResult.error || "Unknown error"}`
        );
        // Mark session as failed since runner couldn't start it
        try {
          await extractionService.updateExtraction(result.id, {
            status: "failed",
            error_message:
              runnerResult.error || "Failed to start extraction on runner",
          });
        } catch (updateError) {
          console.error("Failed to update extraction status:", updateError);
        }
        return;
      }

      toast.success("Extraction started successfully");
    } catch (error) {
      console.error("Failed to start extraction:", error);
      toast.error("Failed to start extraction");
    }
  };

  const handleImportStates = async (
    stateIds: string[]
  ): Promise<ImportResult> => {
    if (!activeExtractionId) {
      throw new Error("No active extraction");
    }

    const request: StateImportRequest = {
      state_ids: stateIds.length > 0 ? stateIds : undefined,
      target_workflow_id: undefined,
    };

    return await extractionService.importStates(activeExtractionId, request);
  };

  const handleSelectPreviousExtraction = (extractionId: string) => {
    setActiveExtractionId(extractionId);
    setResultsSubTab("progress");
    setMainTab("results");
  };

  const handleDeleteExtraction = async (extractionId: string) => {
    if (!projectId) return;

    try {
      await deleteExtraction.mutateAsync({ extractionId, projectId });
      toast.success("Extraction deleted");
      if (activeExtractionId === extractionId) {
        setActiveExtractionId(null);
        setExtractionDetail(null);
        setAnnotations([]);
        setSelectedStateIds(new Set());
      }
    } catch (error) {
      console.error("Failed to delete extraction:", error);
      toast.error("Failed to delete extraction");
    }
  };

  const handleDeleteAllExtractions = async () => {
    if (!projectId || !extractions || extractions.length === 0) return;

    setIsDeletingAll(true);
    try {
      // Delete all extractions in parallel
      await Promise.all(
        extractions.map((extraction) =>
          deleteExtraction.mutateAsync({
            extractionId: extraction.id,
            projectId,
          })
        )
      );
      toast.success(`Deleted ${extractions.length} extraction(s)`);
      // Clear active extraction state
      setActiveExtractionId(null);
      setExtractionDetail(null);
      setAnnotations([]);
      setSelectedStateIds(new Set());
    } catch (error) {
      console.error("Failed to delete all extractions:", error);
      toast.error("Failed to delete some extractions");
    } finally {
      setIsDeletingAll(false);
    }
  };

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

  // Count total states from annotations
  const totalStatesCount = annotations.reduce(
    (sum, annotation) => sum + (annotation.states?.length ?? 0),
    0
  );

  // Check if there's an active or completed extraction to show results
  const hasActiveExtraction = !!activeExtractionId;
  const extractionIsComplete = extractionDetail?.status === "completed";

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Web Extraction</h1>
            <p className="text-sm text-muted-foreground">
              Automatically discover states and elements from web pages
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="container max-w-7xl mx-auto p-6">
          {/* Main Tabs: Configuration and Results */}
          <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as MainTab)}>
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger
                value="configuration"
                className="flex items-center gap-2"
              >
                <Settings className="h-4 w-4" />
                Configuration
              </TabsTrigger>
              <TabsTrigger value="results" className="flex items-center gap-2">
                <FileSearch className="h-4 w-4" />
                Results
                {hasActiveExtraction && extractionDetail && (
                  <Badge
                    variant={
                      extractionDetail.status === "completed"
                        ? "default"
                        : extractionDetail.status === "failed"
                          ? "destructive"
                          : "secondary"
                    }
                    className="ml-1"
                  >
                    {extractionDetail.status}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            {/* Configuration Tab */}
            <TabsContent value="configuration" className="space-y-6">
              <ExtractionConfigPanel
                onStartExtraction={handleStartExtraction}
                isRunning={createExtraction.isPending}
                extractionConfig={extractionConfig}
              />

              {/* Previous Extractions */}
              {extractions && extractions.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <History className="h-5 w-5 text-muted-foreground" />
                      <h2 className="text-lg font-semibold">
                        Previous Extractions
                      </h2>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDeleteAllExtractions}
                      disabled={isDeletingAll}
                      className="text-destructive hover:text-destructive"
                    >
                      {isDeletingAll ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4 mr-2" />
                      )}
                      Delete All
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {extractions.map((extraction) => (
                      <div
                        key={extraction.id}
                        className="border rounded-lg p-4 flex items-center justify-between hover:bg-accent transition-colors cursor-pointer"
                        onClick={() =>
                          handleSelectPreviousExtraction(extraction.id)
                        }
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {extraction.source_urls[0]}
                              {extraction.source_urls.length > 1 &&
                                ` +${extraction.source_urls.length - 1} more`}
                            </span>
                            <Badge
                              variant={
                                extraction.status === "completed"
                                  ? "default"
                                  : extraction.status === "failed"
                                    ? "destructive"
                                    : "secondary"
                              }
                            >
                              {extraction.status}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {extraction.stats.pages_extracted || 0} pages •{" "}
                            {extraction.stats.states_found || 0} states
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteExtraction(extraction.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            {/* Results Tab */}
            <TabsContent value="results" className="space-y-6">
              {!hasActiveExtraction ? (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    No extraction in progress. Go to the Configuration tab to
                    start a new extraction, or select a previous extraction from
                    the list.
                  </AlertDescription>
                </Alert>
              ) : (
                /* Active extraction - show progress and results sub-tabs */
                <Tabs
                  value={resultsSubTab}
                  onValueChange={(v) => setResultsSubTab(v as ResultsSubTab)}
                >
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="progress">Progress</TabsTrigger>
                    <TabsTrigger
                      value="states"
                      disabled={!extractionIsComplete}
                    >
                      States
                    </TabsTrigger>
                    <TabsTrigger
                      value="import"
                      disabled={!extractionIsComplete}
                    >
                      Import
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="progress" className="space-y-6 mt-6">
                    {isLoadingDetail ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : extractionDetail ? (
                      <ExtractionProgress session={extractionDetail} />
                    ) : (
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          Failed to load extraction details
                        </AlertDescription>
                      </Alert>
                    )}
                  </TabsContent>

                  <TabsContent value="states" className="space-y-6 mt-6">
                    <StateList
                      annotations={annotations}
                      selectedStateIds={selectedStateIds}
                      onSelectionChange={setSelectedStateIds}
                      extractionId={
                        extractionDetail?.stats?.screenshot_extraction_id ||
                        activeExtractionId ||
                        undefined
                      }
                    />
                  </TabsContent>

                  <TabsContent value="import" className="space-y-6 mt-6">
                    <ExportPanel
                      extractionId={activeExtractionId}
                      selectedStateIds={selectedStateIds}
                      totalStatesCount={totalStatesCount}
                      onImport={handleImportStates}
                    />
                  </TabsContent>
                </Tabs>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
