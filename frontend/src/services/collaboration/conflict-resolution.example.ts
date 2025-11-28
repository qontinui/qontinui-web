/**
 * Conflict Resolution Examples
 *
 * Comprehensive examples showing how to use the conflict resolution
 * and synchronization services in real-world scenarios.
 */

import {
  conflictResolutionService,
  syncService,
  operationalTransformService,
} from "./index";
import {
  Conflict,
  ResolutionStrategy,
  Operation,
  Change,
} from "../../types/collaboration/conflict-types";

/**
 * Example 1: Basic Conflict Detection and Resolution
 */
export async function basicConflictResolution() {
  const projectId = "project-123";
  const workflowId = "workflow-456";

  // User makes local changes
  const localVersion = {
    id: workflowId,
    name: "My Workflow - Updated",
    actions: [
      { id: "action-1", name: "Start", type: "click", x: 100, y: 100 },
      { id: "action-2", name: "Process", type: "wait", x: 200, y: 100 },
    ],
    connections: [{ id: "conn-1", source: "action-1", target: "action-2" }],
  };

  // Check for conflicts
  const result = await conflictResolutionService.checkForConflicts(
    projectId,
    "workflow",
    workflowId,
    localVersion
  );

  if (result.hasConflicts) {
    console.log(`Found ${result.conflicts.length} conflicts`);

    // Try auto-resolve
    const autoResult = await conflictResolutionService.autoResolve(
      result.conflicts
    );

    console.log(`Auto-resolved: ${autoResult.resolved.length}`);
    console.log(`Requires manual: ${autoResult.requiresManual.length}`);

    // Handle manual conflicts
    for (const conflict of autoResult.requiresManual) {
      await handleManualConflict(conflict);
    }
  } else {
    console.log("No conflicts - safe to save");
  }
}

/**
 * Example 2: Manual Conflict Resolution
 */
async function handleManualConflict(conflict: Conflict): Promise<void> {
  // Get detailed information about the conflict
  const details = await conflictResolutionService.getConflictDetails(
    conflict.id
  );

  console.log("Conflict Details:");
  console.log("Type:", details.type);
  console.log("Path:", details.path.join("."));
  console.log("Local:", details.localVersion);
  console.log("Remote:", details.serverVersion);
  console.log("Base:", details.baseVersion);

  // Show user the available strategies and their previews
  console.log("\nAvailable Resolutions:");
  for (const strategy of details.availableStrategies) {
    console.log(`${strategy}:`, details.strategyPreviews[strategy]);
  }

  // User chooses a strategy (in real app, this would be from UI)
  const chosenStrategy: ResolutionStrategy = details.recommendedStrategy;

  // Resolve the conflict
  await conflictResolutionService.resolveConflict(
    conflict.id,
    chosenStrategy,
    details.strategyPreviews[chosenStrategy]
  );

  console.log(`Conflict resolved using ${chosenStrategy}`);
}

/**
 * Example 3: Three-Way Merge
 */
export function threeWayMergeExample() {
  const detector = conflictResolutionService.getDetector();

  const baseVersion = {
    name: "Original Workflow",
    description: "Base description",
    settings: {
      timeout: 5000,
      retries: 3,
    },
    actions: [
      { id: "a1", name: "Action 1", x: 100 },
      { id: "a2", name: "Action 2", x: 200 },
    ],
  };

  const localVersion = {
    name: "My Workflow", // User changed name
    description: "Base description",
    settings: {
      timeout: 10000, // User increased timeout
      retries: 3,
    },
    actions: [
      { id: "a1", name: "Action 1", x: 150 }, // User moved action
      { id: "a2", name: "Action 2", x: 200 },
      { id: "a3", name: "Action 3", x: 300 }, // User added action
    ],
  };

  const remoteVersion = {
    name: "Original Workflow",
    description: "Updated description", // Other user updated description
    settings: {
      timeout: 5000,
      retries: 5, // Other user increased retries
    },
    actions: [
      { id: "a1", name: "Start Action", x: 100 }, // Other user renamed action
      { id: "a2", name: "Action 2", x: 200 },
    ],
  };

  // Perform three-way merge
  const mergeResult = detector.threeWayMerge(
    localVersion,
    remoteVersion,
    baseVersion
  );

  if (mergeResult.success) {
    console.log("Merge successful!");
    console.log("Merged version:", mergeResult.mergedVersion);
    // Expected result:
    // - name: 'My Workflow' (local change)
    // - description: 'Updated description' (remote change)
    // - timeout: 10000 (local change)
    // - retries: 5 (remote change)
    // - actions: will have conflicts for action-1 (both modified)
  } else {
    console.log("Merge has conflicts:", mergeResult.conflicts);
  }
}

