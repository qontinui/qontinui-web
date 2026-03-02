/**
 * Layout issue detection logic.
 *
 * Pure functions that analyze a workflow and its layout statistics
 * to produce a list of actionable LayoutIssue items.
 */

import type { Workflow } from "@/lib/action-schema/action-types";
import {
  getLayoutService,
  type LayoutPreviewResult,
} from "@/services/layout-service";
import { LayoutStyle } from "@/lib/workflow-layout/auto-layout";
import type { LayoutIssue } from "./LayoutSuggestionsTypes";

export function detectIssues(
  workflow: Workflow,
  layoutResult: LayoutPreviewResult,
  layoutService: ReturnType<typeof getLayoutService>
): LayoutIssue[] {
  const issues: LayoutIssue[] = [];

  // Check for overlapping nodes
  const overlaps = layoutResult.statistics.nodesOverlapping;
  if (overlaps > 0) {
    const overlappingNodes = findOverlappingNodes(workflow);
    issues.push({
      id: "overlapping-nodes",
      severity: "error",
      title: `${overlaps} overlapping node${overlaps > 1 ? "s" : ""}`,
      description:
        "Nodes are overlapping and may be difficult to distinguish. Apply auto-layout to fix.",
      affectedNodes: overlappingNodes,
      autoFixable: true,
      fix: () => {
        const fixed = JSON.parse(JSON.stringify(workflow));
        layoutService.applyLayout(fixed, LayoutStyle.HIERARCHICAL);
        return fixed;
      },
    });
  }

  // Check for unpositioned nodes
  const unpositioned = layoutResult.statistics.nodesWithoutPosition;
  if (unpositioned > 0) {
    const unpositionedNodes = workflow.actions
      .filter(
        (a) => !a.position || (a.position[0] === 0 && a.position[1] === 0)
      )
      .map((a) => a.id);

    issues.push({
      id: "unpositioned-nodes",
      severity: "error",
      title: `${unpositioned} unpositioned node${unpositioned > 1 ? "s" : ""}`,
      description:
        "Some nodes do not have positions. Apply auto-layout to position them.",
      affectedNodes: unpositionedNodes,
      autoFixable: true,
      fix: () => {
        const fixed = JSON.parse(JSON.stringify(workflow));
        layoutService.applyLayout(fixed, LayoutStyle.HIERARCHICAL);
        return fixed;
      },
    });
  }

  // Check for high edge crossings
  const crossings = layoutResult.statistics.edgeCrossings;
  if (crossings > 10) {
    issues.push({
      id: "edge-crossings",
      severity: "warning",
      title: `${crossings} edge crossings`,
      description:
        "High number of edge crossings may reduce readability. Try a different layout style.",
      affectedNodes: [],
      autoFixable: true,
      fix: () => {
        const fixed = JSON.parse(JSON.stringify(workflow));
        layoutService.applyLayout(fixed, LayoutStyle.HIERARCHICAL);
        return fixed;
      },
    });
  }

  // Check for poor compactness
  if (layoutResult.statistics.compactness < 0.2) {
    issues.push({
      id: "low-compactness",
      severity: "info",
      title: "Layout is very spread out",
      description:
        "The layout is using a lot of canvas space. Consider using Tree layout for more compact arrangement.",
      affectedNodes: [],
      autoFixable: true,
      fix: () => {
        const fixed = JSON.parse(JSON.stringify(workflow));
        layoutService.applyLayout(fixed, LayoutStyle.TREE, {
          horizontalSpacing: 150,
          verticalSpacing: 100,
        });
        return fixed;
      },
    });
  } else if (layoutResult.statistics.compactness > 0.8) {
    issues.push({
      id: "high-compactness",
      severity: "info",
      title: "Layout is very dense",
      description:
        "The layout is very compact and may be hard to read. Consider increasing spacing.",
      affectedNodes: [],
      autoFixable: true,
      fix: () => {
        const fixed = JSON.parse(JSON.stringify(workflow));
        layoutService.applyLayout(fixed, LayoutStyle.HIERARCHICAL, {
          horizontalSpacing: 250,
          verticalSpacing: 150,
        });
        return fixed;
      },
    });
  }

  // Check for poor readability
  if (layoutResult.statistics.readability < 0.6) {
    issues.push({
      id: "low-readability",
      severity: "warning",
      title: "Layout readability is low",
      description:
        "The layout may be hard to understand. Consider adjusting spacing or using a different layout style.",
      affectedNodes: [],
      autoFixable: true,
      fix: () => {
        const fixed = JSON.parse(JSON.stringify(workflow));
        layoutService.applyLayout(fixed, LayoutStyle.HIERARCHICAL, {
          horizontalSpacing: 200,
          verticalSpacing: 120,
          minNodeSpacing: 30,
        });
        return fixed;
      },
    });
  }

  // Check for unbalanced aspect ratio
  const aspectRatio = layoutResult.statistics.boundingBoxAspectRatio;
  if (aspectRatio > 3) {
    issues.push({
      id: "wide-aspect",
      severity: "info",
      title: "Layout is very wide",
      description:
        "The layout has a wide aspect ratio. Consider using Hierarchical layout for better balance.",
      affectedNodes: [],
      autoFixable: true,
      fix: () => {
        const fixed = JSON.parse(JSON.stringify(workflow));
        layoutService.applyLayout(fixed, LayoutStyle.HIERARCHICAL);
        return fixed;
      },
    });
  } else if (aspectRatio < 0.33) {
    issues.push({
      id: "tall-aspect",
      severity: "info",
      title: "Layout is very tall",
      description:
        "The layout has a tall aspect ratio. Consider using Horizontal layout for better balance.",
      affectedNodes: [],
      autoFixable: true,
      fix: () => {
        const fixed = JSON.parse(JSON.stringify(workflow));
        layoutService.applyLayout(fixed, LayoutStyle.HORIZONTAL);
        return fixed;
      },
    });
  }

  // Check for disconnected nodes
  const disconnected = findDisconnectedNodes(workflow);
  if (disconnected.length > 0) {
    issues.push({
      id: "disconnected-nodes",
      severity: "warning",
      title: `${disconnected.length} disconnected node${disconnected.length > 1 ? "s" : ""}`,
      description:
        "Some nodes are not connected to any other nodes. Verify your workflow structure.",
      affectedNodes: disconnected,
      autoFixable: false,
    });
  }

  return issues;
}

