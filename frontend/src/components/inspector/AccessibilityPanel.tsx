"use client";

import { useState, useCallback, useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Search,
  ScanSearch,
  TreePine,
  MousePointerClick,
  Type,
  Link2,
  Image as ImageIcon,
  SquareCheck,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Focus,
  MousePointer,
  X,
  AlertCircle,
  Accessibility,
} from "lucide-react";

const RUNNER_API_BASE = "http://localhost:9876";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AccessibilityNode {
  role: string;
  name?: string;
  value?: string;
  description?: string;
  ref?: string;
  is_interactive?: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
  state?: Record<string, boolean>;
  properties?: Record<string, unknown>;
  children?: AccessibilityNode[];
  [key: string]: unknown;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getRoleIcon(role: string) {
  switch (role.toLowerCase()) {
    case "button":
      return <MousePointerClick className="w-3.5 h-3.5 text-purple-400" />;
    case "link":
      return <Link2 className="w-3.5 h-3.5 text-blue-400" />;
    case "textbox":
    case "input":
    case "searchbox":
    case "combobox":
      return <Type className="w-3.5 h-3.5 text-green-400" />;
    case "img":
    case "image":
      return <ImageIcon className="w-3.5 h-3.5 text-amber-400" />;
    case "checkbox":
    case "radio":
      return <SquareCheck className="w-3.5 h-3.5 text-cyan-400" />;
    default:
      return <TreePine className="w-3.5 h-3.5 text-text-muted" />;
  }
}

function getRoleBadgeVariant(role: string) {
  switch (role.toLowerCase()) {
    case "button":
      return "default" as const;
    case "link":
      return "info" as const;
    case "textbox":
    case "input":
    case "searchbox":
    case "combobox":
      return "success" as const;
    case "heading":
      return "warning" as const;
    case "img":
    case "image":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

function hasMatchingDescendant(
  node: AccessibilityNode,
  query: string
): boolean {
  if (!node.children) return false;
  const lower = query.toLowerCase();
  return node.children.some(
    (child) =>
      child.role?.toLowerCase().includes(lower) ||
      child.name?.toLowerCase().includes(lower) ||
      hasMatchingDescendant(child, query)
  );
}

function collectInteractiveNodes(
  node: AccessibilityNode
): Array<{ ref: string; role: string; name?: string }> {
  const result: Array<{ ref: string; role: string; name?: string }> = [];
  if (node.is_interactive && node.ref) {
    result.push({ ref: node.ref, role: node.role, name: node.name });
  }
  if (node.children) {
    for (const child of node.children) {
      result.push(...collectInteractiveNodes(child));
    }
  }
  return result;
}

async function executeAccessibilityCommand(
  cmdType: string,
  params: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${RUNNER_API_BASE}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd_type: cmdType, params }),
    });
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    return { success: data.success ?? true, error: data.error };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Command failed",
    };
  }
}

// ─── Node Details Panel ─────────────────────────────────────────────────────

