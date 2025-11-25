/**
 * TypeScript types for Training Dataset management.
 *
 * These types correspond to datasets exported from qontinui-runner's
 * Training Data Exporter and stored in the qontinui-web database.
 */

// ============================================================================
// Core Dataset Types
// ============================================================================

export interface Dataset {
  id: string;
  name: string;
  description?: string;
  source: DatasetSource;
  created_at: string;
  updated_at: string;
  created_by: string;

  // Statistics (computed)
  total_images: number;
  total_annotations: number;
  reviewed_count: number;

  // Metadata from export
  dataset_version?: string;
  export_metadata?: Record<string, unknown>;
}

export type DatasetSource = 'runner_export' | 'manual_upload' | 'merged';

export interface DatasetImage {
  id: string;
  dataset_id: string;
  image_hash: string;
  filename: string;
  width: number;
  height: number;
  storage_path: string;
  image_url?: string; // Computed URL for display

  // From manifest
  action_id?: string;
  action_type?: string;
  active_states?: string[];
  timestamp?: string;

  // Annotation count (computed)
  annotation_count?: number;

  // Review status
  reviewed: boolean;
  reviewed_by?: string;
  reviewed_at?: string;
}

export interface DatasetAnnotation {
  id: string;
  dataset_id: string;
  image_id: string;

  // Bounding box (COCO format: x, y, width, height)
  x: number;
  y: number;
  width: number;
  height: number;

  // Category
  category_id: number;
  category_name: string;

  // Metadata
  confidence: number;
  source: AnnotationSource;
  element_type?: ElementType;
  verified: boolean;

  // Smart analysis metadata (from click_analysis module)
  inference_metadata?: InferenceMetadata;

  // Review workflow
  review_status: ReviewStatus;
  reviewer_notes?: string;
  reviewed_by?: string;
  reviewed_at?: string;
}

export type AnnotationSource =
  | 'user_click'
  | 'template_matching'
  | 'smart_click_analysis'
  | 'manual';

export type ElementType =
  | 'button'
  | 'icon'
  | 'text'
  | 'image'
  | 'checkbox'
  | 'radio'
  | 'input_field'
  | 'link'
  | 'menu_item'
  | 'tab'
  | 'unknown';

export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'flagged';

export interface InferenceMetadata {
  strategy_used: string;
  element_type: string;
  used_fallback: boolean;
  processing_time_ms: number;
  alternatives_count?: number;
}

// ============================================================================
// Statistics Types
// ============================================================================

export interface DatasetStatistics {
  total_images: number;
  unique_images: number;
  total_annotations: number;
  reviewed_images: number;
  reviewed_annotations: number;

  // Breakdown by source
  by_source: Record<AnnotationSource, number>;

  // Breakdown by element type
  by_element_type: Record<string, number>;

  // Breakdown by review status
  by_review_status: Record<ReviewStatus, number>;

  // Confidence statistics
  confidence_stats: {
    min: number;
    max: number;
    mean: number;
    median: number;
  };

  // Category breakdown
  by_category: Array<{
    category_id: number;
    category_name: string;
    count: number;
  }>;
}

export interface ConfidenceHistogram {
  buckets: Array<{
    min: number;
    max: number;
    count: number;
  }>;
}

// ============================================================================
// Filter Types
// ============================================================================

export interface DatasetFilters {
  // Source filter
  sources?: AnnotationSource[];

  // Element type filter
  element_types?: ElementType[];

  // Confidence range
  confidence_min?: number;
  confidence_max?: number;

  // Review status filter
  review_statuses?: ReviewStatus[];

  // Verified filter
  verified?: boolean;

  // Category filter
  category_names?: string[];

  // Search
  search?: string;

  // Pagination
  page?: number;
  page_size?: number;

  // Sorting
  sort_by?: 'confidence' | 'created_at' | 'category_name' | 'review_status';
  sort_order?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// ============================================================================
// Import/Export Types
// ============================================================================

export interface DatasetImportRequest {
  name: string;
  description?: string;
  // File will be sent as FormData
}

export interface DatasetImportResult {
  dataset_id: string;
  images_imported: number;
  annotations_imported: number;
  warnings: string[];
  errors: string[];
}

export interface DatasetExportRequest {
  format: ExportFormat;
  filters?: DatasetFilters;
  split?: TrainValTestSplit;
  include_images: boolean;
}

export type ExportFormat = 'coco' | 'yolo' | 'pascal_voc' | 'csv' | 'jsonl';

export interface TrainValTestSplit {
  train_percent: number;
  val_percent: number;
  test_percent: number;
  random_seed?: number;
}

export interface DatasetExportJob {
  id: string;
  dataset_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  format: ExportFormat;
  download_url?: string;
  error?: string;
  created_at: string;
  completed_at?: string;
}

// ============================================================================
// Bulk Operation Types
// ============================================================================

export interface BulkAnnotationUpdate {
  annotation_ids: string[];
  update: {
    review_status?: ReviewStatus;
    reviewer_notes?: string;
    verified?: boolean;
  };
}

export interface BulkOperationResult {
  updated_count: number;
  failed_count: number;
  errors: Array<{
    annotation_id: string;
    error: string;
  }>;
}

// ============================================================================
// UI State Types
// ============================================================================

export interface DatasetViewerState {
  selectedDataset: Dataset | null;
  selectedImage: DatasetImage | null;
  selectedAnnotation: DatasetAnnotation | null;
  filters: DatasetFilters;
  viewMode: 'grid' | 'list';
  showStatistics: boolean;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface DatasetListResponse {
  datasets: Dataset[];
  total: number;
}

export interface DatasetDetailResponse extends Dataset {
  images: PaginatedResponse<DatasetImage>;
  statistics: DatasetStatistics;
}

export interface ImageDetailResponse extends DatasetImage {
  annotations: DatasetAnnotation[];
}