function findOverlappingNodes(workflow: Workflow): string[] {
  const overlapping: string[] = [];
  const nodeWidth = 180;
  const nodeHeight = 80;

  for (let i = 0; i < workflow.actions.length; i++) {
    for (let j = i + 1; j < workflow.actions.length; j++) {
      const a1 = workflow.actions[i];
      const a2 = workflow.actions[j];
      if (!a1 || !a2) continue;

      if (!a1.position || !a2.position) continue;

      const [x1, y1] = a1.position;
      const [x2, y2] = a2.position;

      const overlapX = Math.abs(x1 - x2) < nodeWidth;
      const overlapY = Math.abs(y1 - y2) < nodeHeight;

      if (overlapX && overlapY) {
        if (!overlapping.includes(a1.id)) overlapping.push(a1.id);
        if (!overlapping.includes(a2.id)) overlapping.push(a2.id);
      }
    }
  }

  return overlapping;
}

function findDisconnectedNodes(workflow: Workflow): string[] {
  const connected = new Set<string>();

  // Add all nodes that have connections
  for (const [sourceId, connections] of Object.entries(workflow.connections)) {
    connected.add(sourceId);

    for (const outputType of [
      "main",
      "error",
      "success",
      "parallel",
    ] as const) {
      const outputs = connections[outputType as keyof typeof connections];
      if (!outputs) continue;

      for (const conns of outputs) {
        for (const conn of conns) {
          connected.add(conn.action);
        }
      }
    }
  }

  // Find nodes that are not connected
  return workflow.actions
    .filter((action) => !connected.has(action.id))
    .map((action) => action.id);
}
