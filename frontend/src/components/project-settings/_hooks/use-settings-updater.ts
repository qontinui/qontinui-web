import { useCallback } from "react";
import type { ProjectSettings } from "@/types/project-settings";

export function useSettingsUpdater(
  settings: ProjectSettings,
  onUpdateSettings: (settings: ProjectSettings) => void
) {
  const updateMouseSettings = useCallback(
    (key: keyof ProjectSettings["mouse"], value: number | boolean) => {
      onUpdateSettings({
        ...settings,
        mouse: { ...settings.mouse, [key]: value },
      });
    },
    [settings, onUpdateSettings]
  );

  const updateKeyboardSettings = useCallback(
    (key: keyof ProjectSettings["keyboard"], value: number) => {
      onUpdateSettings({
        ...settings,
        keyboard: { ...settings.keyboard, [key]: value },
      });
    },
    [settings, onUpdateSettings]
  );

  const updateFindSettings = useCallback(
    (key: keyof ProjectSettings["find"], value: number) => {
      onUpdateSettings({
        ...settings,
        find: { ...settings.find, [key]: value },
      });
    },
    [settings, onUpdateSettings]
  );

  const updateWaitSettings = useCallback(
    (key: keyof ProjectSettings["wait"], value: number) => {
      onUpdateSettings({
        ...settings,
        wait: { ...settings.wait, [key]: value },
      });
    },
    [settings, onUpdateSettings]
  );

  const updateExecutionSettings = useCallback(
    (key: keyof ProjectSettings["execution"], value: number | string) => {
      onUpdateSettings({
        ...settings,
        execution: { ...settings.execution, [key]: value },
      });
    },
    [settings, onUpdateSettings]
  );

  const updateRecognitionSettings = useCallback(
    (
      key: keyof ProjectSettings["recognition"],
      value: number | string | boolean
    ) => {
      onUpdateSettings({
        ...settings,
        recognition: { ...settings.recognition, [key]: value },
      });
    },
    [settings, onUpdateSettings]
  );

  return {
    updateMouseSettings,
    updateKeyboardSettings,
    updateFindSettings,
    updateWaitSettings,
    updateExecutionSettings,
    updateRecognitionSettings,
  };
}
