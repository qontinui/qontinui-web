import { useState, useCallback, useMemo } from "react";
import { runnerRequest, useRunnerTarget } from "@/lib/runner";
import { useNewWorkRefusal } from "@/contexts/active-runner-context";
import { AccessibilityNode } from "../_types";
import { collectInteractiveNodes, countNodes } from "../_utils";

export function useAccessibilityInspector() {
  const target = useRunnerTarget();
  // Opening a URL in a browser session is NEW work (the tree/capture of the
  // already-open page stays a read).
  const newWorkRefusal = useNewWorkRefusal();
  const [targetUrl, setTargetUrl] = useState("");
  const [isInspecting, setIsInspecting] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [treeData, setTreeData] = useState<AccessibilityNode | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [nodeCount, setNodeCount] = useState(0);
  const [selectedNode, setSelectedNode] = useState<AccessibilityNode | null>(
    null
  );

  const interactiveNodes = useMemo(() => {
    if (!treeData) return [];
    return collectInteractiveNodes(treeData);
  }, [treeData]);

  const handleInspect = async () => {
    if (!targetUrl.trim()) return;
    if (newWorkRefusal !== null) {
      setInspectError(newWorkRefusal);
      return;
    }
    setIsInspecting(true);
    setInspectError(null);
    setTreeData(null);
    setSelectedNode(null);

    try {
      const res = await runnerRequest(target, "/accessibility/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl.trim() }),
      });
      if (!res.ok) {
        throw new Error(`Inspection failed: ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      const tree: AccessibilityNode = data.tree ?? data;
      setTreeData(tree);
      setNodeCount(countNodes(tree));
    } catch (err) {
      setInspectError(
        err instanceof Error ? err.message : "Failed to inspect page"
      );
    } finally {
      setIsInspecting(false);
    }
  };

  const handleCaptureTree = async () => {
    setIsInspecting(true);
    setInspectError(null);
    setSelectedNode(null);

    try {
      const res = await runnerRequest(target, "/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cmd_type: "capture_accessibility",
          params: {},
        }),
      });
      if (!res.ok) {
        throw new Error(`Capture failed: ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      const result = data.data ?? data;
      if (result.success && result.snapshot?.tree) {
        setTreeData(result.snapshot.tree);
        setNodeCount(countNodes(result.snapshot.tree));
      } else if (result.tree) {
        setTreeData(result.tree);
        setNodeCount(countNodes(result.tree));
      } else {
        setInspectError(result.error || "No tree data returned");
      }
    } catch (err) {
      setInspectError(
        err instanceof Error ? err.message : "Failed to capture tree"
      );
    } finally {
      setIsInspecting(false);
    }
  };

  const handleSelectNode = useCallback((node: AccessibilityNode) => {
    setSelectedNode(node);
  }, []);

  const clearSelectedNode = useCallback(() => {
    setSelectedNode(null);
  }, []);

  return {
    newWorkRefusal,
    targetUrl,
    setTargetUrl,
    isInspecting,
    inspectError,
    treeData,
    searchQuery,
    setSearchQuery,
    nodeCount,
    selectedNode,
    interactiveNodes,
    handleInspect,
    handleCaptureTree,
    handleSelectNode,
    clearSelectedNode,
  };
}