/**
 * Example 4: Operational Transformation
 */
export function operationalTransformExample() {
  // Two users make concurrent edits
  const op1: Operation = {
    type: "insert",
    path: ["actions"],
    value: { id: "new-1", name: "New Action 1" },
    position: 2,
    timestamp: new Date("2024-01-01T10:00:00"),
    userId: "user-1",
    operationId: "op-1",
  };

  const op2: Operation = {
    type: "delete",
    path: ["actions"],
    position: 1,
    timestamp: new Date("2024-01-01T10:00:01"),
    userId: "user-2",
    operationId: "op-2",
  };

  // Transform operations against each other
  const [op1Prime, op2Prime] = operationalTransformService.transform(op1, op2);

  console.log("Original operations:");
  console.log("Op1:", op1);
  console.log("Op2:", op2);

  console.log("\nTransformed operations:");
  console.log("Op1 prime:", op1Prime);
  console.log("Op2 prime:", op2Prime);

  // Apply to document
  const initialDoc = {
    actions: [
      { id: "a1", name: "Action 1" },
      { id: "a2", name: "Action 2" },
      { id: "a3", name: "Action 3" },
    ],
  };

  // User 1's view
  const doc1 = operationalTransformService.apply(initialDoc, op1);
  const doc1Final = operationalTransformService.apply(doc1, op2Prime);

  // User 2's view
  const doc2 = operationalTransformService.apply(initialDoc, op2);
  const doc2Final = operationalTransformService.apply(doc2, op1Prime);

  console.log("\nBoth users should see the same result:");
  console.log("User 1 final:", doc1Final);
  console.log("User 2 final:", doc2Final);
  console.log(
    "Equal?",
    JSON.stringify(doc1Final) === JSON.stringify(doc2Final)
  );
}

/**
 * Example 5: Real-time Synchronization
 */
export async function realtimeSyncExample() {
  const projectId = "project-123";
  const workflowId = "workflow-456";

  // Connect to WebSocket for real-time updates
  syncService.connectWebSocket(projectId);

  // Listen for conflicts
  syncService.onConflictDetected((conflict) => {
    console.log("Real-time conflict detected:", conflict);
    // Show notification to user
    showConflictNotification(conflict);
  });

  // Make a change
  const change: Change = {
    id: "change-1",
    type: "update",
    resourceType: "workflow",
    resourceId: workflowId,
    path: ["actions", "123", "name"],
    value: "Updated Action Name",
    oldValue: "Old Action Name",
    timestamp: new Date(),
    userId: "current-user",
  };

  // Sync the change
  const result = await syncService.syncResource(
    "workflow",
    workflowId,
    change,
    false
  );

  if (result.success) {
    console.log("Change synced successfully");
  } else if (result.status === "conflict") {
    console.log("Conflicts detected:", result.conflicts);
    // Handle conflicts
  } else {
    console.log("Sync failed:", result.errors);
  }
}

/**
 * Example 6: Optimistic Updates
 */
export async function optimisticUpdateExample() {
  const workflowId = "workflow-456";

  const change: Change = {
    id: `change-${Date.now()}`,
    type: "update",
    resourceType: "workflow",
    resourceId: workflowId,
    path: ["name"],
    value: "New Workflow Name",
    oldValue: "Old Workflow Name",
    timestamp: new Date(),
    userId: "current-user",
    optimistic: true,
  };

  // Apply change optimistically (immediate UI update)
  syncService.applyOptimisticUpdate(change);
  console.log("Change applied optimistically");

  try {
    // Try to sync with server
    const result = await syncService.syncResource(
      "workflow",
      workflowId,
      change.value,
      false
    );

    if (result.success) {
      console.log("Optimistic update confirmed by server");
    } else {
      // Conflict or error - rollback
      syncService.rollbackOptimisticUpdate(change.id);
      console.log("Optimistic update rolled back");
    }
  } catch (error) {
    // Error - rollback
    syncService.rollbackOptimisticUpdate(change.id);
    console.log("Optimistic update rolled back due to error:", error);
  }
}

/**
 * Example 7: Offline Queue
 */
