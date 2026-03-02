"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { WorkflowDocumentation } from "@/services/workflow-documentation-service";

export type AutoSaveStatus = "saved" | "saving" | "unsaved";

export function useDocumentationEditor(
  workflowId: string,
  documentation?: WorkflowDocumentation
) {
  const [content, setContent] = useState(documentation?.content || "");
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>("saved");
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Auto-save functionality
  useEffect(() => {
    if (content !== documentation?.content) {
      setAutoSaveStatus("unsaved");

      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }

      autoSaveTimeoutRef.current = setTimeout(() => {
        setAutoSaveStatus("saving");
        // Save to localStorage as draft
        localStorage.setItem(`doc-draft-${workflowId}`, content);
        setTimeout(() => setAutoSaveStatus("saved"), 500);
      }, 2000);
    }

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [content, documentation, workflowId]);

  // Load draft on mount
  useEffect(() => {
    const draft = localStorage.getItem(`doc-draft-${workflowId}`);
    if (draft && !documentation?.content) {
      setContent(draft);
    }
  }, [workflowId, documentation]);

  const handleSave = useCallback(
    (onSave: (content: string) => void) => {
      onSave(content);
      localStorage.removeItem(`doc-draft-${workflowId}`);
      setAutoSaveStatus("saved");
    },
    [content, workflowId]
  );

  return {
    content,
    setContent,
    autoSaveStatus,
    handleSave,
  };
}
