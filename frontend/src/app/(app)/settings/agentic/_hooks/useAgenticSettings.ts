import { useState, useEffect, useCallback } from "react";
import {
  runnerApi,
  useRunnerHealth,
  type AgenticSettings,
} from "@/lib/runner-api";
import { toast } from "sonner";
import {
  DEFAULT_COMPRESSION,
  DEFAULT_RETRY,
  DEFAULT_ROUTING,
  type CompressionSettings,
  type RetrySettings,
  type RoutingSettings,
} from "../types";

export function useAgenticSettings() {
  const { isLoading: healthLoading, isOffline } = useRunnerHealth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [compression, setCompression] =
    useState<CompressionSettings>(DEFAULT_COMPRESSION);
  const [retry, setRetry] = useState<RetrySettings>(DEFAULT_RETRY);
  const [routing, setRouting] = useState<RoutingSettings>(DEFAULT_ROUTING);

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      const settings = await runnerApi.getAgenticSettings();
      setCompression(settings.compression);
      setRetry(settings.retry);
      setRouting(settings.routing);
    } catch {
      toast.error("Failed to load agentic settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOffline) {
      loadSettings();
    }
  }, [isOffline, loadSettings]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const settings: AgenticSettings = { compression, retry, routing };
      await runnerApi.saveAgenticSettings(settings);
      toast.success("Agentic settings saved");
    } catch {
      toast.error("Failed to save agentic settings");
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = () => {
    setCompression(DEFAULT_COMPRESSION);
    setRetry(DEFAULT_RETRY);
    setRouting(DEFAULT_ROUTING);
    toast.info("Settings reset to defaults (not saved yet)");
  };

  return {
    healthLoading,
    isOffline,
    loading,
    saving,
    compression,
    setCompression,
    retry,
    setRetry,
    routing,
    setRouting,
    handleSave,
    handleResetDefaults,
  };
}
