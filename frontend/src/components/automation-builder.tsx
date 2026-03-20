"use client";

/**
 * Automation Builder Component
 *
 * Single Responsibility: Compose project management UI.
 * This component orchestrates the hooks and renders the workflow editor.
 *
 * Hooks used (each with single responsibility):
 * - useProjectLoader: Load project from URL/backend
 * - useProjectAutoSave: Handle auto-saving
 * - useProjectNameEditor: Handle inline name editing
 */

import { Suspense } from "react";
import { AutomationBuilder as UnifiedAutomationBuilder } from "@/components/automation-builder/AutomationBuilder";
import { useAutomation } from "@/contexts/automation-context";
import { useProjectLoader } from "@/hooks/use-project-loader";
import { useProjectAutoSave } from "@/hooks/use-project-auto-save";
import { useProjectNameEditor } from "@/hooks/use-project-name-editor";
import { projectLogger } from "@/lib/project-logger";
import { Pencil, Check, X, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Project Header Component
 *
 * Single Responsibility: Render the project name header with edit functionality.
 */
function ProjectHeader({ projectId }: { projectId: string | null }) {
  const { projectName, lastSaved } = useAutomation();

  const {
    isEditing,
    editedName,
    inputRef,
    startEditing,
    cancelEditing,
    saveName,
    setEditedName,
    handleKeyDown,
  } = useProjectNameEditor({ projectId });

  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-border-default">
      <div className="flex items-center gap-4">
        {isEditing ? (
          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={cancelEditing}
              className="h-8 w-64 bg-surface-raised border-border-default text-white text-xl font-semibold"
              placeholder="Project name"
            />
            <Button
              size="sm"
              variant="ghost"
              onMouseDown={(e) => e.preventDefault()}
              onClick={saveName}
              className="h-8 w-8 p-0 text-green-500 hover:text-green-400 hover:bg-surface-raised"
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onMouseDown={(e) => e.preventDefault()}
              onClick={cancelEditing}
              className="h-8 w-8 p-0 text-red-500 hover:text-red-400 hover:bg-surface-raised"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            className="flex items-center gap-2 group cursor-pointer"
            onClick={startEditing}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startEditing(); } }}
          >
            <h1 className="text-xl font-semibold text-white group-hover:text-brand-primary transition-colors">
              {projectName || "Untitled Project"}
            </h1>
            <Pencil className="h-4 w-4 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        )}
        {lastSaved && (
          <span className="text-sm text-text-muted">
            Last saved: {new Date(lastSaved).toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Loading Indicator Component
 */
function LoadingOverlay() {
  return (
    <div className="absolute inset-0 bg-surface-base/80 flex items-center justify-center z-50">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-brand-primary" />
        <span className="text-white">Loading project...</span>
      </div>
    </div>
  );
}

/**
 * Main Content Component
 *
 * Single Responsibility: Orchestrate hooks and compose the UI.
 */
function AutomationBuilderContent() {
  // Project loading from URL
  const { projectId, isLoading, error } = useProjectLoader();

  projectLogger.debug("AutomationBuilder", "Render", {
    projectId,
    isLoading,
    hasError: !!error,
  });

  // Auto-save functionality
  useProjectAutoSave({
    projectId,
    enabled: !isLoading && projectId !== null,
  });

  return (
    <div className="h-full w-full flex flex-col bg-surface-base relative">
      {/* Loading Overlay */}
      {isLoading && <LoadingOverlay />}

      {/* Project Name Header */}
      <ProjectHeader projectId={projectId} />

      {/* Workflow Editor */}
      <div className="flex-1 min-h-0">
        <UnifiedAutomationBuilder />
      </div>
    </div>
  );
}

/**
 * Exported Component with Suspense Boundary
 *
 * Note: AutomationProvider is already provided by the app layout.
 * Don't wrap again here or RequireProject won&apos;t see the projectId.
 */
export default function AutomationBuilder() {
  return (
    <Suspense
      fallback={
        <div className="h-full w-full flex items-center justify-center bg-surface-base">
          <Loader2 className="h-8 w-8 animate-spin text-brand-primary" />
        </div>
      }
    >
      <AutomationBuilderContent />
    </Suspense>
  );
}
