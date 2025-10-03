/**
 * Custom hook for State Discovery operations
 */

import { useState, useCallback, useRef } from 'react';
import { StateImage, DiscoveredState, AnalysisConfig, DeletionImpact } from '@/types/stateDiscovery';

// Use the Qontinui API URL for State Discovery endpoints
const API_BASE_URL = process.env.NEXT_PUBLIC_QONTINUI_API_URL || 'http://localhost:8000';
const API_PATH = '/api';

export function useStateDiscovery() {
  const [stateImages, setStateImages] = useState<StateImage[]>([]);
  const [states, setStates] = useState<DiscoveredState[]>([]);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [uploadId, setUploadId] = useState<string>('');
  const [analysisId, setAnalysisId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);

  // Upload screenshots
  const uploadScreenshots = useCallback(async (files: File[]) => {
    setError(null);
    setIsLoading(true);

    try {
      const formData = new FormData();
      files.forEach(file => {
        formData.append('files', file);
      });
      formData.append('project_id', 'default');

      const response = await fetch(`${API_BASE_URL}${API_PATH}/state-discovery/upload`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.text();
        let errorMessage = 'Failed to upload screenshots';
        try {
          const errorJson = JSON.parse(errorData);
          errorMessage = errorJson.detail || errorMessage;
        } catch {
          // If not JSON, use the text
          if (errorData) errorMessage = errorData;
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      setUploadId(data.upload_id);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Start analysis
  const startAnalysis = useCallback(async (
    config: AnalysisConfig,
    onProgress?: (progress: any) => void,
    onComplete?: () => void
  ) => {
    if (!uploadId) {
      throw new Error('No screenshots uploaded');
    }

    console.log('[useStateDiscovery] Starting analysis:', {
      uploadId,
      config,
      apiUrl: `${API_BASE_URL}${API_PATH}/state-discovery/analyze`,
      timestamp: new Date().toISOString()
    });

    setError(null);
    setIsLoading(true);

    try {
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
          similarity_threshold: config.similarityThreshold || 0.95
        }
      };
      console.log('[useStateDiscovery] Sending analysis request:', requestBody);

      const response = await fetch(`${API_BASE_URL}${API_PATH}/state-discovery/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      console.log('[useStateDiscovery] Analysis response received:', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        timestamp: new Date().toISOString()
      });

      if (!response.ok) {
        const errorData = await response.text();
        let errorMessage = 'Failed to start analysis';
        try {
          const errorJson = JSON.parse(errorData);
          errorMessage = errorJson.detail || errorMessage;
        } catch {
          if (errorData) errorMessage = errorData;
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      console.log('[useStateDiscovery] Analysis started successfully:', {
        analysisId: data.analysis_id,
        websocketUrl: data.websocket_url,
        data
      });
      setAnalysisId(data.analysis_id);

      // Connect to WebSocket for progress updates
      if (data.websocket_url) {
        console.log('[useStateDiscovery] Connecting to WebSocket for progress updates');
        connectWebSocket(data.analysis_id, onProgress, onComplete);
      } else {
        console.log('[useStateDiscovery] No WebSocket URL provided, will use polling or wait for completion');
      }

      return data;
    } catch (err) {
      console.error('[useStateDiscovery] Analysis failed:', {
        error: err,
        message: err instanceof Error ? err.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
      setError(err instanceof Error ? err.message : 'Analysis failed');
      throw err;
    }
  }, [uploadId]);

  // Connect to WebSocket for real-time updates
  const connectWebSocket = useCallback((analysisId: string, onProgress?: (progress: any) => void, onComplete?: () => void) => {
    // Close existing connection
    if (wsRef.current) {
      console.log('[useStateDiscovery] Closing existing WebSocket connection');
      wsRef.current.close();
    }

    // Construct WebSocket URL based on API_BASE_URL
    const wsProtocol = API_BASE_URL.startsWith('https') ? 'wss' : 'ws';
    const wsHost = API_BASE_URL.replace(/^https?:\/\//, '');
    const wsUrl = `${wsProtocol}://${wsHost}${API_PATH}/state-discovery/ws/${analysisId}`;
    console.log('[useStateDiscovery] Creating WebSocket connection:', {
      url: wsUrl,
      analysisId,
      timestamp: new Date().toISOString()
    });
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[useStateDiscovery] WebSocket connected:', {
        readyState: ws.readyState,
        timestamp: new Date().toISOString()
      });
    };

    ws.onmessage = (event) => {
      console.log('[useStateDiscovery] WebSocket message received:', {
        rawData: event.data,
        timestamp: new Date().toISOString()
      });
      const message = JSON.parse(event.data);
      console.log('[useStateDiscovery] Parsed message:', message);

      switch (message.type) {
        case 'progress':
          console.log('[useStateDiscovery] Progress update:', message.data);
          if (onProgress) {
            onProgress(message.data);
          }
          break;

        case 'state_image_found':
          console.log('[useStateDiscovery] New state image found:', message.data);
          setStateImages(prev => {
            const updated = [...prev, message.data];
            console.log('[useStateDiscovery] State images count:', updated.length);
            return updated;
          });
          break;

        case 'complete':
          // Analysis complete
          console.log('[useStateDiscovery] Analysis complete, updating states:', {
            newStates: message.data.states?.length || 0,
            newStateImages: message.data.state_images?.length || 0
          });
          setAnalysisResult(message.data);
          setStateImages(message.data.state_images || []);
          setStates(message.data.states || []);
          console.log('[useStateDiscovery] States updated');
          setIsLoading(false);
          if (onComplete) {
            onComplete();
          }
          break;

        case 'error':
          console.error('[useStateDiscovery] Error received via WebSocket:', message.data);
          const errorMessage = message.data?.message || message.data?.error || 'An error occurred during state discovery';
          setError(errorMessage);
          setIsLoading(false);
          break;

        default:
          console.log('[useStateDiscovery] Unhandled message type:', message.type, message);
          break;
      }
    };

    ws.onerror = (error) => {
      console.error('[useStateDiscovery] WebSocket error:', {
        error,
        readyState: ws.readyState,
        timestamp: new Date().toISOString()
      });
      setError('Connection error');
      setIsLoading(false);
    };

    ws.onclose = (event) => {
      console.log('[useStateDiscovery] WebSocket disconnected:', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        timestamp: new Date().toISOString()
      });
    };

    wsRef.current = ws;
  }, []);

  // Get deletion impact
  const getDeleteImpact = useCallback(async (stateImageId: string): Promise<DeletionImpact> => {
    const response = await fetch(
      `${API_BASE_URL}${API_PATH}/state-discovery/state-image/${stateImageId}/delete-impact`
    );

    if (!response.ok) {
      throw new Error('Failed to get deletion impact');
    }

    return response.json();
  }, []);

  // Delete StateImage
  const deleteStateImage = useCallback(async (
    stateImageId: string,
    options?: { cascade?: boolean; force?: boolean }
  ) => {
    const params = new URLSearchParams();
    if (options?.cascade) params.append('cascade', 'true');
    if (options?.force) params.append('force', 'true');

    const response = await fetch(
      `${API_BASE_URL}${API_PATH}/state-discovery/state-image/${stateImageId}?${params}`,
      { method: 'DELETE' }
    );

    if (!response.ok) {
      throw new Error('Failed to delete StateImage');
    }

    const result = await response.json();

    // Update local state
    console.log('[useStateDiscovery] Deleting state image:', stateImageId);
    setStateImages(prev => {
      const newStateImages = prev.filter(si => si.id !== stateImageId);
      console.log('[useStateDiscovery] StateImages after delete:', {
        before: prev.length,
        after: newStateImages.length
      });
      return newStateImages;
    });

    // Also update states to remove the deleted stateImage reference
    setStates(prev => {
      const newStates = prev.map(state => ({
        ...state,
        stateImageIds: state.stateImageIds.filter(id => id !== stateImageId)
      })).filter(state => state.stateImageIds.length > 0); // Remove states with no images

      console.log('[useStateDiscovery] States after stateImage delete:', {
        before: prev.length,
        after: newStates.length,
        removedStates: prev.length - newStates.length
      });
      return newStates;
    });

    return result;
  }, []);

  // Bulk delete StateImages
  const bulkDeleteStateImages = useCallback(async (
    ids: string[],
    options?: any
  ) => {
    const response = await fetch(
      `${API_BASE_URL}${API_PATH}/state-discovery/state-images/batch`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, options })
      }
    );

    if (!response.ok) {
      throw new Error('Failed to delete StateImages');
    }

    const result = await response.json();

    // Update local state
    console.log('[useStateDiscovery] Bulk deleting state images:', ids);
    setStateImages(prev => {
      const newStateImages = prev.filter(si => !result.deleted.includes(si.id));
      console.log('[useStateDiscovery] StateImages after bulk delete:', {
        before: prev.length,
        after: newStateImages.length,
        deleted: result.deleted.length
      });
      return newStateImages;
    });

    // Also update states to remove the deleted stateImage references
    setStates(prev => {
      const deletedIds = new Set(result.deleted);
      const newStates = prev.map(state => ({
        ...state,
        stateImageIds: state.stateImageIds.filter(id => !deletedIds.has(id))
      })).filter(state => state.stateImageIds.length > 0); // Remove states with no images

      console.log('[useStateDiscovery] States after bulk stateImage delete:', {
        before: prev.length,
        after: newStates.length,
        removedStates: prev.length - newStates.length
      });
      return newStates;
    });

    return result;
  }, []);

  // Update StateImage
  const updateStateImage = useCallback(async (
    stateImageId: string,
    updates: Partial<StateImage>
  ) => {
    const response = await fetch(
      `${API_BASE_URL}${API_PATH}/state-discovery/state-image/${stateImageId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      }
    );

    if (!response.ok) {
      throw new Error('Failed to update StateImage');
    }

    const updated = await response.json();

    // Update local state
    setStateImages(prev => prev.map(si =>
      si.id === stateImageId ? { ...si, ...updates } : si
    ));

    return updated;
  }, []);

  // Merge StateImages
  const mergeStateImages = useCallback(async (
    sourceIds: string[],
    targetName: string,
    strategy: string = 'union'
  ) => {
    const response = await fetch(
      `${API_BASE_URL}${API_PATH}/state-discovery/state-image/merge`,
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
  }, []);

  // Save state structure
  const saveStructure = useCallback(async (name: string, description?: string) => {
    if (!analysisId) {
      throw new Error('No analysis to save');
    }

    const response = await fetch(
      `${API_BASE_URL}${API_PATH}/state-discovery/save-structure`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: 'default',
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
  }, [analysisId]);

  // Export state structure
  const exportStructure = useCallback(async (structureId: string, format: string = 'json') => {
    const response = await fetch(
      `${API_BASE_URL}${API_PATH}/state-discovery/export/${structureId}?format=${format}`
    );

    if (!response.ok) {
      throw new Error('Failed to export structure');
    }

    return response.json();
  }, []);

  // Cleanup on unmount
  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  return {
    // Data
    stateImages,
    states,
    analysisResult,
    uploadId,
    analysisId,
    error,
    isLoading,

    // Actions
    uploadScreenshots,
    startAnalysis,
    getDeleteImpact,
    deleteStateImage,
    bulkDeleteStateImages,
    updateStateImage,
    mergeStateImages,
    saveStructure,
    exportStructure,
    cleanup
  };
}
