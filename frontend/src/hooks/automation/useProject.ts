/**
 * useProject Hook
 *
 * Hook for project metadata operations.
 */

import { useAutomationStore } from "@/stores/automation";

export function useProject() {
  // State
  const projectName = useAutomationStore((s) => s.projectName);
  const projectId = useAutomationStore((s) => s.projectId);
  const lastSaved = useAutomationStore((s) => s.lastSaved);
  const isLoadingFromBackend = useAutomationStore((s) => s.isLoadingFromBackend);
  const categories = useAutomationStore((s) => s.categories);

  // Actions
  const setProjectName = useAutomationStore((s) => s.setProjectName);
  const setProjectId = useAutomationStore((s) => s.setProjectId);
  const setIsLoadingFromBackend = useAutomationStore(
    (s) => s.setIsLoadingFromBackend
  );
  const triggerSave = useAutomationStore((s) => s.triggerSave);
  const renameProject = useAutomationStore((s) => s.renameProject);
  const addCategory = useAutomationStore((s) => s.addCategory);
  const deleteCategory = useAutomationStore((s) => s.deleteCategory);

  return {
    // State
    projectName,
    projectId,
    lastSaved,
    isLoadingFromBackend,
    categories,

    // Actions
    setProjectName,
    setProjectId,
    setIsLoadingFromBackend,
    triggerSave,
    renameProject,
    addCategory,
    deleteCategory,
  };
}
