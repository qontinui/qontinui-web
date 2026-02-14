"use client";

/**
 * UI Bridge State Machine Page
 *
 * Tabbed interface for:
 * 1. Graph Editor - ReactFlow graph showing states as nodes, transitions as edges
 * 2. Pathfinding - Find optimal paths between states
 * 3. Export - Download runtime-compatible JSON and push to runner
 */

import { UIBridgeStateMachinePage } from "./_components/UIBridgeStateMachinePage";

export default function UIBridgeStatesPage() {
  return <UIBridgeStateMachinePage />;
}
