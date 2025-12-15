/**
 * Web Extraction Tab Component
 *
 * Main component that orchestrates the web extraction workflow:
 * 1. Configure extraction settings (URLs, viewports, options)
 * 2. Create and start extraction session
 * 3. Monitor extraction progress
 * 4. View and select discovered states
 * 5. Import states into project
 */

"use client";

import { useState, useEffect } from "react";
import { useProjectLoader } from "@/hooks/use-project-loader";
import { useExtractions, useCreateExtraction } from "@/hooks/use-extractions";
import { extractionService } from "@/services/service-factory";
import { ExtractionConfigPanel } from "./ExtractionConfigPanel";
import { ExtractionProgress } from "./ExtractionProgress";
import { StateList } from "./StateList";
import { ExportPanel } from "./ExportPanel";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Plus,
  History,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type {
  ExtractionSessionCreate,
  ExtractionSessionDetail,
  ExtractionAnnotation,
  StateImportRequest,
  ImportResult,
} from "@/services/extraction-service";

export default function WebExtractionTab() {
  const { projectId } = useProjectLoader();
  const { data: extractions, isLoading: isLoadingExtractions } = useExtractions(
    projectId || "",
    !!projectId
  );
  const createExtraction = useCreateExtraction();

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
  const [activeTab, setActiveTab] = useState<string>("config");

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
      loadExtractionDetail(activeExtractionId);
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(interval);
  }, [activeExtractionId, extractionDetail?.status]);

  const loadExtractionDetail = async (extractionId: string) => {
    try {
      setIsLoadingDetail(true);
      const detail = await extractionService.getExtractionDetail(extractionId);
      setExtractionDetail(detail);

      // Load annotations if extraction is completed
      if (detail.status === "completed") {
        const annots = await extractionService.getAnnotations(extractionId);
        setAnnotations(annots);
      }
    } catch (error) {
      console.error("Failed to load extraction detail:", error);
      toast.error("Failed to load extraction details");
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleStartExtraction = async (config: ExtractionSessionCreate) => {
    if (!projectId) {
      toast.error("No project selected");
      return;
    }

    try {
      const result = await createExtraction.mutateAsync({
        projectId,
        data: config,
      });

      setActiveExtractionId(result.id);
      setActiveTab("progress");
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

  const handleNewExtraction = () => {
    setActiveExtractionId(null);
    setExtractionDetail(null);
    setAnnotations([]);
    setSelectedStateIds(new Set());
    setActiveTab("config");
  };

  const handleSelectPreviousExtraction = (extractionId: string) => {
    setActiveExtractionId(extractionId);
    setActiveTab("progress");
  };

  const handleDeleteExtraction = async (extractionId: string) => {
    try {
      await extractionService.deleteExtraction(extractionId);
      toast.success("Extraction deleted");
      if (activeExtractionId === extractionId) {
        handleNewExtraction();
      }
    } catch (error) {
      console.error("Failed to delete extraction:", error);
      toast.error("Failed to delete extraction");
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
    (sum, annotation) => sum + annotation.states.length,
    0
  );

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
          {activeExtractionId && (
            <Button onClick={handleNewExtraction} variant="outline">
              <Plus className="h-4 w-4 mr-2" />
              New Extraction
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="container max-w-7xl mx-auto p-6">
          {!activeExtractionId ? (
            /* No active extraction - show config and history */
            <div className="space-y-6">
              <ExtractionConfigPanel
                onStartExtraction={handleStartExtraction}
                isRunning={createExtraction.isPending}
              />

              {/* Previous Extractions */}
              {extractions && extractions.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <History className="h-5 w-5 text-muted-foreground" />
                    <h2 className="text-lg font-semibold">
                      Previous Extractions
                    </h2>
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
            </div>
          ) : (
            /* Active extraction - show progress and results */
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="progress">Progress</TabsTrigger>
                <TabsTrigger
                  value="states"
                  disabled={
                    !extractionDetail || extractionDetail.status !== "completed"
                  }
                >
                  States
                </TabsTrigger>
                <TabsTrigger
                  value="export"
                  disabled={
                    !extractionDetail || extractionDetail.status !== "completed"
                  }
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
                />
              </TabsContent>

              <TabsContent value="export" className="space-y-6 mt-6">
                <ExportPanel
                  extractionId={activeExtractionId}
                  selectedStateIds={selectedStateIds}
                  totalStatesCount={totalStatesCount}
                  onImport={handleImportStates}
                />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}
