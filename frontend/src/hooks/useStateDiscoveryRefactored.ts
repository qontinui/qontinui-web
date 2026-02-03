/**
 * Refactored State Discovery Hook
 * Single Responsibility: Coordinate between different state discovery modules
 */

import { useState, useCallback, useRef, useEffect } from "react";
import {
  StateImage,
  DiscoveredState,
  AnalysisConfig,
  DeletionImpact,
} from "@/types/stateDiscovery";
import { StateDiscoveryAPIClient } from "./stateDiscovery/apiClient";
import { StateDiscoveryWebSocketManager } from "./stateDiscovery/websocketManager";
import { StateDiscoveryStateManager } from "./stateDiscovery/stateManager";

// Use the main backend URL for State Discovery endpoints
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const API_PATH = "/api";

export function useStateDiscovery() {
  // Module instances
  const apiClientRef = useRef<StateDiscoveryAPIClient | undefined>(undefined);
  const wsManagerRef = useRef<StateDiscoveryWebSocketManager | undefined>(
    undefined
  );
  const stateManagerRef = useRef<StateDiscoveryStateManager | undefined>(
    undefined
  );

  // Local React state
  const [stateImages, setStateImages] = useState<StateImage[]>([]);
  const [states, setStates] = useState<DiscoveredState[]>([]);
  const [analysisResult, setAnalysisResult] = useState<unknown>(null);
  const [uploadId, setUploadId] = useState<string>("");
  const [analysisId, setAnalysisId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Initialize modules
  useEffect(() => {
    console.log("[useStateDiscovery] Initializing modules");

    // Create module instances
    apiClientRef.current = new StateDiscoveryAPIClient(API_BASE_URL, API_PATH);
    wsManagerRef.current = new StateDiscoveryWebSocketManager();
    stateManagerRef.current = new StateDiscoveryStateManager();

    // Subscribe to state manager changes
    const unsubscribe = stateManagerRef.current.subscribe((type, data) => {
      console.log("[useStateDiscovery] State change:", type);

      switch (type) {
        case "stateImages":
          setStateImages([...(data as StateImage[])]);
          break;
        case "states":
          setStates([...(data as DiscoveredState[])]);
          break;
        case "clear":
          setStateImages([]);
          setStates([]);
          break;
      }
    });

    // Cleanup
    return () => {
      console.log("[useStateDiscovery] Cleaning up");
      unsubscribe();
      wsManagerRef.current?.disconnect();
    };
  }, []);

  // Upload screenshots
  const uploadScreenshots = useCallback(async (files: File[]) => {
    console.log("[useStateDiscovery] Uploading screenshots:", files.length);
    setError(null);
    setIsLoading(true);

    try {
      if (!apiClientRef.current) {
        throw new Error("API client not initialized");
      }

      const data = await apiClientRef.current.uploadScreenshots(files);
      const typedData = data as { upload_id: string };
      setUploadId(typedData.upload_id);
      console.log("[useStateDiscovery] Upload complete:", typedData.upload_id);
      return data;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Upload failed";
      console.error("[useStateDiscovery] Upload failed:", errorMsg);
      setError(errorMsg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Start analysis
  const startAnalysis = useCallback(
    async (
      config: AnalysisConfig,
      onProgress?: (progress: unknown) => void,
      onComplete?: () => void
    ) => {
      console.log("[useStateDiscovery] Starting analysis:", {
        uploadId,
        config,
        timestamp: new Date().toISOString(),
      });

      if (!uploadId) {
        throw new Error("No screenshots uploaded");
      }

      setError(null);
      setIsLoading(true);

      try {
        if (
          !apiClientRef.current ||
          !wsManagerRef.current ||
          !stateManagerRef.current
        ) {
          throw new Error("Modules not initialized");
        }

        // Start analysis via API
        const data = await apiClientRef.current.startAnalysis(uploadId, config);
        const typedData = data as {
          analysis_id: string;
          websocket_url?: string;
        };
        setAnalysisId(typedData.analysis_id);

        // Connect WebSocket for progress updates
        if (typedData.websocket_url) {
          console.log("[useStateDiscovery] Setting up WebSocket connection");

          wsManagerRef.current.connect(
            typedData.analysis_id,
            API_BASE_URL,
            API_PATH,
            {
              onProgress: (progress) => {
                console.log("[useStateDiscovery] Progress:", progress);
                if (onProgress) onProgress(progress);
              },
              onStateImageFound: (stateImage) => {
                console.log(
                  "[useStateDiscovery] State image found:",
                  stateImage
                );
                stateManagerRef.current?.addStateImage(
                  stateImage as StateImage
                );
              },
              onComplete: (completeData) => {
                const typedCompleteData = completeData as {
                  states?: DiscoveredState[];
                  state_images?: StateImage[];
                };
                console.log("[useStateDiscovery] Analysis complete:", {
                  states: typedCompleteData.states?.length || 0,
                  stateImages: typedCompleteData.state_images?.length || 0,
                });

                setAnalysisResult(completeData);

                if (typedCompleteData.state_images) {
                  stateManagerRef.current?.setStateImages(
                    typedCompleteData.state_images
                  );
                }
                if (typedCompleteData.states) {
                  stateManagerRef.current?.setStates(typedCompleteData.states);
                }

                setIsLoading(false);
                if (onComplete) onComplete();
              },
              onError: (errorMsg) => {
                console.error("[useStateDiscovery] WebSocket error:", errorMsg);
                setError(errorMsg);
                setIsLoading(false);
              },
            }
          );
        }

        return data;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Analysis failed";
        console.error("[useStateDiscovery] Analysis failed:", errorMsg);
        setError(errorMsg);
        setIsLoading(false);
        throw err;
      }
    },
    [uploadId]
  );

  // Get deletion impact
  const getDeleteImpact = useCallback(
    async (stateImageId: string): Promise<DeletionImpact> => {
      console.log("[useStateDiscovery] Getting deletion impact:", stateImageId);

      if (!apiClientRef.current) {
        throw new Error("API client not initialized");
      }

      return apiClientRef.current.getDeleteImpact(stateImageId);
    },
    []
  );

  // Delete StateImage
  const deleteStateImage = useCallback(
    async (
      stateImageId: string,
      options?: { cascade?: boolean; force?: boolean }
    ) => {
      console.log("[useStateDiscovery] Deleting state image:", stateImageId);

      if (!apiClientRef.current || !stateManagerRef.current) {
        throw new Error("Modules not initialized");
      }

      const result = await apiClientRef.current.deleteStateImage(
        stateImageId,
        options
      );
      stateManagerRef.current.removeStateImage(stateImageId);

      return result;
    },
    []
  );

  // Bulk delete StateImages
  const bulkDeleteStateImages = useCallback(
    async (ids: string[], options?: unknown) => {
      console.log(
        "[useStateDiscovery] Bulk deleting state images:",
        ids.length
      );

      if (!apiClientRef.current || !stateManagerRef.current) {
        throw new Error("Modules not initialized");
      }

      const result = await apiClientRef.current.bulkDeleteStateImages(
        ids,
        options
      );

      const typedResult = result as { deleted?: string[] };
      if (typedResult.deleted && Array.isArray(typedResult.deleted)) {
        stateManagerRef.current.bulkRemoveStateImages(typedResult.deleted);
      }

      return result;
    },
    []
  );

  // Update StateImage
  const updateStateImage = useCallback(
    async (stateImageId: string, updates: Partial<StateImage>) => {
      console.log("[useStateDiscovery] Updating state image:", stateImageId);

      if (!apiClientRef.current || !stateManagerRef.current) {
        throw new Error("Modules not initialized");
      }

      const result = await apiClientRef.current.updateStateImage(
        stateImageId,
        updates
      );
      stateManagerRef.current.updateStateImage(stateImageId, updates);

      return result;
    },
    []
  );

  // Merge StateImages
  const mergeStateImages = useCallback(
    async (
      sourceIds: string[],
      targetName: string,
      strategy: string = "union"
    ) => {
      console.log(
        "[useStateDiscovery] Merging state images:",
        sourceIds.length
      );

      if (!apiClientRef.current) {
        throw new Error("API client not initialized");
      }

      return apiClientRef.current.mergeStateImages(
        sourceIds,
        targetName,
        strategy
      );
    },
    []
  );

  // Save state structure
  const saveStructure = useCallback(
    async (name: string, description?: string) => {
      console.log("[useStateDiscovery] Saving structure:", name);

      if (!analysisId) {
        throw new Error("No analysis to save");
      }

      if (!apiClientRef.current) {
        throw new Error("API client not initialized");
      }

      return apiClientRef.current.saveStructure(analysisId, name, description);
    },
    [analysisId]
  );

  // Export state structure
  const exportStructure = useCallback(
    async (structureId: string, format: string = "json") => {
      console.log("[useStateDiscovery] Exporting structure:", structureId);

      if (!apiClientRef.current) {
        throw new Error("API client not initialized");
      }

      return apiClientRef.current.exportStructure(structureId, format);
    },
    []
  );

  // Cleanup on unmount
  const cleanup = useCallback(() => {
    console.log("[useStateDiscovery] Manual cleanup");
    wsManagerRef.current?.disconnect();
    stateManagerRef.current?.clear();
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
    cleanup,
  };
}
