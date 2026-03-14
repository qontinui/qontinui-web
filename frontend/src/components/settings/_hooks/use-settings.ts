import { useState, useEffect } from "react";
import { toast } from "sonner";
import { QontinuiSettings, defaultSettings } from "../settings-types";
import type { UpdateSettingFn } from "../settings-types";

export function useSettings() {
  const [settings, setSettings] = useState<QontinuiSettings>(defaultSettings);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/v1/settings/", {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        setSettings(data);
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
      toast.error("Failed to load settings");
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/v1/settings/", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(settings),
      });
      if (response.ok) {
        toast.success("Settings saved successfully");
      } else {
        toast.error("Failed to save settings");
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error("Failed to save settings");
    } finally {
      setLoading(false);
    }
  };

  const resetSettings = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/v1/settings/reset", {
        method: "POST",
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        setSettings(data);
        toast.success("Settings reset to defaults");
      } else {
        toast.error("Failed to reset settings");
      }
    } catch (error) {
      console.error("Failed to reset settings:", error);
      toast.error("Failed to reset settings");
    } finally {
      setLoading(false);
    }
  };

  const exportSettings = async () => {
    try {
      const response = await fetch("/api/v1/settings/export?format=yaml", {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        const blob = new Blob([data.content], { type: "text/yaml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "qontinui-settings.yaml";
        a.click();
        toast.success("Settings exported");
      }
    } catch (error) {
      console.error("Failed to export settings:", error);
      toast.error("Failed to export settings");
    }
  };

  const updateSetting: UpdateSettingFn = (category, key, value) => {
    setSettings((prev) => ({
      ...prev,
      [category]: {
        ...prev[category],
        [key]: value,
      },
    }));
  };

  return {
    settings,
    loading,
    saveSettings,
    resetSettings,
    exportSettings,
    updateSetting,
  };
}
