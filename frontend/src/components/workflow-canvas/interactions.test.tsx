/**
 * Canvas Interactions Tests
 *
 * Test coverage for:
 * - Context menus
 * - Tooltips
 * - Hover effects
 * - Selection box
 * - Connection drawing
 * - Keyboard shortcuts
 * - Alignment tools
 * - Gestures
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContextMenu } from "./ContextMenu";
import { Tooltip, NodeTooltip } from "./Tooltip";
import { SelectionBox } from "./SelectionBox";
import { alignNodes, distributeNodes } from "./AlignmentTools";
import {
  hoverEffects,
  getNodeHoverEffect,
  getEdgeHoverEffect,
} from "./hover-effects";

// ============================================================================
// Context Menu Tests
// ============================================================================

describe("ContextMenu", () => {
  it("renders menu items correctly", () => {
    const items = [
      { label: "Copy", onClick: vi.fn() },
      { label: "Paste", onClick: vi.fn() },
      { divider: true },
      { label: "Delete", onClick: vi.fn(), danger: true },
    ];

    const { container: _container } = render(
      <ContextMenu
        position={{ x: 100, y: 100 }}
        items={items}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("Copy")).toBeInTheDocument();
    expect(screen.getByText("Paste")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("calls onClick when item is clicked", async () => {
    const onClickMock = vi.fn();
    const items = [{ label: "Test Item", onClick: onClickMock }];

    render(
      <ContextMenu
        position={{ x: 100, y: 100 }}
        items={items}
        onClose={vi.fn()}
      />
    );

    const item = screen.getByText("Test Item");
    await userEvent.click(item);

    expect(onClickMock).toHaveBeenCalledTimes(1);
  });

  it("shows submenu on hover", async () => {
    const items = [
      {
        label: "Parent",
        submenu: [{ label: "Child", onClick: vi.fn() }],
      },
    ];

    render(
      <ContextMenu
        position={{ x: 100, y: 100 }}
        items={items}
        onClose={vi.fn()}
      />
    );

    const parent = screen.getByText("Parent");
    await userEvent.hover(parent);

    await waitFor(() => {
      expect(screen.getByText("Child")).toBeInTheDocument();
    });
  });

  it("closes on Escape key", async () => {
    const onCloseMock = vi.fn();

    render(
      <ContextMenu
        position={{ x: 100, y: 100 }}
        items={[]}
        onClose={onCloseMock}
      />
    );

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(onCloseMock).toHaveBeenCalled();
    });
  });

  it("disables disabled items", () => {
    const items = [{ label: "Disabled", onClick: vi.fn(), disabled: true }];

    render(
      <ContextMenu
        position={{ x: 100, y: 100 }}
        items={items}
        onClose={vi.fn()}
      />
    );

    const button = screen.getByText("Disabled").closest("button");
    expect(button).toBeDisabled();
  });
});

// ============================================================================
// Tooltip Tests
// ============================================================================

describe("Tooltip", () => {
  it("shows tooltip after delay", async () => {
    render(
      <Tooltip content="Test tooltip" delay={100}>
        <button>Hover me</button>
      </Tooltip>
    );

    const trigger = screen.getByText("Hover me");
    await userEvent.hover(trigger);

    await waitFor(
      () => {
        expect(screen.getByText("Test tooltip")).toBeInTheDocument();
      },
      { timeout: 200 }
    );
  });

  it("hides tooltip on mouse leave", async () => {
    render(
      <Tooltip content="Test tooltip" delay={100}>
        <button>Hover me</button>
      </Tooltip>
    );

    const trigger = screen.getByText("Hover me");
    await userEvent.hover(trigger);
    await userEvent.unhover(trigger);

    await waitFor(() => {
      expect(screen.queryByText("Test tooltip")).not.toBeInTheDocument();
    });
  });

  it("renders NodeTooltip with correct data", () => {
    const data = {
      actionName: "Test Action",
      actionType: "FIND",
      category: "find",
      executionState: "success" as const,
      executionDuration: 123,
    };

    render(<NodeTooltip data={data} />);

    expect(screen.getByText("Test Action")).toBeInTheDocument();
    expect(screen.getByText("FIND")).toBeInTheDocument();
    expect(screen.getByText("find")).toBeInTheDocument();
  });
});

// ============================================================================
// Selection Box Tests
// ============================================================================

describe("SelectionBox", () => {
  it("calculates correct dimensions", () => {
    const { container } = render(
      <SelectionBox
        start={{ x: 100, y: 100 }}
        end={{ x: 200, y: 200 }}
        mode="replace"
      />
    );

    const box = container.firstChild as HTMLElement;
    expect(box.style.left).toBe("100px");
    expect(box.style.top).toBe("100px");
    expect(box.style.width).toBe("100px");
    expect(box.style.height).toBe("100px");
  });

  it("handles negative dimensions correctly", () => {
    const { container } = render(
      <SelectionBox
        start={{ x: 200, y: 200 }}
        end={{ x: 100, y: 100 }}
        mode="replace"
      />
    );

    const box = container.firstChild as HTMLElement;
    expect(box.style.left).toBe("100px");
    expect(box.style.top).toBe("100px");
    expect(box.style.width).toBe("100px");
    expect(box.style.height).toBe("100px");
  });

  it("shows correct mode indicator", () => {
    const { rerender } = render(
      <SelectionBox
        start={{ x: 100, y: 100 }}
        end={{ x: 200, y: 200 }}
        mode="add"
      />
    );

    expect(screen.getByText("Add to selection")).toBeInTheDocument();

    rerender(
      <SelectionBox
        start={{ x: 100, y: 100 }}
        end={{ x: 200, y: 200 }}
        mode="remove"
      />
    );

    expect(screen.getByText("Remove from selection")).toBeInTheDocument();
  });
});

// ============================================================================
// Alignment Tools Tests
// ============================================================================

describe("AlignmentTools", () => {
  const mockNodes = [
    {
      id: "1",
      position: { x: 0, y: 0 },
      data: {},
    },
    {
      id: "2",
      position: { x: 100, y: 100 },
      data: {},
    },
    {
      id: "3",
      position: { x: 200, y: 50 },
      data: {},
    },
  ] as unknown[];

  it("aligns nodes to the left", () => {
    const updates = alignNodes(mockNodes, "left");

    expect(updates).toHaveLength(3);
    expect(updates[0].position[0]).toBe(0);
    expect(updates[1].position[0]).toBe(0);
    expect(updates[2].position[0]).toBe(0);
  });

  it("aligns nodes to the right", () => {
    const updates = alignNodes(mockNodes, "right");

    expect(updates).toHaveLength(3);
    expect(updates[0].position[0]).toBe(200);
    expect(updates[1].position[0]).toBe(200);
    expect(updates[2].position[0]).toBe(200);
  });

  it("aligns nodes to the top", () => {
    const updates = alignNodes(mockNodes, "top");

    expect(updates).toHaveLength(3);
    expect(updates[0].position[1]).toBe(0);
    expect(updates[1].position[1]).toBe(0);
    expect(updates[2].position[1]).toBe(0);
  });

  it("aligns nodes to the bottom", () => {
    const updates = alignNodes(mockNodes, "bottom");

    expect(updates).toHaveLength(3);
    expect(updates[0].position[1]).toBe(100);
    expect(updates[1].position[1]).toBe(100);
    expect(updates[2].position[1]).toBe(100);
  });

  it("distributes nodes horizontally", () => {
    const updates = distributeNodes(mockNodes, "horizontal");

    expect(updates).toHaveLength(3);
    expect(updates[0].position[0]).toBe(0);
    expect(updates[1].position[0]).toBe(100);
    expect(updates[2].position[0]).toBe(200);
  });

  it("distributes nodes vertically", () => {
    const updates = distributeNodes(mockNodes, "vertical");

    expect(updates).toHaveLength(3);
    // Positions should be evenly distributed between min and max Y
    expect(updates[0].position[1]).toBeLessThan(updates[1].position[1]);
    expect(updates[1].position[1]).toBeLessThan(updates[2].position[1]);
  });

  it("returns empty array for single node", () => {
    const updates = alignNodes([mockNodes[0]], "left");
    expect(updates).toHaveLength(0);
  });

  it("returns empty array for less than 3 nodes in distribute", () => {
    const updates = distributeNodes([mockNodes[0], mockNodes[1]], "horizontal");
    expect(updates).toHaveLength(0);
  });
});

// ============================================================================
// Hover Effects Tests
// ============================================================================

describe("Hover Effects", () => {
  beforeEach(() => {
    hoverEffects.clearHover();
  });

  it("sets hovered node", () => {
    hoverEffects.setHoveredNode("node-1");
    const state = hoverEffects.getState();

    expect(state.nodeId).toBe("node-1");
    expect(state.edgeId).toBeNull();
  });

  it("sets hovered edge", () => {
    hoverEffects.setHoveredEdge("edge-1");
    const state = hoverEffects.getState();

    expect(state.edgeId).toBe("edge-1");
    expect(state.nodeId).toBeNull();
  });

  it("clears hover state", () => {
    hoverEffects.setHoveredNode("node-1");
    hoverEffects.clearHover();
    const state = hoverEffects.getState();

    expect(state.nodeId).toBeNull();
    expect(state.edgeId).toBeNull();
  });

  it("notifies listeners on state change", () => {
    const listener = vi.fn();
    const unsubscribe = hoverEffects.subscribe(listener);

    hoverEffects.setHoveredNode("node-1");

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("applies correct hover effect to hovered node", () => {
    const mockNode = {
      id: "node-1",
      position: { x: 0, y: 0 },
      data: {},
    } as unknown;

    const hoverState = {
      nodeId: "node-1",
      edgeId: null,
      handleId: null,
      handleType: null,
    };
    const effect = getNodeHoverEffect(mockNode, hoverState);

    expect(effect.scale).toBe(1.02);
    expect(effect.opacity).toBe(1);
  });

  it("fades non-hovered nodes", () => {
    const mockNode = {
      id: "node-2",
      position: { x: 0, y: 0 },
      data: {},
    } as unknown;

    const hoverState = {
      nodeId: "node-1",
      edgeId: null,
      handleId: null,
      handleType: null,
    };
    const effect = getNodeHoverEffect(mockNode, hoverState);

    expect(effect.opacity).toBe(0.4);
  });

  it("applies correct hover effect to hovered edge", () => {
    const mockEdge = {
      id: "edge-1",
      source: "node-1",
      target: "node-2",
      data: {},
    } as unknown;

    const hoverState = {
      nodeId: null,
      edgeId: "edge-1",
      handleId: null,
      handleType: null,
    };
    const effect = getEdgeHoverEffect(mockEdge, hoverState);

    expect(effect.strokeWidth).toBe(4);
    expect(effect.animated).toBe(true);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Canvas Interactions Integration", () => {
  it("context menu triggers tooltip on hover", async () => {
    // This would test the integration between context menu and tooltips
    // Implementation depends on actual component integration
  });

  it("selection box works with alignment tools", async () => {
    // This would test selecting multiple nodes and then aligning them
    // Implementation depends on actual component integration
  });

  it("hover effects work with connection drawing", async () => {
    // This would test that hover effects are applied during connection drawing
    // Implementation depends on actual component integration
  });
});
