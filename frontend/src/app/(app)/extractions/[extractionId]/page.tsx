"use client";

/**
 * Extraction Detail Page
 *
 * Displays detailed information about a web extraction session:
 * - Session metadata (status, dates, source URLs)
 * - Configuration (viewports, max depth, etc.)
 * - Statistics (pages, elements, states)
 * - Annotations grouped by screenshot
 * - Import to workflow functionality
 */

import { useEffect, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ArrowLeft,
  Download,
  Trash2,
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
  Eye,
  Box,
  GitBranch,
  Clock,
  AlertCircle,
  CheckCircle,
  Loader2,
} from "lucide-react";

// Types based on backend schemas
interface ExtractionConfig {
  viewports: [number, number][];
  capture_hover_states: boolean;
  capture_focus_states: boolean;
  max_depth: number;
  max_pages: number;
  auth_cookies: Record<string, string>;
}

interface ElementAnnotation {
  id: string;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  element_type: string;
  text_content: string | null;
  selector: string;
  is_interactive: boolean;
  is_enabled: boolean;
  semantic_role: string | null;
  aria_label: string | null;
}

interface StateAnnotation {
  id: string;
  name: string;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  state_type: string;
  element_ids: string[];
}

interface ExtractionAnnotation {
  id: string;
  session_id: string;
  screenshot_id: string;
  source_url: string;
  viewport_width: number;
  viewport_height: number;
  elements: ElementAnnotation[];
  states: StateAnnotation[];
  created_at: string;
  updated_at: string;
}

interface ExtractionSession {
  id: string;
  project_id: string;
  source_urls: string[];
  config: ExtractionConfig;
  status: string;
  stats: {
    pages_extracted?: number;
    elements_found?: number;
    states_found?: number;
  };
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  annotations: ExtractionAnnotation[];
}

