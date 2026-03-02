import { useState, useEffect, useMemo } from "react";
import type { Workflow } from "@/lib/action-schema/action-types";
import {
  getLayoutService,
  LayoutOptions,
  LayoutPreviewResult,
} from "@/services/layout-service";
import { LayoutStyle } from "@/lib/workflow-layout/auto-layout";
import type { LayoutPreset } from "../auto-layout-types";
import { BUILTIN_PRESETS } from "../auto-layout-constants";

export function useAutoLayout(workflow: Workflow) {
  const layoutService = useMemo(() => getLayoutService(), []);

  const [selectedStyle, setSelectedStyle] = useState<LayoutStyle>(
    LayoutStyle.HIERARCHICAL
  );
  const [selectedPreset, setSelectedPreset] = useState<string>(
    "balanced-hierarchical"
  );
  const [customOptions, setCustomOptions] = useState<LayoutOptions>(
    BUILTIN_PRESETS[2]!.options
  );
  const [animate, setAnimate] = useState(true);
  const [showPreview, setShowPreview] = useState(true);
  const [showStatistics, setShowStatistics] = useState(true);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [previewResult, setPreviewResult] =
    useState<LayoutPreviewResult | null>(null);
  const [customPresets, setCustomPresets] = useState<LayoutPreset[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("auto-layout-custom-presets");
      if (saved) {
        setCustomPresets(JSON.parse(saved));
      }
    } catch (err) {
      console.error("Failed to load custom presets:", err);
    }
  }, []);

  const recommendation = useMemo(() => {
    return layoutService.getRecommendedLayout(workflow);
  }, [workflow, layoutService]);

  useEffect(() => {
    const result = layoutService.previewLayout(
      workflow,
      selectedStyle,
      customOptions
    );
    setPreviewResult(result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStyle, customOptions]);

  const allPresets = [...BUILTIN_PRESETS, ...customPresets];

  const handleStyleChange = (style: LayoutStyle) => {
    setSelectedStyle(style);
    const matchingPreset = allPresets.find(
      (p) => p.style === style && p.id === selectedPreset
    );
    if (!matchingPreset) {
      setSelectedPreset("custom");
    }
  };

  const handlePresetChange = (presetId: string) => {
    setSelectedPreset(presetId);
    const preset = allPresets.find((p) => p.id === presetId);
    if (preset) {
      setSelectedStyle(preset.style);
      setCustomOptions(preset.options);
    }
  };

  const handleOptionChange = (key: keyof LayoutOptions, value: number) => {
    setCustomOptions((prev) => ({ ...prev, [key]: value }));
    setSelectedPreset("custom");
  };

  const handleSavePreset = () => {
    const name = prompt("Enter preset name:");
    if (!name) return;

    const description = prompt("Enter preset description (optional):") || "";

    const newPreset: LayoutPreset = {
      id: `custom-${Date.now()}`,
      name,
      description,
      category: "custom",
      style: selectedStyle,
      options: { ...customOptions },
    };

    const updated = [...customPresets, newPreset];
    setCustomPresets(updated);

    try {
      localStorage.setItem(
        "auto-layout-custom-presets",
        JSON.stringify(updated)
      );
    } catch (err) {
      console.error("Failed to save preset:", err);
    }

    setSelectedPreset(newPreset.id);
  };

  return {
    selectedStyle,
    selectedPreset,
    customOptions,
    animate,
    setAnimate,
    showPreview,
    setShowPreview,
    showStatistics,
    setShowStatistics,
    showSuggestions,
    setShowSuggestions,
    previewResult,
    customPresets,
    recommendation,
    allPresets,
    handleStyleChange,
    handlePresetChange,
    handleOptionChange,
    handleSavePreset,
  };
}
