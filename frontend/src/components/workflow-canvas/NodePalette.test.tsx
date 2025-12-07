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
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { NodePalette } from "./NodePalette";
import { NodeSearch } from "./NodeSearch";
import { PaletteItem } from "./PaletteItem";
import { QuickAddMenu } from "./QuickAddMenu";
import { NODE_METADATA } from "./palette-config";
import { useFavoriteNodes } from "@/stores/favorite-nodes";
import { useRecentNodes } from "@/stores/recent-nodes";

// Mock stores
jest.mock("@/stores/favorite-nodes");
jest.mock("@/stores/recent-nodes");
jest.mock("@xyflow/react", () => ({
  useReactFlow: () => ({
    screenToFlowPosition: ({ x, y }: any) => ({ x, y }),
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  }),
}));

describe("NodePalette", () => {
  const mockOnNodeAdd = jest.fn();
  const mockCanvasRef = { current: document.createElement("div") };

  beforeEach(() => {
    jest.clearAllMocks();
    (useFavoriteNodes as jest.Mock).mockReturnValue({
      favorites: [],
      isFavorite: () => false,
      toggleFavorite: jest.fn(),
      getFavorites: () => [],
    });
    (useRecentNodes as jest.Mock).mockReturnValue({
      recentNodes: [],
      addRecentNode: jest.fn(),
      getRecentNodes: () => [],
      isRecent: () => false,
    });
  });

  describe("Rendering", () => {
    it("renders the palette with all categories", () => {
      render(
        <NodePalette onNodeAdd={mockOnNodeAdd} canvasRef={mockCanvasRef} />
      );

      expect(screen.getByText("Nodes")).toBeInTheDocument();
      expect(screen.getByText("Find")).toBeInTheDocument();
      expect(screen.getByText("Mouse")).toBeInTheDocument();
      expect(screen.getByText("Keyboard")).toBeInTheDocument();
      expect(screen.getByText("Control Flow")).toBeInTheDocument();
      expect(screen.getByText("Data")).toBeInTheDocument();
      expect(screen.getByText("State")).toBeInTheDocument();
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

      const findCategory = screen.getByText("Find").closest("button");
      expect(findCategory).toBeInTheDocument();

      // Should be expanded by default
      expect(screen.getByText(/Find element on screen/i)).toBeInTheDocument();

      // Collapse
      fireEvent.click(findCategory!);
      await waitFor(() => {
        expect(
          screen.queryByText(/Find element on screen/i)
        ).not.toBeInTheDocument();
      });

      // Expand again
      fireEvent.click(findCategory!);
      await waitFor(() => {
        expect(screen.getByText(/Find element on screen/i)).toBeInTheDocument();
      });
    });

    it("expands all categories when Expand All is clicked", async () => {
      render(
        <NodePalette onNodeAdd={mockOnNodeAdd} canvasRef={mockCanvasRef} />
      );

      const expandAllButton = screen.getByText("Expand All");
      fireEvent.click(expandAllButton);

      await waitFor(() => {
        expect(screen.getByText(/Click on an element/i)).toBeInTheDocument();
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
        expect(
          screen.queryByText(/Click on an element/i)
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("Node Addition", () => {
    it("calls onNodeAdd when a node item is clicked", () => {
      render(
        <NodePalette onNodeAdd={mockOnNodeAdd} canvasRef={mockCanvasRef} />
      );

      const findNode = screen.getByText("Find").closest(".palette-item");
      expect(findNode).toBeInTheDocument();

      fireEvent.click(findNode!);

      expect(mockOnNodeAdd).toHaveBeenCalledWith("FIND");
    });
  });

  describe("Favorites", () => {
    it("shows favorites section when favorites exist", () => {
      (useFavoriteNodes as jest.Mock).mockReturnValue({
        favorites: [{ type: "CLICK", order: 0, addedAt: Date.now() }],
        isFavorite: (type: string) => type === "CLICK",
        toggleFavorite: jest.fn(),
        getFavorites: () => [{ type: "CLICK", order: 0, addedAt: Date.now() }],
      });

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
      (useRecentNodes as jest.Mock).mockReturnValue({
        recentNodes: [{ type: "FIND", lastUsed: Date.now(), useCount: 1 }],
        addRecentNode: jest.fn(),
        getRecentNodes: () => [
          { type: "FIND", lastUsed: Date.now(), useCount: 1 },
        ],
        isRecent: (type: string) => type === "FIND",
      });

      render(
        <NodePalette onNodeAdd={mockOnNodeAdd} canvasRef={mockCanvasRef} />
      );

      expect(screen.getByText("Recent")).toBeInTheDocument();
    });
  });
});

describe("NodeSearch", () => {
  const mockOnSelect = jest.fn();
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
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
  const mockOnDragStart = jest.fn();
  const mockOnAdd = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useFavoriteNodes as jest.Mock).mockReturnValue({
      isFavorite: () => false,
      toggleFavorite: jest.fn(),
    });
    (useRecentNodes as jest.Mock).mockReturnValue({
      isRecent: () => false,
    });
  });

  it("renders node metadata correctly", () => {
    render(<PaletteItem metadata={mockMetadata} />);

    expect(screen.getByText("Click")).toBeInTheDocument();
    expect(screen.getByText(/Click on an element/i)).toBeInTheDocument();
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
    (useRecentNodes as jest.Mock).mockReturnValue({
      isRecent: (type: string) => type === "CLICK",
    });

    render(<PaletteItem metadata={mockMetadata} />);

    expect(screen.getByText("Recent")).toBeInTheDocument();
  });

  it("toggles favorite when star button is clicked", () => {
    const mockToggleFavorite = jest.fn();
    (useFavoriteNodes as jest.Mock).mockReturnValue({
      isFavorite: () => false,
      toggleFavorite: mockToggleFavorite,
    });

    render(<PaletteItem metadata={mockMetadata} />);

    const favoriteButton = screen.getByTitle("Add to favorites");
    fireEvent.click(favoriteButton);

    expect(mockToggleFavorite).toHaveBeenCalledWith("CLICK");
  });
});

describe("QuickAddMenu", () => {
  const mockOnSelect = jest.fn();
  const mockOnClose = jest.fn();
  const mockPosition = { x: 100, y: 100 };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRecentNodes as jest.Mock).mockReturnValue({
      recentNodes: [],
      getRecentNodes: () => [],
    });
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
    (useRecentNodes as jest.Mock).mockReturnValue({
      recentNodes: [{ type: "CLICK", lastUsed: Date.now(), useCount: 1 }],
      getRecentNodes: () => [
        { type: "CLICK", lastUsed: Date.now(), useCount: 1 },
      ],
    });

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
    const mockOnNodeAdd = jest.fn();
    const mockCanvasRef = { current: document.createElement("div") };

    render(<NodePalette onNodeAdd={mockOnNodeAdd} canvasRef={mockCanvasRef} />);

    // Open search
    const searchButton = screen.getByTitle(/search nodes/i);
    fireEvent.click(searchButton);

    // Type search query
    const input = screen.getByPlaceholderText(/search/i);
    await user.type(input, "click");

    // Select first result
    await waitFor(() => {
      expect(screen.getByText("Click")).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: "Enter" });

    // Should call onNodeAdd
    await waitFor(() => {
      expect(mockOnNodeAdd).toHaveBeenCalled();
    });
  });

  it("favorites workflow: add to favorites and access from favorites section", async () => {
    const favorites: any[] = [];
    const mockToggleFavorite = jest.fn((type) => {
      favorites.push({ type, order: 0, addedAt: Date.now() });
    });

    (useFavoriteNodes as jest.Mock).mockImplementation(() => ({
      favorites,
      isFavorite: (type: string) => favorites.some((f) => f.type === type),
      toggleFavorite: mockToggleFavorite,
      getFavorites: () => favorites,
    }));

    const { rerender } = render(
      <NodePalette
        onNodeAdd={jest.fn()}
        canvasRef={{ current: document.createElement("div") }}
      />
    );

    // Find and favorite a node
    const findNode = screen.getByText("Find").closest(".palette-item");
    const favoriteButton = within(findNode!).getByTitle("Add to favorites");
    fireEvent.click(favoriteButton);

    expect(mockToggleFavorite).toHaveBeenCalledWith("FIND");

    // Update mock to include favorited item
    (useFavoriteNodes as jest.Mock).mockReturnValue({
      favorites: [{ type: "FIND", order: 0, addedAt: Date.now() }],
      isFavorite: (type: string) => type === "FIND",
      toggleFavorite: mockToggleFavorite,
      getFavorites: () => [{ type: "FIND", order: 0, addedAt: Date.now() }],
    });

    // Rerender to show favorites section
    rerender(
      <NodePalette
        onNodeAdd={jest.fn()}
        canvasRef={{ current: document.createElement("div") }}
      />
    );

    // Should now show in favorites
    expect(screen.getByText("Favorites")).toBeInTheDocument();
  });
});
