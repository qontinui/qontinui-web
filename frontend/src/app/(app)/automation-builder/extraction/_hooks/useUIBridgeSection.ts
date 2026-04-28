import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useUIBridgeExploration } from "@/hooks/ui-bridge";
import { useUIBridgeRecording } from "@/hooks/useUIBridgeRecording";
import { useRealtimeConnections } from "@/hooks/useRealtimeConnections";
import type { ExtractionState } from "./useExtractionState";
import type { RenderLogEntry, RenderLogSession } from "../_types";
import { createLogger } from "@/lib/logger";
const logger = createLogger("UseUIBridgeSection");

interface UseUIBridgeSectionArgs {
  state: ExtractionState;
  configMethod: string;
}

export function useUIBridgeSection({
  state,
  configMethod,
}: UseUIBridgeSectionArgs) {
  const exploration = useUIBridgeExploration();
  const recording = useUIBridgeRecording();
  const { runners, isLoading: runnersLoading } = useRealtimeConnections();

  // Keep a ref to state so callbacks can access setters without re-creating
  const stateRef = useRef(state);
  stateRef.current = state;

  // Auto-select first runner when runners load
  useEffect(() => {
    if (
      state.selectedRunnerId === null &&
      runners.length > 0 &&
      !runnersLoading
    ) {
      state.setSelectedRunnerId(runners[0]?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setSelectedRunnerId is stable
  }, [runners, runnersLoading, state.selectedRunnerId]);

  // Runner change handler
  const onRunnerChange = useCallback(
    (runnerId: string | null) => {
      state.setSelectedRunnerId(runnerId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setter is stable
    [state.setSelectedRunnerId]
  );

  // Construct runner URL from runner UUID
  const getRunnerUrl = useCallback(
    (runnerId: string | null): string | null => {
      if (exploration.config.targetType === "extension") {
        return "http://127.0.0.1:9876";
      }

      if (runnerId === null) return null;

      const runner = runners.find((r) => r.id === runnerId);
      if (!runner) return null;

      const ip = runner.ipAddress;
      const host = runner.hostname;
      const port = runner.port ?? 9876;
      if (
        !ip ||
        ip === "127.0.0.1" ||
        ip === "::1" ||
        ip.startsWith("localhost")
      ) {
        return `http://127.0.0.1:${port}`;
      }
      const target = ip || host;
      return `http://${target}:${port}`;
    },
    [runners, exploration.config.targetType]
  );

  // Refresh browser tabs
  const handleRefreshBrowserTabs = useCallback(() => {
    const runnerUrl = getRunnerUrl(state.selectedRunnerId);
    logger.info("[Extraction] Fetching browser tabs, runnerUrl:", runnerUrl);
    exploration.fetchBrowserTabs(runnerUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exploration.fetchBrowserTabs, getRunnerUrl, state.selectedRunnerId]);

  // Auto-fetch browser tabs when extension mode is selected
  useEffect(() => {
    if (exploration.config.targetType === "extension") {
      handleRefreshBrowserTabs();
    }
  }, [exploration.config.targetType, handleRefreshBrowserTabs]);

  // Select browser tab
  const handleSelectBrowserTab = useCallback(
    async (tabId: number | null) => {
      const runnerUrl = getRunnerUrl(state.selectedRunnerId);
      await exploration.selectBrowserTab(runnerUrl, tabId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exploration.selectBrowserTab, getRunnerUrl, state.selectedRunnerId]
  );

  // Load render log sessions
  const loadRenderLogSessions = useCallback(async () => {
    stateRef.current.setIsLoadingSessions(true);
    try {
      const response = await fetch("/api/v1/render-logs/sessions?limit=20", {
        credentials: "include",
      });

      if (response.ok) {
        const sessions: RenderLogSession[] = await response.json();
        stateRef.current.setRenderLogSessions(sessions);
      } else if (response.status === 404) {
        stateRef.current.setRenderLogSessions([]);
      }
    } catch (error) {
      logger.error("Failed to load render log sessions:", error);
      stateRef.current.setRenderLogSessions([]);
    } finally {
      stateRef.current.setIsLoadingSessions(false);
    }
  }, []);

  // Load renders from session
  const loadSessionRenders = useCallback(async (sessionId: string) => {
    stateRef.current.setIsLoadingSessionRenders(true);
    stateRef.current.setSelectedSessionId(sessionId);
    try {
      const listResponse = await fetch(
        `/api/v1/render-logs?session_id=${sessionId}&page_size=200`,
        { credentials: "include" }
      );

      if (!listResponse.ok) {
        throw new Error("Failed to load render logs");
      }

      const listData = await listResponse.json();
      const renders: RenderLogEntry[] = [];
      for (const summary of listData.items) {
        const detailResponse = await fetch(
          `/api/v1/render-logs/${summary.id}`,
          { credentials: "include" }
        );
        if (detailResponse.ok) {
          const detail = await detailResponse.json();
          renders.push(detail);
        }
      }

      const formattedRenders = renders.map((r) => ({
        id: `render_${r.id}`,
        type: "dom_snapshot",
        page_url: r.page_url,
        snapshot: r.snapshot,
      }));

      stateRef.current.setSessionRenders(formattedRenders);
      stateRef.current.setUploadedRenders(null);
      stateRef.current.setDiscoveryResult(null);
      stateRef.current.setStateDescriptions({});
      stateRef.current.setCurrentSavedConfigId(null);
      stateRef.current.setStateUuidMap({});

      toast.success(`Loaded ${formattedRenders.length} renders from session`);
    } catch (error) {
      logger.error("Failed to load session renders:", error);
      toast.error("Failed to load render logs from session");
    } finally {
      stateRef.current.setIsLoadingSessionRenders(false);
    }
  }, []);

  // Handle file upload
  const handleFileUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const parsed = JSON.parse(content);
          const renders = Array.isArray(parsed) ? parsed : [parsed];
          stateRef.current.setUploadedRenders(renders);
          stateRef.current.setSessionRenders(null);
          stateRef.current.setSelectedSessionId(null);
          stateRef.current.setDiscoveryResult(null);
          stateRef.current.setStateDescriptions({});
          stateRef.current.setCurrentSavedConfigId(null);
          stateRef.current.setStateUuidMap({});
          toast.success(`Loaded ${renders.length} render logs from file`);
        } catch {
          toast.error("Invalid JSON file");
        }
      };
      reader.readAsText(file);
    },
    []
  );

  // Load configs and knowledge when in UI Bridge mode
  useEffect(() => {
    if (configMethod === "ui-bridge") {
      loadRenderLogSessions();
    }
  }, [configMethod, loadRenderLogSessions]);

  return {
    exploration,
    recording,
    runners,
    runnersLoading,
    onRunnerChange,
    getRunnerUrl,
    handleRefreshBrowserTabs,
    handleSelectBrowserTab,
    loadRenderLogSessions,
    loadSessionRenders,
    handleFileUpload,
  };
}
