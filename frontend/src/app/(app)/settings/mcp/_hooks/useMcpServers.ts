import { useState, useEffect, useCallback } from "react";
import {
  useRunnerHealth,
  useRunnerApi,
  runnerFailureMessage,
  useRunnerTarget,
  useRunnerPoll,
  type McpServer,
  type McpServerStatus,
} from "@/lib/runner-api";
import { toast } from "sonner";
import { type ServerFormData, formDataToPayload } from "../types";

export function useMcpServers() {
  const runnerApi = useRunnerApi();
  const target = useRunnerTarget();
  const { isOffline, isLoading: healthLoading } = useRunnerHealth();
  const [loading, setLoading] = useState(true);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [serverStatuses, setServerStatuses] = useState<
    Record<string, McpServerStatus>
  >({});
  const [isAdding, setIsAdding] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServer | null>(null);
  const [expandedServerId, setExpandedServerId] = useState<string | null>(null);

  const loadServers = useCallback(async () => {
    try {
      const data = await runnerApi.getSettingsMcpServers();
      setServers(data ?? []);
    } catch (err) {
      toast.error(runnerFailureMessage(err, "Failed to load MCP servers"));
    }
  }, [runnerApi]);

  const fetchStatuses = useCallback(async () => {
    const statuses = await runnerApi.getMcpServersStatus();
    const map: Record<string, McpServerStatus> = {};
    for (const s of statuses ?? []) {
      map[s.server_id] = s;
    }
    setServerStatuses(map);
  }, [runnerApi]);

  const loadStatuses = useCallback(async () => {
    try {
      await fetchStatuses();
    } catch {
      // Statuses are non-critical; silently ignore
    }
  }, [fetchStatuses]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadServers(), loadStatuses()]);
    setLoading(false);
  }, [loadServers, loadStatuses]);

  useEffect(() => {
    if (isOffline) {
      setLoading(false);
      return;
    }
    loadAll();
  }, [isOffline, loadAll]);

  // Poll statuses. The cadence is re-evaluated every tick (never faster than
  // the relay cadence for a relayed or unresolved target); a
  // RUNNER_NEEDS_LOCAL refusal stops the poll and is shown. Other failures
  // are non-critical and ignored.
  useRunnerPoll(target, {
    enabled: !isOffline,
    requestedMs: 10000,
    tick: fetchStatuses,
    onNeedsLocal: (err) => toast.error(err.message),
  });

  const handleCreate = async (form: ServerFormData) => {
    try {
      const payload = formDataToPayload(form);
      await runnerApi.createMcpServer(payload);
      toast.success(`Server "${form.name}" created`);
      setIsAdding(false);
      await loadAll();
    } catch (err) {
      toast.error(
        `Failed to create: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  };

  const handleUpdate = async (form: ServerFormData) => {
    if (!editingServer) return;
    try {
      const payload = formDataToPayload(form);
      await runnerApi.updateMcpServer(editingServer.id, payload);
      toast.success(`Server "${form.name}" updated`);
      setEditingServer(null);
      await loadAll();
    } catch (err) {
      toast.error(
        `Failed to update: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await runnerApi.deleteMcpServer(id);
      toast.success("Server deleted");
      await loadAll();
    } catch (err) {
      toast.error(
        `Failed to delete: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  };

  const handleConnect = async (id: string) => {
    try {
      await runnerApi.connectMcpServer(id);
      toast.success("Connecting...");
      setTimeout(loadStatuses, 1500);
    } catch (err) {
      toast.error(
        `Failed to connect: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      await runnerApi.disconnectMcpServer(id);
      toast.success("Disconnected");
      setTimeout(loadStatuses, 1000);
    } catch (err) {
      toast.error(
        `Failed to disconnect: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  };

  const startAdding = () => {
    setEditingServer(null);
    setIsAdding(true);
  };

  const cancelAdding = () => setIsAdding(false);

  const startEditing = (server: McpServer) => {
    setIsAdding(false);
    setEditingServer(server);
  };

  const cancelEditing = () => setEditingServer(null);

  const toggleExpanded = (serverId: string) => {
    setExpandedServerId(expandedServerId === serverId ? null : serverId);
  };

  return {
    isOffline,
    healthLoading,
    loading,
    servers,
    serverStatuses,
    isAdding,
    editingServer,
    expandedServerId,
    showForm: isAdding || editingServer !== null,
    loadAll,
    handleCreate,
    handleUpdate,
    handleDelete,
    handleConnect,
    handleDisconnect,
    startAdding,
    cancelAdding,
    startEditing,
    cancelEditing,
    toggleExpanded,
  };
}
