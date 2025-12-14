"use client";

/**
 * Automation Builder Layout
 *
 * This layout wraps all automation-builder pages and ensures:
 * 1. Project data is auto-saved to backend every 10 seconds
 * 2. Local saves to IndexedDB happen every 2 seconds
 *
 * Previously, only the main /automation-builder page had autosave,
 * causing data loss when users worked on sub-pages like /states, /images, etc.
 */

import { useProjectLoader } from "@/hooks/use-project-loader";
import { useProjectAutoSave } from "@/hooks/use-project-auto-save";

interface AutomationBuilderLayoutProps {
  children: React.ReactNode;
}

function AutoSaveProvider({ children }: { children: React.ReactNode }) {
  const { projectId, isLoading } = useProjectLoader();

  // Auto-save to backend every 10 seconds, local save every 2 seconds
  // This ensures data is saved regardless of which sub-page the user is on
  useProjectAutoSave({
    projectId,
    enabled: !isLoading && projectId !== null,
    localSaveInterval: 2000,
    backendSaveInterval: 10000,
  });

  return <>{children}</>;
}

export default function AutomationBuilderLayout({
  children,
}: AutomationBuilderLayoutProps) {
  return <AutoSaveProvider>{children}</AutoSaveProvider>;
}
