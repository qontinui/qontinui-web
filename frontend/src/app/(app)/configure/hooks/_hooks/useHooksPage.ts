import { useState } from "react";
import {
  useRunnerHealth,
  useHooks,
  runnerApi,
  type Hook,
  type CreateHookRequest,
  type UpdateHookRequest,
  type TestHookResponse,
} from "@/lib/runner";

export function useHooksPage() {
  const { isOffline, isLoading: healthLoading } = useRunnerHealth();
  const {
    data: hooks,
    isLoading: hooksLoading,
    error: hooksError,
    refetch,
  } = useHooks();

  const [showEditor, setShowEditor] = useState(false);
  const [editingHook, setEditingHook] = useState<Hook | undefined>(undefined);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, TestHookResponse>
  >({});
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleCreate = () => {
    setEditingHook(undefined);
    setShowEditor(true);
  };

  const handleEdit = (hook: Hook) => {
    setEditingHook(hook);
    setShowEditor(true);
  };

  const handleSave = async (data: CreateHookRequest | UpdateHookRequest) => {
    if (editingHook) {
      await runnerApi.updateHook(editingHook.id, data as UpdateHookRequest);
    } else {
      await runnerApi.createHook(data as CreateHookRequest);
    }
    refetch();
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await runnerApi.deleteHook(id);
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete hook");
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleEnabled = async (id: string, enabled: boolean) => {
    try {
      await runnerApi.setHookEnabled(id, enabled);
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle hook");
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    // Clear previous result for this hook
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const result = await runnerApi.testHook(id);
      setTestResults((prev) => ({ ...prev, [id]: result }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [id]: {
          success: false,
          error: err instanceof Error ? err.message : "Test failed",
          duration_ms: 0,
        },
      }));
    } finally {
      setTestingId(null);
    }
  };

  const handleCloseEditor = () => {
    setShowEditor(false);
    setEditingHook(undefined);
  };

  const filteredHooks = hooks?.filter((hook) => {
    if (!searchQuery.trim()) return true;
    const lower = searchQuery.toLowerCase();
    return (
      hook.name.toLowerCase().includes(lower) ||
      hook.trigger.toLowerCase().includes(lower) ||
      hook.action_type.toLowerCase().includes(lower) ||
      (hook.description ?? "").toLowerCase().includes(lower)
    );
  });

  return {
    // Health
    isOffline,
    healthLoading,
    // Hooks data
    hooks,
    hooksLoading,
    hooksError,
    filteredHooks,
    refetch,
    // Editor
    showEditor,
    editingHook,
    // Actions
    handleCreate,
    handleEdit,
    handleSave,
    handleDelete,
    handleToggleEnabled,
    handleTest,
    handleCloseEditor,
    // State
    deletingId,
    testingId,
    testResults,
    searchQuery,
    setSearchQuery,
    error,
    setError,
  };
}
