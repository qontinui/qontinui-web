"use client";

/**
 * Dataset Viewer Page
 *
 * Detailed view of a training dataset with:
 * - Statistics overview
 * - Image browser with thumbnails
 * - Annotation viewing and editing
 * - Filter controls
 * - Review workflow
 */

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { datasetService } from "@/services/dataset-service";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { ImageCanvas, BoundingBox } from "@/components/common/ImageCanvas";
import { DatasetExportDialog } from "@/components/datasets/DatasetExportDialog";
import {
  Download,
  ImageIcon,
  Tag,
  CheckCircle2,
  Filter,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Flag,
  BarChart3,
  CheckSquare,
  Square,
} from "lucide-react";
import type {
  Dataset,
  DatasetImage,
  DatasetAnnotation,
  DatasetStatistics,
  DatasetFilters,
  AnnotationSource,
  ReviewStatus,
} from "@/types/dataset";

const SOURCE_COLORS: Record<AnnotationSource, string> = {
  user_click: "#22c55e", // Green
  smart_click_analysis: "#3b82f6", // Blue
  template_matching: "#f97316", // Orange
  manual: "#8b5cf6", // Purple
};

const REVIEW_STATUS_COLORS: Record<ReviewStatus, string> = {
  pending: "#6b7280", // Gray
  approved: "#22c55e", // Green
  rejected: "#ef4444", // Red
  flagged: "#eab308", // Yellow
};

