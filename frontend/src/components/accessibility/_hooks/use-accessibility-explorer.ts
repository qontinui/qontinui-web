"use client";

import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { useAccessibilityTree } from "@/hooks/use-accessibility-tree";
import type {
  AccessibilityNode,
  AccessibilitySelector,
} from "@qontinui/schemas/accessibility";

interface UseAccessibilityExplorerOptions {
  apiUrl: string;
  cdpHost: string;
  cdpPort: number;
  onSelectorConfigured?: (
    selector: AccessibilitySelector,
    node: AccessibilityNode
  ) => void;
}

export function useAccessibilityExplorer({
  apiUrl,
  cdpHost: initialCdpHost,
  cdpPort: initialCdpPort,
  onSelectorConfigured,
}: UseAccessibilityExplorerOptions) {
  // CDP connection settings
  const [cdpHost, setCdpHost] = useState(initialCdpHost);
  const [cdpPort, setCdpPort] = useState(initialCdpPort);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Selector state
  const [currentSelector, setCurrentSelector] = useState<AccessibilitySelector>(
    {}
  );
  const [matchCount, setMatchCount] = useState(0);

  // Quick action state
  const [actionRef, setActionRef] = useState("");
  const [actionText, setActionText] = useState("");

  // Screenshot state (for bounds overlay)
  const [screenshotUrl, _setScreenshotUrl] = useState<string | null>(null);
  const [hoveredRef, setHoveredRef] = useState<string | null>(null);

  // Suppress unused warning - will be used when screenshot capture is added
  void _setScreenshotUrl;

  // Use the accessibility tree hook
  const {
    snapshot,
    selectedNode,
    selectedRef,
    isLoading,
    error,
    aiContext,
    capture,
    selectNode,
    clickRef,
    fillRef,
    focusRef,
    findElements,
    disconnect,
  } = useAccessibilityTree({
    apiUrl,
    cdpHost,
    cdpPort,
  });

  // Handle capture
  const handleCapture = useCallback(async () => {
    try {
      await capture();
      toast.success("Accessibility tree captured");
    } catch {
      toast.error("Failed to capture accessibility tree");
    }
  }, [capture]);

  // Handle selector test
  const handleTestSelector = useCallback(async () => {
    try {
      const matches = await findElements(currentSelector);
      setMatchCount(matches.length);
      if (matches.length === 0) {
        toast.info("No matching elements found");
      } else {
        toast.success(`Found ${matches.length} matching element(s)`);
      }
    } catch {
      toast.error("Failed to test selector");
    }
  }, [currentSelector, findElements]);

  // Handle node selection
  const handleSelectNode = useCallback(
    (node: AccessibilityNode) => {
      selectNode(node);
      setActionRef(node.ref);

      // Pre-fill selector from selected node
      setCurrentSelector({
        role: node.role,
        name: node.name || undefined,
        is_interactive: node.is_interactive || undefined,
      });
    },
    [selectNode]
  );

  // Handle use selector
  const handleUseSelector = useCallback(() => {
    if (selectedNode) {
      onSelectorConfigured?.(currentSelector, selectedNode);
      toast.success("Selector configured");
    }
  }, [currentSelector, selectedNode, onSelectorConfigured]);

  // Quick actions
  const handleQuickClick = useCallback(async () => {
    if (!actionRef) return;
    const success = await clickRef(actionRef);
    if (success) {
      toast.success(`Clicked ${actionRef}`);
    } else {
      toast.error(`Failed to click ${actionRef}`);
    }
  }, [actionRef, clickRef]);

  const handleQuickType = useCallback(async () => {
    if (!actionRef || !actionText) return;
    const success = await fillRef(actionRef, actionText);
    if (success) {
      toast.success(`Typed into ${actionRef}`);
    } else {
      toast.error(`Failed to type into ${actionRef}`);
    }
  }, [actionRef, actionText, fillRef]);

  const handleQuickFocus = useCallback(async () => {
    if (!actionRef) return;
    const success = await focusRef(actionRef);
    if (success) {
      toast.success(`Focused ${actionRef}`);
    } else {
      toast.error(`Failed to focus ${actionRef}`);
    }
  }, [actionRef, focusRef]);

  // Copy AI context
  const handleCopyAIContext = useCallback(() => {
    if (aiContext) {
      navigator.clipboard.writeText(aiContext);
      toast.success("AI context copied to clipboard");
    }
  }, [aiContext]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    // CDP settings
    cdpHost,
    setCdpHost,
    cdpPort,
    setCdpPort,
    settingsOpen,
    setSettingsOpen,

    // Tree data
    snapshot,
    selectedNode,
    selectedRef,
    isLoading,
    error,
    aiContext,

    // Selector
    currentSelector,
    setCurrentSelector,
    matchCount,

    // Quick actions
    actionRef,
    setActionRef,
    actionText,
    setActionText,

    // Overlay
    screenshotUrl,
    hoveredRef,
    setHoveredRef,

    // Handlers
    handleCapture,
    handleTestSelector,
    handleSelectNode,
    handleUseSelector,
    handleQuickClick,
    handleQuickType,
    handleQuickFocus,
    handleCopyAIContext,
  };
}
