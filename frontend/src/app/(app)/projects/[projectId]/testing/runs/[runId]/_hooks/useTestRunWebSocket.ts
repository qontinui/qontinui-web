"use client";

import { useEffect, useState } from "react";
import { ApiConfig } from "@/services/api-config";
import { createLogger } from "@/lib/logger";

const log = createLogger("TestRunWebSocket");

interface WebSocketMessage {
  type: string;
  data?: {
    status?: string;
    current_step?: number;
    total_steps?: number;
    transition?: {
      from_state: string;
      to_state: string;
      action_type: string;
      success: boolean;
      duration_ms: number;
      error_message?: string;
      screenshot_url?: string;
    };
    coverage_percentage?: number;
    states_covered?: number;
    deficiency?: {
      severity: string;
      title: string;
      description: string;
    };
  };
}

export function useTestRunWebSocket(
  runId: string,
  runStatus: string | undefined,
  refetch: () => void
) {
  const [liveStatus, setLiveStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!runStatus || runStatus === "completed" || runStatus === "failed") {
      return;
    }

    const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
    // Empty base => same-origin: use window.location.host.
    const apiBase = ApiConfig.getBaseUrl();
    const wsHost = apiBase
      ? apiBase.replace(/^https?:\/\//, "")
      : window.location.host;
    const wsUrl = `${wsProtocol}://${wsHost}/api/v1/testing/runs/${runId}/ws`;

    const websocket = new WebSocket(wsUrl);

    websocket.onopen = () => {
      log.debug("WebSocket connected");
    };

    websocket.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);

        switch (message.type) {
          case "status_update":
            if (message.data?.status) {
              setLiveStatus(message.data.status);
            }
            break;

          case "transition_complete":
          case "deficiency_found":
          case "coverage_update":
            refetch();
            break;

          case "run_complete":
            refetch();
            websocket.close();
            break;
        }
      } catch (error) {
        console.error(
          "[TestRunDetail] Failed to parse WebSocket message:",
          error
        );
      }
    };

    websocket.onerror = (error) => {
      console.error("[TestRunDetail] WebSocket error:", error);
    };

    websocket.onclose = () => {
      log.debug("WebSocket disconnected");
    };

    return () => {
      websocket.close();
    };
  }, [runStatus, runId, refetch]);

  return liveStatus;
}
