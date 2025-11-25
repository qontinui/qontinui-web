/**
 * Dataset Service - API client for training dataset management.
 *
 * Provides methods for:
 * - Listing and managing datasets
 * - Browsing images and annotations
 * - Importing datasets from Training Data Exporter
 * - Exporting datasets to various formats
 * - Bulk operations on annotations
 */

import type {
  Dataset,
  DatasetImage,
  DatasetAnnotation,
  DatasetStatistics,
  DatasetFilters,
  PaginatedResponse,
  DatasetImportResult,
  DatasetExportRequest,
  DatasetExportJob,
  BulkAnnotationUpdate,
  BulkOperationResult,
  ConfidenceHistogram,
  ReviewStatus,
} from '@/types/dataset';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

class DatasetService {
  private getAuthHeaders(): HeadersInit {
    // Get token from localStorage or auth context
    const token = typeof window !== 'undefined'
      ? localStorage.getItem('access_token')
      : null;

    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }
    return response.json();
  }

  // ============================================================================
  // Dataset CRUD
  // ============================================================================

  async listDatasets(): Promise<Dataset[]> {
    const response = await fetch(`${API_BASE}/api/v1/datasets/`, {
      headers: this.getAuthHeaders(),
    });
    return this.handleResponse<Dataset[]>(response);
  }

  async getDataset(id: string): Promise<Dataset> {
    const response = await fetch(`${API_BASE}/api/v1/datasets/${id}`, {
      headers: this.getAuthHeaders(),
    });
    return this.handleResponse<Dataset>(response);
  }

  async createDataset(data: { name: string; description?: string }): Promise<Dataset> {
    const response = await fetch(`${API_BASE}/api/v1/datasets/`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data),
    });
    return this.handleResponse<Dataset>(response);
  }

  async updateDataset(
    id: string,
    data: { name?: string; description?: string }
  ): Promise<Dataset> {
    const response = await fetch(`${API_BASE}/api/v1/datasets/${id}`, {
      method: 'PUT',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(data),
    });
    return this.handleResponse<Dataset>(response);
  }

  async deleteDataset(id: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/v1/datasets/${id}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }
  }

  // ============================================================================
  // Dataset Images
  // ============================================================================

  async getDatasetImages(
    datasetId: string,
    filters?: DatasetFilters
  ): Promise<PaginatedResponse<DatasetImage>> {
    const params = new URLSearchParams();

    if (filters?.page) params.set('page', String(filters.page));
    if (filters?.page_size) params.set('page_size', String(filters.page_size));
    if (filters?.review_statuses?.length) {
      filters.review_statuses.forEach((s) => params.append('review_status', s));
    }
    if (filters?.search) params.set('search', filters.search);
    if (filters?.sort_by) params.set('sort_by', filters.sort_by);
    if (filters?.sort_order) params.set('sort_order', filters.sort_order);

    const url = `${API_BASE}/api/v1/datasets/${datasetId}/images?${params}`;
    const response = await fetch(url, {
      headers: this.getAuthHeaders(),
    });
    return this.handleResponse<PaginatedResponse<DatasetImage>>(response);
  }

  async getImage(datasetId: string, imageId: string): Promise<DatasetImage> {
    const response = await fetch(
      `${API_BASE}/api/v1/datasets/${datasetId}/images/${imageId}`,
      { headers: this.getAuthHeaders() }
    );
    return this.handleResponse<DatasetImage>(response);
  }

  async updateImage(
    datasetId: string,
    imageId: string,
    data: { reviewed?: boolean; reviewer_notes?: string }
  ): Promise<DatasetImage> {
    const response = await fetch(
      `${API_BASE}/api/v1/datasets/${datasetId}/images/${imageId}`,
      {
        method: 'PUT',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(data),
      }
    );
    return this.handleResponse<DatasetImage>(response);
  }

  // ============================================================================
  // Dataset Annotations
  // ============================================================================

  async getAnnotations(
    datasetId: string,
    filters?: DatasetFilters
  ): Promise<PaginatedResponse<DatasetAnnotation>> {
    const params = new URLSearchParams();

    if (filters?.page) params.set('page', String(filters.page));
    if (filters?.page_size) params.set('page_size', String(filters.page_size));
    if (filters?.sources?.length) {
      filters.sources.forEach((s) => params.append('source', s));
    }
    if (filters?.element_types?.length) {
      filters.element_types.forEach((t) => params.append('element_type', t));
    }
    if (filters?.confidence_min !== undefined) {
      params.set('confidence_min', String(filters.confidence_min));
    }
    if (filters?.confidence_max !== undefined) {
      params.set('confidence_max', String(filters.confidence_max));
    }
    if (filters?.review_statuses?.length) {
      filters.review_statuses.forEach((s) => params.append('review_status', s));
    }
    if (filters?.verified !== undefined) {
      params.set('verified', String(filters.verified));
    }
    if (filters?.category_names?.length) {
      filters.category_names.forEach((c) => params.append('category_name', c));
    }
    if (filters?.search) params.set('search', filters.search);
    if (filters?.sort_by) params.set('sort_by', filters.sort_by);
    if (filters?.sort_order) params.set('sort_order', filters.sort_order);

    const url = `${API_BASE}/api/v1/datasets/${datasetId}/annotations?${params}`;
    const response = await fetch(url, {
      headers: this.getAuthHeaders(),
    });
    return this.handleResponse<PaginatedResponse<DatasetAnnotation>>(response);
  }

  async getImageAnnotations(
    datasetId: string,
    imageId: string
  ): Promise<DatasetAnnotation[]> {
    const response = await fetch(
      `${API_BASE}/api/v1/datasets/${datasetId}/images/${imageId}/annotations`,
      { headers: this.getAuthHeaders() }
    );
    return this.handleResponse<DatasetAnnotation[]>(response);
  }

  async getAnnotation(
    datasetId: string,
    annotationId: string
  ): Promise<DatasetAnnotation> {
    const response = await fetch(
      `${API_BASE}/api/v1/datasets/${datasetId}/annotations/${annotationId}`,
      { headers: this.getAuthHeaders() }
    );
    return this.handleResponse<DatasetAnnotation>(response);
  }

  async updateAnnotation(
    datasetId: string,
    annotationId: string,
    data: Partial<DatasetAnnotation>
  ): Promise<DatasetAnnotation> {
    const response = await fetch(
      `${API_BASE}/api/v1/datasets/${datasetId}/annotations/${annotationId}`,
      {
        method: 'PUT',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(data),
      }
    );
    return this.handleResponse<DatasetAnnotation>(response);
  }

  async deleteAnnotation(datasetId: string, annotationId: string): Promise<void> {
    const response = await fetch(
      `${API_BASE}/api/v1/datasets/${datasetId}/annotations/${annotationId}`,
      {
        method: 'DELETE',
        headers: this.getAuthHeaders(),
      }
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }
  }

  async bulkUpdateAnnotations(
    datasetId: string,
    update: BulkAnnotationUpdate
  ): Promise<BulkOperationResult> {
    const response = await fetch(
      `${API_BASE}/api/v1/datasets/${datasetId}/annotations/bulk`,
      {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(update),
      }
    );
    return this.handleResponse<BulkOperationResult>(response);
  }

  // Convenience methods for review workflow
  async approveAnnotation(
    datasetId: string,
    annotationId: string,
    notes?: string
  ): Promise<DatasetAnnotation> {
    return this.updateAnnotation(datasetId, annotationId, {
      review_status: 'approved' as ReviewStatus,
      reviewer_notes: notes,
      verified: true,
    });
  }

  async rejectAnnotation(
    datasetId: string,
    annotationId: string,
    notes?: string
  ): Promise<DatasetAnnotation> {
    return this.updateAnnotation(datasetId, annotationId, {
      review_status: 'rejected' as ReviewStatus,
      reviewer_notes: notes,
    });
  }

  async flagAnnotation(
    datasetId: string,
    annotationId: string,
    notes?: string
  ): Promise<DatasetAnnotation> {
    return this.updateAnnotation(datasetId, annotationId, {
      review_status: 'flagged' as ReviewStatus,
      reviewer_notes: notes,
    });
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  async getStatistics(datasetId: string): Promise<DatasetStatistics> {
    const response = await fetch(
      `${API_BASE}/api/v1/datasets/${datasetId}/stats`,
      { headers: this.getAuthHeaders() }
    );
    return this.handleResponse<DatasetStatistics>(response);
  }

  async getConfidenceHistogram(
    datasetId: string,
    buckets: number = 10
  ): Promise<ConfidenceHistogram> {
    const response = await fetch(
      `${API_BASE}/api/v1/datasets/${datasetId}/stats/confidence-histogram?buckets=${buckets}`,
      { headers: this.getAuthHeaders() }
    );
    return this.handleResponse<ConfidenceHistogram>(response);
  }

  // ============================================================================
  // Import
  // ============================================================================

  async importDataset(
    file: File,
    name: string,
    description?: string,
    onProgress?: (progress: number) => void
  ): Promise<DatasetImportResult> {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', name);
      if (description) formData.append('description', description);

      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && onProgress) {
          const progress = Math.round((event.loaded / event.total) * 100);
          onProgress(progress);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          const error = JSON.parse(xhr.responseText);
          reject(new Error(error.detail || `HTTP ${xhr.status}`));
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Network error during upload'));
      });

      const token = typeof window !== 'undefined'
        ? localStorage.getItem('access_token')
        : null;

      xhr.open('POST', `${API_BASE}/api/v1/datasets/import`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
    });
  }

  // ============================================================================
  // Export
  // ============================================================================

  async startExport(
    datasetId: string,
    request: DatasetExportRequest
  ): Promise<DatasetExportJob> {
    const response = await fetch(
      `${API_BASE}/api/v1/datasets/${datasetId}/export`,
      {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(request),
      }
    );
    return this.handleResponse<DatasetExportJob>(response);
  }

  async getExportJob(datasetId: string, jobId: string): Promise<DatasetExportJob> {
    const response = await fetch(
      `${API_BASE}/api/v1/datasets/${datasetId}/export/${jobId}`,
      { headers: this.getAuthHeaders() }
    );
    return this.handleResponse<DatasetExportJob>(response);
  }

  async pollExportJob(
    datasetId: string,
    jobId: string,
    onProgress?: (job: DatasetExportJob) => void,
    intervalMs: number = 1000
  ): Promise<DatasetExportJob> {
    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const job = await this.getExportJob(datasetId, jobId);
          onProgress?.(job);

          if (job.status === 'completed') {
            resolve(job);
          } else if (job.status === 'failed') {
            reject(new Error(job.error || 'Export failed'));
          } else {
            setTimeout(poll, intervalMs);
          }
        } catch (error) {
          reject(error);
        }
      };

      poll();
    });
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  getImageUrl(datasetId: string, imageHash: string): string {
    return `${API_BASE}/api/v1/datasets/${datasetId}/images/${imageHash}/file`;
  }

  getImageThumbnailUrl(
    datasetId: string,
    imageHash: string,
    size: number = 200
  ): string {
    return `${API_BASE}/api/v1/datasets/${datasetId}/images/${imageHash}/thumbnail?size=${size}`;
  }
}

// Export singleton instance
export const datasetService = new DatasetService();

// Export class for testing
export { DatasetService };
