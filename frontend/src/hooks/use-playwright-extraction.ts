"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  runnerClient,
  type StartPlaywrightCollectionRequest,
  type PlaywrightClickable,
} from "@/lib/runner-client";

/**
 * Job status from runner
 */
export interface PlaywrightExtractionJob {
  job_id: string;
  status: "idle" | "pending" | "running" | "completed" | "failed";
  url: string;
  progress_message?: string;
  progress_percent?: number;
  error?: string;
  has_results?: boolean;
}

/**
 * Results from runner
 */
export interface PlaywrightExtractionResults {
  success: boolean;
  job_id?: string;
  url?: string;
  clickables?: PlaywrightClickable[];
  skipped_dangerous?: Array<{
    selector: string;
    text?: string;
    risk: string;
    reason: string;
    url: string;
  }>;
  metrics?: {
    total_found: number;
    clicked: number;
    skipped_dangerous: number;
    pages_visited: number;
    errors: number;
    verified?: number;
    unverified?: number;
  };
  pages_visited?: string[];
  errors?: string[];
  error?: string;
}

/**
 * Hook to start and monitor a Playwright extraction job via the runner.
 */
export function usePlaywrightExtraction() {
  const queryClient = useQueryClient();
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [results, setResults] = useState<PlaywrightExtractionResults | null>(
    null
  );
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Query for current job status
  const {
    data: currentJob,
    isLoading: isLoadingJob,
    error: jobError,
    refetch: refetchJob,
  } = useQuery<PlaywrightExtractionJob | null>({
    queryKey: ["playwright-extraction", currentJobId],
    queryFn: async () => {
      if (!currentJobId) return null;

      const response =
        await runnerClient.getPlaywrightCollectionStatus(currentJobId);
      if (!response.success || !response.data) {
        return null;
      }

      return {
        job_id: response.data.job_id || currentJobId,
        status: response.data.status,
        url: response.data.url || "",
        progress_message: response.data.progress_message,
        progress_percent: response.data.progress_percent,
        error: response.data.error,
        has_results: response.data.has_results,
      };
    },
    enabled: !!currentJobId,
    refetchInterval: isPolling ? 2000 : false,
  });

  // Fetch results when job completes
  useEffect(() => {
    if (currentJob?.status === "completed" && currentJob.has_results) {
      runnerClient
        .getPlaywrightCollectionResults(currentJob.job_id)
        .then((response) => {
          if (response.success && response.data) {
            setResults(response.data);
          }
        });
    }
  }, [currentJob?.status, currentJob?.has_results, currentJob?.job_id]);

  // Stop polling when job completes or fails
  useEffect(() => {
    if (
      currentJob &&
      (currentJob.status === "completed" || currentJob.status === "failed")
    ) {
      setIsPolling(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentJob?.status]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        // eslint-disable-next-line react-hooks/exhaustive-deps
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  // Mutation to start extraction
  const startExtractionMutation = useMutation({
    mutationFn: async (request: StartPlaywrightCollectionRequest) => {
      const response = await runnerClient.startPlaywrightCollection(request);
      if (!response.success) {
        throw new Error(response.error || "Failed to start extraction");
      }
      return {
        job_id: response.data?.job_id || "",
        success: response.data?.success ?? true,
      };
    },
    onSuccess: (result) => {
      if (result.job_id) {
        setCurrentJobId(result.job_id);
        setIsPolling(true);
        setResults(null);
        queryClient.invalidateQueries({ queryKey: ["playwright-jobs"] });
      }
    },
  });

  // Mutation to stop extraction
  const stopExtractionMutation = useMutation({
    mutationFn: async () => {
      const response = await runnerClient.stopPlaywrightCollection();
      if (!response.success) {
        throw new Error(response.error || "Failed to stop extraction");
      }
      return response;
    },
    onSuccess: () => {
      setIsPolling(false);
    },
  });

  const startExtraction = useCallback(
    (request: StartPlaywrightCollectionRequest) => {
      return startExtractionMutation.mutateAsync(request);
    },
    [startExtractionMutation]
  );

  const startSinglePageExtraction = useCallback(
    (
      url: string,
      options?: {
        maxElements?: number;
        verifyExtractions?: boolean;
        verificationThreshold?: number;
        additionalBlockedKeywords?: string[];
      }
    ) => {
      return startExtractionMutation.mutateAsync({
        url,
        max_depth: 0, // Single page = no depth
        max_elements_per_page: options?.maxElements ?? 50,
        verify_extractions: options?.verifyExtractions ?? true,
        verification_threshold: options?.verificationThreshold ?? 0.85,
        additional_blocked_keywords: options?.additionalBlockedKeywords,
        dry_run: true, // Single page mode doesn't click
      });
    },
    [startExtractionMutation]
  );

  const stopExtraction = useCallback(() => {
    return stopExtractionMutation.mutateAsync();
  }, [stopExtractionMutation]);

  const clearCurrentJob = useCallback(() => {
    setCurrentJobId(null);
    setIsPolling(false);
    setResults(null);
  }, []);

  return {
    // Current job state
    currentJob,
    currentJobId,
    isLoadingJob,
    jobError,
    results,

    // Loading states
    isStarting: startExtractionMutation.isPending,
    isPolling,
    isStopping: stopExtractionMutation.isPending,

    // Errors
    startError: startExtractionMutation.error,
    stopError: stopExtractionMutation.error,

    // Actions
    startExtraction,
    startSinglePageExtraction,
    stopExtraction,
    clearCurrentJob,
    refetchJob,
  };
}

/**
 * Configuration state for Playwright extraction form.
 */
export interface PlaywrightExtractionConfigState {
  url: string;
  maxDepth: number;
  maxElementsPerPage: number;
  maxRiskLevel: "dry_run" | "safe" | "caution";
  verifyExtractions: boolean;
  verificationThreshold: number;
  dangerousKeywords: string[];
  safeKeywords: string[];
  blockedSelectors: string[];
}

const DEFAULT_CONFIG: PlaywrightExtractionConfigState = {
  url: "",
  maxDepth: 2,
  maxElementsPerPage: 50,
  maxRiskLevel: "safe",
  verifyExtractions: true,
  verificationThreshold: 0.85,
  dangerousKeywords: [],
  safeKeywords: [],
  blockedSelectors: [],
};

/**
 * Hook to persist and load Playwright extraction config from localStorage.
 */
export function usePlaywrightExtractionConfig() {
  const STORAGE_KEY = "qontinui_playwright_extraction_config";
  const [isLoaded, setIsLoaded] = useState(false);

  const [config, setConfigState] =
    useState<PlaywrightExtractionConfigState>(DEFAULT_CONFIG);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Merge with defaults to handle any missing fields from older stored configs
        setConfigState({ ...DEFAULT_CONFIG, ...parsed });
      }
    } catch (e) {
      console.warn("Failed to load playwright extraction config:", e);
    }
    setIsLoaded(true);
  }, []);

  // Save to localStorage whenever config changes (after initial load)
  const setConfig = useCallback(
    (newConfig: PlaywrightExtractionConfigState) => {
      setConfigState(newConfig);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
      } catch (e) {
        console.warn("Failed to save playwright extraction config:", e);
      }
    },
    []
  );

  // Partial update helper - updates specific fields and persists
  const updateConfig = useCallback(
    (updates: Partial<PlaywrightExtractionConfigState>) => {
      setConfigState((prev) => {
        const newConfig = { ...prev, ...updates };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
        } catch (e) {
          console.warn("Failed to save playwright extraction config:", e);
        }
        return newConfig;
      });
    },
    []
  );

  const clearConfig = useCallback(() => {
    setConfigState(DEFAULT_CONFIG);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn("Failed to clear playwright extraction config:", e);
    }
  }, []);

  return {
    config,
    setConfig,
    updateConfig,
    clearConfig,
    isLoaded,
  };
}

/**
 * Convert config state to runner request format.
 */
export function configToRequest(
  config: PlaywrightExtractionConfigState
): StartPlaywrightCollectionRequest {
  return {
    url: config.url,
    max_depth: config.maxDepth,
    max_elements_per_page: config.maxElementsPerPage,
    max_risk_level: config.maxRiskLevel,
    dry_run: config.maxRiskLevel === "dry_run",
    verify_extractions: config.verifyExtractions,
    verification_threshold: config.verificationThreshold,
    additional_blocked_keywords:
      config.dangerousKeywords.length > 0
        ? config.dangerousKeywords
        : undefined,
    additional_safe_keywords:
      config.safeKeywords.length > 0 ? config.safeKeywords : undefined,
    blocked_selectors:
      config.blockedSelectors.length > 0 ? config.blockedSelectors : undefined,
  };
}