export default function ExtractionDetailPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const extractionId = params.extractionId as string;
  const projectId = searchParams.get("project");

  const [extraction, setExtraction] = useState<ExtractionSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [expandedAnnotations, setExpandedAnnotations] = useState<Set<string>>(
    new Set()
  );

  useEffect(() => {
    loadExtraction();
  }, [extractionId]);

  const loadExtraction = async () => {
    setLoading(true);
    try {
      const data = await apiClient.getExtractionSession(extractionId);
      setExtraction(data);
    } catch (error) {
      console.error("Error loading extraction:", error);
      toast.error("Failed to load extraction session");
    } finally {
      setLoading(false);
    }
  };

  const handleImportStates = async () => {
    if (!extraction) return;

    setImporting(true);
    try {
      const result = await apiClient.importExtractionStates(extractionId, {
        state_ids: [], // Empty array imports all states
      });

      toast.success(
        `Successfully imported ${result.imported_states} state(s) and ${result.imported_transitions} transition(s)`
      );
    } catch (error) {
      console.error("Error importing states:", error);
      toast.error("Failed to import states to workflow");
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this extraction session?")) {
      return;
    }

    setDeleting(true);
    try {
      await apiClient.deleteExtractionSession(extractionId);
      toast.success("Extraction session deleted");
      router.push(`/extractions?project=${projectId}`);
    } catch (error) {
      console.error("Error deleting extraction:", error);
      toast.error("Failed to delete extraction session");
      setDeleting(false);
    }
  };

  const toggleAnnotation = (annotationId: string) => {
    setExpandedAnnotations((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(annotationId)) {
        newSet.delete(annotationId);
      } else {
        newSet.add(annotationId);
      }
      return newSet;
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case "pending":
        return <Clock className="h-5 w-5 text-yellow-500" />;
      case "running":
        return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
      case "failed":
        return <AlertCircle className="h-5 w-5 text-red-500" />;
      default:
        return <AlertCircle className="h-5 w-5 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-100 text-green-800 border-green-300";
      case "pending":
        return "bg-yellow-100 text-yellow-800 border-yellow-300";
      case "running":
        return "bg-blue-100 text-blue-800 border-blue-300";
      case "failed":
        return "bg-red-100 text-red-800 border-red-300";
      default:
        return "bg-gray-100 text-gray-800 border-gray-300";
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto py-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-[#00D9FF]" />
        </div>
      </div>
    );
  }

  if (!extraction) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle>Extraction Not Found</CardTitle>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={() => router.push(`/extractions?project=${projectId}`)}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Extractions
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalElements = extraction.annotations.reduce(
    (sum, ann) => sum + (ann.elements?.length || 0),
    0
  );
  const totalStates = extraction.annotations.reduce(
    (sum, ann) => sum + (ann.states?.length || 0),
    0
  );

  return (
    <div className="container mx-auto py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            onClick={() => router.push(`/extractions?project=${projectId}`)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              Extraction Session
              {getStatusIcon(extraction.status)}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Created {new Date(extraction.created_at).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleImportStates}
            disabled={
              importing ||
              extraction.status !== "completed" ||
              totalStates === 0
            }
          >
            {importing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Import States to Workflow
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            Delete
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Left Column: Info & Config */}
        <div className="col-span-12 lg:col-span-4 space-y-6">
          {/* Status & Info Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Session Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Status
                </label>
                <div className="mt-1">
                  <Badge
                    variant="outline"
                    className={`${getStatusColor(extraction.status)}`}
                  >
                    {extraction.status}
                  </Badge>
                </div>
              </div>

              {extraction.error_message && (
                <div>
                  <label className="text-sm font-medium text-red-600">
                    Error
                  </label>
                  <p className="mt-1 text-sm text-red-600">
                    {extraction.error_message}
                  </p>
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Source URLs ({extraction.source_urls.length})
                </label>
                <div className="mt-2 space-y-1">
                  {extraction.source_urls.map((url, idx) => (
                    <div
                      key={idx}
                      className="text-sm bg-accent/30 rounded px-2 py-1 truncate"
                      title={url}
                    >
                      {url}
                    </div>
                  ))}
                </div>
              </div>

              {extraction.started_at && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Started
                  </label>
                  <p className="mt-1 text-sm">
                    {new Date(extraction.started_at).toLocaleString()}
                  </p>
                </div>
              )}

              {extraction.completed_at && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Completed
                  </label>
                  <p className="mt-1 text-sm">
                    {new Date(extraction.completed_at).toLocaleString()}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Configuration Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Viewports
                </label>
                <div className="mt-1 space-y-1">
                  {extraction.config.viewports.map((vp, idx) => (
                    <div key={idx} className="text-sm">
                      {vp[0]} x {vp[1]}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Max Depth
                </label>
                <p className="mt-1 text-sm">{extraction.config.max_depth}</p>
              </div>

              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Max Pages
                </label>
                <p className="mt-1 text-sm">{extraction.config.max_pages}</p>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={extraction.config.capture_hover_states}
                  disabled
                  className="rounded"
                />
                <span className="text-muted-foreground">
                  Capture Hover States
                </span>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={extraction.config.capture_focus_states}
                  disabled
                  className="rounded"
                />
                <span className="text-muted-foreground">
                  Capture Focus States
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Statistics Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Statistics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-3 bg-accent/30 rounded-lg">
                  <ImageIcon className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                  <div className="text-2xl font-bold">
                    {extraction.stats.pages_extracted || 0}
                  </div>
                  <div className="text-xs text-muted-foreground">Pages</div>
                </div>
                <div className="text-center p-3 bg-accent/30 rounded-lg">
                  <Box className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                  <div className="text-2xl font-bold">{totalElements}</div>
                  <div className="text-xs text-muted-foreground">Elements</div>
                </div>
                <div className="text-center p-3 bg-accent/30 rounded-lg">
                  <Eye className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                  <div className="text-2xl font-bold">{totalStates}</div>
                  <div className="text-xs text-muted-foreground">States</div>
                </div>
                <div className="text-center p-3 bg-accent/30 rounded-lg">
                  <ImageIcon className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                  <div className="text-2xl font-bold">
                    {extraction.annotations.length}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Screenshots
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Annotations */}
        <Card className="col-span-12 lg:col-span-8">
          <CardHeader>
            <CardTitle className="text-lg">
              Annotations ({extraction.annotations.length} screenshots)
            </CardTitle>
            <CardDescription>
              Extracted elements and states from each screenshot
            </CardDescription>
          </CardHeader>
          <CardContent>
            {extraction.annotations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <ImageIcon className="h-12 w-12 mb-2 opacity-50" />
                <p>No annotations found</p>
              </div>
            ) : (
              <ScrollArea className="h-[600px]">
                <div className="space-y-3">
                  {extraction.annotations.map((annotation) => {
                    const isExpanded = expandedAnnotations.has(annotation.id);
                    return (
                      <Collapsible key={annotation.id}>
                        <Card>
                          <CollapsibleTrigger
                            onClick={() => toggleAnnotation(annotation.id)}
                            className="w-full"
                          >
                            <CardHeader className="cursor-pointer hover:bg-accent/50 transition-colors">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  {isExpanded ? (
                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                  )}
                                  <div className="text-left">
                                    <CardTitle className="text-sm font-medium">
                                      {annotation.source_url}
                                    </CardTitle>
                                    <CardDescription className="text-xs">
                                      {annotation.viewport_width} x{" "}
                                      {annotation.viewport_height} •{" "}
                                      {annotation.elements?.length || 0}{" "}
                                      elements •{" "}
                                      {annotation.states?.length || 0} states
                                    </CardDescription>
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <Badge variant="outline" className="text-xs">
                                    <Box className="h-3 w-3 mr-1" />
                                    {annotation.elements?.length || 0}
                                  </Badge>
                                  <Badge variant="outline" className="text-xs">
                                    <Eye className="h-3 w-3 mr-1" />
                                    {annotation.states?.length || 0}
                                  </Badge>
                                </div>
                              </div>
                            </CardHeader>
                          </CollapsibleTrigger>

                          <CollapsibleContent>
                            <CardContent className="pt-0">
                              {/* Elements */}
                              {annotation.elements &&
                                annotation.elements.length > 0 && (
                                  <div className="mb-4">
                                    <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                                      <Box className="h-4 w-4" />
                                      Elements ({annotation.elements.length})
                                    </h4>
                                    <div className="space-y-1">
                                      {annotation.elements.map((element) => (
                                        <div
                                          key={element.id}
                                          className="text-xs p-2 bg-accent/20 rounded"
                                        >
                                          <div className="flex items-center justify-between mb-1">
                                            <Badge
                                              variant="secondary"
                                              className="text-xs"
                                            >
                                              {element.element_type}
                                            </Badge>
                                            <span className="text-muted-foreground">
                                              {element.bbox.width} x{" "}
                                              {element.bbox.height}
                                            </span>
                                          </div>
                                          {element.text_content && (
                                            <div className="text-muted-foreground truncate">
                                              {element.text_content}
                                            </div>
                                          )}
                                          {element.aria_label && (
                                            <div className="text-muted-foreground text-xs">
                                              aria: {element.aria_label}
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                              {/* States */}
                              {annotation.states &&
                                annotation.states.length > 0 && (
                                  <div>
                                    <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                                      <Eye className="h-4 w-4" />
                                      States ({annotation.states.length})
                                    </h4>
                                    <div className="space-y-1">
                                      {annotation.states.map((state) => (
                                        <div
                                          key={state.id}
                                          className="text-xs p-2 bg-blue-50 dark:bg-blue-950 rounded"
                                        >
                                          <div className="flex items-center justify-between mb-1">
                                            <span className="font-medium">
                                              {state.name}
                                            </span>
                                            <Badge
                                              variant="outline"
                                              className="text-xs"
                                            >
                                              {state.state_type}
                                            </Badge>
                                          </div>
                                          <div className="text-muted-foreground">
                                            {state.bbox.width} x{" "}
                                            {state.bbox.height} •{" "}
                                            {state.element_ids.length} elements
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                              {!annotation.elements?.length &&
                                !annotation.states?.length && (
                                  <p className="text-sm text-muted-foreground text-center py-4">
                                    No annotations for this screenshot
                                  </p>
                                )}
                            </CardContent>
                          </CollapsibleContent>
                        </Card>
                      </Collapsible>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
