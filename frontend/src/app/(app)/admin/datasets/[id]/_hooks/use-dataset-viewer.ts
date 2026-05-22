import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { datasetService } from "@/services/dataset-service";
import { toast } from "sonner";
import type {
  Dataset,
  DatasetImage,
  DatasetAnnotation,
  DatasetStatistics,
  DatasetFilters,
  AnnotationSource,
  ReviewStatus,
} from "@/types/dataset";
import { filterAnnotations, DEFAULT_FILTERS } from "../dataset-viewer-utils";
import type {
  DatasetViewerState,
  DatasetViewerActions,
} from "../dataset-viewer-types";

export function useDatasetViewer(): DatasetViewerState & DatasetViewerActions {
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
  const [filters, setFilters] = useState<DatasetFilters>(DEFAULT_FILTERS);

  // UI state
  const [showFilters, setShowFilters] = useState(true);
  const [showStatistics, setShowStatistics] = useState(true);
  const [showExportDialog, setShowExportDialog] = useState(false);

  // Bulk selection state
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<
    Set<string>
  >(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

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
      const filtered = filterAnnotations(anns, filters);
      setAnnotations(filtered);
    } catch (error) {
      console.error("Error loading annotations:", error);
      toast.error("Failed to load annotations");
    }
  };

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (user && !user.is_superuser) {
      toast.error("Access denied - Admin privileges required");
      router.push("/build/workflows");
    }
  }, [user, router]);

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

  // ---------------------------------------------------------------------------
  // Filter handlers
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Single annotation review handlers
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Bulk operation handlers
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  const navigateToDatasets = () => {
    router.push("/admin/datasets");
  };

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const totalPages = Math.ceil(totalImages / (filters.page_size || 24));
  const isAdmin = !!user?.is_superuser;

  return {
    // State
    dataset,
    statistics,
    images,
    totalImages,
    selectedImage,
    annotations,
    selectedAnnotation,
    loading,
    authLoading,
    isAdmin,
    filters,
    showFilters,
    showStatistics,
    showExportDialog,
    selectedAnnotationIds,
    bulkProcessing,
    totalPages,
    datasetId,

    // Actions
    setSelectedImage,
    setSelectedAnnotation,
    setFilters,
    setShowFilters,
    setShowStatistics,
    setShowExportDialog,
    handleSourceFilterChange,
    handleReviewStatusFilterChange,
    handleApprove,
    handleReject,
    handleFlag,
    handleToggleAnnotationSelection,
    handleSelectAllAnnotations,
    handleBulkApprove,
    handleBulkReject,
    handleBulkFlag,
    navigateToDatasets,
  };
}
