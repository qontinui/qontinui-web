import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, TreePine, MousePointerClick } from "lucide-react";
import { AccessibilityNode } from "../_types";
import { AccessibilityTreeNode } from "./AccessibilityTreeNode";
import { NodeDetailsPanel } from "./NodeDetailsPanel";
import { RefItem } from "./RefItem";

export function TreeResultsPanel({
  treeData,
  searchQuery,
  setSearchQuery,
  nodeCount,
  selectedNode,
  interactiveNodes,
  onSelectNode,
  onClearSelectedNode,
}: {
  treeData: AccessibilityNode;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  nodeCount: number;
  selectedNode: AccessibilityNode | null;
  interactiveNodes: Array<{ ref: string; role: string; name?: string }>;
  onSelectNode: (node: AccessibilityNode) => void;
  onClearSelectedNode: () => void;
}) {
  return (
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
                onSelectNode={onSelectNode}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {selectedNode ? (
          <NodeDetailsPanel node={selectedNode} onClose={onClearSelectedNode} />
        ) : (
          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardContent className="py-12">
              <div className="text-center">
                <MousePointerClick className="w-8 h-8 mx-auto mb-3 text-text-muted" />
                <p className="text-sm text-text-muted">
                  Click a node in the tree to view its details and interact with
                  it
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
  );
}
