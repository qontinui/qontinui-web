/**
 * Folder Tree Component Tests
 *
 * Tests for FolderTree component and utilities
 */

import { describe, it, expect } from "vitest";
import {
  createFolder,
  generateFolderId,
  getDescendantIds,
  wouldCreateCycle,
  getFolderPath,
  validateFolderName,
  sortFolders,
  reorderFolders,
  getFolderStats,
} from "./folder-utils";
import { WorkflowFolder } from "./types";

describe("Folder Utilities", () => {
  describe("generateFolderId", () => {
    it("should generate unique IDs", () => {
      const id1 = generateFolderId();
      const id2 = generateFolderId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^folder_/);
    });
  });

  describe("createFolder", () => {
    it("should create a folder with default values", () => {
      const folder = createFolder("Test Folder");
      expect(folder.name).toBe("Test Folder");
      expect(folder.parentId).toBeNull();
      expect(folder.order).toBe(0);
      expect(folder.createdAt).toBeInstanceOf(Date);
      expect(folder.updatedAt).toBeInstanceOf(Date);
    });

    it("should create a folder with custom options", () => {
      const folder = createFolder("Test Folder", "parent1", {
        color: "#ff0000",
        icon: "Star",
        order: 5,
      });
      expect(folder.parentId).toBe("parent1");
      expect(folder.color).toBe("#ff0000");
      expect(folder.icon).toBe("Star");
      expect(folder.order).toBe(5);
    });
  });

  describe("getDescendantIds", () => {
    const folders: WorkflowFolder[] = [
      createFolder("Parent", null),
      createFolder("Child1", "folder1"),
      createFolder("Child2", "folder1"),
      createFolder("Grandchild", "folder2"),
    ];
    folders[0].id = "folder1";
    folders[1].id = "folder2";
    folders[2].id = "folder3";
    folders[3].id = "folder4";

    it("should get all descendants", () => {
      const descendants = getDescendantIds("folder1", folders);
      expect(descendants).toContain("folder2");
      expect(descendants).toContain("folder3");
      expect(descendants).toContain("folder4");
      expect(descendants).toHaveLength(3);
    });

    it("should return empty array for folder with no children", () => {
      const descendants = getDescendantIds("folder4", folders);
      expect(descendants).toHaveLength(0);
    });
  });

  describe("wouldCreateCycle", () => {
    const folders: WorkflowFolder[] = [
      { ...createFolder("Parent"), id: "folder1" },
      { ...createFolder("Child", "folder1"), id: "folder2" },
      { ...createFolder("Grandchild", "folder2"), id: "folder3" },
    ];

    it("should detect direct cycle", () => {
      expect(wouldCreateCycle("folder1", "folder1", folders)).toBe(true);
    });

    it("should detect indirect cycle", () => {
      expect(wouldCreateCycle("folder1", "folder3", folders)).toBe(true);
    });

    it("should allow valid moves", () => {
      expect(wouldCreateCycle("folder3", "folder1", folders)).toBe(false);
      expect(wouldCreateCycle("folder2", null, folders)).toBe(false);
    });

    it("should handle null parent", () => {
      expect(wouldCreateCycle("folder1", null, folders)).toBe(false);
    });
  });

  describe("getFolderPath", () => {
    const folders: WorkflowFolder[] = [
      { ...createFolder("Root"), id: "folder1", parentId: null },
      { ...createFolder("Child", "folder1"), id: "folder2" },
      { ...createFolder("Grandchild", "folder2"), id: "folder3" },
    ];

    it("should get correct path", () => {
      const path = getFolderPath("folder3", folders);
      expect(path).toEqual(["Root", "Child", "Grandchild"]);
    });

    it("should get path for root folder", () => {
      const path = getFolderPath("folder1", folders);
      expect(path).toEqual(["Root"]);
    });

    it("should return empty path for non-existent folder", () => {
      const path = getFolderPath("nonexistent", folders);
      expect(path).toEqual([]);
    });
  });

  describe("validateFolderName", () => {
    const folders: WorkflowFolder[] = [
      { ...createFolder("Existing", null), id: "folder1" },
      { ...createFolder("Child", "folder1"), id: "folder2" },
    ];

    it("should reject empty name", () => {
      const result = validateFolderName("", folders, null);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("empty");
    });

    it("should reject whitespace-only name", () => {
      const result = validateFolderName("   ", folders, null);
      expect(result.valid).toBe(false);
    });

    it("should reject too long name", () => {
      const longName = "a".repeat(101);
      const result = validateFolderName(longName, folders, null);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("too long");
    });

    it("should reject duplicate name in same parent", () => {
      const result = validateFolderName("Existing", folders, null);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("already exists");
    });

    it("should allow duplicate name in different parent", () => {
      const result = validateFolderName("Existing", folders, "folder1");
      expect(result.valid).toBe(true);
    });

    it("should allow same name when excluding current folder", () => {
      const result = validateFolderName("Existing", folders, null, "folder1");
      expect(result.valid).toBe(true);
    });

    it("should accept valid name", () => {
      const result = validateFolderName("New Folder", folders, null);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe("sortFolders", () => {
    it("should sort by order first, then name", () => {
      const folders: WorkflowFolder[] = [
        { ...createFolder("Zebra"), order: 1 },
        { ...createFolder("Apple"), order: 1 },
        { ...createFolder("Banana"), order: 0 },
      ];

      const sorted = sortFolders(folders);
      expect(sorted[0].name).toBe("Banana");
      expect(sorted[1].name).toBe("Apple");
      expect(sorted[2].name).toBe("Zebra");
    });
  });

  describe("reorderFolders", () => {
    it("should update folder parent and order", () => {
      const folders: WorkflowFolder[] = [
        { ...createFolder("Root1"), id: "folder1", parentId: null, order: 0 },
        { ...createFolder("Root2"), id: "folder2", parentId: null, order: 1 },
        {
          ...createFolder("Child"),
          id: "folder3",
          parentId: "folder1",
          order: 0,
        },
      ];

      const updated = reorderFolders(folders, "folder3", "folder2");
      const movedFolder = updated.find((f) => f.id === "folder3")!;

      expect(movedFolder.parentId).toBe("folder2");
      expect(movedFolder.order).toBeGreaterThanOrEqual(0);
    });
  });

  describe("getFolderStats", () => {
    it("should calculate correct statistics", () => {
      const folders: WorkflowFolder[] = [
        {
          ...createFolder("Root"),
          id: "folder1",
          parentId: null,
          color: "#ff0000",
        },
        { ...createFolder("Child1", "folder1"), id: "folder2", icon: "Star" },
        { ...createFolder("Child2", "folder1"), id: "folder3" },
        { ...createFolder("Empty"), id: "folder4", parentId: null },
      ];

      const stats = getFolderStats(folders, []);

      expect(stats.totalFolders).toBe(4);
      expect(stats.maxDepth).toBeGreaterThan(0);
      expect(stats.emptyFolders).toBe(4); // All empty since no workflows
      expect(stats.foldersWithColor).toBe(1);
      expect(stats.foldersWithIcon).toBe(1);
    });
  });
});

describe("FolderTree Component", () => {
  // Component tests would go here
  // These would typically use React Testing Library
  // Example:
  // it('should render folder tree', () => {
  //   render(<FolderTree ... />);
  //   expect(screen.getByText('All Workflows')).toBeInTheDocument();
  // });
});
