/**
 * Extraction Annotation Store Tests
 *
 * Test coverage:
 * - Element CRUD operations (add, update, delete)
 * - Multi-selection management
 * - Clipboard operations (copy, cut, paste)
 * - Undo/Redo history
 * - Version history
 * - Review workflow
 * - Grid snap calculations
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useExtractionAnnotationStore } from "./extraction-annotation-store";
import type {
  AnnotatedElement,
  BoundingBox,
} from "./extraction-annotation-store";

// Mock the annotation persistence service
vi.mock("@/services/annotation-persistence", () => ({
  saveAnnotations: vi.fn().mockResolvedValue({ success: true }),
  loadAnnotations: vi
    .fn()
    .mockResolvedValue({ success: true, annotations: [] }),
  generateScreenshotId: vi.fn(
    (extractionId: string, pageIndex: number) =>
      `${extractionId}-page-${pageIndex}`
  ),
}));

// Helper to create mock elements
function createMockElement(
  overrides: Partial<AnnotatedElement> = {}
): Omit<AnnotatedElement, "id"> {
  return {
    bbox: { x: 100, y: 100, width: 50, height: 50 },
    label: "Test Element",
    elementType: "button",
    confidence: 0.95,
    isGroundTruth: true,
    isAutoDetected: false,
    ...overrides,
  };
}

function resetStore(): void {
  const store = useExtractionAnnotationStore.getState();
  store.reset();
  // Also clear auto-save timer
  if (store.autoSaveTimerId) {
    clearTimeout(store.autoSaveTimerId);
  }
}

describe("ExtractionAnnotationStore", () => {
  beforeEach(() => {
    // Reset store state before each test
    resetStore();
    // Disable auto-save to prevent async issues in tests
    useExtractionAnnotationStore.getState().setAutoSaveEnabled(false);
  });

  afterEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  describe("Initialization", () => {
    it("should initialize with empty state", () => {
      const state = useExtractionAnnotationStore.getState();

      expect(state.elements).toEqual([]);
      expect(state.selectedElementIds).toEqual([]);
      expect(state.activeTool).toBe("select");
      expect(state.history).toEqual([]);
      expect(state.historyIndex).toBe(-1);
      expect(state.versions).toEqual([]);
      expect(state.clipboard).toBeNull();
    });

    it("should set session correctly", () => {
      const { setSession } = useExtractionAnnotationStore.getState();

      setSession("extraction-123", "screenshot-1", "https://example.com");

      const state = useExtractionAnnotationStore.getState();
      expect(state.extractionId).toBe("extraction-123");
      expect(state.screenshotId).toBe("screenshot-1");
      expect(state.sourceUrl).toBe("https://example.com");
    });
  });

  describe("Element CRUD - addElement", () => {
    it("should add a single element", () => {
      const { addElement } = useExtractionAnnotationStore.getState();
      const mockElement = createMockElement();

      const id = addElement(mockElement);

      const state = useExtractionAnnotationStore.getState();
      expect(state.elements).toHaveLength(1);
      expect(state.elements[0].id).toBe(id);
      expect(state.elements[0].label).toBe("Test Element");
      expect(state.selectedElementIds).toEqual([id]);
    });

    it("should set reviewStatus to pending for new elements", () => {
      const { addElement } = useExtractionAnnotationStore.getState();
      const mockElement = createMockElement();

      const _id = addElement(mockElement);

      const state = useExtractionAnnotationStore.getState();
      expect(state.elements[0].reviewStatus).toBe("pending");
    });

    it("should record history when adding element", () => {
      const { addElement } = useExtractionAnnotationStore.getState();

      addElement(createMockElement());

      const state = useExtractionAnnotationStore.getState();
      expect(state.history.length).toBeGreaterThan(0);
      expect(state.hasUnsavedChanges).toBe(true);
    });
  });

  describe("Element CRUD - addElements", () => {
    it("should add multiple elements at once", () => {
      const { addElements } = useExtractionAnnotationStore.getState();
      const mockElements = [
        createMockElement({ label: "Element 1" }),
        createMockElement({ label: "Element 2" }),
        createMockElement({ label: "Element 3" }),
      ];

      const ids = addElements(mockElements);

      const state = useExtractionAnnotationStore.getState();
      expect(state.elements).toHaveLength(3);
      expect(ids).toHaveLength(3);
      expect(state.selectedElementIds).toEqual(ids);
    });

    it("should generate unique IDs for each element", () => {
      const { addElements } = useExtractionAnnotationStore.getState();
      const mockElements = [createMockElement(), createMockElement()];

      const ids = addElements(mockElements);

      expect(ids[0]).not.toBe(ids[1]);
    });
  });

  describe("Element CRUD - updateElement", () => {
    it("should update a single element", () => {
      const { addElement, updateElement } =
        useExtractionAnnotationStore.getState();
      const id = addElement(createMockElement());

      updateElement(id, { label: "Updated Label", confidence: 0.99 });

      const state = useExtractionAnnotationStore.getState();
      expect(state.elements[0].label).toBe("Updated Label");
      expect(state.elements[0].confidence).toBe(0.99);
    });

    it("should not modify other elements", () => {
      const { addElements, updateElement } =
        useExtractionAnnotationStore.getState();
      const ids = addElements([
        createMockElement({ label: "Element 1" }),
        createMockElement({ label: "Element 2" }),
      ]);

      updateElement(ids[0], { label: "Updated" });

      const state = useExtractionAnnotationStore.getState();
      expect(state.elements[0].label).toBe("Updated");
      expect(state.elements[1].label).toBe("Element 2");
    });
  });

  describe("Element CRUD - updateElements", () => {
    it("should update multiple elements with same updates", () => {
      const { addElements, updateElements } =
        useExtractionAnnotationStore.getState();
      const ids = addElements([
        createMockElement({ label: "Element 1" }),
        createMockElement({ label: "Element 2" }),
        createMockElement({ label: "Element 3" }),
      ]);

      updateElements([ids[0], ids[1]], { isGroundTruth: false });

      const state = useExtractionAnnotationStore.getState();
      expect(state.elements[0].isGroundTruth).toBe(false);
      expect(state.elements[1].isGroundTruth).toBe(false);
      expect(state.elements[2].isGroundTruth).toBe(true);
    });
  });

  describe("Element CRUD - deleteElement", () => {
    it("should delete a single element", () => {
      const { addElement, deleteElement } =
        useExtractionAnnotationStore.getState();
      const id = addElement(createMockElement());

      deleteElement(id);

      const state = useExtractionAnnotationStore.getState();
      expect(state.elements).toHaveLength(0);
    });

    it("should remove deleted element from selection", () => {
      const { addElement, selectElement, deleteElement } =
        useExtractionAnnotationStore.getState();
      const id = addElement(createMockElement());
      selectElement(id);

      deleteElement(id);

      const state = useExtractionAnnotationStore.getState();
      expect(state.selectedElementIds).not.toContain(id);
    });
  });

  describe("Element CRUD - deleteElements", () => {
    it("should delete multiple elements", () => {
      const { addElements, deleteElements } =
        useExtractionAnnotationStore.getState();
      const ids = addElements([
        createMockElement({ label: "Element 1" }),
        createMockElement({ label: "Element 2" }),
        createMockElement({ label: "Element 3" }),
      ]);

      deleteElements([ids[0], ids[2]]);

      const state = useExtractionAnnotationStore.getState();
      expect(state.elements).toHaveLength(1);
      expect(state.elements[0].label).toBe("Element 2");
    });

    it("should remove deleted elements from selection", () => {
      const { addElements, selectElements, deleteElements } =
        useExtractionAnnotationStore.getState();
      const ids = addElements([
        createMockElement({ label: "Element 1" }),
        createMockElement({ label: "Element 2" }),
      ]);
      selectElements(ids);

      deleteElements([ids[0]]);

      const state = useExtractionAnnotationStore.getState();
      expect(state.selectedElementIds).toEqual([ids[1]]);
    });
  });

  describe("Selection - selectElement", () => {
    it("should select a single element", () => {
      const { addElements, selectElement } =
        useExtractionAnnotationStore.getState();
      const ids = addElements([
        createMockElement({ label: "Element 1" }),
        createMockElement({ label: "Element 2" }),
      ]);

      selectElement(ids[0]);

      const state = useExtractionAnnotationStore.getState();
      expect(state.selectedElementIds).toEqual([ids[0]]);
    });

    it("should replace selection when addToSelection is false", () => {
      const { addElements, selectElement } =
        useExtractionAnnotationStore.getState();
      const ids = addElements([
        createMockElement({ label: "Element 1" }),
        createMockElement({ label: "Element 2" }),
      ]);
      selectElement(ids[0]);

      selectElement(ids[1]);

      const state = useExtractionAnnotationStore.getState();
      expect(state.selectedElementIds).toEqual([ids[1]]);
    });

    it("should add to selection when addToSelection is true", () => {
      const { addElements, selectElement } =
        useExtractionAnnotationStore.getState();
      const ids = addElements([
        createMockElement({ label: "Element 1" }),
        createMockElement({ label: "Element 2" }),
      ]);
      selectElement(ids[0]);

      selectElement(ids[1], true);

      const state = useExtractionAnnotationStore.getState();
      expect(state.selectedElementIds).toContain(ids[0]);
      expect(state.selectedElementIds).toContain(ids[1]);
    });

    it("should toggle selection when element is already selected with addToSelection", () => {
      const { addElements, selectElement } =
        useExtractionAnnotationStore.getState();
      const ids = addElements([
        createMockElement({ label: "Element 1" }),
        createMockElement({ label: "Element 2" }),
      ]);
      selectElement(ids[0]);
      selectElement(ids[1], true);

      selectElement(ids[0], true); // Toggle off

      const state = useExtractionAnnotationStore.getState();
      expect(state.selectedElementIds).toEqual([ids[1]]);
    });

    it("should clear selection when id is null", () => {
      const { addElement, selectElement } =
        useExtractionAnnotationStore.getState();
      const id = addElement(createMockElement());
      selectElement(id);

      selectElement(null);

      const state = useExtractionAnnotationStore.getState();
      expect(state.selectedElementIds).toEqual([]);
    });
  });

  describe("Selection - selectElements", () => {
    it("should select multiple elements", () => {
      const { addElements, selectElements } =
        useExtractionAnnotationStore.getState();
      const ids = addElements([
        createMockElement({ label: "Element 1" }),
        createMockElement({ label: "Element 2" }),
        createMockElement({ label: "Element 3" }),
      ]);

      selectElements([ids[0], ids[2]]);

      const state = useExtractionAnnotationStore.getState();
      expect(state.selectedElementIds).toEqual([ids[0], ids[2]]);
    });
  });

  describe("Selection - selectAll", () => {
    it("should select all elements", () => {
      const { addElements, selectAll } =
        useExtractionAnnotationStore.getState();
      const ids = addElements([
        createMockElement({ label: "Element 1" }),
        createMockElement({ label: "Element 2" }),
        createMockElement({ label: "Element 3" }),
      ]);

      selectAll();

      const state = useExtractionAnnotationStore.getState();
      expect(state.selectedElementIds).toHaveLength(3);
      expect(state.selectedElementIds).toEqual(expect.arrayContaining(ids));
    });
  });

  describe("Selection - deselectAll", () => {
    it("should clear all selections", () => {
      const { addElements, selectAll, deselectAll } =
        useExtractionAnnotationStore.getState();
      addElements([
        createMockElement({ label: "Element 1" }),
        createMockElement({ label: "Element 2" }),
      ]);
      selectAll();

      deselectAll();

      const state = useExtractionAnnotationStore.getState();
      expect(state.selectedElementIds).toEqual([]);
    });
  });

  describe("Clipboard - copySelected", () => {
    it("should copy selected elements to clipboard", () => {
      const { addElements, selectElements, copySelected } =
        useExtractionAnnotationStore.getState();
      const ids = addElements([
        createMockElement({ label: "Element 1" }),
        createMockElement({ label: "Element 2" }),
      ]);
      selectElements([ids[0]]);

      copySelected();

      const state = useExtractionAnnotationStore.getState();
      expect(state.clipboard).not.toBeNull();
      expect(state.clipboard?.elements).toHaveLength(1);
      expect(state.clipboard?.elements[0].label).toBe("Element 1");
    });

    it("should not modify clipboard if nothing is selected", () => {
      const { addElement, deselectAll, copySelected } =
        useExtractionAnnotationStore.getState();
      addElement(createMockElement());
      deselectAll();

      copySelected();

      const state = useExtractionAnnotationStore.getState();
      expect(state.clipboard).toBeNull();
    });
  });

  describe("Clipboard - cutSelected", () => {
    it("should copy to clipboard and delete selected elements", () => {
      const { addElements, selectElements, cutSelected } =
        useExtractionAnnotationStore.getState();
      const ids = addElements([
        createMockElement({ label: "Element 1" }),
        createMockElement({ label: "Element 2" }),
      ]);
      selectElements([ids[0]]);

      cutSelected();

      const state = useExtractionAnnotationStore.getState();
      expect(state.clipboard?.elements).toHaveLength(1);
      expect(state.elements).toHaveLength(1);
      expect(state.elements[0].label).toBe("Element 2");
    });
  });

  describe("Clipboard - paste", () => {
    it("should paste elements from clipboard with offset", () => {
      const { addElement, selectElement, copySelected, paste } =
        useExtractionAnnotationStore.getState();
      const id = addElement(
        createMockElement({ bbox: { x: 100, y: 100, width: 50, height: 50 } })
      );
      selectElement(id);
      copySelected();

      paste({ x: 20, y: 20 });

      const state = useExtractionAnnotationStore.getState();
      expect(state.elements).toHaveLength(2);
      const pastedElement = state.elements[1];
      expect(pastedElement.bbox.x).toBe(120);
      expect(pastedElement.bbox.y).toBe(120);
      expect(pastedElement.id).not.toBe(id);
    });

    it("should use default offset when not specified", () => {
      const { addElement, selectElement, copySelected, paste } =
        useExtractionAnnotationStore.getState();
      const id = addElement(
        createMockElement({ bbox: { x: 100, y: 100, width: 50, height: 50 } })
      );
      selectElement(id);
      copySelected();

      paste();

      const state = useExtractionAnnotationStore.getState();
      const pastedElement = state.elements[1];
      expect(pastedElement.bbox.x).toBe(120); // Default offset is 20
      expect(pastedElement.bbox.y).toBe(120);
    });

    it("should reset review status to pending on pasted elements", () => {
      const { addElement, selectElement, updateElement, copySelected, paste } =
        useExtractionAnnotationStore.getState();
      const id = addElement(createMockElement());
      updateElement(id, { reviewStatus: "approved" });
      selectElement(id);
      copySelected();

      paste();

      const state = useExtractionAnnotationStore.getState();
      const pastedElement = state.elements[1];
      expect(pastedElement.reviewStatus).toBe("pending");
    });

    it("should do nothing when clipboard is empty", () => {
      const { addElement, paste } = useExtractionAnnotationStore.getState();
      addElement(createMockElement());

      paste();

      const state = useExtractionAnnotationStore.getState();
      expect(state.elements).toHaveLength(1);
    });
  });

  describe("History - undo", () => {
    it("should undo the last action", () => {
      const { addElement, deleteElement, undo } =
        useExtractionAnnotationStore.getState();
      const id = addElement(createMockElement({ label: "Original" }));

      deleteElement(id);
      undo();

      const state = useExtractionAnnotationStore.getState();
      expect(state.elements).toHaveLength(1);
      expect(state.elements[0].label).toBe("Original");
    });

    it("should restore selection state", () => {
      const { addElements, selectElement, deleteElement, undo } =
        useExtractionAnnotationStore.getState();
      const ids = addElements([
        createMockElement({ label: "Element 1" }),
        createMockElement({ label: "Element 2" }),
      ]);
      selectElement(ids[0]);

      deleteElement(ids[0]);
      undo();

      const state = useExtractionAnnotationStore.getState();
      expect(state.selectedElementIds).toContain(ids[0]);
    });

    it("should not undo if at beginning of history", () => {
      resetStore();
      const { undo, canUndo } = useExtractionAnnotationStore.getState();

      expect(canUndo()).toBe(false);
      undo();

      const state = useExtractionAnnotationStore.getState();
      expect(state.elements).toEqual([]);
    });
  });

  describe("History - redo", () => {
    it("should redo the undone action", () => {
      const { addElement, deleteElement, undo, redo } =
        useExtractionAnnotationStore.getState();
      const id = addElement(createMockElement());

      deleteElement(id);
      undo();
      redo();

      const state = useExtractionAnnotationStore.getState();
      expect(state.elements).toHaveLength(0);
    });

    it("should not redo if at end of history", () => {
      const { addElement, canRedo, redo } =
        useExtractionAnnotationStore.getState();
      addElement(createMockElement());

      expect(canRedo()).toBe(false);
      redo();

      const state = useExtractionAnnotationStore.getState();
      expect(state.elements).toHaveLength(1);
    });

    it("should clear redo history when new action is performed", () => {
      const { addElement, deleteElement, undo, canRedo } =
        useExtractionAnnotationStore.getState();
      const id = addElement(createMockElement());
      deleteElement(id);
      undo();

      addElement(createMockElement({ label: "New Element" }));

      const _state = useExtractionAnnotationStore.getState();
      expect(canRedo()).toBe(false);
    });
  });

  describe("History - canUndo/canRedo", () => {
    it("should correctly report canUndo", () => {
      const { addElement, canUndo } = useExtractionAnnotationStore.getState();

      // Initially cannot undo (history is empty, index is -1)
      expect(canUndo()).toBe(false);

      // After adding an element, we have 1 history entry at index 0
      // canUndo checks if historyIndex > 0, which is false (0 > 0)
      // This is correct - we can't undo to before the first action
      addElement(createMockElement());
      // After first action, historyIndex is 0, so canUndo() returns false
      // We need to add another element to have something to undo to
      addElement(createMockElement());
      expect(canUndo()).toBe(true);
    });

    it("should correctly report canRedo", () => {
      const { addElement, deleteElement, undo, canRedo } =
        useExtractionAnnotationStore.getState();
      const id = addElement(createMockElement());

      expect(canRedo()).toBe(false);

      deleteElement(id);
      undo();
      expect(canRedo()).toBe(true);
    });
  });

  describe("Version History - saveVersion", () => {
    it("should save current state as a version", () => {
      const { addElement, saveVersion } =
        useExtractionAnnotationStore.getState();
      addElement(createMockElement({ label: "Test Element" }));

      saveVersion("Initial version");

      const state = useExtractionAnnotationStore.getState();
      expect(state.versions).toHaveLength(1);
      expect(state.versions[0].comment).toBe("Initial version");
      expect(state.versions[0].elements).toHaveLength(1);
      expect(state.currentVersionId).toBe(state.versions[0].id);
    });

    it("should limit versions to MAX_VERSIONS", () => {
      const { addElement, saveVersion } =
        useExtractionAnnotationStore.getState();
      addElement(createMockElement());

      // Save 25 versions (MAX_VERSIONS is 20)
      for (let i = 0; i < 25; i++) {
        saveVersion(`Version ${i}`);
      }

      const state = useExtractionAnnotationStore.getState();
      expect(state.versions.length).toBeLessThanOrEqual(20);
    });
  });

  describe("Version History - loadVersion", () => {
    it("should restore elements from a saved version", () => {
      const { addElement, updateElement, saveVersion, loadVersion } =
        useExtractionAnnotationStore.getState();
      const id = addElement(createMockElement({ label: "Original" }));
      saveVersion("Version 1");

      updateElement(id, { label: "Modified" });

      const state = useExtractionAnnotationStore.getState();
      const versionId = state.versions[0].id;

      loadVersion(versionId);

      const newState = useExtractionAnnotationStore.getState();
      expect(newState.elements[0].label).toBe("Original");
      expect(newState.currentVersionId).toBe(versionId);
    });

    it("should clear selection when loading version", () => {
      const { addElement, selectElement, saveVersion, loadVersion } =
        useExtractionAnnotationStore.getState();
      const id = addElement(createMockElement());
      saveVersion("Version 1");
      selectElement(id);

      const state = useExtractionAnnotationStore.getState();
      loadVersion(state.versions[0].id);

      const newState = useExtractionAnnotationStore.getState();
      expect(newState.selectedElementIds).toEqual([]);
    });

    it("should do nothing if version not found", () => {
      const { addElement, loadVersion } =
        useExtractionAnnotationStore.getState();
      addElement(createMockElement({ label: "Current" }));

      loadVersion("non-existent-version");

      const state = useExtractionAnnotationStore.getState();
      expect(state.elements[0].label).toBe("Current");
    });
  });

  describe("Version History - deleteVersion", () => {
    it("should delete a saved version", () => {
      const { addElement, saveVersion, deleteVersion } =
        useExtractionAnnotationStore.getState();
      addElement(createMockElement());
      saveVersion("Version 1");

      const state = useExtractionAnnotationStore.getState();
      const versionId = state.versions[0].id;

      deleteVersion(versionId);

      const newState = useExtractionAnnotationStore.getState();
      expect(newState.versions).toHaveLength(0);
    });

    it("should clear currentVersionId if deleted version was current", () => {
      const { addElement, saveVersion, deleteVersion } =
        useExtractionAnnotationStore.getState();
      addElement(createMockElement());
      saveVersion("Version 1");

      const state = useExtractionAnnotationStore.getState();
      expect(state.currentVersionId).toBe(state.versions[0].id);

      deleteVersion(state.versions[0].id);

      const newState = useExtractionAnnotationStore.getState();
      expect(newState.currentVersionId).toBeNull();
    });
  });

  describe("Review Workflow - setReviewStatus", () => {
    it("should set review status for specified elements", () => {
      const { addElements, setReviewStatus } =
        useExtractionAnnotationStore.getState();
      const ids = addElements([
        createMockElement({ label: "Element 1" }),
        createMockElement({ label: "Element 2" }),
        createMockElement({ label: "Element 3" }),
      ]);

      setReviewStatus([ids[0], ids[1]], "approved", "Looks good");

      const state = useExtractionAnnotationStore.getState();
      expect(state.elements[0].reviewStatus).toBe("approved");
      expect(state.elements[0].reviewComment).toBe("Looks good");
      expect(state.elements[1].reviewStatus).toBe("approved");
      expect(state.elements[2].reviewStatus).toBe("pending");
    });

    it("should set reviewedAt timestamp", () => {
      const { addElement, setReviewStatus } =
        useExtractionAnnotationStore.getState();
      const id = addElement(createMockElement());
      const before = Date.now();

      setReviewStatus([id], "rejected");

      const state = useExtractionAnnotationStore.getState();
      const after = Date.now();
      expect(state.elements[0].reviewedAt).toBeGreaterThanOrEqual(before);
      expect(state.elements[0].reviewedAt).toBeLessThanOrEqual(after);
    });
  });

  describe("Review Workflow - bulkApprove", () => {
    it("should approve all selected elements", () => {
      const { addElements, selectAll, bulkApprove } =
        useExtractionAnnotationStore.getState();
      addElements([
        createMockElement({ label: "Element 1" }),
        createMockElement({ label: "Element 2" }),
      ]);
      selectAll();

      bulkApprove();

      const state = useExtractionAnnotationStore.getState();
      expect(state.elements.every((el) => el.reviewStatus === "approved")).toBe(
        true
      );
    });
  });

  describe("Review Workflow - bulkReject", () => {
    it("should reject all selected elements with comment", () => {
      const { addElements, selectAll, bulkReject } =
        useExtractionAnnotationStore.getState();
      addElements([
        createMockElement({ label: "Element 1" }),
        createMockElement({ label: "Element 2" }),
      ]);
      selectAll();

      bulkReject("Incorrect labels");

      const state = useExtractionAnnotationStore.getState();
      expect(state.elements.every((el) => el.reviewStatus === "rejected")).toBe(
        true
      );
      expect(
        state.elements.every((el) => el.reviewComment === "Incorrect labels")
      ).toBe(true);
    });
  });

  describe("Grid - setGridEnabled", () => {
    it("should enable grid", () => {
      const { setGridEnabled } = useExtractionAnnotationStore.getState();

      setGridEnabled(true);

      const state = useExtractionAnnotationStore.getState();
      expect(state.grid.enabled).toBe(true);
    });
  });

  describe("Grid - snapToGrid", () => {
    it("should snap value to grid when enabled", () => {
      const { setGridEnabled, setGridSize, snapToGrid } =
        useExtractionAnnotationStore.getState();
      setGridEnabled(true);
      setGridSize(10);

      const snapped = snapToGrid(57);

      expect(snapped).toBe(60);
    });

    it("should round down when closer to lower grid line", () => {
      const { setGridEnabled, setGridSize, snapToGrid } =
        useExtractionAnnotationStore.getState();
      setGridEnabled(true);
      setGridSize(10);

      const snapped = snapToGrid(53);

      expect(snapped).toBe(50);
    });

    it("should not snap when grid is disabled", () => {
      const { setGridEnabled, snapToGrid } =
        useExtractionAnnotationStore.getState();
      setGridEnabled(false);

      const snapped = snapToGrid(57);

      expect(snapped).toBe(57);
    });
  });

  describe("Grid - snapBboxToGrid", () => {
    it("should snap bounding box to grid when enabled", () => {
      const { setGridEnabled, setGridSize, snapBboxToGrid } =
        useExtractionAnnotationStore.getState();
      setGridEnabled(true);
      setGridSize(10);

      const bbox: BoundingBox = { x: 57, y: 43, width: 98, height: 73 };
      const snapped = snapBboxToGrid(bbox);

      expect(snapped.x).toBe(60);
      expect(snapped.y).toBe(40);
      expect(snapped.width).toBe(100);
      expect(snapped.height).toBe(70);
    });

    it("should ensure minimum size equals grid size", () => {
      const { setGridEnabled, setGridSize, snapBboxToGrid } =
        useExtractionAnnotationStore.getState();
      setGridEnabled(true);
      setGridSize(10);

      const bbox: BoundingBox = { x: 50, y: 50, width: 3, height: 3 };
      const snapped = snapBboxToGrid(bbox);

      expect(snapped.width).toBe(10);
      expect(snapped.height).toBe(10);
    });

    it("should not snap when grid is disabled", () => {
      const { setGridEnabled, snapBboxToGrid } =
        useExtractionAnnotationStore.getState();
      setGridEnabled(false);

      const bbox: BoundingBox = { x: 57, y: 43, width: 98, height: 73 };
      const snapped = snapBboxToGrid(bbox);

      expect(snapped).toEqual(bbox);
    });
  });

  describe("Grid - addElement with grid enabled", () => {
    it("should snap new element bbox to grid", () => {
      const { setGridEnabled, setGridSize, addElement } =
        useExtractionAnnotationStore.getState();
      setGridEnabled(true);
      setGridSize(10);

      const id = addElement(
        createMockElement({
          bbox: { x: 57, y: 43, width: 98, height: 73 },
        })
      );

      const state = useExtractionAnnotationStore.getState();
      const element = state.elements.find((el) => el.id === id);
      expect(element?.bbox.x).toBe(60);
      expect(element?.bbox.y).toBe(40);
    });
  });

  describe("Helpers", () => {
    it("getSelectedElements should return selected elements", () => {
      const { addElements, selectElements, getSelectedElements } =
        useExtractionAnnotationStore.getState();
      const ids = addElements([
        createMockElement({ label: "Element 1" }),
        createMockElement({ label: "Element 2" }),
        createMockElement({ label: "Element 3" }),
      ]);
      selectElements([ids[0], ids[2]]);

      const selected = getSelectedElements();

      expect(selected).toHaveLength(2);
      expect(selected.map((el) => el.label)).toEqual([
        "Element 1",
        "Element 3",
      ]);
    });

    it("getVisibleElements should filter by ground truth when showOnlyGroundTruth is true", () => {
      const { addElements, setShowOnlyGroundTruth, getVisibleElements } =
        useExtractionAnnotationStore.getState();
      addElements([
        createMockElement({ label: "GT Element", isGroundTruth: true }),
        createMockElement({ label: "Non-GT Element", isGroundTruth: false }),
      ]);
      setShowOnlyGroundTruth(true);

      const visible = getVisibleElements();

      expect(visible).toHaveLength(1);
      expect(visible[0].label).toBe("GT Element");
    });

    it("hasSelection should return true when elements are selected", () => {
      const { addElement, deselectAll, selectElement, hasSelection } =
        useExtractionAnnotationStore.getState();
      const id = addElement(createMockElement());

      // addElement automatically selects the new element, so we need to deselect first
      deselectAll();
      expect(hasSelection()).toBe(false);

      selectElement(id);
      expect(hasSelection()).toBe(true);
    });

    it("getElementsInBox should return elements that intersect with the box", () => {
      const { addElements, getElementsInBox } =
        useExtractionAnnotationStore.getState();
      addElements([
        createMockElement({
          label: "Inside",
          bbox: { x: 50, y: 50, width: 50, height: 50 },
        }),
        createMockElement({
          label: "Partial",
          bbox: { x: 80, y: 80, width: 50, height: 50 },
        }),
        createMockElement({
          label: "Outside",
          bbox: { x: 200, y: 200, width: 50, height: 50 },
        }),
      ]);

      const selectionBox: BoundingBox = { x: 40, y: 40, width: 60, height: 60 };
      const elements = getElementsInBox(selectionBox);

      expect(elements).toHaveLength(2);
      expect(elements.map((el) => el.label)).toContain("Inside");
      expect(elements.map((el) => el.label)).toContain("Partial");
    });
  });

  describe("Reset", () => {
    it("should reset all state to initial values", () => {
      const { addElement, selectElement, setSession, reset } =
        useExtractionAnnotationStore.getState();
      setSession("extraction-123");
      addElement(createMockElement());
      selectElement(useExtractionAnnotationStore.getState().elements[0].id);

      reset();

      const state = useExtractionAnnotationStore.getState();
      expect(state.extractionId).toBeNull();
      expect(state.elements).toEqual([]);
      expect(state.selectedElementIds).toEqual([]);
      expect(state.history).toEqual([]);
      expect(state.versions).toEqual([]);
    });
  });
});
