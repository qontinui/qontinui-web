/**
 * API client for State Discovery
 * Single Responsibility: Handle all HTTP API calls to the backend
 */

import { AnalysisConfig, DeletionImpact, StateImage } from '@/types/stateDiscovery';

export class StateDiscoveryAPIClient {
  private apiBaseUrl: string;
  private apiPath: string;

  constructor(apiBaseUrl: string, apiPath: string) {
    this.apiBaseUrl = apiBaseUrl;
    this.apiPath = apiPath;
    console.log('[APIClient] Initialized with:', { apiBaseUrl, apiPath });
  }

  private getUrl(endpoint: string): string {
    return `${this.apiBaseUrl}${this.apiPath}/state-discovery${endpoint}`;
  }

  async uploadScreenshots(files: File[], projectId: string = 'default'): Promise<any> {
    console.log('[APIClient] Uploading screenshots:', {
      filesCount: files.length,
      projectId,
      timestamp: new Date().toISOString()
    });

    const formData = new FormData();
    files.forEach(file => {
      formData.append('files', file);
    });
    formData.append('project_id', projectId);

    const response = await fetch(this.getUrl('/upload'), {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errorData = await this.parseErrorResponse(response);
      throw new Error(errorData);
    }

    const data = await response.json();
    console.log('[APIClient] Upload successful:', {
      uploadId: data.upload_id,
      count: data.count
    });
    return data;
  }

  async startAnalysis(uploadId: string, config: AnalysisConfig): Promise<any> {
    console.log('[APIClient] Starting analysis:', {
      uploadId,
      config,
      timestamp: new Date().toISOString()
    });

    const requestBody = {
      upload_id: uploadId,
      config: {
        min_region_size: config.minRegionSize,
        max_region_size: config.maxRegionSize,
        color_tolerance: config.colorTolerance,
        stability_threshold: config.stabilityThreshold,
        variance_threshold: config.varianceThreshold,
        min_screenshots_present: config.minScreenshotsPresent,
        processing_mode: config.processingMode,
        enable_rectangle_decomposition: config.enableRectangleDecomposition,
        enable_cooccurrence_analysis: config.enableCooccurrenceAnalysis,
        similarity_threshold: config.similarityThreshold || 0.95,
        region: config.region ? {
          x: Math.round(config.region.x),
          y: Math.round(config.region.y),
          width: Math.round(config.region.width),
          height: Math.round(config.region.height)
        } : undefined
      }
    };

    const response = await fetch(this.getUrl('/analyze'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    console.log('[APIClient] Analysis response:', {
      status: response.status,
      statusText: response.statusText
    });

    if (!response.ok) {
      const errorData = await this.parseErrorResponse(response);
      throw new Error(errorData);
    }

    const data = await response.json();
    console.log('[APIClient] Analysis started:', {
      analysisId: data.analysis_id,
      websocketUrl: data.websocket_url
    });
    return data;
  }

  async getDeleteImpact(stateImageId: string): Promise<DeletionImpact> {
    console.log('[APIClient] Getting deletion impact:', stateImageId);

    const response = await fetch(
      this.getUrl(`/state-image/${stateImageId}/delete-impact`)
    );

    if (!response.ok) {
      throw new Error('Failed to get deletion impact');
    }

    return response.json();
  }

  async deleteStateImage(
    stateImageId: string,
    options?: { cascade?: boolean; force?: boolean }
  ): Promise<any> {
    console.log('[APIClient] Deleting state image:', {
      stateImageId,
      options
    });

    const params = new URLSearchParams();
    if (options?.cascade) params.append('cascade', 'true');
    if (options?.force) params.append('force', 'true');

    const response = await fetch(
      this.getUrl(`/state-image/${stateImageId}?${params}`),
      { method: 'DELETE' }
    );

    if (!response.ok) {
      throw new Error('Failed to delete StateImage');
    }

    return response.json();
  }

  async bulkDeleteStateImages(ids: string[], options?: any): Promise<any> {
    console.log('[APIClient] Bulk deleting state images:', {
      count: ids.length,
      options
    });

    const response = await fetch(
      this.getUrl('/state-images/batch'),
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, options })
      }
    );

    if (!response.ok) {
      throw new Error('Failed to delete StateImages');
    }

    return response.json();
  }

  async updateStateImage(
    stateImageId: string,
    updates: Partial<StateImage>
  ): Promise<any> {
    console.log('[APIClient] Updating state image:', {
      stateImageId,
      updates
    });

    const response = await fetch(
      this.getUrl(`/state-image/${stateImageId}`),
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      }
    );

    if (!response.ok) {
      throw new Error('Failed to update StateImage');
    }

    return response.json();
  }

  async mergeStateImages(
    sourceIds: string[],
    targetName: string,
    strategy: string = 'union'
  ): Promise<any> {
    console.log('[APIClient] Merging state images:', {
      sourceCount: sourceIds.length,
      targetName,
      strategy
    });

    const response = await fetch(
      this.getUrl('/state-image/merge'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_ids: sourceIds,
          target_name: targetName,
          merge_strategy: strategy
        })
      }
    );

    if (!response.ok) {
      throw new Error('Failed to merge StateImages');
    }

    return response.json();
  }

  async saveStructure(
    analysisId: string,
    name: string,
    description?: string,
    projectId: string = 'default'
  ): Promise<any> {
    console.log('[APIClient] Saving structure:', {
      analysisId,
      name,
      projectId
    });

    const response = await fetch(
      this.getUrl('/save-structure'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          analysis_id: analysisId,
          name,
          description
        })
      }
    );

    if (!response.ok) {
      throw new Error('Failed to save structure');
    }

    return response.json();
  }

  async exportStructure(structureId: string, format: string = 'json'): Promise<any> {
    console.log('[APIClient] Exporting structure:', {
      structureId,
      format
    });

    const response = await fetch(
      this.getUrl(`/export/${structureId}?format=${format}`)
    );

    if (!response.ok) {
      throw new Error('Failed to export structure');
    }

    return response.json();
  }

  private async parseErrorResponse(response: Response): Promise<string> {
    const errorData = await response.text();
    let errorMessage = 'Request failed';

    try {
      const errorJson = JSON.parse(errorData);
      errorMessage = errorJson.detail || errorMessage;
    } catch {
      if (errorData) errorMessage = errorData;
    }

    console.error('[APIClient] Error response:', {
      status: response.status,
      message: errorMessage
    });

    return errorMessage;
  }
}
