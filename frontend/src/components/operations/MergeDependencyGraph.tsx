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
 * Composition: **one PR's graph, keyed on that PR.** It takes ``repo`` and
 * ``pr`` as required props and fetches on mount.
 *
 * It used to be a standalone surface behind a ``#merge-dep-graph`` anchor,
 * with a repo input and a PR-number input the operator had to fill in by hand.
 * Phase 4 of ``2026-08-25-coord-console-intent-and-devops-sections`` deleted
 * the form and the anchor and moved it into the ``MergePipeline`` row
 * expansion: the row already knows its own repo and PR number, so asking the
 * operator to re-type them was asking for the one thing the surface already
 * had. Nothing seeds a repo any more either — there is no "some repo" state
 * left for a tenant default to fill.
 *
 * **It owns no collapse of its own, deliberately.** It used to render its own
 * ``CollapsiblePanel``, and that was wrong the moment it moved into a row: the
 * panel gates its CHILDREN, while this component's fetch effect sits above
 * them — so a collapsed panel still cost a request and a mount for every row
 * an operator expanded. The caller wraps it instead, which makes "collapsed"
 * mean *not mounted, not fetched*.
 *
 * The honest cost of that: while it is collapsed there is no cycle badge on
 * the header, because nothing has been read. R7 asks a collapsed panel to keep
 * its signal, and a signal that cannot exist without the request the collapse
 * exists to avoid is one this surface simply does not have. An invented
 * "no cycles" would be worse than an absent badge.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
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
  topo_merge_ready?: boolean;
  block_reason_code?: string | null;
  /** Legacy wire name for `topo_merge_ready` — see {@link GraphNode}. */
  ready?: boolean;
  merge_state_status: string | null;
  isCycleMember: boolean;
} & Record<string, unknown>;

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_API } from "./utils";

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
  /**
   * The topological-merge predicate (`is_pr_ready_for_topo_merge`). It
   * requires review `APPROVED`, which agents on this fleet never give, so it
   * reads `false` for PRs the merge train will land. Secondary signal only —
   * never the "landable" colour.
   */
  topo_merge_ready?: boolean;
  /**
   * The merge predicate's latest verdict (the latest `predicate_eval`
   * `pr_events` row — the same verdict `coord_pr_status` serves). `"none"`
   * means the predicate passed; `null` means no verdict is recorded. Absent
   * on a coord that predates the field.
   */
  block_reason_code?: string | null;
  /**
   * LEGACY: the pre-rename wire name of `topo_merge_ready` (same predicate).
   * Served only by a coord predating plan
   * `2026-09-28-coord-pr-merge-ready-false-stall-and-events-tenant-mismatch`
   * Phase 2c; read only when `block_reason_code` is absent.
   */
  ready?: boolean;
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
// Readiness — which predicate says "landable"
// ---------------------------------------------------------------------------

type ReadinessFields = Pick<
  GraphNode,
  "topo_merge_ready" | "block_reason_code" | "ready"
>;

/**
 * Primary "landable" signal: the MERGE predicate's verdict, not the
 * review-gated topo flag. A coord that predates `block_reason_code` omits the
 * key, and only then does the legacy `ready` stand in. A present `null` (no
 * verdict recorded yet) is not landable.
 */
function isLandable(node: ReadinessFields): boolean {
  if (node.block_reason_code !== undefined) {
    return node.block_reason_code === "none";
  }
  return node.ready === true;
}

/** The topo-merge flag under either wire name; `undefined` when neither is served. */
function topoMergeReady(node: ReadinessFields): boolean | undefined {
  return node.topo_merge_ready ?? node.ready;
}

