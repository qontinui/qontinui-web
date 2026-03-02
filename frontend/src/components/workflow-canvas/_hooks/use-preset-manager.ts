import { useState, useEffect, useCallback } from "react";
import { LayoutStyle } from "@/lib/workflow-layout/auto-layout";
import type { LayoutPreset } from "../PresetManagerDialog";

const BUILTIN_PRESETS: LayoutPreset[] = [
  {
    id: "balanced-hierarchical",
    name: "Balanced Hierarchical",
    description: "Standard top-to-bottom layout",
    category: "balanced",
    style: LayoutStyle.HIERARCHICAL,
    options: {
      nodeWidth: 180,
      nodeHeight: 80,
      horizontalSpacing: 200,
      verticalSpacing: 120,
      branchOffset: 150,
      minNodeSpacing: 20,
    },
    builtin: true,
  },
];

const STORAGE_KEY = "auto-layout-custom-presets";

type CategoryFilter = "all" | "compact" | "spacious" | "balanced" | "custom";

export function usePresetManager(open: boolean) {
  const [presets, setPresets] = useState<LayoutPreset[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] =
    useState<CategoryFilter>("all");
  const [selectedPreset, setSelectedPreset] = useState<LayoutPreset | null>(
    null
  );
  const [editingPreset, setEditingPreset] = useState<LayoutPreset | null>(null);

  const loadPresets = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const customPresets = saved ? JSON.parse(saved) : [];
      setPresets([...BUILTIN_PRESETS, ...customPresets]);
    } catch (err) {
      console.error("Failed to load presets:", err);
      setPresets([...BUILTIN_PRESETS]);
    }
  };

  useEffect(() => {
    if (open) {
      loadPresets();
    }
  }, [open]);

  const filteredPresets = presets.filter((preset) => {
    if (selectedCategory !== "all" && preset.category !== selectedCategory) {
      return false;
    }
    if (
      searchQuery &&
      !preset.name.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const handleDelete = (presetId: string) => {
    if (!confirm("Delete this preset?")) return;

    const updated = presets.filter((p) => p.id !== presetId && p.builtin);
    const customPresets = updated.filter((p) => !p.builtin);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(customPresets));
      setPresets(updated);
    } catch (err) {
      console.error("Failed to delete preset:", err);
    }
  };

  const handleExport = (preset: LayoutPreset) => {
    const json = JSON.stringify(preset, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `layout-preset-${preset.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e: unknown) => {
      const event = e as { target: { files?: FileList } };
      const file = event.target?.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const preset = JSON.parse(
            event.target?.result as string
          ) as LayoutPreset;
          preset.id = `custom-${Date.now()}`;
          preset.builtin = false;
          preset.category = "custom";

          const customPresets = presets.filter((p) => !p.builtin);
          customPresets.push(preset);

          localStorage.setItem(STORAGE_KEY, JSON.stringify(customPresets));
          loadPresets();
        } catch (_err) {
          alert("Failed to import preset: Invalid file format");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleSaveEdit = useCallback(
    (updatedPreset: LayoutPreset) => {
      try {
        const updatedPresets = presets.map((p) =>
          p.id === updatedPreset.id ? updatedPreset : p
        );

        const customPresets = updatedPresets.filter((p) => !p.builtin);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(customPresets));

        setPresets(updatedPresets);
        setEditingPreset(null);

        if (selectedPreset?.id === updatedPreset.id) {
          setSelectedPreset(updatedPreset);
        }
      } catch (err) {
        console.error("Failed to save preset:", err);
        alert("Failed to save preset changes");
      }
    },
    [presets, selectedPreset]
  );

  return {
    filteredPresets,
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    selectedPreset,
    setSelectedPreset,
    editingPreset,
    setEditingPreset,
    handleDelete,
    handleExport,
    handleImport,
    handleSaveEdit,
  };
}
