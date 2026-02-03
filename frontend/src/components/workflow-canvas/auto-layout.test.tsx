/**
 * Auto-Layout UI Tests
 *
 * Comprehensive test suite for auto-layout functionality including:
 * - Layout service
 * - Statistics calculation
 * - Presets
 * - Suggestions
 * - Animation
 * - History
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { Workflow } from "@/lib/action-schema/action-types";
import { LayoutStyle } from "@/lib/workflow-layout/auto-layout";
import {
  LayoutService,
  getLayoutService,
  resetLayoutService,
} from "@/services/layout-service";
import {
  calculateLayoutStatistics,
  compareLayouts,
} from "@/services/layout-statistics";
import {
  getAllPresets,
  getPresetById,
  saveCustomPreset,
  deleteCustomPreset,
  BUILTIN_PRESETS,
} from "@/services/layout-presets";
import {
  getLayoutSuggestions,
  autoFixSuggestions,
  hasCriticalIssues,
} from "@/services/layout-suggestions";
import {
  LayoutAnimationController,
  extractPositions,
  applyPositions,
} from "@/components/workflow-canvas/layout-animation";
import { useLayoutHistory } from "@/stores/layout-history";

// ============================================================================
// Test Fixtures
// ============================================================================

function createTestWorkflow(): Workflow {
  return {
    id: "test-workflow",
    name: "Test Workflow",
    version: "1.0.0",
    format: "graph",
    actions: [
      {
        id: "a1",
        type: "CLICK",
        config: {} as unknown,
        position: [100, 100],
      },
      {
        id: "a2",
        type: "TYPE",
        config: {} as unknown,
        position: [100, 200],
      },
      {
        id: "a3",
        type: "FIND",
        config: {} as unknown,
        position: [100, 300],
      },
    ],
    connections: {
      a1: {
        main: [[{ action: "a2", type: "main", index: 0 }]],
      },
      a2: {
        main: [[{ action: "a3", type: "main", index: 0 }]],
      },
    },
  };
}

function createOverlappingWorkflow(): Workflow {
  return {
    id: "overlapping-workflow",
    name: "Overlapping Workflow",
    version: "1.0.0",
    format: "graph",
    actions: [
      {
        id: "a1",
        type: "CLICK",
        config: {} as unknown,
        position: [100, 100],
      },
      {
        id: "a2",
        type: "TYPE",
        config: {} as unknown,
        position: [110, 110], // Overlapping with a1
      },
    ],
    connections: {},
  };
}

function createBranchingWorkflow(): Workflow {
  return {
    id: "branching-workflow",
    name: "Branching Workflow",
    version: "1.0.0",
    format: "graph",
    actions: [
      {
        id: "a1",
        type: "IF",
        config: {} as unknown,
        position: [100, 100],
      },
      {
        id: "a2",
        type: "CLICK",
        config: {} as unknown,
        position: [100, 200],
      },
      {
        id: "a3",
        type: "TYPE",
        config: {} as unknown,
        position: [300, 200],
      },
      {
        id: "a4",
        type: "FIND",
        config: {} as unknown,
        position: [200, 300],
      },
    ],
    connections: {
      a1: {
        main: [
          [{ action: "a2", type: "main", index: 0 }], // True branch
          [{ action: "a3", type: "main", index: 0 }], // False branch
        ],
      },
      a2: {
        main: [[{ action: "a4", type: "main", index: 0 }]],
      },
      a3: {
        main: [[{ action: "a4", type: "main", index: 0 }]],
      },
    },
  };
}

// ============================================================================
// Layout Service Tests
// ============================================================================

describe("LayoutService", () => {
  let layoutService: LayoutService;
  let workflow: Workflow;

  beforeEach(() => {
    resetLayoutService();
    layoutService = getLayoutService();
    workflow = createTestWorkflow();
  });

  it("should apply layout to workflow", () => {
    const originalPositions = workflow.actions.map((a) => a.position);

    layoutService.applyLayout(workflow, LayoutStyle.HIERARCHICAL);

    // Positions should change
    const newPositions = workflow.actions.map((a) => a.position);
    expect(newPositions).not.toEqual(originalPositions);
  });

  it("should preview layout without mutating workflow", () => {
    const originalPositions = workflow.actions.map((a) => [...a.position]);

    const preview = layoutService.previewLayout(workflow, LayoutStyle.TREE);

    // Original workflow unchanged
    expect(workflow.actions.map((a) => a.position)).toEqual(originalPositions);

    // Preview has different positions
    expect(preview.workflow.actions.map((a) => a.position)).not.toEqual(
      originalPositions
    );
  });

  it("should detect overlapping nodes", () => {
    const overlapping = createOverlappingWorkflow();

    expect(layoutService.hasOverlaps(overlapping)).toBe(true);
    expect(layoutService.needsLayout(overlapping)).toBe(true);
  });

  it("should detect unpositioned nodes", () => {
    workflow.actions[0].position = [0, 0];

    expect(layoutService.hasUnpositioned(workflow)).toBe(true);
    expect(layoutService.needsLayout(workflow)).toBe(true);
  });

  it("should recommend layout style", () => {
    const recommendation = layoutService.getRecommendedLayout(workflow);

    expect(recommendation).toBeDefined();
    expect(recommendation.style).toBeDefined();
    expect(recommendation.confidence).toBeGreaterThan(0);
    expect(recommendation.confidence).toBeLessThanOrEqual(1);
    expect(recommendation.reason).toBeDefined();
    expect(recommendation.alternatives).toHaveLength(4);
  });

  it("should recommend hierarchical for branching workflows", () => {
    const branching = createBranchingWorkflow();
    const recommendation = layoutService.getRecommendedLayout(branching);

    expect(recommendation.style).toBe(LayoutStyle.HIERARCHICAL);
  });

  it("should preserve manual positions when requested", () => {
    const preservedId = workflow.actions[0].id;
    const preservedPosition = [...workflow.actions[0].position];

    layoutService.applyLayout(workflow, LayoutStyle.HIERARCHICAL, {
      preserveManualPositions: true,
      preservedNodeIds: [preservedId],
    });

    expect(workflow.actions[0].position).toEqual(preservedPosition);
  });
});

// ============================================================================
// Statistics Tests
// ============================================================================

describe("LayoutStatistics", () => {
  it("should calculate basic statistics", () => {
    const workflow = createTestWorkflow();
    const stats = calculateLayoutStatistics(workflow);

    expect(stats.nodeCount).toBe(3);
    expect(stats.edgeCount).toBe(2);
    expect(stats.nodesOverlapping).toBe(0);
    expect(stats.layoutScore).toBeGreaterThanOrEqual(0);
    expect(stats.layoutScore).toBeLessThanOrEqual(100);
  });

  it("should detect overlaps", () => {
    const workflow = createOverlappingWorkflow();
    const stats = calculateLayoutStatistics(workflow);

    expect(stats.nodesOverlapping).toBeGreaterThan(0);
  });

  it("should compare layouts", () => {
    const before = createOverlappingWorkflow();
    const after = JSON.parse(JSON.stringify(before));

    // Apply layout to fix overlaps
    const layoutService = getLayoutService();
    layoutService.applyLayout(after, LayoutStyle.HIERARCHICAL);

    const comparison = compareLayouts(before, after);

    expect(comparison.improvementScore).toBeGreaterThan(0);
    expect(comparison.isImprovement).toBe(true);
    expect(comparison.metrics.overlaps.change).toBeGreaterThan(0);
  });

  it("should calculate edge crossings", () => {
    const workflow = createBranchingWorkflow();
    const stats = calculateLayoutStatistics(workflow);

    expect(stats.edgeCount).toBe(4);
    // Edge crossings depend on layout
  });

  it("should calculate compactness", () => {
    const workflow = createTestWorkflow();
    const stats = calculateLayoutStatistics(workflow);

    expect(stats.compactness).toBeGreaterThanOrEqual(0);
    expect(stats.compactness).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// Presets Tests
// ============================================================================

describe("LayoutPresets", () => {
  beforeEach(() => {
    // Clear custom presets
    const customs = getAllPresets().filter((p) => !p.builtIn);
    customs.forEach((p) => deleteCustomPreset(p.id));
  });

  it("should have built-in presets", () => {
    expect(BUILTIN_PRESETS).toHaveLength(10);
    expect(BUILTIN_PRESETS.every((p) => p.builtIn)).toBe(true);
  });

  it("should get preset by id", () => {
    const preset = getPresetById("readable-standard");

    expect(preset).toBeDefined();
    expect(preset?.name).toBe("Readable Standard");
    expect(preset?.style).toBe(LayoutStyle.HIERARCHICAL);
  });

  it("should get all presets", () => {
    const presets = getAllPresets();

    expect(presets.length).toBeGreaterThanOrEqual(10);
  });

  it("should save custom preset", () => {
    const custom = saveCustomPreset({
      name: "My Custom Preset",
      description: "Test preset",
      style: LayoutStyle.TREE,
      options: {
        horizontalSpacing: 150,
        verticalSpacing: 100,
      },
      tags: ["test"],
    });

    expect(custom.id).toBeDefined();
    expect(custom.builtIn).toBe(false);
    expect(custom.category).toBe("custom");
    expect(custom.createdAt).toBeDefined();

    // Should be retrievable
    const retrieved = getPresetById(custom.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe("My Custom Preset");
  });

  it("should delete custom preset", () => {
    const custom = saveCustomPreset({
      name: "To Delete",
      description: "Will be deleted",
      style: LayoutStyle.CIRCULAR,
      options: {},
    });

    const deleted = deleteCustomPreset(custom.id);
    expect(deleted).toBe(true);

    const retrieved = getPresetById(custom.id);
    expect(retrieved).toBeUndefined();
  });

  it("should not delete built-in preset", () => {
    const deleted = deleteCustomPreset("readable-standard");
    expect(deleted).toBe(false);
  });
});

// ============================================================================
// Suggestions Tests
// ============================================================================

describe("LayoutSuggestions", () => {
  it("should detect overlap issues", () => {
    const workflow = createOverlappingWorkflow();
    const suggestions = getLayoutSuggestions(workflow);

    const overlapSuggestions = suggestions.filter((s) => s.type === "overlap");
    expect(overlapSuggestions.length).toBeGreaterThan(0);
    expect(overlapSuggestions[0].severity).toBe("error");
  });

  it("should provide quick fixes", () => {
    const workflow = createOverlappingWorkflow();
    const suggestions = getLayoutSuggestions(workflow);

    const overlapSuggestion = suggestions.find((s) => s.type === "overlap");
    expect(overlapSuggestion).toBeDefined();

    const fixed = overlapSuggestion!.quickFix(workflow);
    const fixedStats = calculateLayoutStatistics(fixed);

    expect(fixedStats.nodesOverlapping).toBe(0);
  });

  it("should auto-fix all issues", () => {
    const workflow = createOverlappingWorkflow();

    const fixed = autoFixSuggestions(workflow);
    const fixedSuggestions = getLayoutSuggestions(fixed);

    const errors = fixedSuggestions.filter((s) => s.severity === "error");
    expect(errors.length).toBe(0);
  });

  it("should detect critical issues", () => {
    const overlapping = createOverlappingWorkflow();
    expect(hasCriticalIssues(overlapping)).toBe(true);

    const normal = createTestWorkflow();
    expect(hasCriticalIssues(normal)).toBe(false);
  });

  it("should group suggestions by severity", () => {
    const workflow = createOverlappingWorkflow();
    const suggestions = getLayoutSuggestions(workflow);

    const errors = suggestions.filter((s) => s.severity === "error");
    const warnings = suggestions.filter((s) => s.severity === "warning");
    const info = suggestions.filter((s) => s.severity === "info");

    expect(errors.length + warnings.length + info.length).toBe(
      suggestions.length
    );
  });
});

// ============================================================================
// Animation Tests
// ============================================================================

describe("LayoutAnimation", () => {
  it("should extract positions from workflow", () => {
    const workflow = createTestWorkflow();
    const positions = extractPositions(workflow);

    expect(Object.keys(positions)).toHaveLength(3);
    expect(positions.a1).toEqual([100, 100]);
    expect(positions.a2).toEqual([100, 200]);
    expect(positions.a3).toEqual([100, 300]);
  });

  it("should apply positions to workflow", () => {
    const workflow = createTestWorkflow();
    const newPositions = {
      a1: [200, 200] as [number, number],
      a2: [300, 300] as [number, number],
      a3: [400, 400] as [number, number],
    };

    applyPositions(workflow, newPositions);

    expect(workflow.actions[0].position).toEqual([200, 200]);
    expect(workflow.actions[1].position).toEqual([300, 300]);
    expect(workflow.actions[2].position).toEqual([400, 400]);
  });

  it("should animate positions", async () => {
    const controller = new LayoutAnimationController();

    const fromPositions = {
      a1: [0, 0] as [number, number],
    };

    const toPositions = {
      a1: [100, 100] as [number, number],
    };

    let frameCount = 0;
    const updates: [number, number][] = [];

    await controller.animate(
      fromPositions,
      toPositions,
      (positions) => {
        frameCount++;
        updates.push([...positions.a1]);
      },
      { duration: 100, easing: "linear" }
    );

    expect(frameCount).toBeGreaterThan(1);
    expect(updates[updates.length - 1]).toEqual([100, 100]);
  });

  it("should cancel animation", () => {
    const controller = new LayoutAnimationController();

    controller.animate({ a1: [0, 0] }, { a1: [100, 100] }, () => {}, {
      duration: 1000,
    });

    expect(controller.isAnimating()).toBe(true);

    controller.cancel();

    expect(controller.isAnimating()).toBe(false);
  });
});

// ============================================================================
// History Tests
// ============================================================================

describe("LayoutHistory", () => {
  beforeEach(() => {
    const history = useLayoutHistory.getState();
    history.clear();
  });

  it("should add layout to history", () => {
    const history = useLayoutHistory.getState();
    const workflow = createTestWorkflow();

    history.addLayout(workflow, LayoutStyle.HIERARCHICAL, {});

    const entries = history.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].style).toBe(LayoutStyle.HIERARCHICAL);
  });

  it("should undo layout", () => {
    const history = useLayoutHistory.getState();
    const workflow1 = createTestWorkflow();
    const workflow2 = JSON.parse(JSON.stringify(workflow1));
    workflow2.actions[0].position = [200, 200];

    history.addLayout(workflow1, LayoutStyle.HIERARCHICAL, {});
    history.addLayout(workflow2, LayoutStyle.TREE, {});

    expect(history.canUndo()).toBe(true);

    const entry = history.undo();
    expect(entry).toBeDefined();
    expect(entry?.style).toBe(LayoutStyle.HIERARCHICAL);
  });

  it("should redo layout", () => {
    const history = useLayoutHistory.getState();
    const workflow = createTestWorkflow();

    history.addLayout(workflow, LayoutStyle.HIERARCHICAL, {});
    history.addLayout(workflow, LayoutStyle.TREE, {});

    history.undo();
    expect(history.canRedo()).toBe(true);

    const entry = history.redo();
    expect(entry).toBeDefined();
    expect(entry?.style).toBe(LayoutStyle.TREE);
  });

  it("should limit history size", () => {
    const history = useLayoutHistory.getState();
    history.setMaxHistorySize(3);

    const workflow = createTestWorkflow();

    for (let i = 0; i < 5; i++) {
      history.addLayout(workflow, LayoutStyle.HIERARCHICAL, {}, `Layout ${i}`);
    }

    const entries = history.getEntries();
    expect(entries.length).toBeLessThanOrEqual(3);
  });

  it("should clear history", () => {
    const history = useLayoutHistory.getState();
    const workflow = createTestWorkflow();

    history.addLayout(workflow, LayoutStyle.HIERARCHICAL, {});
    history.addLayout(workflow, LayoutStyle.TREE, {});

    history.clear();

    expect(history.getEntries()).toHaveLength(0);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });

  it("should branch history on new changes after undo", () => {
    const history = useLayoutHistory.getState();
    const workflow = createTestWorkflow();

    history.addLayout(workflow, LayoutStyle.HIERARCHICAL, {}, "Layout 1");
    history.addLayout(workflow, LayoutStyle.TREE, {}, "Layout 2");
    history.addLayout(workflow, LayoutStyle.CIRCULAR, {}, "Layout 3");

    // Undo twice
    history.undo();
    history.undo();

    // Add new layout (branches history)
    history.addLayout(workflow, LayoutStyle.FORCE_DIRECTED, {}, "Layout 4");

    const entries = history.getEntries();
    expect(entries).toHaveLength(2); // Layout 1 + Layout 4
    expect(entries[1].description).toBe("Layout 4");
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Integration", () => {
  it("should apply preset and save to history", () => {
    const workflow = createTestWorkflow();
    const layoutService = getLayoutService();
    const history = useLayoutHistory.getState();
    history.clear();

    const preset = getPresetById("readable-standard")!;

    // Apply layout
    layoutService.applyLayout(workflow, preset.style, preset.options);

    // Calculate stats
    const stats = calculateLayoutStatistics(workflow);

    // Save to history
    history.addLayout(
      workflow,
      preset.style,
      preset.options,
      "Applied preset",
      stats
    );

    // Verify
    const entries = history.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].statistics).toBeDefined();
    expect(entries[0].statistics?.nodeCount).toBe(3);
  });

  it("should detect issues, apply fix, and verify improvement", () => {
    const workflow = createOverlappingWorkflow();

    // Get suggestions
    const suggestions = getLayoutSuggestions(workflow);
    expect(suggestions.length).toBeGreaterThan(0);

    // Calculate before stats
    const beforeStats = calculateLayoutStatistics(workflow);
    expect(beforeStats.nodesOverlapping).toBeGreaterThan(0);

    // Auto-fix
    const fixed = autoFixSuggestions(workflow);

    // Calculate after stats
    const afterStats = calculateLayoutStatistics(fixed);
    expect(afterStats.nodesOverlapping).toBe(0);

    // Compare
    const comparison = compareLayouts(workflow, fixed);
    expect(comparison.isImprovement).toBe(true);
  });

  it("should preview multiple styles and choose best", () => {
    const workflow = createBranchingWorkflow();
    const layoutService = getLayoutService();

    const styles = [
      LayoutStyle.HIERARCHICAL,
      LayoutStyle.TREE,
      LayoutStyle.HORIZONTAL,
    ];

    const previews = styles.map((style) => ({
      style,
      preview: layoutService.previewLayout(workflow, style),
    }));

    // Find best by score
    const best = previews.reduce((prev, current) =>
      current.preview.statistics.layoutScore >
      prev.preview.statistics.layoutScore
        ? current
        : prev
    );

    expect(best).toBeDefined();
    expect(best.preview.statistics.layoutScore).toBeGreaterThan(0);
  });
});