/** Tooltip text naming the merge verdict and the topo flag, for operators. */
function readinessTooltip(node: ReadinessFields): string {
  const parts: string[] = [];
  if (node.block_reason_code === undefined) {
    parts.push("merge predicate verdict: not served by this coord build");
  } else if (node.block_reason_code === null) {
    parts.push("merge predicate verdict: none recorded yet");
  } else if (node.block_reason_code === "none") {
    parts.push("merge predicate: passed");
  } else {
    parts.push(`merge predicate blocked: ${node.block_reason_code}`);
  }
  const topo = topoMergeReady(node);
  if (topo !== undefined) {
    parts.push(
      `topo merge ready: ${topo ? "yes" : "no"} (requires review APPROVED)`
    );
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Coloring
// ---------------------------------------------------------------------------

/**
 * Outer-state → border + background palette. Matches the
 * ``prStatusTint`` palette in MergeTrain.tsx so the colour language
 * is consistent across the two surfaces.
 */
function nodeTint(
  node: GraphNode,
  isCycleMember: boolean
): {
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
  if (isLandable(node)) {
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
const NODE_HEIGHT = 96;

function layoutNodes(
  nodes: Node<PrNodeData>[],
  edges: Edge[]
): { nodes: Node<PrNodeData>[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  // Left-to-right layout puts upstream PRs on the left, downstream
  // on the right — operator reading order matches merge order.
  g.setGraph({
    rankdir: "LR",
    marginx: 24,
    marginy: 24,
    nodesep: 40,
    ranksep: 80,
  });

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
  const landable = isLandable(data);
  const topo = topoMergeReady(data);
  const blockReason =
    data.block_reason_code && data.block_reason_code !== "none"
      ? data.block_reason_code
      : null;
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
      data-pr-ready={landable ? "true" : "false"}
      data-pr-block-reason={data.block_reason_code ?? undefined}
      data-pr-topo-ready={topo === undefined ? undefined : String(topo)}
      title={readinessTooltip(data)}
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
      {blockReason && !data.isCycleMember && (
        <div
          style={{
            fontSize: 10,
            opacity: 0.85,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          data-testid="merge-dep-graph-block-reason"
        >
          blocked: {blockReason}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {landable && !data.isCycleMember && (
          <span style={{ fontSize: 10, fontWeight: 600, color: "#bbf7d0" }}>
            ✓ ready
          </span>
        )}
        {topo !== undefined && (
          <span
            style={{
              fontSize: 9,
              padding: "0 4px",
              borderRadius: 4,
              border: "1px solid currentColor",
              opacity: 0.7,
            }}
            data-testid="merge-dep-graph-topo-badge"
          >
            topo {topo ? "✓" : "✗"}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { pr: PrNodeComponent };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface MergeDependencyGraphProps {
  /** The repo this graph is for — `owner/name`. Required: this renders one
   *  KNOWN PR's connected component, never "whichever repo you type". */
  repo: string;
  /** The PR number this graph is for. Required, for the same reason. */
  pr: number;
}

export function MergeDependencyGraph({ repo, pr }: MergeDependencyGraphProps) {
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ repo, pr: String(pr) });
      const res = await httpClient.fetch(
        `${OPERATIONS_API}/pr-merge/graph?${params.toString()}`
      );
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
  }, [repo, pr]);

  // The identifiers are props, so there is nothing to wait for: fetch on mount
  // and whenever the row this is mounted under changes.
  useEffect(() => {
    void fetchGraph();
  }, [fetchGraph]);

  // Build the laid-out node + edge lists.
  const laidOut = useMemo(() => {
    if (!graph) return { nodes: [] as Node<PrNodeData>[], edges: [] as Edge[] };
    const cycleSet = new Set(
      graph.cycle_members.map((m) => `${m.repo}#${m.pr}`)
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
        stroke:
          cycleSet.has(`${e.from.repo}#${e.from.pr}`) &&
          cycleSet.has(`${e.to.repo}#${e.to.pr}`)
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
    <div className="space-y-2" data-testid="merge-dep-graph-body">
      <div className="flex items-center justify-end">
        <Button
          onClick={() => void fetchGraph()}
          disabled={loading}
          size="sm"
          variant="outline"
          data-testid="merge-dep-graph-refresh"
          aria-label="Reload dependency graph"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
          />
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
            auto-merge is halted for this component. Relabel one of the members
            to break the cycle.
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
          style={{
            height: 420,
            width: "100%",
            border: "1px solid var(--border)",
            borderRadius: 6,
          }}
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
    </div>
  );
}
