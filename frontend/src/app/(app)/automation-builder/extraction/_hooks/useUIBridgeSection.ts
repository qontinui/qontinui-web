import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useUIBridgeExploration } from "@/hooks/ui-bridge";
import { useUIBridgeRecording } from "@/hooks/useUIBridgeRecording";
import { useRealtimeConnections } from "@/hooks/useRealtimeConnections";
import type { ExtractionState } from "./useExtractionState";
import type { RenderLogEntry, RenderLogSession } from "../_types";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";
import {
  routeOfTarget,
  useRunnerTarget,
  type RunnerTarget,
} from "@/lib/runner";
import {
  useActiveRunner,
  useDispatchRunnerTarget,
  useNewWorkRefusal,
} from "@/contexts/active-runner-context";
import { runnerTargetById } from "@/hooks/ui-bridge/runnerTargetById";
const logger = createLogger("UseUIBridgeSection");
const API = `${ApiConfig.API_BASE_URL}/api/v1`;

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
  const runnerTarget = useRunnerTarget();
  const { localityById } = useActiveRunner();

  // Keep a ref to state so callbacks can access setters without re-creating
  const stateRef = useRef(state);
  stateRef.current = state;

  // This page STARTS work (exploration / extraction) on its selected runner,
  // so the default selection is where new work may go — the user's explicit
  // choice or coord's resolved pick — never a read fallback and never the
  // first listed runner. Nothing eligible: stay unselected (the user picks
  // one in this page's own selector, which is an explicit choice).
  //
  // An AUTO-FILLED selection follows the dispatch target: when coord moves
  // its pick, or refuses new work, the auto-filled id is replaced (or
  // cleared). Only a runner the user picked here is sticky.
  const dispatch = useDispatchRunnerTarget();
  const activeRunnerId = dispatch.runnerId;
  const autoFilledRef = useRef<string | null>(null);
  useEffect(() => {
    if (runnersLoading) return;
    const current = state.selectedRunnerId;
    const isAuto = current === null || current === autoFilledRef.current;
    if (!isAuto || current === activeRunnerId) return;
    autoFilledRef.current = activeRunnerId;
    state.setSelectedRunnerId(activeRunnerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setSelectedRunnerId is stable
  }, [activeRunnerId, runnersLoading, state.selectedRunnerId]);

  // Runner change handler — a user pick is sticky (no longer auto-filled).
  const onRunnerChange = useCallback(
    (runnerId: string | null) => {
      autoFilledRef.current = null;
      state.setSelectedRunnerId(runnerId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setter is stable
    [state.setSelectedRunnerId]
  );

  // The runner the downstream helpers call, as a TARGET: addressed by its
  // id and resolved per request (loopback only when proven local, the relay
  // otherwise). Never a URL built from the IP address or hostname a runner
  // reports — the runner binds 127.0.0.1 only, so such a URL never answers,
  // and a reported address proves nothing about which machine answers.
  //
  // Extension mode drives the browser extension on THIS machine: through the
  // active runner when it is proven local, otherwise (null) through the
  // extension's own postMessage bridge — never a runner on another machine.
  const getRunnerTarget = useCallback(
    (runnerId: string | null): RunnerTarget | null => {
      if (exploration.config.targetType === "extension") {
        return routeOfTarget(runnerTarget).kind === "loopback"
          ? runnerTarget
          : null;
      }
      // The dispatch runner may be a device coord resolved that the list has
      // not caught up with; it is addressed as the dispatch target itself.
      if (runnerId !== null && runnerId === dispatch.runnerId) {
        return dispatch.target;
      }
      return runnerTargetById(runners, localityById, runnerId);
    },
    [
      runners,
      localityById,
      exploration.config.targetType,
      runnerTarget,
      dispatch.runnerId,
      dispatch.target,
    ]
  );

  // Extension mode starts work on the READ target (the browser extension on
  // this machine, through the active runner when it is proven local), so a
  // new exploration / recording there is gated on the new-work rule. In the
  // other modes the target is this page's own selection: the user's pick
  // (explicit) or the auto-filled dispatch runner, which is cleared when new
  // work is refused.
  const newWorkRefusal = useNewWorkRefusal();
  const startRefusal =
    exploration.config.targetType === "extension" ? newWorkRefusal : null;
  const getStartTarget = useCallback(
    (runnerId: string | null): RunnerTarget | null =>
      startRefusal !== null ? null : getRunnerTarget(runnerId),
    [startRefusal, getRunnerTarget]
  );

  // Refresh browser tabs
  const handleRefreshBrowserTabs = useCallback(() => {
    logger.info("[Extraction] Fetching browser tabs");
    exploration.fetchBrowserTabs(getRunnerTarget(state.selectedRunnerId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exploration.fetchBrowserTabs, getRunnerTarget, state.selectedRunnerId]);

  // Auto-fetch browser tabs when extension mode is selected
  useEffect(() => {
    if (exploration.config.targetType === "extension") {
      handleRefreshBrowserTabs();
    }
  }, [exploration.config.targetType, handleRefreshBrowserTabs]);

  // Select browser tab
  const handleSelectBrowserTab = useCallback(
    async (tabId: number | null) => {
      await exploration.selectBrowserTab(
        getRunnerTarget(state.selectedRunnerId),
        tabId
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exploration.selectBrowserTab, getRunnerTarget, state.selectedRunnerId]
  );

  // Load render log sessions
  const loadRenderLogSessions = useCallback(async () => {
    stateRef.current.setIsLoadingSessions(true);
    try {
      const response = await httpClient.fetch(
        `${API}/render-logs/sessions?limit=20`
      );

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
      const listResponse = await httpClient.fetch(
        `${API}/render-logs?session_id=${sessionId}&page_size=200`
      );

      if (!listResponse.ok) {
        throw new Error("Failed to load render logs");
      }

      const listData = await listResponse.json();
      const renders: RenderLogEntry[] = [];
      for (const summary of listData.items) {
        const detailResponse = await httpClient.fetch(
          `${API}/render-logs/${summary.id}`
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
    getRunnerTarget,
    getStartTarget,
    startRefusal,
    handleRefreshBrowserTabs,
    handleSelectBrowserTab,
    loadRenderLogSessions,
    loadSessionRenders,
    handleFileUpload,
  };
}
