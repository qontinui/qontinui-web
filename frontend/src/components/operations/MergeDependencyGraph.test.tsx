/**
 * MergeDependencyGraph — the dual wire shape and the graph proxy's errors.
 *
 * Coord's `/pr-merge/graph` node renamed `ready` to `topo_merge_ready` and
 * added `block_reason_code` (plan
 * `2026-09-28-coord-pr-merge-ready-false-stall-and-events-tenant-mismatch`
 * Phase 2c). The graph must render BOTH shapes: "landable" keys off
 * `block_reason_code === "none"` when the key is present, and off the legacy
 * `ready` only when it is absent.
 *
 * `ReactFlow` is stubbed to render every node through the component's own
 * `nodeTypes` entry, so the real `PrNodeComponent` is what the assertions
 * read. jsdom has no layout, and the real canvas renders nodes only after it
 * measures them, which is not what this file tests.
 */

import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({
    nodes,
    nodeTypes,
  }: {
    nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>;
    nodeTypes: Record<string, ComponentType<{ data: unknown }>>;
  }) => (
    <div data-testid="stub-react-flow">
      {nodes.map((n) => {
        const NodeType = nodeTypes[n.type];
        return (
          <div key={n.id} data-testid={`node-${n.id}`}>
            <NodeType data={n.data} />
          </div>
        );
      })}
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
}));
vi.mock("@xyflow/react/dist/style.css", () => ({}));

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

import {
  MergeDependencyGraph,
  graphErrorMessage,
  isLandable,
  readinessTooltip,
  topoMergeReady,
} from "./MergeDependencyGraph";

function node(pr: number, fields: Record<string, unknown>) {
  return {
    repo: "qontinui/qontinui-web",
    pr_number: pr,
    tenant_id: null,
    outer_state: "open",
    merge_state_status: "CLEAN",
    ...fields,
  };
}

const NODES = [
  // 1 — legacy coord: only `ready`.
  node(1, { ready: true }),
  // 2 — new coord: predicate passed, topo flag false (no review APPROVED).
  node(2, { topo_merge_ready: false, block_reason_code: "none" }),
  // 3 — new coord: topo flag true, no predicate verdict recorded yet.
  node(3, { topo_merge_ready: true, block_reason_code: null }),
  // 4 — new coord: predicate blocked.
  node(4, { topo_merge_ready: false, block_reason_code: "ci-pending" }),
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function nodeEl(pr: number): HTMLElement {
  const wrapper = screen.getByTestId(`node-qontinui/qontinui-web#${pr}`);
  const el = wrapper.querySelector("[data-pr-ready]");
  if (!(el instanceof HTMLElement)) throw new Error(`node ${pr} not rendered`);
  return el;
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("MergeDependencyGraph — dual wire shape", () => {
  it("renders readiness attributes for legacy and new node shapes", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        nodes: NODES,
        edges: [],
        topo_order: [],
        cycle_detected: false,
        cycle_members: [],
      })
    );
    render(<MergeDependencyGraph repo="qontinui/qontinui-web" pr={1} />);
    await waitFor(() => expect(screen.getByTestId("stub-react-flow")));

    // Legacy `{ready: true}`: landable via the fallback; `ready` doubles as
    // the topo flag; no block reason served.
    const legacy = nodeEl(1);
    expect(legacy.getAttribute("data-pr-ready")).toBe("true");
    expect(legacy.getAttribute("data-pr-topo-ready")).toBe("true");
    expect(legacy.hasAttribute("data-pr-block-reason")).toBe(false);

    // `block_reason_code: "none"` is landable even with topo false.
    const passed = nodeEl(2);
    expect(passed.getAttribute("data-pr-ready")).toBe("true");
    expect(passed.getAttribute("data-pr-topo-ready")).toBe("false");
    expect(passed.getAttribute("data-pr-block-reason")).toBe("none");

    // A present `null` verdict is NOT landable, even with topo true.
    const noVerdict = nodeEl(3);
    expect(noVerdict.getAttribute("data-pr-ready")).toBe("false");
    expect(noVerdict.getAttribute("data-pr-topo-ready")).toBe("true");
    expect(noVerdict.hasAttribute("data-pr-block-reason")).toBe(false);

    // A blocked verdict: not landable, and the reason is shown on the node.
    const blocked = nodeEl(4);
    expect(blocked.getAttribute("data-pr-ready")).toBe("false");
    expect(blocked.getAttribute("data-pr-topo-ready")).toBe("false");
    expect(blocked.getAttribute("data-pr-block-reason")).toBe("ci-pending");
    expect(blocked.textContent).toContain("blocked: ci-pending");
  });
});