export async function offlineQueueExample() {
  // User makes changes while offline
  if (!navigator.onLine) {
    const change: Change = {
      id: `offline-${Date.now()}`,
      type: "update",
      resourceType: "workflow",
      resourceId: "workflow-456",
      path: ["actions", "123"],
      value: { name: "Updated Offline" },
      timestamp: new Date(),
      userId: "current-user",
    };

    // Queue for later
    syncService.queueOfflineChange(change);
    console.log("Change queued for offline sync");
  }

  // When connection is restored
  window.addEventListener("online", async () => {
    console.log("Connection restored - processing offline queue");

    // Get queue state
    const queueState = syncService.getQueueState();
    console.log(`Processing ${queueState.pending.length} queued changes`);

    // Process the queue
    await syncService.processOfflineQueue();

    console.log("Offline queue processed");
  });
}

/**
 * Example 8: Compose Operations
 */
export function composeOperationsExample() {
  // User makes multiple edits to the same field
  const op1: Operation = {
    type: "update",
    path: ["name"],
    value: "First Update",
    oldValue: "Original",
    timestamp: new Date("2024-01-01T10:00:00"),
    userId: "user-1",
    operationId: "op-1",
  };

  const op2: Operation = {
    type: "update",
    path: ["name"],
    value: "Second Update",
    oldValue: "First Update",
    timestamp: new Date("2024-01-01T10:00:01"),
    userId: "user-1",
    operationId: "op-2",
  };

  // Compose into single operation
  const composed = operationalTransformService.compose(op1, op2);

  console.log("Composed operation:", composed);
  // Result: update from 'Original' to 'Second Update' (skips intermediate state)
}

/**
 * Example 9: Invert Operation (Undo)
 */
export function invertOperationExample() {
  const operation: Operation = {
    type: "update",
    path: ["actions", "123", "name"],
    value: "New Name",
    oldValue: "Old Name",
    timestamp: new Date(),
    userId: "user-1",
    operationId: "op-1",
  };

  // Invert for undo
  const undoOperation = operationalTransformService.invert(operation);

  console.log("Original operation:", operation);
  console.log("Undo operation:", undoOperation);

  // Apply undo
  const document = { actions: { "123": { name: "New Name" } } };
  const undone = operationalTransformService.apply(document, undoOperation);

  console.log("After undo:", undone);
  // Result: name is back to 'Old Name'
}

/**
 * Example 10: Complex Workflow Merge
 */
export async function complexWorkflowMerge() {
  const baseWorkflow = {
    id: "wf-1",
    name: "Login Flow",
    actions: [
      { id: "a1", type: "click", selector: "#login", x: 100, y: 100 },
      {
        id: "a2",
        type: "type",
        selector: "#username",
        text: "user",
        x: 200,
        y: 100,
      },
      {
        id: "a3",
        type: "type",
        selector: "#password",
        text: "pass",
        x: 300,
        y: 100,
      },
    ],
    connections: [
      { id: "c1", source: "a1", target: "a2" },
      { id: "c2", source: "a2", target: "a3" },
    ],
    settings: {
      timeout: 5000,
      retries: 3,
    },
  };

  // User A: Adds validation action and updates timeout
  const userAVersion = {
    ...baseWorkflow,
    actions: [
      ...baseWorkflow.actions,
      { id: "a4", type: "wait", selector: ".success", x: 400, y: 100 },
    ],
    connections: [
      ...baseWorkflow.connections,
      { id: "c3", source: "a3", target: "a4" },
    ],
    settings: {
      timeout: 10000, // Increased
      retries: 3,
    },
  };

  // User B: Updates action selectors and retries
  const userBVersion = {
    ...baseWorkflow,
    actions: baseWorkflow.actions.map((a) => ({
      ...a,
      selector: a.selector?.replace("#", "[data-testid=") + "]",
    })),
    connections: baseWorkflow.connections,
    settings: {
      timeout: 5000,
      retries: 5, // Increased
    },
  };

  // Merge
  const detector = conflictResolutionService.getDetector();
  const mergeResult = detector.threeWayMerge(
    userAVersion,
    userBVersion,
    baseWorkflow
  );

  console.log("Merge result:", mergeResult);
  console.log("Conflicts:", mergeResult.conflicts.length);

  if (mergeResult.success) {
    console.log("Successfully merged workflow!");
    console.log("- Has validation action from User A");
    console.log("- Has updated selectors from User B");
    console.log("- Settings: timeout=10000, retries=5");
  }
}

