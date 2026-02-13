"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { useAutomationStore } from "@/stores/automation";
import type { ExportConfig } from "../_types";

export function useExportStateMachine(configId: string | null) {
  const projectId = useAutomationStore((s) => s.projectId);
  const [isExporting, setIsExporting] = useState(false);

  const exportConfig = useCallback(async (): Promise<ExportConfig | null> => {
    if (!projectId || !configId) return null;
    setIsExporting(true);
    try {
      const res = await fetch(
        `/api/v1/projects/${projectId}/ui-bridge-configs/${configId}/export`,
        { credentials: "include" }
      );
      if (res.ok) {
        const data: ExportConfig = await res.json();
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

  return { isExporting, exportConfig, downloadExport };
}
