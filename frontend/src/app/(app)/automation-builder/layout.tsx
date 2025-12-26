"use client";

/**
 * Automation Builder Layout
 *
 * This layout wraps all automation-builder pages and ensures:
 * 1. Project data is auto-saved to backend every 10 seconds
 * 2. Local saves to IndexedDB happen via store subscriptions
 *
 * Previously, only the main /automation-builder page had autosave,
 * causing data loss when users worked on sub-pages like /states, /images, etc.
 */

import { useProjectLoader } from "@/hooks/use-project-loader";
import { useProjectAutoSave } from "@/hooks/use-project-auto-save";
import { useAutomation } from "@/contexts/automation-context";

interface AutomationBuilderLayoutProps {
  children: React.ReactNode;
}

function AutoSaveProvider({ children }: { children: React.ReactNode }) {
  const { projectId: urlProjectId, isLoading } = useProjectLoader();
  const { projectId: contextProjectId } = useAutomation();

  // Use project ID from URL if available, otherwise fall back to context
  // This ensures auto-save works even when navigating without URL project param
  const effectiveProjectId = urlProjectId || contextProjectId;

  // Auto-save to backend every 10 seconds
  // Local saves happen automatically via store subscriptions
  useProjectAutoSave({
    projectId: effectiveProjectId,
    enabled: !isLoading && effectiveProjectId !== null,
    backendSaveInterval: 10000,
  });

  return <>{children}</>;
}

export default function AutomationBuilderLayout({
  children,
}: AutomationBuilderLayoutProps) {
  return <AutoSaveProvider>{children}</AutoSaveProvider>;
}
