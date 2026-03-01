import type {
  Dataset,
  DatasetImage,
  DatasetAnnotation,
  DatasetStatistics,
  DatasetFilters,
  AnnotationSource,
  ReviewStatus,
} from "@/types/dataset";

// ============================================================================
// Hook return type
// ============================================================================

export interface DatasetViewerState {
  // Data
  dataset: Dataset | null;
  statistics: DatasetStatistics | null;
  images: DatasetImage[];
  totalImages: number;
  selectedImage: DatasetImage | null;
  annotations: DatasetAnnotation[];
  selectedAnnotation: DatasetAnnotation | null;
  loading: boolean;
  authLoading: boolean;
  isAdmin: boolean;

  // Filters
  filters: DatasetFilters;
  showFilters: boolean;
  showStatistics: boolean;
  showExportDialog: boolean;

  // Bulk selection
  selectedAnnotationIds: Set<string>;
  bulkProcessing: boolean;

  // Derived
  totalPages: number;
  datasetId: string;
}

export interface DatasetViewerActions {
  setSelectedImage: (image: DatasetImage | null) => void;
  setSelectedAnnotation: (annotation: DatasetAnnotation | null) => void;
  setFilters: React.Dispatch<React.SetStateAction<DatasetFilters>>;
  setShowFilters: (show: boolean) => void;
  setShowStatistics: (show: boolean) => void;
  setShowExportDialog: (show: boolean) => void;

  // Filter handlers
  handleSourceFilterChange: (
    source: AnnotationSource,
    checked: boolean
  ) => void;
  handleReviewStatusFilterChange: (
    status: ReviewStatus,
    checked: boolean
  ) => void;

  // Single annotation review
  handleApprove: (annotation: DatasetAnnotation) => Promise<void>;
  handleReject: (annotation: DatasetAnnotation) => Promise<void>;
  handleFlag: (annotation: DatasetAnnotation) => Promise<void>;

  // Bulk operations
  handleToggleAnnotationSelection: (annotationId: string) => void;
  handleSelectAllAnnotations: () => void;
  handleBulkApprove: () => Promise<void>;
  handleBulkReject: () => Promise<void>;
  handleBulkFlag: () => Promise<void>;

  // Navigation
  navigateToDatasets: () => void;
}

// ============================================================================
// Component prop types
// ============================================================================

export interface StatisticsBarProps {
  statistics: DatasetStatistics;
}

export interface FilterSidebarProps {
  filters: DatasetFilters;
  onSourceFilterChange: (source: AnnotationSource, checked: boolean) => void;
  onReviewStatusFilterChange: (status: ReviewStatus, checked: boolean) => void;
  onFiltersChange: React.Dispatch<React.SetStateAction<DatasetFilters>>;
}

export interface ImageGridProps {
  images: DatasetImage[];
  totalImages: number;
  selectedImage: DatasetImage | null;
  filters: DatasetFilters;
  totalPages: number;
  datasetId: string;
  onSelectImage: (image: DatasetImage) => void;
  onFiltersChange: React.Dispatch<React.SetStateAction<DatasetFilters>>;
  showFilters: boolean;
}

export interface AnnotationDetailProps {
  selectedImage: DatasetImage | null;
  annotations: DatasetAnnotation[];
  selectedAnnotation: DatasetAnnotation | null;
  selectedAnnotationIds: Set<string>;
  bulkProcessing: boolean;
  datasetId: string;
  showFilters: boolean;
  onSelectAnnotation: (annotation: DatasetAnnotation | null) => void;
  onApprove: (annotation: DatasetAnnotation) => Promise<void>;
  onReject: (annotation: DatasetAnnotation) => Promise<void>;
  onFlag: (annotation: DatasetAnnotation) => Promise<void>;
  onToggleAnnotationSelection: (annotationId: string) => void;
  onSelectAllAnnotations: () => void;
  onBulkApprove: () => Promise<void>;
  onBulkReject: () => Promise<void>;
  onBulkFlag: () => Promise<void>;
}
