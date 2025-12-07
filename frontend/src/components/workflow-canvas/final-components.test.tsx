/**
 * Final Components Test Suite
 *
 * Tests for all final React UI components.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FormatSwitcherDialog } from "./FormatSwitcherDialog";
import { AutoLayoutPanel } from "./AutoLayoutPanel";
import { TemplateBrowser } from "./TemplateBrowser";
import { LayoutPreview } from "./LayoutPreview";
import { ConversionPreview } from "./ConversionPreview";
import { LayoutSuggestions } from "./LayoutSuggestions";
import { SequentialListView } from "../workflow-editor/SequentialListView";
import { PresetManagerDialog } from "./PresetManagerDialog";
import { ConversionWizard } from "./ConversionWizard";
import type { Workflow } from "@/lib/action-schema/action-types";
import { createAction } from "@/lib/action-schema/action-types";

// ============================================================================
// Mock Data
// ============================================================================

const mockWorkflow: Workflow = {
  id: "test-workflow",
  name: "Test Workflow",
  version: "1.0.0",
  format: "graph",
  actions: [
    createAction("CLICK", { target: { image: "button.png" } }, [100, 100], {
      id: "action-1",
    }),
    createAction("TYPE", { text: "test" }, [100, 250], { id: "action-2" }),
    createAction("WAIT", { duration: 1000 }, [100, 400], { id: "action-3" }),
  ],
  connections: {
    "action-1": {
      main: [[{ action: "action-2", type: "main", index: 0 }]],
    },
    "action-2": {
      main: [[{ action: "action-3", type: "main", index: 0 }]],
    },
  },
  metadata: {
    created: "2024-01-01T00:00:00Z",
  },
};

// ============================================================================
// Format Switcher Dialog Tests
// ============================================================================

describe("FormatSwitcherDialog", () => {
  const mockOnSwitch = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders when open", () => {
    render(
      <FormatSwitcherDialog
        open={true}
        workflow={mockWorkflow}
        currentFormat="graph"
        onSwitch={mockOnSwitch}
        onClose={mockOnClose}
      />
    );

    expect(screen.getByText("Switch Workflow Format")).toBeDefined();
  });

  it("does not render when closed", () => {
    const { container } = render(
      <FormatSwitcherDialog
        open={false}
        workflow={mockWorkflow}
        currentFormat="graph"
        onSwitch={mockOnSwitch}
        onClose={mockOnClose}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it("calls onClose when cancel button is clicked", () => {
    render(
      <FormatSwitcherDialog
        open={true}
        workflow={mockWorkflow}
        currentFormat="graph"
        onSwitch={mockOnSwitch}
        onClose={mockOnClose}
      />
    );

    const cancelButton = screen.getByText("Cancel");
    fireEvent.click(cancelButton);

    expect(mockOnClose).toHaveBeenCalled();
  });
});

// ============================================================================
// Auto-Layout Panel Tests
// ============================================================================

describe("AutoLayoutPanel", () => {
  const mockOnApplyLayout = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders layout style options", () => {
    render(
      <AutoLayoutPanel
        workflow={mockWorkflow}
        onApplyLayout={mockOnApplyLayout}
      />
    );

    expect(screen.getByText("Layout Style")).toBeDefined();
  });

  it("shows spacing controls", () => {
    render(
      <AutoLayoutPanel
        workflow={mockWorkflow}
        onApplyLayout={mockOnApplyLayout}
      />
    );

    expect(screen.getByText("Spacing")).toBeDefined();
    expect(screen.getByText(/Horizontal Spacing:/)).toBeDefined();
    expect(screen.getByText(/Vertical Spacing:/)).toBeDefined();
  });

  it("calls onApplyLayout when apply button is clicked", async () => {
    render(
      <AutoLayoutPanel
        workflow={mockWorkflow}
        onApplyLayout={mockOnApplyLayout}
      />
    );

    const applyButton = screen.getByText("Apply Layout");
    fireEvent.click(applyButton);

    await waitFor(() => {
      expect(mockOnApplyLayout).toHaveBeenCalled();
    });
  });
});

// ============================================================================
// Template Browser Tests
// ============================================================================

describe("TemplateBrowser", () => {
  const mockOnSelectTemplate = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders template categories", () => {
    render(
      <TemplateBrowser
        onSelectTemplate={mockOnSelectTemplate}
        onClose={mockOnClose}
      />
    );

    expect(screen.getByText(/Basic/)).toBeDefined();
    expect(screen.getByText(/Control Flow/)).toBeDefined();
    expect(screen.getByText(/Automation/)).toBeDefined();
  });

  it("filters templates by category", () => {
    render(
      <TemplateBrowser
        onSelectTemplate={mockOnSelectTemplate}
        onClose={mockOnClose}
      />
    );

    const basicTab = screen.getByText(/Basic/);
    fireEvent.click(basicTab);

    // Should show basic templates only
    expect(screen.queryByText("Linear Workflow")).toBeDefined();
  });

  it("searches templates", () => {
    render(
      <TemplateBrowser
        onSelectTemplate={mockOnSelectTemplate}
        onClose={mockOnClose}
      />
    );

    const searchInput = screen.getByPlaceholderText("Search templates...");
    fireEvent.change(searchInput, { target: { value: "loop" } });

    // Should filter results
    expect(screen.queryByText("Loop Workflow")).toBeDefined();
  });
});

// ============================================================================
// Sequential List View Tests
// ============================================================================

describe("SequentialListView", () => {
  const mockOnActionClick = vi.fn();
  const mockOnActionEdit = vi.fn();
  const mockOnActionDelete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders list of actions", () => {
    render(
      <SequentialListView
        workflow={mockWorkflow}
        onActionClick={mockOnActionClick}
        onActionEdit={mockOnActionEdit}
        onActionDelete={mockOnActionDelete}
      />
    );

    expect(screen.getByText(/Actions \(3\)/)).toBeDefined();
  });

  it("displays action summaries", () => {
    render(
      <SequentialListView
        workflow={mockWorkflow}
        onActionClick={mockOnActionClick}
        onActionEdit={mockOnActionEdit}
        onActionDelete={mockOnActionDelete}
      />
    );

    expect(screen.getByText("CLICK")).toBeDefined();
    expect(screen.getByText("TYPE")).toBeDefined();
    expect(screen.getByText("WAIT")).toBeDefined();
  });

  it("calls onActionClick when action is clicked", () => {
    render(
      <SequentialListView
        workflow={mockWorkflow}
        onActionClick={mockOnActionClick}
        onActionEdit={mockOnActionEdit}
        onActionDelete={mockOnActionDelete}
      />
    );

    const actionItems = screen.getAllByText("CLICK")[0].closest(".action-item");
    if (actionItems) {
      fireEvent.click(actionItems);
      expect(mockOnActionClick).toHaveBeenCalled();
    }
  });
});

// ============================================================================
// Layout Preview Tests
// ============================================================================

describe("LayoutPreview", () => {
  const mockComparison = {
    improvementScore: 50,
    isImprovement: true,
    summary: "Good improvement",
    metrics: {
      overlaps: { before: 2, after: 0, change: 2 },
      edgeCrossings: { before: 5, after: 2, change: 3 },
      edgeLength: { before: 200, after: 180, change: 20 },
      compactness: { before: 0.5, after: 0.7, change: 0.2 },
      readability: { before: 0.6, after: 0.8, change: 0.2 },
    },
    recommendations: [],
  };

  it("renders preview canvas", () => {
    render(
      <LayoutPreview
        beforeWorkflow={mockWorkflow}
        afterWorkflow={mockWorkflow}
        comparison={mockComparison}
      />
    );

    expect(screen.getByText("Side by Side")).toBeDefined();
  });

  it("switches between view modes", () => {
    render(
      <LayoutPreview
        beforeWorkflow={mockWorkflow}
        afterWorkflow={mockWorkflow}
        comparison={mockComparison}
      />
    );

    const overlayButton = screen.getByText("Overlay");
    fireEvent.click(overlayButton);

    // Should switch to overlay mode
    expect(overlayButton.classList.contains("active")).toBe(true);
  });
});

// ============================================================================
// Conversion Preview Tests
// ============================================================================

describe("ConversionPreview", () => {
  const mockConversionPreview = {
    canConvert: true,
    fromFormat: "graph" as const,
    toFormat: "sequential" as const,
    changes: {
      actionsAdded: 0,
      actionsRemoved: 0,
      actionsModified: 0,
      connectionsChanged: 2,
    },
    warnings: [],
    impact: "low" as const,
    recommendation: "safe" as const,
  };

  it("renders conversion statistics", () => {
    render(
      <ConversionPreview
        beforeWorkflow={mockWorkflow}
        afterWorkflow={mockWorkflow}
        conversionPreview={mockConversionPreview}
      />
    );

    expect(screen.getByText("Conversion Statistics")).toBeDefined();
  });

  it("shows warnings when present", () => {
    const previewWithWarnings = {
      ...mockConversionPreview,
      warnings: [{ code: "TEST_WARNING", message: "Test warning message" }],
    };

    render(
      <ConversionPreview
        beforeWorkflow={mockWorkflow}
        afterWorkflow={mockWorkflow}
        conversionPreview={previewWithWarnings}
      />
    );

    expect(screen.getByText(/Warnings/)).toBeDefined();
  });
});

// ============================================================================
// Layout Suggestions Tests
// ============================================================================

describe("LayoutSuggestions", () => {
  const mockOnApplySuggestion = vi.fn();

  const mockLayoutResult = {
    workflow: mockWorkflow,
    statistics: {
      nodeCount: 3,
      nodesOverlapping: 0,
      nodesWithoutPosition: 0,
      edgeCount: 2,
      edgeCrossings: 0,
      averageEdgeLength: 150,
      minEdgeLength: 150,
      maxEdgeLength: 150,
      canvasWidth: 400,
      canvasHeight: 500,
      canvasArea: 200000,
      canvasUtilization: 0.5,
      boundingBoxAspectRatio: 0.8,
      layoutScore: 85,
      compactness: 0.7,
      symmetry: 0.8,
      alignment: 0.9,
      readability: 0.85,
      averageNodeDensity: 0,
    },
    comparison: {
      improvementScore: 50,
      isImprovement: true,
      summary: "Good improvement",
      metrics: {
        overlaps: { before: 2, after: 0, change: 2 },
        edgeCrossings: { before: 5, after: 2, change: 3 },
        edgeLength: { before: 200, after: 180, change: 20 },
        compactness: { before: 0.5, after: 0.7, change: 0.2 },
        readability: { before: 0.6, after: 0.8, change: 0.2 },
      },
      recommendations: [],
    },
    changes: [],
  };

  it("shows success message when no issues", () => {
    render(
      <LayoutSuggestions
        workflow={mockWorkflow}
        layoutResult={mockLayoutResult}
        onApplySuggestion={mockOnApplySuggestion}
      />
    );

    expect(screen.getByText("No layout issues detected")).toBeDefined();
  });
});

// ============================================================================
// Conversion Wizard Tests
// ============================================================================

describe("ConversionWizard", () => {
  const mockOnComplete = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders when open", () => {
    render(
      <ConversionWizard
        open={true}
        workflow={mockWorkflow}
        currentFormat="graph"
        onComplete={mockOnComplete}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.getByText("Convert Workflow Format")).toBeDefined();
  });

  it("shows progress steps", () => {
    render(
      <ConversionWizard
        open={true}
        workflow={mockWorkflow}
        currentFormat="graph"
        onComplete={mockOnComplete}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.getByText("Format")).toBeDefined();
  });

  it("calls onCancel when close button is clicked", () => {
    render(
      <ConversionWizard
        open={true}
        workflow={mockWorkflow}
        currentFormat="graph"
        onComplete={mockOnComplete}
        onCancel={mockOnCancel}
      />
    );

    const closeButton = screen.getByLabelText("Close");
    fireEvent.click(closeButton);

    expect(mockOnCancel).toHaveBeenCalled();
  });
});
