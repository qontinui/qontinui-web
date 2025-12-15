/**
 * Conflict Resolution Tests
 *
 * Comprehensive test suite for conflict detection, resolution,
 * and synchronization services.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ConflictDetector,
  ConflictResolutionService,
  OperationalTransformService,
  SyncService,
} from "./index";
import {
  Conflict,
  Operation,
  Change,
} from "../../types/collaboration/conflict-types";

describe("ConflictDetector", () => {
  let detector: ConflictDetector;

  beforeEach(() => {
    detector = new ConflictDetector({
      detectPropertyChanges: true,
      detectStructuralChanges: true,
      minimumSeverity: "low",
    });
  });

  describe("detectConflicts", () => {
    it("should detect property changes", () => {
      const base = { name: "Base", value: 10 };
      const local = { name: "Local", value: 15 };
      const remote = { name: "Remote", value: 12 };

      const conflicts = detector.detectConflicts(local, remote, base);

      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts.some((c) => c.type === "PropertyChanged")).toBe(true);
    });

    it("should not detect conflicts for different properties", () => {
      const base = { name: "Base", value: 10 };
      const local = { name: "Local", value: 10 };
      const remote = { name: "Base", value: 15 };

      const conflicts = detector.detectConflicts(local, remote, base);

      expect(conflicts.length).toBe(0);
    });

    it("should detect action removal conflicts", () => {
      const base = { actions: [{ id: "a1", name: "Action" }] };
      const local = { actions: [] }; // Removed
      const remote = { actions: [{ id: "a1", name: "Updated Action" }] }; // Modified

      const conflicts = detector.detectConflicts(local, remote, base);

      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts.some((c) => c.type === "ActionRemoved")).toBe(true);
    });

    it("should detect structural changes in arrays", () => {
      const base = {
        actions: [
          { id: "a1", name: "Action 1" },
          { id: "a2", name: "Action 2" },
        ],
      };

      const local = {
        actions: [
          { id: "a1", name: "Updated Action 1" },
          { id: "a2", name: "Action 2" },
        ],
      };

      const remote = {
        actions: [
          { id: "a1", name: "Different Update" },
          { id: "a2", name: "Action 2" },
        ],
      };

      const conflicts = detector.detectConflicts(local, remote, base);

      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts.some((c) => c.type === "ActionModified")).toBe(true);
    });
  });

  describe("resolveConflict", () => {
    it("should resolve with KeepLocal strategy", () => {
      const conflict: Conflict = {
        id: "c1",
        type: "PropertyChanged",
        resourceType: "workflow",
        resourceId: "w1",
        localVersion: "Local",
        serverVersion: "Remote",
        baseVersion: "Base",
        path: ["name"],
        severity: "low",
        autoResolvable: false,
        createdAt: new Date(),
      };

      const result = detector.resolveConflict(conflict, "KeepLocal");
      expect(result).toBe("Local");
    });

    it("should resolve with KeepRemote strategy", () => {
      const conflict: Conflict = {
        id: "c1",
        type: "PropertyChanged",
        resourceType: "workflow",
        resourceId: "w1",
        localVersion: "Local",
        serverVersion: "Remote",
        baseVersion: "Base",
        path: ["name"],
        severity: "low",
        autoResolvable: false,
        createdAt: new Date(),
      };

      const result = detector.resolveConflict(conflict, "KeepRemote");
      expect(result).toBe("Remote");
    });

    it("should merge numeric values by adding deltas", () => {
      const conflict: Conflict = {
        id: "c1",
        type: "PropertyChanged",
        resourceType: "workflow",
        resourceId: "w1",
        localVersion: 15, // base + 5
        serverVersion: 12, // base + 2
        baseVersion: 10,
        path: ["value"],
        severity: "low",
        autoResolvable: true,
        createdAt: new Date(),
      };

      const result = detector.resolveConflict(conflict, "Merge");
      expect(result).toBe(17); // 10 + 5 + 2
    });
  });

  describe("threeWayMerge", () => {
    it("should successfully merge non-conflicting changes", () => {
      const base = {
        name: "Base",
        description: "Base description",
        value: 10,
      };

      const local = {
        name: "Local", // Changed
        description: "Base description",
        value: 10,
      };

      const remote = {
        name: "Base",
        description: "Remote description", // Changed
        value: 10,
      };

      const result = detector.threeWayMerge(local, remote, base);

      expect(result.success).toBe(true);
      expect(result.conflicts.length).toBe(0);
      expect(result.mergedVersion.name).toBe("Local");
      expect(result.mergedVersion.description).toBe("Remote description");
    });

    it("should detect conflicts in merge", () => {
      const base = { name: "Base" };
      const local = { name: "Local" };
      const remote = { name: "Remote" };

      const result = detector.threeWayMerge(local, remote, base);

      expect(result.success).toBe(false);
      expect(result.conflicts.length).toBeGreaterThan(0);
    });
  });
});

describe("OperationalTransformService", () => {
  let otService: OperationalTransformService;

  beforeEach(() => {
    otService = new OperationalTransformService();
  });

  describe("transform", () => {
    it("should transform insert-insert operations", () => {
      const op1: Operation = {
        type: "insert",
        path: ["actions"],
        value: { id: "new-1" },
        position: 2,
        timestamp: new Date("2024-01-01T10:00:00"),
        userId: "user-1",
        operationId: "op-1",
      };

      const op2: Operation = {
        type: "insert",
        path: ["actions"],
        value: { id: "new-2" },
        position: 2,
        timestamp: new Date("2024-01-01T10:00:01"),
        userId: "user-2",
        operationId: "op-2",
      };

      const [op1Prime, op2Prime] = otService.transform(op1, op2);

      // Earlier operation keeps position, later gets incremented
      expect(op1Prime.position).toBe(2);
      expect(op2Prime.position).toBe(3);
    });

    it("should transform insert-delete operations", () => {
      const op1: Operation = {
        type: "insert",
        path: ["actions"],
        value: { id: "new" },
        position: 2,
        timestamp: new Date(),
        userId: "user-1",
        operationId: "op-1",
      };

      const op2: Operation = {
        type: "delete",
        path: ["actions"],
        position: 1,
        timestamp: new Date(),
        userId: "user-2",
        operationId: "op-2",
      };

      const [op1Prime, op2Prime] = otService.transform(op1, op2);

      // Insert position shifts down due to delete
      expect(op1Prime.position).toBe(1);
      expect(op2Prime.position).toBe(1);
    });

    it("should transform update-update operations with timestamp ordering", () => {
      const op1: Operation = {
        type: "update",
        path: ["name"],
        value: "Value 1",
        oldValue: "Original",
        timestamp: new Date("2024-01-01T10:00:00"),
        userId: "user-1",
        operationId: "op-1",
      };

      const op2: Operation = {
        type: "update",
        path: ["name"],
        value: "Value 2",
        oldValue: "Original",
        timestamp: new Date("2024-01-01T10:00:01"),
        userId: "user-2",
        operationId: "op-2",
      };

      const [, op2Prime] = otService.transform(op1, op2);

      // Earlier operation's value becomes old value for later
      expect(op2Prime.oldValue).toBe("Value 1");
    });
  });

  describe("compose", () => {
    it("should compose update operations", () => {
      const op1: Operation = {
        type: "update",
        path: ["name"],
        value: "Middle",
        oldValue: "Original",
        timestamp: new Date(),
        userId: "user-1",
        operationId: "op-1",
      };

      const op2: Operation = {
        type: "update",
        path: ["name"],
        value: "Final",
        oldValue: "Middle",
        timestamp: new Date(),
        userId: "user-1",
        operationId: "op-2",
      };

      const composed = otService.compose(op1, op2);

      expect(composed.value).toBe("Final");
      expect(composed.oldValue).toBe("Original");
    });
  });

  describe("invert", () => {
    it("should invert update operation", () => {
      const op: Operation = {
        type: "update",
        path: ["name"],
        value: "New",
        oldValue: "Old",
        timestamp: new Date(),
        userId: "user-1",
        operationId: "op-1",
      };

      const inverted = otService.invert(op);

      expect(inverted.type).toBe("update");
      expect(inverted.value).toBe("Old");
      expect(inverted.oldValue).toBe("New");
    });

    it("should invert insert operation", () => {
      const op: Operation = {
        type: "insert",
        path: ["actions"],
        value: { id: "new" },
        position: 2,
        timestamp: new Date(),
        userId: "user-1",
        operationId: "op-1",
      };

      const inverted = otService.invert(op);

      expect(inverted.type).toBe("delete");
      expect(inverted.position).toBe(2);
    });
  });

  describe("apply", () => {
    it("should apply insert operation", () => {
      const doc = {
        actions: [
          { id: "a1", name: "Action 1" },
          { id: "a2", name: "Action 2" },
        ],
      };

      const op: Operation = {
        type: "insert",
        path: ["actions"],
        value: { id: "a3", name: "Action 3" },
        position: 1,
        timestamp: new Date(),
        userId: "user-1",
        operationId: "op-1",
      };

      const result = otService.apply(doc, op);

      expect(result.actions.length).toBe(3);
      expect(result.actions[1].id).toBe("a3");
    });

    it("should apply delete operation", () => {
      const doc = {
        actions: [
          { id: "a1", name: "Action 1" },
          { id: "a2", name: "Action 2" },
          { id: "a3", name: "Action 3" },
        ],
      };

      const op: Operation = {
        type: "delete",
        path: ["actions"],
        position: 1,
        timestamp: new Date(),
        userId: "user-1",
        operationId: "op-1",
      };

      const result = otService.apply(doc, op);

      expect(result.actions.length).toBe(2);
      expect(result.actions[1].id).toBe("a3");
    });

    it("should apply update operation", () => {
      const doc = {
        name: "Original",
      };

      const op: Operation = {
        type: "update",
        path: ["name"],
        value: "Updated",
        oldValue: "Original",
        timestamp: new Date(),
        userId: "user-1",
        operationId: "op-1",
      };

      const result = otService.apply(doc, op);

      expect(result.name).toBe("Updated");
    });
  });

  describe("transformPath", () => {
    it("should transform path after insert", () => {
      const path = ["actions", "2", "name"];

      const op: Operation = {
        type: "insert",
        path: ["actions"],
        value: { id: "new" },
        position: 1,
        timestamp: new Date(),
        userId: "user-1",
        operationId: "op-1",
      };

      const result = otService.transformPath(path, op);

      expect(result.exists).toBe(true);
      expect(result.transformedPath).toEqual(["actions", "3", "name"]);
    });

    it("should detect deleted paths", () => {
      const path = ["actions", "2", "name"];

      const op: Operation = {
        type: "delete",
        path: ["actions", "2"],
        timestamp: new Date(),
        userId: "user-1",
        operationId: "op-1",
      };

      const result = otService.transformPath(path, op);

      expect(result.exists).toBe(false);
      expect(result.reason).toBe("Path was deleted");
    });
  });
});

describe("SyncService", () => {
  let syncService: SyncService;

  beforeEach(() => {
    syncService = new SyncService({
      wsUrl: "ws://localhost:8000/ws",
      syncInterval: 1000,
      maxRetries: 3,
      retryDelay: 100,
      enableOptimisticUpdates: true,
      enableOfflineQueue: true,
      maxQueueSize: 10,
    });

    // Mock fetch
    global.fetch = vi.fn();
  });

  afterEach(() => {
    syncService.destroy();
    vi.restoreAllMocks();
  });

  describe("queueOfflineChange", () => {
    it("should queue change when offline", () => {
      const change: Change = {
        id: "change-1",
        type: "update",
        resourceType: "workflow",
        resourceId: "wf-1",
        path: ["name"],
        value: "Updated",
        timestamp: new Date(),
        userId: "user-1",
      };

      syncService.queueOfflineChange(change);

      const queueState = syncService.getQueueState();
      expect(queueState.pending.length).toBe(1);
      expect(queueState.pending[0].change).toEqual(change);
    });

    it("should respect max queue size", () => {
      // Queue 11 changes (max is 10)
      for (let i = 0; i < 11; i++) {
        const change: Change = {
          id: `change-${i}`,
          type: "update",
          resourceType: "workflow",
          resourceId: "wf-1",
          path: ["name"],
          value: `Update ${i}`,
          timestamp: new Date(),
          userId: "user-1",
        };
        syncService.queueOfflineChange(change);
      }

      const queueState = syncService.getQueueState();
      expect(queueState.size).toBe(10);
    });
  });

  describe("applyOptimisticUpdate", () => {
    it("should apply optimistic update", () => {
      const change: Change = {
        id: "change-1",
        type: "update",
        resourceType: "workflow",
        resourceId: "wf-1",
        path: ["name"],
        value: "Updated",
        timestamp: new Date(),
        userId: "user-1",
        optimistic: true,
      };

      syncService.applyOptimisticUpdate(change);

      // Optimistic update should be tracked internally
      // This would be verified through integration tests
    });
  });

  describe("getQueueState", () => {
    it("should return correct queue state", () => {
      const state = syncService.getQueueState();

      expect(state).toHaveProperty("pending");
      expect(state).toHaveProperty("failed");
      expect(state).toHaveProperty("size");
      expect(state).toHaveProperty("processing");
      expect(Array.isArray(state.pending)).toBe(true);
      expect(Array.isArray(state.failed)).toBe(true);
    });
  });

  describe("clearQueue", () => {
    it("should clear the queue", () => {
      // Add some changes
      const change: Change = {
        id: "change-1",
        type: "update",
        resourceType: "workflow",
        resourceId: "wf-1",
        path: ["name"],
        value: "Updated",
        timestamp: new Date(),
        userId: "user-1",
      };
      syncService.queueOfflineChange(change);

      // Clear
      syncService.clearQueue();

      const state = syncService.getQueueState();
      expect(state.size).toBe(0);
    });
  });
});

describe("ConflictResolutionService", () => {
  let service: ConflictResolutionService;

  beforeEach(() => {
    service = new ConflictResolutionService("/api");

    // Mock fetch
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("checkForConflicts", () => {
    it("should detect no conflicts when versions match", async () => {
      const serverVersion = { name: "Test", value: 10 };

      (global.fetch as unknown).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          version: serverVersion,
          baseVersion: serverVersion,
        }),
      });

      const result = await service.checkForConflicts(
        "proj-1",
        "workflow",
        "wf-1",
        serverVersion
      );

      expect(result.hasConflicts).toBe(false);
      expect(result.canSave).toBe(true);
    });

    it("should detect conflicts when versions differ", async () => {
      const baseVersion = { name: "Base", value: 10 };
      const serverVersion = { name: "Server", value: 15 };
      const localVersion = { name: "Local", value: 12 };

      (global.fetch as unknown).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          version: serverVersion,
          baseVersion: baseVersion,
        }),
      });

      const result = await service.checkForConflicts(
        "proj-1",
        "workflow",
        "wf-1",
        localVersion
      );

      expect(result.hasConflicts).toBe(true);
    });
  });
});

describe("Integration Tests", () => {
  it("should handle full conflict resolution workflow", async () => {
    const detector = new ConflictDetector();

    // Setup versions
    const base = {
      name: "Workflow",
      actions: [{ id: "a1", name: "Action 1", x: 100 }],
    };

    const local = {
      name: "My Workflow",
      actions: [
        { id: "a1", name: "Action 1", x: 150 }, // Moved
      ],
    };

    const remote = {
      name: "Workflow",
      actions: [
        { id: "a1", name: "Updated Action", x: 100 }, // Renamed
      ],
    };

    // Detect conflicts
    const conflicts = detector.detectConflicts(local, remote, base);
    expect(conflicts.length).toBeGreaterThan(0);

    // Merge
    const mergeResult = detector.threeWayMerge(local, remote, base);

    // Should merge non-conflicting changes
    expect(mergeResult.mergedVersion.name).toBe("My Workflow"); // Local change
    expect(mergeResult.mergedVersion.actions[0].name).toBeDefined();
    expect(mergeResult.mergedVersion.actions[0].x).toBeDefined();
  });

  it("should handle OT with multiple concurrent operations", () => {
    const otService = new OperationalTransformService();

    const doc = {
      actions: [
        { id: "a1", name: "Action 1" },
        { id: "a2", name: "Action 2" },
        { id: "a3", name: "Action 3" },
      ],
    };

    // User 1 deletes action at index 1
    const op1: Operation = {
      type: "delete",
      path: ["actions"],
      position: 1,
      timestamp: new Date(),
      userId: "user-1",
      operationId: "op-1",
    };

    // User 2 inserts action at index 2
    const op2: Operation = {
      type: "insert",
      path: ["actions"],
      value: { id: "a4", name: "Action 4" },
      position: 2,
      timestamp: new Date(),
      userId: "user-2",
      operationId: "op-2",
    };

    // Transform
    const [op1Prime, op2Prime] = otService.transform(op1, op2);

    // Apply in both orders
    const doc1 = otService.apply(doc, op1);
    const doc1Final = otService.apply(doc1, op2Prime);

    const doc2 = otService.apply(doc, op2);
    const doc2Final = otService.apply(doc2, op1Prime);

    // Both should converge to same result
    expect(JSON.stringify(doc1Final)).toBe(JSON.stringify(doc2Final));
  });
});
