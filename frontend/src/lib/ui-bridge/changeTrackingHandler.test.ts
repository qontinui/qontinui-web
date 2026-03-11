/**
 * Change Tracking Handler Tests (Web Frontend — camelCase commands)
 *
 * Tests the extracted command dispatch logic that maps camelCase actions
 * to ChangeTracker method calls.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  handleChangeTrackingCommand,
  type ChangeTrackerLike,
  type ChangeTrackingDeps,
} from "./changeTrackingHandler";

// ============================================================================
// Helpers
// ============================================================================

function createMockTracker(
  overrides?: Partial<ChangeTrackerLike>
): ChangeTrackerLike {
  return {
    saveBookmark: vi.fn().mockReturnValue({ name: "test", snapshot: {} }),
    getBookmark: vi
      .fn()
      .mockReturnValue({ name: "test", snapshot: {}, timestamp: 123 }),
    deleteBookmark: vi.fn().mockReturnValue(true),
    listBookmarks: vi.fn().mockReturnValue(["a", "b"]),
    diffFromBookmark: vi.fn().mockReturnValue({
      changes: { appeared: [], disappeared: [], modified: [] },
    }),
    executeWithDiff: vi
      .fn()
      .mockResolvedValue({ actionResult: {}, diff: null }),
    waitForChange: vi.fn().mockResolvedValue(null),
    categorizeLastDiff: vi
      .fn()
      .mockReturnValue({ category: "no-op", confidence: 1, diff: null }),
    scopedDiffFromBookmark: vi.fn().mockReturnValue(null),
    summarizeDiff: vi.fn().mockReturnValue("2 elements changed"),
    enableBuffer: vi.fn(),
    disableBuffer: vi.fn(),
    drainBuffer: vi.fn().mockReturnValue({ changes: [], count: 0 }),
    getBufferSize: vi.fn().mockReturnValue(0),
    isBufferEnabled: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

function createMockDeps(
  overrides?: Partial<ChangeTrackingDeps>
): ChangeTrackingDeps {
  return {
    createSnapshot: vi.fn().mockReturnValue({
      elements: [
        {
          id: "btn-1",
          type: "button",
          label: "Save",
          actions: ["click"],
          state: { visible: true },
        },
      ],
    }),
    createSnapshotManager: vi.fn().mockReturnValue({
      createSnapshot: vi.fn().mockReturnValue({ snapshotId: "snap-1" }),
    }),
    analyzeStructuredChanges: vi.fn().mockReturnValue({
      hasStructuredData: false,
      tableChanges: [],
      listChanges: [],
    }),
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("handleChangeTrackingCommand (web/camelCase)", () => {
  let ct: ChangeTrackerLike;
  let deps: ChangeTrackingDeps;

  beforeEach(() => {
    ct = createMockTracker();
    deps = createMockDeps();
  });

  // =========================================================================
  // Bookmark CRUD
  // =========================================================================

  describe("bookmark operations", () => {
    it("saveBookmark delegates with name", async () => {
      await handleChangeTrackingCommand(
        ct,
        "saveBookmark",
        { name: "snap1" },
        deps
      );
      expect(ct.saveBookmark).toHaveBeenCalledWith("snap1");
    });

    it("getBookmark returns bookmark when found", async () => {
      const bookmark = { name: "snap1", snapshot: { id: "s1" }, timestamp: 1 };
      (ct.getBookmark as ReturnType<typeof vi.fn>).mockReturnValue(bookmark);
      const result = await handleChangeTrackingCommand(
        ct,
        "getBookmark",
        { name: "snap1" },
        deps
      );
      expect(result).toBe(bookmark);
    });

    it("getBookmark throws when not found", async () => {
      (ct.getBookmark as ReturnType<typeof vi.fn>).mockReturnValue(null);
      await expect(
        handleChangeTrackingCommand(
          ct,
          "getBookmark",
          { name: "missing" },
          deps
        )
      ).rejects.toThrow("Bookmark 'missing' not found");
    });

    it("deleteBookmark wraps result in { deleted }", async () => {
      (ct.deleteBookmark as ReturnType<typeof vi.fn>).mockReturnValue(true);
      const result = await handleChangeTrackingCommand(
        ct,
        "deleteBookmark",
        { name: "old" },
        deps
      );
      expect(result).toEqual({ deleted: true });
      expect(ct.deleteBookmark).toHaveBeenCalledWith("old");
    });

    it("deleteBookmark returns false when not found", async () => {
      (ct.deleteBookmark as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const result = await handleChangeTrackingCommand(
        ct,
        "deleteBookmark",
        { name: "nope" },
        deps
      );
      expect(result).toEqual({ deleted: false });
    });

    it("listBookmarks delegates directly", async () => {
      const names = ["a", "b", "c"];
      (ct.listBookmarks as ReturnType<typeof vi.fn>).mockReturnValue(names);
      const result = await handleChangeTrackingCommand(
        ct,
        "listBookmarks",
        {},
        deps
      );
      expect(result).toBe(names);
    });
  });

  // =========================================================================
  // Diff Operations
  // =========================================================================

  describe("diff operations", () => {
    it("diffFromBookmark delegates with name", async () => {
      const diff = {
        changes: { appeared: [{ id: "e1" }], disappeared: [], modified: [] },
      };
      (ct.diffFromBookmark as ReturnType<typeof vi.fn>).mockReturnValue(diff);
      const result = await handleChangeTrackingCommand(
        ct,
        "diffFromBookmark",
        { name: "snap1" },
        deps
      );
      expect(result).toBe(diff);
      expect(ct.diffFromBookmark).toHaveBeenCalledWith("snap1");
    });

    it("executeWithDiff passes entire payload", async () => {
      const payload = {
        elementId: "btn-1",
        action: "click",
        settleTimeout: 2000,
      };
      await handleChangeTrackingCommand(ct, "executeWithDiff", payload, deps);
      expect(ct.executeWithDiff).toHaveBeenCalledWith(payload);
    });

    it("waitForChange passes predicate and options", async () => {
      const predicate = { minChanges: 1 };
      const options = { timeout: 5000 };
      await handleChangeTrackingCommand(
        ct,
        "waitForChange",
        { predicate, options },
        deps
      );
      expect(ct.waitForChange).toHaveBeenCalledWith(predicate, options);
    });

    it("waitForChange works without options", async () => {
      const predicate = { minChanges: 1 };
      await handleChangeTrackingCommand(
        ct,
        "waitForChange",
        { predicate },
        deps
      );
      expect(ct.waitForChange).toHaveBeenCalledWith(predicate, undefined);
    });

    it("categorizeLastDiff delegates directly", async () => {
      const categorized = {
        category: "content-update",
        confidence: 0.9,
        diff: {},
      };
      (ct.categorizeLastDiff as ReturnType<typeof vi.fn>).mockReturnValue(
        categorized
      );
      const result = await handleChangeTrackingCommand(
        ct,
        "categorizeLastDiff",
        {},
        deps
      );
      expect(result).toBe(categorized);
    });
  });

  // =========================================================================
  // Scoped Diff
  // =========================================================================

  describe("getScopedDiff", () => {
    it("delegates to scopedDiffFromBookmark", async () => {
      await handleChangeTrackingCommand(
        ct,
        "getScopedDiff",
        { scope: ".sidebar", fromBookmark: "snap1" },
        deps
      );
      expect(ct.scopedDiffFromBookmark).toHaveBeenCalledWith(
        "snap1",
        ".sidebar"
      );
    });

    it("throws when fromBookmark is missing", async () => {
      await expect(
        handleChangeTrackingCommand(
          ct,
          "getScopedDiff",
          { scope: ".sidebar" },
          deps
        )
      ).rejects.toThrow("getScopedDiff requires a fromBookmark parameter");
    });

    it("throws when fromBookmark is empty string", async () => {
      await expect(
        handleChangeTrackingCommand(
          ct,
          "getScopedDiff",
          { scope: ".sidebar", fromBookmark: "" },
          deps
        )
      ).rejects.toThrow("getScopedDiff requires a fromBookmark parameter");
    });
  });

  // =========================================================================
  // Summarize Diff
  // =========================================================================

  describe("summarizeDiff", () => {
    it("uses fromBookmark when provided", async () => {
      const diff = { changes: {} };
      (ct.diffFromBookmark as ReturnType<typeof vi.fn>).mockReturnValue(diff);
      (ct.summarizeDiff as ReturnType<typeof vi.fn>).mockReturnValue(
        "1 button appeared"
      );

      const result = await handleChangeTrackingCommand(
        ct,
        "summarizeDiff",
        { budget: 200, fromBookmark: "snap1", includeIds: true },
        deps
      );

      expect(ct.diffFromBookmark).toHaveBeenCalledWith("snap1");
      expect(ct.summarizeDiff).toHaveBeenCalledWith(diff, {
        budget: 200,
        includeIds: true,
        includeCategory: undefined,
      });
      expect(result).toEqual({ summary: "1 button appeared" });
    });

    it("falls back to categorizeLastDiff when no fromBookmark", async () => {
      const diff = { changes: {} };
      (ct.categorizeLastDiff as ReturnType<typeof vi.fn>).mockReturnValue({
        category: "content-update",
        diff,
      });
      (ct.summarizeDiff as ReturnType<typeof vi.fn>).mockReturnValue(
        "content changed"
      );

      const result = await handleChangeTrackingCommand(
        ct,
        "summarizeDiff",
        { budget: 100 },
        deps
      );

      expect(ct.categorizeLastDiff).toHaveBeenCalled();
      expect(ct.summarizeDiff).toHaveBeenCalledWith(diff, {
        budget: 100,
        includeIds: undefined,
        includeCategory: undefined,
      });
      expect(result).toEqual({ summary: "content changed" });
    });

    it("returns 'No changes detected' when no diff available", async () => {
      (ct.categorizeLastDiff as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const result = await handleChangeTrackingCommand(
        ct,
        "summarizeDiff",
        { budget: 100 },
        deps
      );

      expect(result).toEqual({ summary: "No changes detected" });
      expect(ct.summarizeDiff).not.toHaveBeenCalled();
    });

    it("returns 'No changes detected' when categorizeLastDiff has null diff", async () => {
      (ct.categorizeLastDiff as ReturnType<typeof vi.fn>).mockReturnValue({
        category: "no-op",
        diff: null,
      });

      const result = await handleChangeTrackingCommand(
        ct,
        "summarizeDiff",
        { budget: 100 },
        deps
      );

      expect(result).toEqual({ summary: "No changes detected" });
    });
  });

  // =========================================================================
  // Structured Changes
  // =========================================================================

  describe("analyzeStructuredChanges", () => {
    it("analyzes from bookmark when provided", async () => {
      const bookmark = { name: "snap1", snapshot: { snapshotId: "s1" } };
      (ct.getBookmark as ReturnType<typeof vi.fn>).mockReturnValue(bookmark);
      const analysis = {
        hasStructuredData: true,
        tableChanges: [{ type: "row-added" }],
        listChanges: [],
      };
      (
        deps.analyzeStructuredChanges as ReturnType<typeof vi.fn>
      ).mockReturnValue(analysis);

      const result = await handleChangeTrackingCommand(
        ct,
        "analyzeStructuredChanges",
        { fromBookmark: "snap1" },
        deps
      );

      expect(ct.getBookmark).toHaveBeenCalledWith("snap1");
      expect(deps.createSnapshot).toHaveBeenCalled();
      expect(deps.createSnapshotManager).toHaveBeenCalledWith({});
      expect(deps.analyzeStructuredChanges).toHaveBeenCalledWith(
        bookmark.snapshot,
        expect.anything()
      );
      expect(result).toBe(analysis);
    });

    it("throws when bookmark not found", async () => {
      (ct.getBookmark as ReturnType<typeof vi.fn>).mockReturnValue(null);

      await expect(
        handleChangeTrackingCommand(
          ct,
          "analyzeStructuredChanges",
          { fromBookmark: "missing" },
          deps
        )
      ).rejects.toThrow("Bookmark 'missing' not found");
    });

    it("returns empty analysis without fromBookmark", async () => {
      const result = await handleChangeTrackingCommand(
        ct,
        "analyzeStructuredChanges",
        {},
        deps
      );

      expect(result).toEqual({
        hasStructuredData: false,
        tableChanges: [],
        listChanges: [],
      });
      expect(ct.getBookmark).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Change Buffer
  // =========================================================================

  describe("change buffer operations", () => {
    it("enableChangeBuffer enables and returns status", async () => {
      const result = await handleChangeTrackingCommand(
        ct,
        "enableChangeBuffer",
        {},
        deps
      );
      expect(ct.enableBuffer).toHaveBeenCalled();
      expect(result).toEqual({ enabled: true });
    });

    it("disableChangeBuffer disables and returns status", async () => {
      const result = await handleChangeTrackingCommand(
        ct,
        "disableChangeBuffer",
        {},
        deps
      );
      expect(ct.disableBuffer).toHaveBeenCalled();
      expect(result).toEqual({ enabled: false });
    });

    it("drainChangeBuffer delegates directly", async () => {
      const drained = { changes: [{ id: "c1" }], count: 1 };
      (ct.drainBuffer as ReturnType<typeof vi.fn>).mockReturnValue(drained);

      const result = await handleChangeTrackingCommand(
        ct,
        "drainChangeBuffer",
        {},
        deps
      );
      expect(result).toBe(drained);
    });

    it("getChangeBufferSize returns size and enabled status", async () => {
      (ct.getBufferSize as ReturnType<typeof vi.fn>).mockReturnValue(5);
      (ct.isBufferEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);

      const result = await handleChangeTrackingCommand(
        ct,
        "getChangeBufferSize",
        {},
        deps
      );
      expect(result).toEqual({ size: 5, enabled: true });
    });
  });

  // =========================================================================
  // Error Handling
  // =========================================================================

  describe("error handling", () => {
    it("throws on unknown action", async () => {
      await expect(
        handleChangeTrackingCommand(ct, "unknownAction", {}, deps)
      ).rejects.toThrow("Unknown change tracking action: unknownAction");
    });
  });
});
