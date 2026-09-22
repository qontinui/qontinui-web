import { useState, useCallback, useEffect } from "react";
import { runnerRequest } from "@/lib/runner/api-client";
import type { RunnerTarget } from "@/lib/runner/target";
import { useRunnerTarget } from "@/contexts/active-runner-context";

export interface BrowserTab {
  id: number;
  title: string;
  url: string;
  active: boolean;
}

export async function extensionCommand<T = unknown>(
  target: RunnerTarget,
  action: string,
  params: Record<string, unknown> = {},
  timeoutSecs = 15
): Promise<T> {
  const res = await runnerRequest(target, "/extension/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, params, timeout_secs: timeoutSecs }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Extension command "${action}" failed (${res.status}): ${text}`
    );
  }
  const result = await res.json();
  if (result.success === false) {
    throw new Error(result.error || `Extension command "${action}" failed`);
  }
  return (result.data ?? result) as T;
}

/** Browser-extension connection state on the active runner. */
export function useExtensionConnection() {
  const target = useRunnerTarget();
  const [isConnected, setIsConnected] = useState(false);
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([]);
  const [selectedTabId, setSelectedTabId] = useState<number | null>(null);
  const [isLoadingTabs, setIsLoadingTabs] = useState(false);

  const checkConnection = useCallback(async () => {
    try {
      const res = await runnerRequest(target, "/extension/status");
      if (!res.ok) {
        setIsConnected(false);
        return;
      }
      const data = await res.json();
      setIsConnected(data.data?.connected === true);
    } catch {
      setIsConnected(false);
    }
  }, [target]);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  const handleRefreshTabs = useCallback(async () => {
    setIsLoadingTabs(true);
    try {
      const data = await extensionCommand<{ tabs?: BrowserTab[] }>(
        target,
        "listTabs"
      );
      const tabs = data.tabs || [];
      setBrowserTabs(tabs);
      if (selectedTabId === null) {
        const activeTab = tabs.find((t) => t.active);
        if (activeTab) setSelectedTabId(activeTab.id);
      }
    } catch (err) {
      console.error("Failed to list tabs:", err);
    } finally {
      setIsLoadingTabs(false);
    }
  }, [target, selectedTabId]);

  useEffect(() => {
    if (isConnected) {
      handleRefreshTabs();
    }
  }, [isConnected, handleRefreshTabs]);

  const handleSelectTab = useCallback(
    async (tabId: number) => {
      setSelectedTabId(tabId);
      try {
        await extensionCommand(target, "selectTab", { tabId });
      } catch (err) {
        console.error("Failed to select tab:", err);
      }
    },
    [target]
  );

  return {
    isConnected,
    setIsConnected,
    browserTabs,
    selectedTabId,
    isLoadingTabs,
    handleRefreshTabs,
    handleSelectTab,
  };
}
