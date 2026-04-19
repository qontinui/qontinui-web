/**
 * Node Palette Test Suite
 *
 * Comprehensive tests for the node palette system including:
 * - Palette rendering and interaction
 * - Search functionality
 * - Category expand/collapse
 * - Drag-and-drop
 * - Favorites and recent nodes
 * - Keyboard navigation
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NodePalette } from "./NodePalette";
import { NodeSearch } from "./NodeSearch";
import { PaletteItem } from "./PaletteItem";
import { QuickAddMenu } from "./QuickAddMenu";
import { NODE_METADATA } from "./palette-config";
import {
  useFavoriteNodes,
  useFavoriteNodeTypes,
  useIsFavoriteNode,
  useToggleFavorite,
} from "@/stores/favorite-nodes";
import {
  useRecentNodes,
  useRecentNodeTypes,
  useIsRecentNode,
} from "@/stores/recent-nodes";

// Mock stores. The components under test import the derived hooks
// (useFavoriteNodeTypes, useIsFavoriteNode, useToggleFavorite,
// useRecentNodeTypes, useIsRecentNode) in addition to the main store hook,
// so we mock the whole module and provide each export.
vi.mock("@/stores/favorite-nodes", () => ({
  useFavoriteNodes: vi.fn(),
  useFavoriteNodeTypes: vi.fn(),
  useIsFavoriteNode: vi.fn(),
  useToggleFavorite: vi.fn(),
}));
vi.mock("@/stores/recent-nodes", () => ({
  useRecentNodes: vi.fn(),
  useRecentNodeTypes: vi.fn(),
  useIsRecentNode: vi.fn(),
  useFrequentNodeTypes: vi.fn(() => []),
}));
vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  }),
}));

// Shared test helpers: installs defaults on the derived hooks so
// individual tests only need to override what they specifically care about.
function installDefaultFavoriteMocks(overrides?: {
  favoriteTypes?: string[];
  isFavorite?: (type: string) => boolean;
  toggleFavorite?: (type: string) => void;
}) {
  (useFavoriteNodes as ReturnType<typeof vi.fn>).mockReturnValue({
    favorites: [],
    isFavorite: overrides?.isFavorite ?? (() => false),
    toggleFavorite: overrides?.toggleFavorite ?? vi.fn(),
    getFavorites: () => [],
  });
  (useFavoriteNodeTypes as ReturnType<typeof vi.fn>).mockReturnValue(
    overrides?.favoriteTypes ?? []
  );
  (useIsFavoriteNode as ReturnType<typeof vi.fn>).mockImplementation(
    (type: string) =>
      overrides?.isFavorite
        ? overrides.isFavorite(type)
        : (overrides?.favoriteTypes ?? []).includes(type)
  );
  (useToggleFavorite as ReturnType<typeof vi.fn>).mockReturnValue(
    overrides?.toggleFavorite ?? vi.fn()
  );
}

function installDefaultRecentMocks(overrides?: {
  recentTypes?: string[];
  isRecent?: (type: string) => boolean;
}) {
  (useRecentNodes as ReturnType<typeof vi.fn>).mockReturnValue({
    recentNodes: [],
    addRecentNode: vi.fn(),
    getRecentNodes: () => [],
    isRecent: overrides?.isRecent ?? (() => false),
  });
  (useRecentNodeTypes as ReturnType<typeof vi.fn>).mockReturnValue(
    overrides?.recentTypes ?? []
  );
  (useIsRecentNode as ReturnType<typeof vi.fn>).mockImplementation(
    (type: string) =>
      overrides?.isRecent
        ? overrides.isRecent(type)
        : (overrides?.recentTypes ?? []).includes(type)
  );
}

describe("NodePalette", () => {
  const mockOnNodeAdd = vi.fn();
  const mockCanvasRef = { current: document.createElement("div") };

  beforeEach(() => {
    vi.clearAllMocks();
    installDefaultFavoriteMocks();
    installDefaultRecentMocks();
  });

  describe("Rendering", () => {
    it("renders the palette with all categories", () => {
      render(
        <NodePalette onNodeAdd={mockOnNodeAdd} canvasRef={mockCanvasRef} />
      );

      expect(screen.getByText("Nodes")).toBeInTheDocument();
      // Category titles appear alongside palette items of the same name, so
      // assert against the category title class rather than the bare label.
      const categoryTitles = document.querySelectorAll(
        ".node-palette__category-title"
      );
      const categoryLabels = Array.from(categoryTitles).map(
        (n) => n.textContent
      );
      expect(categoryLabels).toContain("Find");
      expect(categoryLabels).toContain("Mouse");
      expect(categoryLabels).toContain("Keyboard");
      expect(categoryLabels).toContain("Control Flow");
      expect(categoryLabels).toContain("Data");
      expect(categoryLabels).toContain("State");
    });

    it("renders in collapsed state when defaultCollapsed is true", () => {
      render(
        <NodePalette
          onNodeAdd={mockOnNodeAdd}
          canvasRef={mockCanvasRef}
          defaultCollapsed={true}
        />
      );

      expect(screen.queryByText("Nodes")).not.toBeInTheDocument();
      expect(screen.getByTitle("Expand palette")).toBeInTheDocument();
    });

    it("shows search panel when search button is clicked", async () => {
      render(
        <NodePalette onNodeAdd={mockOnNodeAdd} canvasRef={mockCanvasRef} />
      );

      const searchButton = screen.getByTitle(/search nodes/i);
      fireEvent.click(searchButton);

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
      });
    });
  });

  describe("Categories", () => {
    it("expands and collapses categories", async () => {
      render(
        <NodePalette onNodeAdd={mockOnNodeAdd} canvasRef={mockCanvasRef} />
      );

      // "Find" text appears both as a category title and as the FIND palette
      // item label; target the category header by its title-class descendant.
      const findTitle = Array.from(
        document.querySelectorAll(".node-palette__category-title")
      ).find((n) => n.textContent === "Find") as HTMLElement;
      const findCategory = findTitle.closest("button");
      expect(findCategory).toBeInTheDocument();

      // Should be expanded by default — the FIND node's description is
      // visible only when its category is expanded.
      expect(
        screen.getByText(/Find element on screen using image matching/i)
      ).toBeInTheDocument();

      // Collapse
      fireEvent.click(findCategory!);
      await waitFor(() => {
        expect(
          screen.queryByText(/Find element on screen using image matching/i)
        ).not.toBeInTheDocument();
      });

      // Expand again
      fireEvent.click(findCategory!);
      await waitFor(() => {
        expect(
          screen.getByText(/Find element on screen using image matching/i)
        ).toBeInTheDocument();
      });
    });

    it("expands all categories when Expand All is clicked", async () => {
      render(
        <NodePalette onNodeAdd={mockOnNodeAdd} canvasRef={mockCanvasRef} />
      );

      const expandAllButton = screen.getByText("Expand All");
      fireEvent.click(expandAllButton);

      await waitFor(() => {
        // Match current palette-config descriptions for CLICK and TYPE.
        expect(screen.getByText(/Click on element/i)).toBeInTheDocument();
        expect(screen.getByText(/Type text into/i)).toBeInTheDocument();
      });
    });

    it("collapses all categories when Collapse All is clicked", async () => {
      render(
        <NodePalette onNodeAdd={mockOnNodeAdd} canvasRef={mockCanvasRef} />
      );

      const collapseAllButton = screen.getByText("Collapse All");
      fireEvent.click(collapseAllButton);

      await waitFor(() => {
        expect(screen.queryByText(/Click on element/i)).not.toBeInTheDocument();
      });
    });
  });

  describe("Node Addition", () => {
    it("calls onNodeAdd when a node item is clicked", () => {
      render(
        <NodePalette onNodeAdd={mockOnNodeAdd} canvasRef={mockCanvasRef} />
      );

      // Target the FIND palette item by its data-node-type attribute so we
      // don't collide with the "Find" category-title button.
      const findNode = document.querySelector(
        '.palette-item[data-node-type="FIND"]'
      );
      expect(findNode).toBeInTheDocument();

      fireEvent.click(findNode!);

      expect(mockOnNodeAdd).toHaveBeenCalledWith("FIND");
    });
  });

  describe("Favorites", () => {
    it("shows favorites section when favorites exist", () => {
      installDefaultFavoriteMocks({ favoriteTypes: ["CLICK"] });

      render(
        <NodePalette onNodeAdd={mockOnNodeAdd} canvasRef={mockCanvasRef} />
      );

      expect(screen.getByText("Favorites")).toBeInTheDocument();
    });

    it("hides favorites section when no favorites", () => {
      render(
        <NodePalette onNodeAdd={mockOnNodeAdd} canvasRef={mockCanvasRef} />
      );

      expect(screen.queryByText("Favorites")).not.toBeInTheDocument();
    });
  });

  describe("Recent Nodes", () => {
    it("shows recent section when recent nodes exist", () => {
      installDefaultRecentMocks({
        recentTypes: ["FIND"],
        isRecent: (type: string) => type === "FIND",
      });

      render(
        <NodePalette onNodeAdd={mockOnNodeAdd} canvasRef={mockCanvasRef} />
      );

      // Both the section title and the per-item "Recent" badge share the
      // "Recent" label; target the section title specifically by its class.
      const sectionTitles = Array.from(
        document.querySelectorAll(".node-palette__section-title")
      ).map((n) => n.textContent);
      expect(sectionTitles).toContain("Recent");
    });
  });
});

describe("NodeSearch", () => {
  const mockOnSelect = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("renders search input with placeholder", () => {
      render(<NodeSearch onSelect={mockOnSelect} />);

      expect(
        screen.getByPlaceholderText("Search nodes...")
      ).toBeInTheDocument();
    });

    it("shows all nodes initially", () => {
      render(<NodeSearch onSelect={mockOnSelect} maxResults={5} />);

      expect(screen.getByText(/result/i)).toBeInTheDocument();
    });
  });

  describe("Search Functionality", () => {
    it("filters nodes based on search query", async () => {
      const user = userEvent.setup();
      render(<NodeSearch onSelect={mockOnSelect} />);

      const input = screen.getByPlaceholderText("Search nodes...");
      await user.type(input, "click");

      await waitFor(() => {
        expect(screen.getByText("Click")).toBeInTheDocument();
        expect(screen.queryByText("Type")).not.toBeInTheDocument();
      });
    });

    it("shows no results message when search has no matches", async () => {
      const user = userEvent.setup();
      render(<NodeSearch onSelect={mockOnSelect} />);

      const input = screen.getByPlaceholderText("Search nodes...");
      await user.type(input, "zzzznonexistent");

      await waitFor(() => {
        expect(screen.getByText("No nodes found")).toBeInTheDocument();
      });
    });

    it("clears search when clear button is clicked", async () => {
      const user = userEvent.setup();
      render(<NodeSearch onSelect={mockOnSelect} />);

      const input = screen.getByPlaceholderText("Search nodes...");
      await user.type(input, "click");

      const clearButton = screen.getByTitle("Clear search");
      fireEvent.click(clearButton);

      await waitFor(() => {
        expect(input).toHaveValue("");
      });
    });
  });

  describe("Keyboard Navigation", () => {
    it("navigates results with arrow keys", async () => {
      render(<NodeSearch onSelect={mockOnSelect} maxResults={5} />);

      const input = screen.getByPlaceholderText("Search nodes...");
      input.focus();

      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "ArrowDown" });

      // Should have moved selection down
      expect(input).toHaveFocus();
    });

    it("selects node with Enter key", async () => {
      render(<NodeSearch onSelect={mockOnSelect} />);

      const input = screen.getByPlaceholderText("Search nodes...");
      input.focus();

      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => {
        expect(mockOnSelect).toHaveBeenCalled();
      });
    });

    it("closes search with Escape key when query is empty", () => {
      render(<NodeSearch onSelect={mockOnSelect} onClose={mockOnClose} />);

      const input = screen.getByPlaceholderText("Search nodes...");
      input.focus();

      fireEvent.keyDown(input, { key: "Escape" });

      expect(mockOnClose).toHaveBeenCalled();
    });

    it("clears query with Escape key when query exists", async () => {
      const user = userEvent.setup();
      render(<NodeSearch onSelect={mockOnSelect} onClose={mockOnClose} />);

      const input = screen.getByPlaceholderText("Search nodes...");
      await user.type(input, "click");

      fireEvent.keyDown(input, { key: "Escape" });

      await waitFor(() => {
        expect(input).toHaveValue("");
      });

      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe("Search History", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it("saves search to history when selecting a result", async () => {
      const user = userEvent.setup();
      render(<NodeSearch onSelect={mockOnSelect} showHistory={true} />);

      const input = screen.getByPlaceholderText("Search nodes...");
      await user.type(input, "click");

      fireEvent.keyDown(input, { key: "Enter" });

      const history = JSON.parse(
        localStorage.getItem("qontinui-node-search-history") || "[]"
      );
      expect(history).toHaveLength(1);
      expect(history[0].query).toBe("click");
    });
  });
});

describe("PaletteItem", () => {
  const mockMetadata = NODE_METADATA.CLICK;
  const mockOnDragStart = vi.fn();
  const mockOnAdd = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    installDefaultFavoriteMocks();
    installDefaultRecentMocks();
  });

  it("renders node metadata correctly", () => {
    render(<PaletteItem metadata={mockMetadata} />);

    expect(screen.getByText("Click")).toBeInTheDocument();
    // Matches NODE_METADATA.CLICK.description in palette-config.ts.
    expect(screen.getByText(/Click on element/i)).toBeInTheDocument();
  });

  it("calls onAdd when clicked", () => {
    render(<PaletteItem metadata={mockMetadata} onAdd={mockOnAdd} />);

    const item = screen.getByText("Click").closest(".palette-item");
    fireEvent.click(item!);

    expect(mockOnAdd).toHaveBeenCalledWith("CLICK");
  });

  it("calls onDragStart when dragged", () => {
    render(
      <PaletteItem metadata={mockMetadata} onDragStart={mockOnDragStart} />
    );

    const item = screen.getByText("Click").closest(".palette-item");
    const dragEvent = new Event("dragstart", { bubbles: true });
    fireEvent(item!, dragEvent);

    expect(mockOnDragStart).toHaveBeenCalled();
  });

  it("shows multi-output badge for multi-output nodes", () => {
    const ifMetadata = NODE_METADATA.IF;
    render(<PaletteItem metadata={ifMetadata} />);

    expect(screen.getByText("Multi")).toBeInTheDocument();
  });

  it("shows recent badge for recent nodes", () => {
    installDefaultRecentMocks({
      isRecent: (type: string) => type === "CLICK",
    });

    render(<PaletteItem metadata={mockMetadata} />);

    expect(screen.getByText("Recent")).toBeInTheDocument();
  });

  it("toggles favorite when star button is clicked", () => {
    const mockToggleFavorite = vi.fn();
    installDefaultFavoriteMocks({ toggleFavorite: mockToggleFavorite });

    render(<PaletteItem metadata={mockMetadata} />);

    const favoriteButton = screen.getByTitle("Add to favorites");
    fireEvent.click(favoriteButton);

    expect(mockToggleFavorite).toHaveBeenCalledWith("CLICK");
  });
});

describe("QuickAddMenu", () => {
  const mockOnSelect = vi.fn();
  const mockOnClose = vi.fn();
  const mockPosition = { x: 100, y: 100 };

  beforeEach(() => {
    vi.clearAllMocks();
    installDefaultRecentMocks();
    installDefaultFavoriteMocks();
  });

  it("renders when open", () => {
    render(
      <QuickAddMenu
        isOpen={true}
        position={mockPosition}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
      />
    );

    expect(screen.getByPlaceholderText("Search nodes...")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(
      <QuickAddMenu
        isOpen={false}
        position={mockPosition}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
      />
    );

    expect(
      screen.queryByPlaceholderText("Search nodes...")
    ).not.toBeInTheDocument();
  });

  it("calls onSelect and onClose when node is selected", async () => {
    render(
      <QuickAddMenu
        isOpen={true}
        position={mockPosition}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
      />
    );

    const firstNode = screen.getAllByRole("button")[0];
    fireEvent.click(firstNode);

    expect(mockOnSelect).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });

  it("filters nodes based on search", async () => {
    const user = userEvent.setup();
    render(
      <QuickAddMenu
        isOpen={true}
        position={mockPosition}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
      />
    );

    const input = screen.getByPlaceholderText("Search nodes...");
    await user.type(input, "find");

    await waitFor(() => {
      expect(screen.getByText("Find")).toBeInTheDocument();
    });
  });

  it("closes when Escape is pressed", () => {
    render(
      <QuickAddMenu
        isOpen={true}
        position={mockPosition}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
      />
    );

    const input = screen.getByPlaceholderText("Search nodes...");
    fireEvent.keyDown(input, { key: "Escape" });

    expect(mockOnClose).toHaveBeenCalled();
  });

  it("navigates with arrow keys", () => {
    render(
      <QuickAddMenu
        isOpen={true}
        position={mockPosition}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
      />
    );

    const input = screen.getByPlaceholderText("Search nodes...");
    input.focus();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });

    expect(input).toHaveFocus();
  });

  it("shows recent nodes section when recent nodes exist", () => {
    installDefaultRecentMocks({ recentTypes: ["CLICK"] });

    render(
      <QuickAddMenu
        isOpen={true}
        position={mockPosition}
        onSelect={mockOnSelect}
        onClose={mockOnClose}
      />
    );

    expect(screen.getByText("Recent")).toBeInTheDocument();
  });
});

describe("Integration Tests", () => {
  it("full workflow: search, select, and add node", async () => {
    const user = userEvent.setup();
    const mockOnNodeAdd = vi.fn();
    const mockCanvasRef = { current: document.createElement("div") };

    render(<NodePalette onNodeAdd={mockOnNodeAdd} canvasRef={mockCanvasRef} />);

    // Open search
    const searchButton = screen.getByTitle(/search nodes/i);
    fireEvent.click(searchButton);

    // Type search query
    const input = screen.getByPlaceholderText(/search/i);
    await user.type(input, "click");

    // Select first result — "Click" appears on both the search result item
    // and the palette item in the Mouse category, so use getAllByText.
    await waitFor(() => {
      expect(screen.getAllByText("Click").length).toBeGreaterThan(0);
    });

    fireEvent.keyDown(input, { key: "Enter" });

    // Should call onNodeAdd
    await waitFor(() => {
      expect(mockOnNodeAdd).toHaveBeenCalled();
    });
  });

  it("favorites workflow: add to favorites and access from favorites section", async () => {
    const mockToggleFavorite = vi.fn();
    installDefaultFavoriteMocks({ toggleFavorite: mockToggleFavorite });
    installDefaultRecentMocks();

    const { rerender } = render(
      <NodePalette
        onNodeAdd={vi.fn()}
        canvasRef={{ current: document.createElement("div") }}
      />
    );

    // Find and favorite the FIND palette item. Target it by data attribute
    // since "Find" appears both as a category title and as an item label.
    const findNode = document.querySelector(
      '.palette-item[data-node-type="FIND"]'
    ) as HTMLElement | null;
    expect(findNode).not.toBeNull();
    const favoriteButton = within(findNode!).getByTitle("Add to favorites");
    fireEvent.click(favoriteButton);

    expect(mockToggleFavorite).toHaveBeenCalledWith("FIND");

    // Update mock to include favorited item
    installDefaultFavoriteMocks({
      favoriteTypes: ["FIND"],
      toggleFavorite: mockToggleFavorite,
    });

    // Rerender to show favorites section
    rerender(
      <NodePalette
        onNodeAdd={vi.fn()}
        canvasRef={{ current: document.createElement("div") }}
      />
    );

    // Should now show in favorites
    expect(screen.getByText("Favorites")).toBeInTheDocument();
  });
});