describe("readiness helpers", () => {
  it("isLandable prefers block_reason_code and falls back to ready", () => {
    expect(isLandable({ ready: true })).toBe(true);
    expect(isLandable({ ready: false })).toBe(false);
    expect(isLandable({})).toBe(false);
    expect(isLandable({ block_reason_code: "none", ready: false })).toBe(true);
    // Present-but-null means "no verdict", which wins over a legacy `ready`.
    expect(isLandable({ block_reason_code: null, ready: true })).toBe(false);
    expect(isLandable({ block_reason_code: "ci-pending" })).toBe(false);
  });

  it("topoMergeReady reads either wire name", () => {
    expect(topoMergeReady({ topo_merge_ready: false, ready: true })).toBe(
      false
    );
    expect(topoMergeReady({ ready: true })).toBe(true);
    expect(topoMergeReady({})).toBeUndefined();
  });

  it("readinessTooltip names the verdict for each shape", () => {
    expect(readinessTooltip({ ready: true })).toContain(
      "not served by this coord build"
    );
    expect(readinessTooltip({ block_reason_code: null })).toContain(
      "none recorded yet"
    );
    expect(readinessTooltip({ block_reason_code: "none" })).toContain(
      "merge predicate: passed"
    );
    expect(readinessTooltip({ block_reason_code: "ci-pending" })).toContain(
      "merge predicate blocked: ci-pending"
    );
  });
});

describe("graph proxy errors", () => {
  const refusal = {
    error: "repo_not_in_caller_tenant",
    caller_tenant_id: "11111111-1111-1111-1111-111111111111",
    repo: "other-org/other-repo",
  };

  it("reads the refusal under `detail` (FastAPI default handler)", () => {
    expect(graphErrorMessage(JSON.stringify({ detail: refusal }), 404)).toBe(
      "other-org/other-repo is not owned by your tenant, so coord will not show its dependency graph."
    );
  });

  it("reads the refusal spliced to the top level (production envelope)", () => {
    const envelope = {
      ...refusal,
      // production writes Python's str(dict) of the detail here
      message:
        "{'error': 'repo_not_in_caller_tenant', 'caller_tenant_id': '11111111-1111-1111-1111-111111111111', 'repo': 'other-org/other-repo'}",
      timestamp: 0,
      path: "/x",
    };
    expect(graphErrorMessage(JSON.stringify(envelope), 404)).toContain(
      "other-org/other-repo is not owned by your tenant"
    );
  });

  it("falls back to the guarded reader for other errors", () => {
    expect(graphErrorMessage("<html>bad gateway</html>", 502)).toBe("HTTP 502");
    expect(
      graphErrorMessage(
        JSON.stringify({ detail: "coord is not reachable" }),
        502
      )
    ).toBe("coord is not reachable");
  });

  it("shows the readable sentence in the panel, not the raw body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: refusal }, 404));
    render(<MergeDependencyGraph repo="other-org/other-repo" pr={1} />);
    const error = await screen.findByTestId("merge-dep-graph-error");
    expect(error.textContent).toContain(
      "other-org/other-repo is not owned by your tenant"
    );
    expect(error.textContent).not.toContain("{");
  });
});
