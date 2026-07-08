"use client";

/**
 * MergeDependencyGraph — PR Merge Orchestrator Phase 5 D5.5.
 *
 * Renders the cross-repo PR dependency DAG for one PR's connected
 * component, tenant-scoped. Cycle members are highlighted red.
 *
 * Backend: ``GET /api/v1/operations/pr-merge/graph?repo=<repo>&pr=<n>``
 * (web-side proxy of coord's ``/pr-merge/graph``). Coord returns
 * ``{nodes, edges, topo_order, cycle_detected, cycle_members}``.
 *
 * Renderer: ``@xyflow/react`` (already a workspace dependency) +
 * ``dagre`` for left-to-right topological layout. Both are listed
 * in ``frontend/package.json`` from prior work — no new deps for
 * Phase 5.
 *
 * Composition: this is a *standalone* surface (the operator types
 * a repo + PR number into a small input and the DAG renders below)
 * meant to be reachable from the ``MergeTrain.tsx`` "Cross-repo
 * dependencies" section's inline link. See the parent integration
 * comment in MergeTrain.tsx for the wiring.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dagre from "dagre";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

/**
 * Shape of the PR-node payload carried inside each ReactFlow node's
 * `data` field. ``@xyflow/react`` v12 constrains the data type to
 * ``Record<string, unknown>``; we use a type alias with the
 * index-signature spelt explicitly so direct property access stays
 * type-safe.
 */
type PrNodeData = {
  repo: string;
  pr_number: number;
  tenant_id: string | null;
  outer_state: string | null;
  ready: boolean;
  merge_state_status: string | null;
  isCycleMember: boolean;
} & Record<string, unknown>;

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, GitBranch, RefreshCw } from "lucide-react";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_API } from "./utils";
import { useTenantDefaultRepo } from "./useTenantDefaultRepo";
import { CollapsiblePanel } from "./CollapsiblePanel";

const log = createLogger("MergeDependencyGraph");

// ---------------------------------------------------------------------------
// Wire types — mirror src/pr_merge/graph_routes.rs::GraphResponse.
// ---------------------------------------------------------------------------

interface PrRef {
  repo: string;
  pr: number;
}

interface GraphNode {
  repo: string;
  pr_number: number;
  tenant_id: string | null;
  outer_state: string | null;
  ready: boolean;
  merge_state_status: string | null;
}

interface GraphEdge {
  from: PrRef;
  to: PrRef;
  /** "upstream_of" | "stacked_on" — kept as string for forward-compat. */
  kind: string;
}

interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  topo_order: PrRef[];
  cycle_detected: boolean;
  cycle_members: PrRef[];
}

// ---------------------------------------------------------------------------
// Coloring
// ---------------------------------------------------------------------------

/**
 * Outer-state → border + background palette. Matches the
 * ``prStatusTint`` palette in MergeTrain.tsx so the colour language
 * is consistent across the two surfaces.
 */
function nodeTint(node: GraphNode, isCycleMember: boolean): {
  border: string;
  bg: string;
  text: string;
} {
  if (isCycleMember) {
    return {
      border: "#fca5a5",
      bg: "#7f1d1d",
      text: "#fee2e2",
    };
  }
  if (node.ready) {
    return {
      border: "#86efac",
      bg: "#14532d",
      text: "#dcfce7",
    };
  }
  switch (node.merge_state_status) {
    case "CLEAN":
      return { border: "#86efac", bg: "#052e16", text: "#dcfce7" };
    case "UNSTABLE":
      return { border: "#fde68a", bg: "#451a03", text: "#fef3c7" };
    case "BEHIND":
      return { border: "#fdba74", bg: "#431407", text: "#ffedd5" };
    case "BLOCKED":
    case "DIRTY":
      return { border: "#fca5a5", bg: "#450a0a", text: "#fee2e2" };
    case "DRAFT":
      return { border: "#94a3b8", bg: "#0f172a", text: "#cbd5e1" };
    default:
      return { border: "#94a3b8", bg: "#1e293b", text: "#cbd5e1" };
  }
}

// ---------------------------------------------------------------------------
// Layout — dagre left-to-right
// ---------------------------------------------------------------------------

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;