export default function DatasetViewerPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const datasetId = params.id as string;

  // Data state
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [statistics, setStatistics] = useState<DatasetStatistics | null>(null);
  const [images, setImages] = useState<DatasetImage[]>([]);
  const [totalImages, setTotalImages] = useState(0);
  const [selectedImage, setSelectedImage] = useState<DatasetImage | null>(null);
  const [annotations, setAnnotations] = useState<DatasetAnnotation[]>([]);
  const [selectedAnnotation, setSelectedAnnotation] =
    useState<DatasetAnnotation | null>(null);
  const [loading, setLoading] = useState(true);

  // Filter state
  const [filters, setFilters] = useState<DatasetFilters>({
    sources: [
      "user_click",
      "smart_click_analysis",
      "template_matching",
      "manual",
    ],
    confidence_min: 0,
    confidence_max: 1,
    review_statuses: ["pending", "approved", "rejected", "flagged"],
    page: 1,
    page_size: 24,
  });

  // UI state
  const [showFilters, setShowFilters] = useState(true);
  const [showStatistics, setShowStatistics] = useState(true);
  const [showExportDialog, setShowExportDialog] = useState(false);

  // Bulk selection state
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<
    Set<string>
  >(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);

  // Auth protection
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
      return;
    }
    if (!authLoading && user && !user.is_superuser) {
      toast.error("Access denied - Admin privileges required");
      router.push("/build/workflows");
      return;
    }
  }, [user, authLoading, router]);

  // Load dataset
  useEffect(() => {
    if (!authLoading && user?.is_superuser && datasetId) {
      loadDataset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadDataset is stable, only reload when auth/datasetId changes
  }, [authLoading, user, datasetId]);

  // Load images when filters change
  useEffect(() => {
    if (dataset) {
      loadImages();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadImages is stable, only reload when dataset/filters change
  }, [dataset, filters]);

  // Load annotations when image selected
  useEffect(() => {
    if (selectedImage) {
      loadAnnotations();
    } else {
      setAnnotations([]);
      setSelectedAnnotation(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadAnnotations is stable, only reload when selectedImage changes
  }, [selectedImage]);

  const loadDataset = async () => {
    setLoading(true);
    try {
      const [datasetData, statsData] = await Promise.all([
        datasetService.getDataset(datasetId),
        datasetService.getStatistics(datasetId),
      ]);
      setDataset(datasetData);
      setStatistics(statsData);
    } catch (error) {
      console.error("Error loading dataset:", error);
      toast.error("Failed to load dataset");
    } finally {
      setLoading(false);
    }
  };

  const loadImages = async () => {
    try {
      const result = await datasetService.getDatasetImages(datasetId, filters);
      setImages(result.items);
      setTotalImages(result.total);
    } catch (error) {
      console.error("Error loading images:", error);
      toast.error("Failed to load images");
    }
  };

  const loadAnnotations = async () => {
    if (!selectedImage) return;
    try {
      const anns = await datasetService.getImageAnnotations(
        datasetId,
        selectedImage.id
      );
      // Filter annotations based on current filters
      const filtered = anns.filter((ann) => {
        if (filters.sources && !filters.sources.includes(ann.source))
          return false;
        if (
          filters.confidence_min !== undefined &&
          ann.confidence < filters.confidence_min
        )
          return false;
        if (
          filters.confidence_max !== undefined &&
          ann.confidence > filters.confidence_max
        )
          return false;
        if (
          filters.review_statuses &&
          !filters.review_statuses.includes(ann.review_status)
        )
          return false;
        return true;
      });
      setAnnotations(filtered);
    } catch (error) {
      console.error("Error loading annotations:", error);
      toast.error("Failed to load annotations");
    }
  };

  const handleSourceFilterChange = (
    source: AnnotationSource,
    checked: boolean
  ) => {
    setFilters((prev) => ({
      ...prev,
      sources: checked
        ? [...(prev.sources || []), source]
        : (prev.sources || []).filter((s) => s !== source),
    }));
  };

  const handleReviewStatusFilterChange = (
    status: ReviewStatus,
    checked: boolean
  ) => {
    setFilters((prev) => ({
      ...prev,
      review_statuses: checked
        ? [...(prev.review_statuses || []), status]
        : (prev.review_statuses || []).filter((s) => s !== status),
    }));
  };

  const handleApprove = async (annotation: DatasetAnnotation) => {
    try {
      await datasetService.approveAnnotation(datasetId, annotation.id);
      setAnnotations((prev) =>
        prev.map((a) =>
          a.id === annotation.id
            ? { ...a, review_status: "approved" as ReviewStatus }
            : a
        )
      );
      toast.success("Annotation approved");
    } catch (_error) {
      toast.error("Failed to approve annotation");
    }
  };

  const handleReject = async (annotation: DatasetAnnotation) => {
    try {
      await datasetService.rejectAnnotation(datasetId, annotation.id);
      setAnnotations((prev) =>
        prev.map((a) =>
          a.id === annotation.id
            ? { ...a, review_status: "rejected" as ReviewStatus }
            : a
        )
      );
      toast.success("Annotation rejected");
    } catch (_error) {
      toast.error("Failed to reject annotation");
    }
  };

  const handleFlag = async (annotation: DatasetAnnotation) => {
    try {
      await datasetService.flagAnnotation(datasetId, annotation.id);
      setAnnotations((prev) =>
        prev.map((a) =>
          a.id === annotation.id
            ? { ...a, review_status: "flagged" as ReviewStatus }
            : a
        )
      );
      toast.success("Annotation flagged for review");
    } catch (_error) {
      toast.error("Failed to flag annotation");
    }
  };

  // Bulk operation handlers
  const handleToggleAnnotationSelection = (annotationId: string) => {
    setSelectedAnnotationIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(annotationId)) {
        newSet.delete(annotationId);
      } else {
        newSet.add(annotationId);
      }
      return newSet;
    });
  };

  const handleSelectAllAnnotations = () => {
    if (selectedAnnotationIds.size === annotations.length) {
      setSelectedAnnotationIds(new Set());
    } else {
      setSelectedAnnotationIds(new Set(annotations.map((a) => a.id)));
    }
  };

  const handleBulkApprove = async () => {
    if (selectedAnnotationIds.size === 0) return;
    setBulkProcessing(true);
    try {
      const result = await datasetService.bulkUpdateAnnotations(datasetId, {
        annotation_ids: Array.from(selectedAnnotationIds),
        update: { review_status: "approved", verified: true },
      });
      setAnnotations((prev) =>
        prev.map((a) =>
          selectedAnnotationIds.has(a.id)
            ? {
                ...a,
                review_status: "approved" as ReviewStatus,
                verified: true,
              }
            : a
        )
      );
      toast.success(`Approved ${result.updated_count} annotation(s)`);
      setSelectedAnnotationIds(new Set());
    } catch (_error) {
      toast.error("Failed to approve annotations");
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleBulkReject = async () => {
    if (selectedAnnotationIds.size === 0) return;
    setBulkProcessing(true);
    try {
      const result = await datasetService.bulkUpdateAnnotations(datasetId, {
        annotation_ids: Array.from(selectedAnnotationIds),
        update: { review_status: "rejected" },
      });
      setAnnotations((prev) =>
        prev.map((a) =>
          selectedAnnotationIds.has(a.id)
            ? { ...a, review_status: "rejected" as ReviewStatus }
            : a
        )
      );
      toast.success(`Rejected ${result.updated_count} annotation(s)`);
      setSelectedAnnotationIds(new Set());
    } catch (_error) {
      toast.error("Failed to reject annotations");
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleBulkFlag = async () => {
    if (selectedAnnotationIds.size === 0) return;
    setBulkProcessing(true);
    try {
      const result = await datasetService.bulkUpdateAnnotations(datasetId, {
        annotation_ids: Array.from(selectedAnnotationIds),
        update: { review_status: "flagged" },
      });
      setAnnotations((prev) =>
        prev.map((a) =>
          selectedAnnotationIds.has(a.id)
            ? { ...a, review_status: "flagged" as ReviewStatus }
            : a
        )
      );
      toast.success(`Flagged ${result.updated_count} annotation(s)`);
      setSelectedAnnotationIds(new Set());
    } catch (_error) {
      toast.error("Failed to flag annotations");
    } finally {
      setBulkProcessing(false);
    }
  };

  // Convert annotations to ImageCanvas BoundingBox format
  const canvasBoxes: BoundingBox[] = annotations.map((ann) => ({
    id: ann.id,
    x: ann.x,
    y: ann.y,
    width: ann.width,
    height: ann.height,
    label: ann.category_name,
    color: SOURCE_COLORS[ann.source],
  }));

  const totalPages = Math.ceil(totalImages / (filters.page_size || 24));

  if (authLoading || loading) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <p className="text-muted-foreground text-sm">Loading...</p>
      </div>
    );
  }

  if (!user?.is_superuser || !dataset) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="font-medium mb-2">Dataset Not Found</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/admin/datasets")}
          >
            Back to Datasets
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/admin/datasets")}
          >
            Datasets
          </Button>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-lg font-semibold">{dataset.name}</h1>
          {dataset.description && (
            <span className="text-sm text-muted-foreground hidden lg:inline">
              {dataset.description}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowStatistics(!showStatistics)}
          >
            <BarChart3 className="h-3.5 w-3.5 mr-1" />
            Stats
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-3.5 w-3.5 mr-1" />
            Filters
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowExportDialog(true)}
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            Export
          </Button>
        </div>
      </div>

      <DatasetExportDialog
        open={showExportDialog}
        onOpenChange={setShowExportDialog}
        datasetId={datasetId}
        datasetName={dataset.name}
      />

      {showStatistics && statistics && (
        <div className="grid grid-cols-6 gap-px bg-border shrink-0">
          <div className="bg-background px-4 py-3">
            <div className="flex items-center gap-1.5 mb-1">
              <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">
                Images
              </span>
            </div>
            <div
              data-content-role="metric"
              data-content-label="total images"
              className="text-xl font-semibold tabular-nums"
            >
              {statistics.total_images}
            </div>
          </div>
          <div className="bg-background px-4 py-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Tag className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">
                Annotations
              </span>
            </div>
            <div
              data-content-role="metric"
              data-content-label="total annotations"
              className="text-xl font-semibold tabular-nums"
            >
              {statistics.total_annotations}
            </div>
          </div>
          <div className="bg-background px-4 py-3">
            <div className="flex items-center gap-1.5 mb-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">
                Reviewed
              </span>
            </div>
            <div
              data-content-role="metric"
              data-content-label="reviewed images"
              className="text-xl font-semibold tabular-nums"
            >
              {statistics.reviewed_images}
            </div>
          </div>
          <div className="bg-background px-4 py-3">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">
              User Clicks
            </span>
            <div
              data-content-role="metric"
              data-content-label="user clicks count"
              className="text-xl font-semibold tabular-nums text-green-500"
            >
              {statistics.by_source.user_click || 0}
            </div>
          </div>
          <div className="bg-background px-4 py-3">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">
              Smart Analysis
            </span>
            <div
              data-content-role="metric"
              data-content-label="smart analysis count"
              className="text-xl font-semibold tabular-nums text-blue-500"
            >
              {statistics.by_source.smart_click_analysis || 0}
            </div>
          </div>
          <div className="bg-background px-4 py-3">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">
              Template Match
            </span>
            <div
              data-content-role="metric"
              data-content-label="template match count"
              className="text-xl font-semibold tabular-nums text-orange-500"
            >
              {statistics.by_source.template_matching || 0}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-12 divide-x divide-border overflow-hidden">
        {showFilters && (
          <div className="col-span-12 lg:col-span-2 overflow-y-auto">
            <div className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border bg-muted/50">
              Filters
            </div>
            <div className="p-4 space-y-4">
              {/* Source Filter */}
              <div>
                <p className="text-xs font-medium">Source</p>
                <div className="mt-2 space-y-2">
                  {(
                    [
                      "user_click",
                      "smart_click_analysis",
                      "template_matching",
                      "manual",
                    ] as AnnotationSource[]
                  ).map((source) => (
                    <div key={source} className="flex items-center gap-2">
                      <Checkbox
                        id={`source-${source}`}
                        checked={filters.sources?.includes(source)}
                        onCheckedChange={(checked) =>
                          handleSourceFilterChange(source, checked as boolean)
                        }
                      />
                      <label
                        htmlFor={`source-${source}`}
                        className="text-xs flex items-center gap-1"
                      >
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: SOURCE_COLORS[source] }}
                        />
                        {source.replace("_", " ")}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Confidence Filter */}
              <div>
                <p className="text-xs font-medium">
                  Confidence: {(filters.confidence_min || 0).toFixed(2)} -{" "}
                  {(filters.confidence_max || 1).toFixed(2)}
                </p>
                <Slider
                  className="mt-2"
                  min={0}
                  max={1}
                  step={0.05}
                  value={[
                    filters.confidence_min || 0,
                    filters.confidence_max || 1,
                  ]}
                  onValueChange={([min, max]) =>
                    setFilters((prev) => ({
                      ...prev,
                      confidence_min: min,
                      confidence_max: max,
                    }))
                  }
                />
              </div>

              {/* Review Status Filter */}
              <div>
                <p className="text-xs font-medium">Review Status</p>
                <div className="mt-2 space-y-2">
                  {(
                    [
                      "pending",
                      "approved",
                      "rejected",
                      "flagged",
                    ] as ReviewStatus[]
                  ).map((status) => (
                    <div key={status} className="flex items-center gap-2">
                      <Checkbox
                        id={`status-${status}`}
                        checked={filters.review_statuses?.includes(status)}
                        onCheckedChange={(checked) =>
                          handleReviewStatusFilterChange(
                            status,
                            checked as boolean
                          )
                        }
                      />
                      <label
                        htmlFor={`status-${status}`}
                        className="text-xs flex items-center gap-1"
                      >
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{
                            backgroundColor: REVIEW_STATUS_COLORS[status],
                          }}
                        />
                        {status}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <div
          className={`col-span-12 ${showFilters ? "lg:col-span-4" : "lg:col-span-5"} overflow-y-auto`}
        >
          <div className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border bg-muted/50">
            Images ({totalImages})
          </div>
          <div className="p-4">
            <ScrollArea className="h-[500px]">
              <div className="grid grid-cols-3 gap-2">
                {images.map((image) => (
                  <div
                    key={image.id}
                    className={`relative cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${
                      selectedImage?.id === image.id
                        ? "border-primary ring-2 ring-primary/50"
                        : "border-transparent hover:border-accent"
                    }`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedImage(image)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedImage(image);
                      }
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- Dynamic thumbnail URL from backend */}
                    <img
                      src={datasetService.getImageThumbnailUrl(
                        datasetId,
                        image.image_hash
                      )}
                      alt={image.filename}
                      className="w-full aspect-square object-cover"
                    />
                    {image.annotation_count !== undefined &&
                      image.annotation_count > 0 && (
                        <Badge className="absolute top-1 right-1 text-xs">
                          {image.annotation_count}
                        </Badge>
                      )}
                    {image.reviewed && (
                      <div className="absolute bottom-1 left-1">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={(filters.page || 1) <= 1}
                onClick={() =>
                  setFilters((prev) => ({
                    ...prev,
                    page: (prev.page || 1) - 1,
                  }))
                }
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span
                data-content-role="body-text"
                data-content-label="page indicator"
                className="text-sm text-muted-foreground"
              >
                Page {filters.page || 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={(filters.page || 1) >= totalPages}
                onClick={() =>
                  setFilters((prev) => ({
                    ...prev,
                    page: (prev.page || 1) + 1,
                  }))
                }
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <div
          className={`col-span-12 ${showFilters ? "lg:col-span-6" : "lg:col-span-7"} overflow-y-auto`}
        >
          <div className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border bg-muted/50 flex items-center justify-between">
            <span>
              {selectedImage ? selectedImage.filename : "Select an image"}
            </span>
            {selectedImage && (
              <span className="normal-case tracking-normal font-normal">
                {selectedImage.width} x {selectedImage.height}px •{" "}
                {annotations.length} annotation(s)
              </span>
            )}
          </div>
          <div className="p-4">
            {selectedImage ? (
              <div className="space-y-4">
                {/* Canvas */}
                <div className="border rounded-lg overflow-hidden">
                  <ImageCanvas
                    imageUrl={datasetService.getImageUrl(
                      datasetId,
                      selectedImage.image_hash
                    )}
                    boxes={canvasBoxes}
                    selectedBoxId={selectedAnnotation?.id || null}
                    onBoxSelect={(id) => {
                      const ann = annotations.find((a) => a.id === id);
                      setSelectedAnnotation(ann || null);
                    }}
                    readonly
                    className="h-[350px]"
                  />
                </div>

                {/* Bulk Actions Toolbar */}
                {annotations.length > 0 && (
                  <div className="flex items-center justify-between p-2 bg-muted/50 rounded-md mb-2">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={handleSelectAllAnnotations}
                      >
                        {selectedAnnotationIds.size === annotations.length ? (
                          <CheckSquare className="h-4 w-4 mr-1" />
                        ) : (
                          <Square className="h-4 w-4 mr-1" />
                        )}
                        {selectedAnnotationIds.size === annotations.length
                          ? "Deselect All"
                          : "Select All"}
                      </Button>
                      {selectedAnnotationIds.size > 0 && (
                        <span
                          data-content-role="metric"
                          data-content-label="selected annotations count"
                          className="text-xs text-muted-foreground"
                        >
                          {selectedAnnotationIds.size} selected
                        </span>
                      )}
                    </div>
                    {selectedAnnotationIds.size > 0 && (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs text-green-600 border-green-600 hover:bg-green-50"
                          onClick={handleBulkApprove}
                          disabled={bulkProcessing}
                        >
                          <Check className="h-3 w-3 mr-1" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs text-red-600 border-red-600 hover:bg-red-50"
                          onClick={handleBulkReject}
                          disabled={bulkProcessing}
                        >
                          <X className="h-3 w-3 mr-1" />
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs text-yellow-600 border-yellow-600 hover:bg-yellow-50"
                          onClick={handleBulkFlag}
                          disabled={bulkProcessing}
                        >
                          <Flag className="h-3 w-3 mr-1" />
                          Flag
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {/* Annotation List */}
                <ScrollArea className="h-[200px]">
                  <div className="space-y-2">
                    {annotations.map((ann) => (
                      <div
                        key={ann.id}
                        className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                          selectedAnnotation?.id === ann.id
                            ? "border-primary bg-accent"
                            : selectedAnnotationIds.has(ann.id)
                              ? "border-blue-300 bg-blue-50 dark:bg-blue-950"
                              : "hover:bg-accent/50"
                        }`}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedAnnotation(ann)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedAnnotation(ann);
                          }
                        }}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={selectedAnnotationIds.has(ann.id)}
                              onCheckedChange={() =>
                                handleToggleAnnotationSelection(ann.id)
                              }
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-3 h-3 rounded-full"
                                  style={{
                                    backgroundColor: SOURCE_COLORS[ann.source],
                                  }}
                                />
                                <span
                                  data-content-role="label"
                                  data-content-label="annotation category"
                                  className="font-medium text-sm"
                                >
                                  {ann.category_name}
                                </span>
                                <Badge
                                  variant="outline"
                                  className="text-xs"
                                  style={{
                                    borderColor:
                                      REVIEW_STATUS_COLORS[ann.review_status],
                                    color:
                                      REVIEW_STATUS_COLORS[ann.review_status],
                                  }}
                                >
                                  {ann.review_status}
                                </Badge>
                              </div>
                              <div
                                data-content-role="metric"
                                data-content-label="annotation details"
                                className="text-xs text-muted-foreground mt-1"
                              >
                                Conf: {(ann.confidence * 100).toFixed(0)}% •{" "}
                                {ann.width}x{ann.height}px •{" "}
                                {ann.element_type || "unknown"}
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-green-600 hover:text-green-700 hover:bg-green-100"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleApprove(ann);
                              }}
                              disabled={ann.review_status === "approved"}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-red-600 hover:text-red-700 hover:bg-red-100"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReject(ann);
                              }}
                              disabled={ann.review_status === "rejected"}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-yellow-600 hover:text-yellow-700 hover:bg-yellow-100"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleFlag(ann);
                              }}
                              disabled={ann.review_status === "flagged"}
                            >
                              <Flag className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[550px] text-muted-foreground">
                <div className="text-center">
                  <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>Select an image to view annotations</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