function NodeDetailsPanel({
  node,
  onClose,
}: {
  node: AccessibilityNode;
  onClose: () => void;
}) {
  const [copySuccess, setCopySuccess] = useState(false);
  const [actionResult, setActionResult] = useState<{
    success: boolean;
    error?: string;
  } | null>(null);
  const [fillValue, setFillValue] = useState("");
  const [showFillInput, setShowFillInput] = useState(false);

  const handleCopy = () => {
    if (node.ref) {
      navigator.clipboard.writeText(node.ref);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 1500);
    }
  };

  const handleClick = async () => {
    if (!node.ref) return;
    setActionResult(null);
    const result = await executeAccessibilityCommand("click_ref", {
      ref: node.ref,
    });
    setActionResult(result);
    setTimeout(() => setActionResult(null), 3000);
  };

  const handleFocus = async () => {
    if (!node.ref) return;
    setActionResult(null);
    const result = await executeAccessibilityCommand("focus_ref", {
      ref: node.ref,
    });
    setActionResult(result);
    setTimeout(() => setActionResult(null), 3000);
  };

  const handleFill = async () => {
    if (!node.ref || !fillValue) return;
    setActionResult(null);
    const result = await executeAccessibilityCommand("fill_ref", {
      ref: node.ref,
      value: fillValue,
      clear_first: false,
    });
    setActionResult(result);
    setShowFillInput(false);
    setFillValue("");
    setTimeout(() => setActionResult(null), 3000);
  };

  const isTextInput = ["textbox", "searchbox", "combobox"].includes(node.role);

  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base text-white flex items-center gap-2">
            {getRoleIcon(node.role)}
            <Badge variant={getRoleBadgeVariant(node.role)} className="text-xs">
              {node.role}
            </Badge>
            {node.ref && (
              <span className="text-xs font-mono text-blue-400">
                {node.ref}
              </span>
            )}
          </CardTitle>
          <div className="flex items-center gap-1">
            {node.ref && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-text-muted hover:text-white"
                onClick={handleCopy}
                title="Copy ref"
              >
                {copySuccess ? (
                  <Check className="w-3.5 h-3.5 text-green-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-muted hover:text-white"
              onClick={onClose}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5 text-xs">
          {node.name && (
            <div className="flex gap-2">
              <span className="text-text-muted w-20 shrink-0">Name:</span>
              <span className="text-text-primary break-all">{node.name}</span>
            </div>
          )}
          {node.value && (
            <div className="flex gap-2">
              <span className="text-text-muted w-20 shrink-0">Value:</span>
              <span className="text-text-primary break-all">{node.value}</span>
            </div>
          )}
          {node.description && (
            <div className="flex gap-2">
              <span className="text-text-muted w-20 shrink-0">Desc:</span>
              <span className="text-text-primary break-all">
                {node.description}
              </span>
            </div>
          )}
          <div className="flex gap-2">
            <span className="text-text-muted w-20 shrink-0">Interactive:</span>
            <span
              className={
                node.is_interactive ? "text-green-400" : "text-text-muted"
              }
            >
              {node.is_interactive ? "Yes" : "No"}
            </span>
          </div>
          {node.bounds && (
            <div className="flex gap-2">
              <span className="text-text-muted w-20 shrink-0">Bounds:</span>
              <span className="text-text-primary font-mono">
                ({Math.round(node.bounds.x)}, {Math.round(node.bounds.y)}){" "}
                {Math.round(node.bounds.width)}x{Math.round(node.bounds.height)}
              </span>
            </div>
          )}
          {node.state && (
            <div className="flex gap-2">
              <span className="text-text-muted w-20 shrink-0">State:</span>
              <span className="text-text-primary font-mono text-[10px]">
                {Object.entries(node.state)
                  .filter(([, v]) => v)
                  .map(([k]) => k.replace("is_", ""))
                  .join(", ") || "none"}
              </span>
            </div>
          )}
        </div>

        {node.is_interactive && node.ref && (
          <div className="pt-2 border-t border-border-subtle/50">
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClick}
                className="text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
              >
                <MousePointer className="w-3.5 h-3.5 mr-1.5" />
                Click
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleFocus}
                className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
              >
                <Focus className="w-3.5 h-3.5 mr-1.5" />
                Focus
              </Button>
              {isTextInput && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowFillInput(!showFillInput)}
                  className={
                    showFillInput
                      ? "bg-green-500/20 text-green-400"
                      : "text-green-400 hover:text-green-300 hover:bg-green-500/10"
                  }
                >
                  <Type className="w-3.5 h-3.5 mr-1.5" />
                  Fill
                </Button>
              )}
            </div>

            {showFillInput && (
              <div className="mt-2 flex items-center gap-2">
                <Input
                  value={fillValue}
                  onChange={(e) => setFillValue(e.target.value)}
                  placeholder="Text to type..."
                  className="flex-1 h-8 text-xs bg-surface-raised/50 border-border-subtle/50 text-white placeholder:text-text-muted"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleFill();
                    if (e.key === "Escape") setShowFillInput(false);
                  }}
                  autoFocus
                />
                <Button
                  size="sm"
                  onClick={handleFill}
                  disabled={!fillValue}
                  className="bg-green-600 hover:bg-green-700 text-white h-8"
                >
                  Type
                </Button>
              </div>
            )}

            {actionResult && (
              <div
                className={`mt-2 px-2 py-1.5 rounded text-xs ${
                  actionResult.success
                    ? "bg-green-950/30 text-green-400 border border-green-500/30"
                    : "bg-red-950/30 text-red-400 border border-red-500/30"
                }`}
              >
                {actionResult.success
                  ? "Action completed"
                  : actionResult.error || "Action failed"}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Tree Node ──────────────────────────────────────────────────────────────

function AccessibilityTreeNode({
  node,
  depth = 0,
  searchQuery,
  selectedRef,
  onSelectNode,
}: {
  node: AccessibilityNode;
  depth?: number;
  searchQuery: string;
  selectedRef: string | null;
  onSelectNode: (node: AccessibilityNode) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;

  const matchesSearch =
    !searchQuery.trim() ||
    node.role?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    node.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    node.value?.toLowerCase().includes(searchQuery.toLowerCase());

  const childrenMatch =
    searchQuery.trim() &&
    node.children?.some(
      (child) =>
        child.role?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        child.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        hasMatchingDescendant(child, searchQuery)
    );

  if (searchQuery.trim() && !matchesSearch && !childrenMatch) {
    return null;
  }

  const isSelected = node.ref && node.ref === selectedRef;

  return (
    <div
      className={depth > 0 ? "ml-4 border-l border-border-subtle/30 pl-2" : ""}
    >
      <div
        className={`flex items-center gap-2 py-1.5 px-2 rounded-md transition-colors cursor-pointer ${
          isSelected
            ? "bg-brand-primary/20 ring-1 ring-brand-primary/40"
            : matchesSearch && searchQuery.trim()
              ? "bg-brand-primary/10"
              : "hover:bg-surface-hover"
        }`}
        onClick={() => onSelectNode(node)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="text-text-muted hover:text-white"
          >
            {expanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>
        ) : (
          <span className="w-3.5" />
        )}

        {getRoleIcon(node.role)}

        <Badge
          variant={getRoleBadgeVariant(node.role)}
          className="text-[10px] px-1.5 py-0"
        >
          {node.role}
        </Badge>

        {node.name && (
          <span className="text-sm text-text-primary truncate">
            {node.name}
          </span>
        )}

        {node.value && (
          <span className="text-xs text-text-muted italic truncate">
            = &quot;{node.value}&quot;
          </span>
        )}

        {node.is_interactive && (
          <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
        )}
      </div>

      {expanded && hasChildren && (
        <div>
          {node.children!.map((child, idx) => (
            <AccessibilityTreeNode
              key={`${child.role}-${child.name ?? ""}-${idx}`}
              node={child}
              depth={depth + 1}
              searchQuery={searchQuery}
              selectedRef={selectedRef}
              onSelectNode={onSelectNode}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Ref Item ───────────────────────────────────────────────────────────────

function RefItem({
  ref_id,
  role,
  name,
}: {
  ref_id: string;
  role: string;
  name?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(ref_id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  };

  return (
    <div className="flex items-center gap-2 py-1 px-2 rounded-md hover:bg-surface-hover transition-colors group">
      <span className="text-[10px] font-mono text-blue-400 flex-shrink-0">
        {ref_id}
      </span>
      <Badge
        variant={getRoleBadgeVariant(role)}
        className="text-[9px] px-1 py-0"
      >
        {role}
      </Badge>
      {name && (
        <span className="text-[11px] text-text-muted truncate flex-1">
          {name}
        </span>
      )}
      <button
        onClick={handleCopy}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-white"
        title="Copy ref"
      >
        {copied ? (
          <Check className="w-3 h-3 text-green-400" />
        ) : (
          <Copy className="w-3 h-3" />
        )}
      </button>
    </div>
  );
}

// ─── Main Panel ─────────────────────────────────────────────────────────────

export function AccessibilityPanel() {
  const [targetUrl, setTargetUrl] = useState("");
  const [isInspecting, setIsInspecting] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [treeData, setTreeData] = useState<AccessibilityNode | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [nodeCount, setNodeCount] = useState(0);
  const [selectedNode, setSelectedNode] = useState<AccessibilityNode | null>(
    null
  );

  const countNodes = useCallback((node: AccessibilityNode): number => {
    let count = 1;
    if (node.children) {
      for (const child of node.children) {
        count += countNodes(child);
      }
    }
    return count;
  }, []);

  const interactiveNodes = useMemo(() => {
    if (!treeData) return [];
    return collectInteractiveNodes(treeData);
  }, [treeData]);

  const handleInspect = async () => {
    if (!targetUrl.trim()) return;
    setIsInspecting(true);
    setInspectError(null);
    setTreeData(null);
    setSelectedNode(null);

    try {
      const res = await fetch(`${RUNNER_API_BASE}/accessibility/inspect`, {
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
      const res = await fetch(`${RUNNER_API_BASE}/execute`, {
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

  return (
    <div className="space-y-6">
      {/* URL Input + Capture */}
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardHeader>
          <CardTitle className="text-lg text-white flex items-center gap-2">
            <ScanSearch className="w-5 h-5" />
            Inspect Page
          </CardTitle>
          <CardDescription className="text-text-muted">
            Enter a URL to inspect its accessibility tree, or capture the
            currently connected page
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-3">
            <Input
              placeholder="https://example.com"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleInspect()}
              className="flex-1 bg-surface-raised/50 border-border-subtle/50 text-white placeholder:text-text-muted"
            />
            <Button
              onClick={handleInspect}
              disabled={isInspecting || !targetUrl.trim()}
              className="bg-brand-primary hover:bg-brand-primary/90 text-black font-semibold px-6"
            >
              {isInspecting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Inspecting...
                </>
              ) : (
                <>
                  <ScanSearch className="w-4 h-4 mr-2" />
                  Inspect
                </>
              )}
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border-subtle/30" />
            <span className="text-xs text-text-muted">or</span>
            <div className="h-px flex-1 bg-border-subtle/30" />
          </div>
          <Button
            variant="outline"
            onClick={handleCaptureTree}
            disabled={isInspecting}
            className="w-full border-border-subtle/50 text-text-secondary hover:text-white hover:bg-surface-hover"
          >
            <TreePine className="w-4 h-4 mr-2" />
            Capture Tree from Connected Page (CDP)
          </Button>

          {inspectError && (
            <div className="flex items-center gap-2 text-red-400 bg-red-950/20 border border-red-500/30 rounded-lg p-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <p className="text-sm">{inspectError}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {treeData ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Card className="bg-surface-raised/50 border-border-subtle/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg text-white flex items-center gap-2">
                    <TreePine className="w-5 h-5" />
                    Accessibility Tree
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{nodeCount} nodes</Badge>
                    {interactiveNodes.length > 0 && (
                      <Badge variant="success" className="gap-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                        {interactiveNodes.length} interactive
                      </Badge>
                    )}
                  </div>
                </div>
                <CardDescription className="text-text-muted">
                  Click a node to view details and interact with it
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <Input
                    placeholder="Search by role or name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 bg-surface-raised/50 border-border-subtle/50 text-white placeholder:text-text-muted"
                  />
                </div>

                <div className="max-h-[600px] overflow-y-auto bg-surface-canvas/30 rounded-lg p-3 font-mono text-sm">
                  <AccessibilityTreeNode
                    node={treeData}
                    searchQuery={searchQuery}
                    selectedRef={selectedNode?.ref ?? null}
                    onSelectNode={handleSelectNode}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            {selectedNode ? (
              <NodeDetailsPanel
                node={selectedNode}
                onClose={() => setSelectedNode(null)}
              />
            ) : (
              <Card className="bg-surface-raised/50 border-border-subtle/50">
                <CardContent className="py-12">
                  <div className="text-center">
                    <MousePointerClick className="w-8 h-8 mx-auto mb-3 text-text-muted" />
                    <p className="text-sm text-text-muted">
                      Click a node in the tree to view its details and interact
                      with it
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {interactiveNodes.length > 0 && (
              <Card className="bg-surface-raised/50 border-border-subtle/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-white flex items-center gap-2">
                    Interactive Refs
                    <Badge variant="secondary" className="text-[10px]">
                      {interactiveNodes.length}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="max-h-60 overflow-y-auto space-y-1">
                    {interactiveNodes.map((n, i) => (
                      <RefItem
                        key={`${n.ref}-${i}`}
                        ref_id={n.ref}
                        role={n.role}
                        name={n.name}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      ) : (
        !isInspecting &&
        !inspectError && (
          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardContent className="py-12">
              <div className="text-center">
                <Accessibility className="w-12 h-12 mx-auto mb-4 text-text-muted" />
                <h3 className="text-lg font-medium text-text-secondary mb-2">
                  No Inspection Results
                </h3>
                <p className="text-sm text-text-muted max-w-md mx-auto">
                  Enter a URL and click Inspect, or use Capture Tree to retrieve
                  the accessibility tree from the currently connected page.
                </p>
                <div className="flex justify-center gap-4 mt-6">
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <MousePointerClick className="w-3.5 h-3.5 text-purple-400" />
                    Buttons
                  </div>
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <Link2 className="w-3.5 h-3.5 text-blue-400" />
                    Links
                  </div>
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <Type className="w-3.5 h-3.5 text-green-400" />
                    Inputs
                  </div>
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <ImageIcon className="w-3.5 h-3.5 text-amber-400" />
                    Images
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )
      )}
    </div>
  );
}