function layoutNodes(
  nodes: Node<PrNodeData>[],
  edges: Edge[],
): { nodes: Node<PrNodeData>[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  // Left-to-right layout puts upstream PRs on the left, downstream
  // on the right — operator reading order matches merge order.
  g.setGraph({ rankdir: "LR", marginx: 24, marginy: 24, nodesep: 40, ranksep: 80 });

  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }
  dagre.layout(g);

  const laidOutNodes = nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    };
  });
  return { nodes: laidOutNodes, edges };
}

// ---------------------------------------------------------------------------
// Custom node component — shows repo/#PR + state badge
// ---------------------------------------------------------------------------

function PrNodeComponent({ data }: NodeProps<Node<PrNodeData>>) {
  const tint = nodeTint(data, data.isCycleMember);
  const repoShort = data.repo.includes("/")
    ? data.repo.split("/").slice(-1)[0]
    : data.repo;
  return (
    <div
      style={{
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        border: `2px solid ${tint.border}`,
        background: tint.bg,
        color: tint.text,
        borderRadius: 6,
        padding: 8,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 4,
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
      }}
      data-pr-cycle={data.isCycleMember ? "true" : "false"}
      data-pr-ready={data.ready ? "true" : "false"}
    >
      <Handle type="target" position={Position.Left} />
      <div style={{ fontSize: 12, fontWeight: 600 }}>
        {repoShort}#{data.pr_number}
      </div>
      <div style={{ fontSize: 10, opacity: 0.85 }}>
        {data.outer_state ?? "—"}
        {data.merge_state_status ? ` · ${data.merge_state_status}` : ""}
      </div>
      {data.isCycleMember && (
        <div style={{ fontSize: 10, fontWeight: 600, color: "#fee2e2" }}>
          ⚠ cycle member
        </div>
      )}
      {data.ready && !data.isCycleMember && (
        <div style={{ fontSize: 10, fontWeight: 600, color: "#bbf7d0" }}>
          ✓ ready
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { pr: PrNodeComponent };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface MergeDependencyGraphProps {
  /** Initial repo to query — usually first repo with a multi-PR
   * chain. Optional; user can edit. */
  initialRepo?: string;
  /** Initial PR number. */
  initialPr?: number;
}

export function MergeDependencyGraph({
  initialRepo = "",
  initialPr,
}: MergeDependencyGraphProps) {
  const [repo, setRepo] = useState<string>(initialRepo);
  const [prInput, setPrInput] = useState<string>(initialPr ? String(initialPr) : "");
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // Seed the repo input from the ACTIVE tenant's first registered repo when
  // no explicit `initialRepo` was supplied — never a hardcoded operator repo.
  // This only pre-fills the input; the graph still requires a PR number + an
  // explicit "Load graph" click (or `initialRepo`+`initialPr` props) to fetch,
  // so seeding never triggers a request against a repo the tenant doesn't own.
  const { defaultRepo } = useTenantDefaultRepo();
  const seededRepoRef = useRef(false);
  useEffect(() => {
    if (seededRepoRef.current) return;
    if (initialRepo || repo) return;
    if (defaultRepo) {
      seededRepoRef.current = true;
      setRepo(defaultRepo);
    }
  }, [defaultRepo, initialRepo, repo]);

  const fetchGraph = useCallback(async () => {
    const prNum = Number(prInput);
    if (!repo || !Number.isInteger(prNum) || prNum <= 0) {
      setError("Enter a repo (owner/name) and a positive PR number");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ repo, pr: String(prNum) });
      const res = await httpClient.fetch(`${OPERATIONS_API}/pr-merge/graph?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as GraphResponse;
      setGraph(body);
    } catch (err) {
      log.warn("fetchGraph failed", err);
      setError(err instanceof Error ? err.message : String(err));
      setGraph(null);
    } finally {
      setLoading(false);
    }
  }, [repo, prInput]);

  // Auto-fetch when initial values are provided.
  useEffect(() => {
    if (initialRepo && initialPr) {
      void fetchGraph();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build the laid-out node + edge lists.
  const laidOut = useMemo(() => {
    if (!graph) return { nodes: [] as Node<PrNodeData>[], edges: [] as Edge[] };
    const cycleSet = new Set(
      graph.cycle_members.map((m) => `${m.repo}#${m.pr}`),
    );
    const rfNodes: Node[] = graph.nodes.map((n) => ({
      id: `${n.repo}#${n.pr_number}`,
      type: "pr",
      position: { x: 0, y: 0 }, // overwritten by dagre below
      data: {
        ...n,
        isCycleMember: cycleSet.has(`${n.repo}#${n.pr_number}`),
      },
    }));
    const rfEdges: Edge[] = graph.edges.map((e, i) => ({
      id: `e${i}-${e.from.repo}#${e.from.pr}-${e.to.repo}#${e.to.pr}`,
      source: `${e.from.repo}#${e.from.pr}`,
      target: `${e.to.repo}#${e.to.pr}`,
      label: e.kind === "stacked_on" ? "stacked" : undefined,
      animated: false,
      style: {
        stroke: cycleSet.has(`${e.from.repo}#${e.from.pr}`)
          && cycleSet.has(`${e.to.repo}#${e.to.pr}`)
          ? "#fca5a5"
          : "#64748b",
        strokeWidth: 1.5,
      },
    }));
    // Cast to Node<PrNodeData>[] for layoutNodes — the runtime data
    // shape includes every PrNodeData field plus `isCycleMember`.
    return layoutNodes(rfNodes as Node<PrNodeData>[], rfEdges);
  }, [graph]);

  return (
    <CollapsiblePanel
      storageKey="fleet:dep-graph"
      icon={<GitBranch className="h-4 w-4" />}
      title="Cross-repo PR dependency graph"
      summary={
        graph?.cycle_detected ? (
          <Badge variant="destructive" className="ml-2 font-mono text-xs">
            cycle
          </Badge>
        ) : null
      }
    >
        <div className="flex items-end gap-2 mb-4 flex-wrap">
          <div className="flex flex-col gap-1">
            <Label htmlFor="dep-graph-repo" className="text-xs">
              Repo (owner/name)
            </Label>
            <Input
              id="dep-graph-repo"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="qontinui/qontinui-coord"
              className="w-64 font-mono text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="dep-graph-pr" className="text-xs">
              PR #
            </Label>
            <Input
              id="dep-graph-pr"
              value={prInput}
              onChange={(e) => setPrInput(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="42"
              className="w-24 font-mono text-xs"
            />
          </div>
          <Button
            onClick={() => void fetchGraph()}
            disabled={loading || !repo || !prInput}
            size="sm"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
            Load graph
          </Button>
        </div>
        {error && (
          <p className="text-xs text-red-300 mb-2 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {error}
          </p>
        )}
        {graph?.cycle_detected && (
          <div className="mb-3 p-2 border border-red-500/30 bg-red-500/15 rounded-md">
            <p className="text-sm text-red-200 font-semibold flex items-center gap-1">
              <AlertTriangle className="h-4 w-4" />
              Dependency cycle detected — operator action required
            </p>
            <p className="text-xs text-red-300 mt-1">
              {graph.cycle_members.length} PR(s) form a cycle. Topological
              auto-merge is halted for this component. Relabel one of the
              members to break the cycle.
            </p>
            <div className="flex flex-wrap gap-1 mt-2">
              {graph.cycle_members.map((m) => (
                <Badge
                  key={`${m.repo}#${m.pr}`}
                  variant="outline"
                  className="font-mono text-[10px] text-red-200 border-red-500/40"
                >
                  {m.repo}#{m.pr}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {loading && !graph && (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}
        {graph && !graph.cycle_detected && graph.topo_order.length > 0 && (
          <div className="mb-3 text-xs text-muted-foreground">
            <span className="font-semibold">Topological order:</span>{" "}
            {graph.topo_order.map((n, i) => (
              <span key={`${n.repo}#${n.pr}`}>
                <span className="font-mono">
                  {n.repo.split("/").slice(-1)[0]}#{n.pr}
                </span>
                {i < graph.topo_order.length - 1 && (
                  <span className="mx-1">→</span>
                )}
              </span>
            ))}
          </div>
        )}
        {graph && graph.nodes.length > 0 && (
          <div
            style={{ height: 420, width: "100%", border: "1px solid var(--border)", borderRadius: 6 }}
            data-testid="merge-dep-graph-canvas"
          >
            <ReactFlow
              nodes={laidOut.nodes}
              edges={laidOut.edges}
              nodeTypes={nodeTypes}
              fitView
              proOptions={{ hideAttribution: true }}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
            >
              <Background gap={20} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        )}
        {graph && graph.nodes.length === 1 && !graph.cycle_detected && (
          <p className="text-xs text-muted-foreground mt-2">
            This PR has no cross-repo dependencies — single-node component.
          </p>
        )}
    </CollapsiblePanel>
  );
}
