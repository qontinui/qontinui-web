"use client";

/**
 * UI Bridge State Machine Page
 *
 * Tabbed interface for:
 * 1. Discovery - Link to the unified Discover page for state discovery
 * 2. Graph Editor - ReactFlow graph showing states as nodes, transitions as edges
 * 3. Pathfinding - Find optimal paths between states
 * 4. Export - Download runtime-compatible JSON
 */

import { UIBridgeStateMachinePage } from "./_components/UIBridgeStateMachinePage";

export default function UIBridgeStatesPage() {
  return <UIBridgeStateMachinePage />;
}
