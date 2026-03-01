import { useState, useEffect, useMemo } from "react";
import { useAiSettings } from "@/lib/runner-api";
import { getGenerateModels } from "@qontinui/workflow-utils";

export interface AdvancedOptionsState {
  showAdvanced: boolean;
  setShowAdvanced: (value: boolean) => void;
  category: string;
  setCategory: (value: string) => void;
  tagsInput: string;
  setTagsInput: (value: string) => void;
  maxIterations: string;
  setMaxIterations: (value: string) => void;
  provider: string;
  setProvider: (value: string) => void;
  model: string;
  setModel: (value: string) => void;
  maxFixIterations: string;
  setMaxFixIterations: (value: string) => void;
  autoIncludeContexts: boolean;
  setAutoIncludeContexts: (value: boolean) => void;
  includeUIBridge: boolean;
  setIncludeUIBridge: (value: boolean) => void;
  reflectionMode: boolean;
  setReflectionMode: (value: boolean) => void;
  investigateCodebase: boolean;
  setInvestigateCodebase: (value: boolean) => void;
  includeDesignGuidance: boolean;
  setIncludeDesignGuidance: (value: boolean) => void;
  discoveryMode: "auto" | "enabled" | "disabled";
  setDiscoveryMode: (value: "auto" | "enabled" | "disabled") => void;
  modelsForProvider: readonly { value: string; label: string }[];
}

export function useAdvancedOptions(): AdvancedOptionsState {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [category, setCategory] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [maxIterations, setMaxIterations] = useState("");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [maxFixIterations, setMaxFixIterations] = useState("");
  const [autoIncludeContexts, setAutoIncludeContexts] = useState(true);
  const [includeUIBridge, setIncludeUIBridge] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem("generate-include-ui-bridge");
    return saved !== null ? saved === "true" : true;
  });
  useEffect(() => {
    localStorage.setItem("generate-include-ui-bridge", String(includeUIBridge));
  }, [includeUIBridge]);
  const [reflectionMode, setReflectionMode] = useState(true);
  const [investigateCodebase, setInvestigateCodebase] = useState(true);
  const [includeDesignGuidance, setIncludeDesignGuidance] = useState(false);
  const [discoveryMode, setDiscoveryMode] = useState<
    "auto" | "enabled" | "disabled"
  >("auto");

  // AI settings (for provider/model defaults)
  const { data: aiSettings } = useAiSettings();

  // Initialize provider/model from settings when loaded
  useEffect(() => {
    if (aiSettings && !provider) {
      setProvider(aiSettings.provider);
    }
  }, [aiSettings, provider]);

  useEffect(() => {
    if (aiSettings && !model) {
      // Get the configured model for the current provider
      const p = provider || aiSettings.provider;
      if (p === "claude_api") setModel(aiSettings.claude_api.model);
      else if (p === "gemini_cli") setModel(aiSettings.gemini_cli.model);
      else if (p === "gemini_api") setModel(aiSettings.gemini_api.model);
    }
  }, [aiSettings, model, provider]);

  // Models list changes based on selected provider
  const modelsForProvider = useMemo(() => {
    return getGenerateModels(provider);
  }, [provider]);

  return {
    showAdvanced,
    setShowAdvanced,
    category,
    setCategory,
    tagsInput,
    setTagsInput,
    maxIterations,
    setMaxIterations,
    provider,
    setProvider,
    model,
    setModel,
    maxFixIterations,
    setMaxFixIterations,
    autoIncludeContexts,
    setAutoIncludeContexts,
    includeUIBridge,
    setIncludeUIBridge,
    reflectionMode,
    setReflectionMode,
    investigateCodebase,
    setInvestigateCodebase,
    includeDesignGuidance,
    setIncludeDesignGuidance,
    discoveryMode,
    setDiscoveryMode,
    modelsForProvider,
  };
}
