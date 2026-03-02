import { useState, useCallback, useEffect } from "react";

export interface BrowserTab {
  id: number;
  title: string;
  url: string;
  active: boolean;
}

export async function extensionCommand<T = unknown>(
  runnerUrl: string,
  action: string,
  params: Record<string, unknown> = {},
  timeoutSecs = 15
): Promise<T> {
  const res = await fetch(`${runnerUrl}/extension/command`, {
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

export function useExtensionConnection(runnerUrl: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([]);
  const [selectedTabId, setSelectedTabId] = useState<number | null>(null);
  const [isLoadingTabs, setIsLoadingTabs] = useState(false);

  const checkConnection = useCallback(async () => {
    try {
      const res = await fetch(`${runnerUrl}/extension/status`);
      if (!res.ok) {
        setIsConnected(false);
        return;
      }
      const data = await res.json();
      setIsConnected(data.data?.connected === true);
    } catch {
      setIsConnected(false);
    }
  }, [runnerUrl]);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  const handleRefreshTabs = useCallback(async () => {
    setIsLoadingTabs(true);
    try {
      const data = await extensionCommand<{ tabs?: BrowserTab[] }>(
        runnerUrl,
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
  }, [runnerUrl, selectedTabId]);

  useEffect(() => {
    if (isConnected) {
      handleRefreshTabs();
    }
  }, [isConnected, handleRefreshTabs]);

  const handleSelectTab = useCallback(
    async (tabId: number) => {
      setSelectedTabId(tabId);
      try {
        await extensionCommand(runnerUrl, "selectTab", { tabId });
      } catch (err) {
        console.error("Failed to select tab:", err);
      }
    },
    [runnerUrl]
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
