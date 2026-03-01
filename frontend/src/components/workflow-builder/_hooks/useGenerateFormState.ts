import { useState, useEffect, useCallback } from "react";
import {
  runnerApi,
  useContextsDetailed,
  type ContextItem,
} from "@/lib/runner-api";
import type { SpecSourceState } from "../SpecSourceSection";
import type { SubmittingAction } from "../ai-generate-types";

export interface GenerateFormState {
  // Description (persisted to localStorage)
  description: string;
  setDescription: (value: string) => void;

  // Context selection
  selectedContextIds: string[];
  setSelectedContextIds: React.Dispatch<React.SetStateAction<string[]>>;
  inlineContext: string;
  setInlineContext: (value: string) => void;

  // File import
  filePath: string;
  setFilePath: (value: string) => void;
  isImportingFile: boolean;
  handleImportFile: () => Promise<void>;

  // Submission
  submittingAction: SubmittingAction;
  setSubmittingAction: (value: SubmittingAction) => void;

  // Context data
  savedContexts: ContextItem[] | null | undefined;
  contextsByScope: Record<string, ContextItem[]>;
  handleContextToggle: (contextId: string) => void;

  // Context section visibility
  showContext: boolean;
  setShowContext: (value: boolean) => void;

  // Spec state
  specState: SpecSourceState;
  setSpecState: React.Dispatch<React.SetStateAction<SpecSourceState>>;
  hasSpecs: boolean;

  // Batch mode
  isBatchMode: boolean;
  batchPageCount: number;
}

export function useGenerateFormState(): GenerateFormState {
  // Form state — description is persisted to localStorage
  const [description, setDescription] = useState("");
  const [selectedContextIds, setSelectedContextIds] = useState<string[]>([]);
  const [inlineContext, setInlineContext] = useState("");
  const [filePath, setFilePath] = useState("");
  const [isImportingFile, setIsImportingFile] = useState(false);
  const [submittingAction, setSubmittingAction] =
    useState<SubmittingAction>(null);

  // Hydrate description from localStorage after mount
  useEffect(() => {
    const saved = localStorage.getItem("generate-workflow-prompt");
    if (saved) setDescription(saved);
  }, []);

  // Persist prompt to localStorage on change
  useEffect(() => {
    localStorage.setItem("generate-workflow-prompt", description);
  }, [description]);

  // Context section
  const [showContext, setShowContext] = useState(false);

  // Page Specs section
  const [specState, setSpecState] = useState<SpecSourceState>({
    discoveredSpecs: [],
    selectedGroupIds: new Set(),
    discoveredPages: [],
    selectedPageUrls: new Set(),
  });
  const hasSpecs =
    specState.discoveredSpecs.length > 0 && specState.selectedGroupIds.size > 0;

  // Batch mode: multiple pages selected
  const isBatchMode = specState.selectedPageUrls.size > 1;
  const batchPageCount = specState.selectedPageUrls.size;

  // Saved contexts
  const { data: savedContexts, refetch: refetchContexts } =
    useContextsDetailed();

  // Refetch contexts on mount
  useEffect(() => {
    refetchContexts();
  }, [refetchContexts]);

  const handleContextToggle = useCallback((contextId: string) => {
    setSelectedContextIds((prev) =>
      prev.includes(contextId)
        ? prev.filter((id) => id !== contextId)
        : [...prev, contextId]
    );
  }, []);

  const handleImportFile = async () => {
    if (!filePath.trim()) return;
    setIsImportingFile(true);
    try {
      await runnerApi.createContextFromFile("user", {
        file_path: filePath.trim(),
      });
      setFilePath("");
      refetchContexts();
    } catch (err) {
      console.error("Failed to import context from file:", err);
    } finally {
      setIsImportingFile(false);
    }
  };

  // Group contexts by scope
  const contextsByScope = (savedContexts || []).reduce(
    (acc, ctx) => {
      const scope = ctx.scope || "user";
      if (!acc[scope]) acc[scope] = [];
      acc[scope].push(ctx);
      return acc;
    },
    {} as Record<string, ContextItem[]>
  );

  return {
    description,
    setDescription,
    selectedContextIds,
    setSelectedContextIds,
    inlineContext,
    setInlineContext,
    filePath,
    setFilePath,
    isImportingFile,
    handleImportFile,
    submittingAction,
    setSubmittingAction,
    savedContexts,
    contextsByScope,
    handleContextToggle,
    showContext,
    setShowContext,
    specState,
    setSpecState,
    hasSpecs,
    isBatchMode,
    batchPageCount,
  };
}