/**
 * Helper: Show conflict notification (mock implementation)
 */
function showConflictNotification(conflict: Conflict): void {
  console.log("🔔 Conflict Notification:");
  console.log(`Type: ${conflict.type}`);
  console.log(`Severity: ${conflict.severity}`);
  console.log(`Path: ${conflict.path.join(".")}`);

  if (conflict.autoResolvable) {
    console.log("✅ Can be auto-resolved");
  } else {
    console.log("⚠️ Requires manual resolution");
  }
}

/**
 * Example 11: Path Transformation
 */
export function pathTransformationExample() {
  const path = ["actions", "2", "name"];

  // Operation that affects the path
  const operation: Operation = {
    type: "insert",
    path: ["actions"],
    value: { id: "new", name: "New Action" },
    position: 1, // Insert before index 2
    timestamp: new Date(),
    userId: "user-1",
    operationId: "op-1",
  };

  // Transform the path
  const result = operationalTransformService.transformPath(path, operation);

  console.log("Original path:", path);
  console.log("After insert at position 1:", result.transformedPath);
  // Result: ['actions', '3', 'name'] - index shifted by 1
}

/**
 * Example 12: Branch Merging
 */
export async function branchMergingExample() {
  // Merge feature branch into main
  const sourceVersionId = "version-feature-123";
  const targetVersionId = "version-main-456";

  const mergeResult = await conflictResolutionService.mergeBranches(
    sourceVersionId,
    targetVersionId
  );

  if (mergeResult.success) {
    console.log("Branch merged successfully!");
    console.log("Merged version:", mergeResult.mergedVersion);
  } else {
    console.log(`Merge has ${mergeResult.conflicts.length} conflicts`);

    // Resolve conflicts
    for (const conflict of mergeResult.conflicts) {
      const details = await conflictResolutionService.getConflictDetails(
        conflict.id
      );
      console.log("Conflict:", details);

      // Use recommended strategy
      await conflictResolutionService.resolveConflict(
        conflict.id,
        details.recommendedStrategy
      );
    }
  }
}

/**
 * Example 13: Concurrent Action Modifications
 */
export function concurrentActionModifications() {
  const baseAction = {
    id: "action-1",
    name: "Click Login",
    type: "click",
    selector: "#login",
    x: 100,
    y: 100,
  };

  // User 1: Updates position
  const user1Action = {
    ...baseAction,
    x: 150,
    y: 150,
  };

  // User 2: Updates selector
  const user2Action = {
    ...baseAction,
    selector: '[data-testid="login"]',
  };

  const detector = conflictResolutionService.getDetector();
  const conflicts = detector.detectConflicts(
    user1Action,
    user2Action,
    baseAction
  );

  console.log("Conflicts:", conflicts.length);
  // Expected: 0 conflicts (different properties modified)

  // Three-way merge should combine both changes
  const merged = detector.threeWayMerge(user1Action, user2Action, baseAction);

  console.log("Merged action:", merged.mergedVersion);
  // Expected: { ...baseAction, x: 150, y: 150, selector: '[data-testid="login"]' }
}

/**
 * Run all examples
 */
export async function runAllExamples() {
  console.log("=== Example 1: Basic Conflict Resolution ===");
  await basicConflictResolution();

  console.log("\n=== Example 3: Three-Way Merge ===");
  threeWayMergeExample();

  console.log("\n=== Example 4: Operational Transformation ===");
  operationalTransformExample();

  console.log("\n=== Example 5: Real-time Synchronization ===");
  await realtimeSyncExample();

  console.log("\n=== Example 6: Optimistic Updates ===");
  await optimisticUpdateExample();

  console.log("\n=== Example 7: Offline Queue ===");
  await offlineQueueExample();

  console.log("\n=== Example 8: Compose Operations ===");
  composeOperationsExample();

  console.log("\n=== Example 9: Invert Operation ===");
  invertOperationExample();

  console.log("\n=== Example 10: Complex Workflow Merge ===");
  await complexWorkflowMerge();

  console.log("\n=== Example 11: Path Transformation ===");
  pathTransformationExample();

  console.log("\n=== Example 12: Branch Merging ===");
  await branchMergingExample();

  console.log("\n=== Example 13: Concurrent Action Modifications ===");
  concurrentActionModifications();
}
