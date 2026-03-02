"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AutomationSettings, DEFAULT_SETTINGS } from "../types";

export function useSettings() {
  const [settings, setSettings] =
    useState<AutomationSettings>(DEFAULT_SETTINGS);

  const updateSetting = <K extends keyof AutomationSettings>(
    key: K,
    value: AutomationSettings[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    toast.success("Settings saved successfully");
  };

  const handleReset = () => {
    toast.info("Settings reset to defaults");
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "automation-settings.json";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Settings exported");
  };

  return { settings, updateSetting, handleSave, handleReset, handleExport };
}
