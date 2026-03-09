"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { useAutomationStore } from "@/stores/automation";
import type { StateMachineExportFormat } from "../_types";

const RUNNER_URL = "http://localhost:9876";

export function useExportStateMachine(configId: string | null) {
  const projectId = useAutomationStore((s) => s.projectId);
  const [isExporting, setIsExporting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);

  const exportConfig =
    useCallback(async (): Promise<StateMachineExportFormat | null> => {
      if (!projectId || !configId) return null;
      setIsExporting(true);
      try {
        const res = await fetch(
          `/api/v1/projects/${projectId}/ui-bridge-configs/${configId}/export`,
          { credentials: "include" }
        );
        if (res.ok) {
          const data: StateMachineExportFormat = await res.json();
          return data;
        }
        toast.error("Failed to export configuration");
        return null;
      } catch (err) {
        console.error("Export failed:", err);
        toast.error("Failed to export configuration");
        return null;
      } finally {
        setIsExporting(false);
      }
    }, [projectId, configId]);

  const downloadExport = useCallback(async () => {
    const data = await exportConfig();
    if (!data) return;

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ui-bridge-state-machine-${configId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Export downloaded");
  }, [exportConfig, configId]);

  const pushToRunner = useCallback(async () => {
    const data = await exportConfig();
    if (!data) return;

    setIsPushing(true);
    try {
      const res = await fetch(`${RUNNER_URL}/state-machine/load`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: data }),
      });

      if (res.ok) {
        const result = await res.json();
        const stats = result.data?.statistics;
        if (stats) {
          toast.success(
            `State machine loaded: ${stats.states?.registered ?? 0} states, ${stats.transitions?.registered ?? 0} transitions`
          );
        } else {
          toast.success("State machine pushed to runner");
        }
      } else {
        const err = await res.json().catch(() => null);
        toast.error(err?.error ?? `Failed to push to runner (${res.status})`);
      }
    } catch (err) {
      console.error("Push to runner failed:", err);
      toast.error(
        "Cannot connect to runner. Is qontinui-runner running on port 9876?"
      );
    } finally {
      setIsPushing(false);
    }
  }, [exportConfig]);

  return { isExporting, isPushing, exportConfig, downloadExport, pushToRunner };
}
