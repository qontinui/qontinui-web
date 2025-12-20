/**
 * Operational Transformation Service
 *
 * Implements Operational Transformation (OT) for concurrent editing.
 * OT allows multiple users to edit the same document simultaneously
 * while maintaining consistency.
 */

import {
  Operation,
  TransformResult,
  ComposedOperation,
  InvertedOperation,
  PathTransformResult,
} from "../../types/collaboration/conflict-types";

/**
 * Operational Transformation Service
 */
export class OperationalTransformService {
  /**
   * Transform two operations against each other
   *
   * Given operations op1 and op2 that happened concurrently,
   * returns transformed operations op1' and op2' such that:
   * apply(apply(doc, op1), op2') = apply(apply(doc, op2), op1')
   */
  transform(op1: Operation, op2: Operation): [Operation, Operation] {
    // If operations don't conflict, return them as-is
    if (!this.operationsConflict(op1, op2)) {
      return [op1, op2];
    }

    // Transform based on operation types
    const result = this.transformByType(op1, op2);

    return [result.op1Prime, result.op2Prime];
  }

  /**
   * Check if two operations conflict
   */
  private operationsConflict(op1: Operation, op2: Operation): boolean {
    // Operations conflict if they affect the same path or related paths
    return this.pathsConflict(op1.path, op2.path);
  }

  /**
   * Check if two paths conflict
   */
  private pathsConflict(path1: string[], path2: string[]): boolean {
    // Paths conflict if one is a prefix of the other
    const minLength = Math.min(path1.length, path2.length);

    for (let i = 0; i < minLength; i++) {
      if (path1[i] !== path2[i]) {
        return false;
      }
    }

    return true;
  }

  /**
   * Transform operations based on their types
   */
  private transformByType(op1: Operation, op2: Operation): TransformResult {
    const typeKey = `${op1.type}-${op2.type}`;

    switch (typeKey) {
      // Insert vs Insert
      case "insert-insert":
        return this.transformInsertInsert(op1, op2);

      // Insert vs Delete
      case "insert-delete":
        return this.transformInsertDelete(op1, op2);
      case "delete-insert":
        return this.transformDeleteInsert(op1, op2);

      // Insert vs Update
      case "insert-update":
        return this.transformInsertUpdate(op1, op2);
      case "update-insert":
        return this.transformUpdateInsert(op1, op2);

      // Delete vs Delete
      case "delete-delete":
        return this.transformDeleteDelete(op1, op2);

      // Delete vs Update
      case "delete-update":
        return this.transformDeleteUpdate(op1, op2);
      case "update-delete":
        return this.transformUpdateDelete(op1, op2);

      // Update vs Update
      case "update-update":
        return this.transformUpdateUpdate(op1, op2);

      // Move operations
      case "move-move":
        return this.transformMoveMove(op1, op2);
      case "move-delete":
        return this.transformMoveDelete(op1, op2);
      case "delete-move":
        return this.transformDeleteMove(op1, op2);

      // Connect/Disconnect operations
      case "connect-disconnect":
        return this.transformConnectDisconnect(op1, op2);
      case "disconnect-connect":
        return this.transformDisconnectConnect(op1, op2);
      case "connect-connect":
        return this.transformConnectConnect(op1, op2);
      case "disconnect-disconnect":
        return this.transformDisconnectDisconnect(op1, op2);

      // Default: no transformation needed
      default:
        return {
          op1Prime: op1,
          op2Prime: op2,
          success: true,
        };
    }
  }

  /**
   * Transform: Insert vs Insert
   */
  private transformInsertInsert(
    op1: Operation,
    op2: Operation
  ): TransformResult {
    const pos1 = op1.position ?? 0;
    const pos2 = op2.position ?? 0;

    if (pos1 < pos2) {
      return {
        op1Prime: op1,
        op2Prime: { ...op2, position: pos2 + 1 },
        success: true,
      };
    } else if (pos1 > pos2) {
      return {
        op1Prime: { ...op1, position: pos1 + 1 },
        op2Prime: op2,
        success: true,
      };
    } else {
      // Same position - use timestamp to break tie
      if (op1.timestamp < op2.timestamp) {
        return {
          op1Prime: op1,
          op2Prime: { ...op2, position: pos2 + 1 },
          success: true,
        };
      } else {
        return {
          op1Prime: { ...op1, position: pos1 + 1 },
          op2Prime: op2,
          success: true,
        };
      }
    }
  }

  /**
   * Transform: Insert vs Delete
   */
  private transformInsertDelete(
    op1: Operation,
    op2: Operation
  ): TransformResult {
    const pos1 = op1.position ?? 0;
    const pos2 = op2.position ?? 0;

    if (pos1 <= pos2) {
      return {
        op1Prime: op1,
        op2Prime: { ...op2, position: pos2 + 1 },
        success: true,
      };
    } else {
      return {
        op1Prime: { ...op1, position: pos1 - 1 },
        op2Prime: op2,
        success: true,
      };
    }
  }

  /**
   * Transform: Delete vs Insert
   */
  private transformDeleteInsert(
    op1: Operation,
    op2: Operation
  ): TransformResult {
    const result = this.transformInsertDelete(op2, op1);
    return {
      op1Prime: result.op2Prime,
      op2Prime: result.op1Prime,
      success: result.success,
    };
  }

  /**
   * Transform: Insert vs Update
   */
  private transformInsertUpdate(
    op1: Operation,
    op2: Operation
  ): TransformResult {
    // Insert doesn't affect update if paths are different
    if (!this.pathsConflict(op1.path, op2.path)) {
      return {
        op1Prime: op1,
        op2Prime: op2,
        success: true,
      };
    }

    // If insert is in the update's path, adjust the path
    const transformedPath = this.adjustPathForInsert(
      op2.path,
      op1.path,
      op1.position ?? 0
    );

    return {
      op1Prime: op1,
      op2Prime: { ...op2, path: transformedPath },
      success: true,
    };
  }

  /**
   * Transform: Update vs Insert
   */
  private transformUpdateInsert(
    op1: Operation,
    op2: Operation
  ): TransformResult {
    const result = this.transformInsertUpdate(op2, op1);
    return {
      op1Prime: result.op2Prime,
      op2Prime: result.op1Prime,
      success: result.success,
    };
  }

  /**
   * Transform: Delete vs Delete
   */
  private transformDeleteDelete(
    op1: Operation,
    op2: Operation
  ): TransformResult {
    const pos1 = op1.position ?? 0;
    const pos2 = op2.position ?? 0;

    if (pos1 === pos2) {
      // Both delete the same item - make one a no-op
      return {
        op1Prime: { ...op1, type: "update", value: null },
        op2Prime: { ...op2, type: "update", value: null },
        success: true,
        warnings: ["Both operations deleted the same item"],
      };
    } else if (pos1 < pos2) {
      return {
        op1Prime: op1,
        op2Prime: { ...op2, position: pos2 - 1 },
        success: true,
      };
    } else {
      return {
        op1Prime: { ...op1, position: pos1 - 1 },
        op2Prime: op2,
        success: true,
      };
    }
  }

  /**
   * Transform: Delete vs Update
   */
  private transformDeleteUpdate(
    op1: Operation,
    op2: Operation
  ): TransformResult {
    // If delete removes the item being updated, update becomes no-op
    if (this.pathsEqual(op1.path, op2.path)) {
      return {
        op1Prime: op1,
        op2Prime: { ...op2, type: "update", value: null },
        success: true,
        warnings: ["Update target was deleted"],
      };
    }

    return {
      op1Prime: op1,
      op2Prime: op2,
      success: true,
    };
  }

  /**
   * Transform: Update vs Delete
   */
  private transformUpdateDelete(
    op1: Operation,
    op2: Operation
  ): TransformResult {
    const result = this.transformDeleteUpdate(op2, op1);
    return {
      op1Prime: result.op2Prime,
      op2Prime: result.op1Prime,
      success: result.success,
      warnings: result.warnings,
    };
  }

  /**
   * Transform: Update vs Update
   */
  private transformUpdateUpdate(
    op1: Operation,
    op2: Operation
  ): TransformResult {
    // If updating the same path, use timestamp to decide
    if (this.pathsEqual(op1.path, op2.path)) {
      if (op1.timestamp < op2.timestamp) {
        return {
          op1Prime: op1,
          op2Prime: { ...op2, oldValue: op1.value },
          success: true,
          warnings: [
            "Concurrent updates to same field - using timestamp ordering",
          ],
        };
      } else {
        return {
          op1Prime: { ...op1, oldValue: op2.value },
          op2Prime: op2,
          success: true,
          warnings: [
            "Concurrent updates to same field - using timestamp ordering",
          ],
        };
      }
    }

    // Different paths - no conflict
    return {
      op1Prime: op1,
      op2Prime: op2,
      success: true,
    };
  }

  /**
   * Transform: Move vs Move
   */
  private transformMoveMove(op1: Operation, op2: Operation): TransformResult {
    const from1 = op1.position ?? 0;
    const to1 = op1.newPosition ?? 0;
    const from2 = op2.position ?? 0;
    const to2 = op2.newPosition ?? 0;

    // Complex transformation for concurrent moves
    let newFrom1 = from1;
    let newTo1 = to1;
    let newFrom2 = from2;
    let newTo2 = to2;

    // Adjust positions based on the other move
    if (from2 <= from1 && to2 > from1) newFrom1--;
    if (from2 < from1 && to2 <= from1) newFrom1--;
    if (from2 <= to1 && to2 > to1) newTo1--;
    if (from2 < to1 && to2 <= to1) newTo1--;

    if (from1 <= from2 && to1 > from2) newFrom2--;
    if (from1 < from2 && to1 <= from2) newFrom2--;
    if (from1 <= to2 && to1 > to2) newTo2--;
    if (from1 < to2 && to1 <= to2) newTo2--;

    return {
      op1Prime: { ...op1, position: newFrom1, newPosition: newTo1 },
      op2Prime: { ...op2, position: newFrom2, newPosition: newTo2 },
      success: true,
    };
  }

  /**
   * Transform: Move vs Delete
   */
  private transformMoveDelete(op1: Operation, op2: Operation): TransformResult {
    const moveFrom = op1.position ?? 0;
    const moveTo = op1.newPosition ?? 0;
    const deletePos = op2.position ?? 0;

    if (deletePos === moveFrom) {
      // Deleted item is being moved - delete wins
      return {
        op1Prime: { ...op1, type: "update", value: null },
        op2Prime: op2,
        success: true,
        warnings: ["Move source was deleted"],
      };
    }

    // Adjust move positions based on delete
    let newFrom = moveFrom;
    let newTo = moveTo;

    if (deletePos < moveFrom) newFrom--;
    if (deletePos < moveTo) newTo--;

    return {
      op1Prime: { ...op1, position: newFrom, newPosition: newTo },
      op2Prime: op2,
      success: true,
    };
  }

  /**
   * Transform: Delete vs Move
   */
  private transformDeleteMove(op1: Operation, op2: Operation): TransformResult {
    const result = this.transformMoveDelete(op2, op1);
    return {
      op1Prime: result.op2Prime,
      op2Prime: result.op1Prime,
      success: result.success,
      warnings: result.warnings,
    };
  }

  /**
   * Transform: Connect vs Disconnect
   */
  private transformConnectDisconnect(
    op1: Operation,
    op2: Operation
  ): TransformResult {
    // If connecting and disconnecting the same connection
    if (op1.sourceId === op2.sourceId && op1.targetId === op2.targetId) {
      // Use timestamp to decide
      if (op1.timestamp < op2.timestamp) {
        return {
          op1Prime: op1,
          op2Prime: op2,
          success: true,
          warnings: [
            "Concurrent connect/disconnect - using timestamp ordering",
          ],
        };
      } else {
        return {
          op1Prime: { ...op1, type: "update", value: null },
          op2Prime: op2,
          success: true,
          warnings: ["Connection was disconnected before connect completed"],
        };
      }
    }

    return {
      op1Prime: op1,
      op2Prime: op2,
      success: true,
    };
  }

  /**
   * Transform: Disconnect vs Connect
   */
  private transformDisconnectConnect(
    op1: Operation,
    op2: Operation
  ): TransformResult {
    const result = this.transformConnectDisconnect(op2, op1);
    return {
      op1Prime: result.op2Prime,
      op2Prime: result.op1Prime,
      success: result.success,
      warnings: result.warnings,
    };
  }

  /**
   * Transform: Connect vs Connect
   */
  private transformConnectConnect(
    op1: Operation,
    op2: Operation
  ): TransformResult {
    // If creating the same connection
    if (op1.sourceId === op2.sourceId && op1.targetId === op2.targetId) {
      // Make one a no-op
      return {
        op1Prime: op1,
        op2Prime: { ...op2, type: "update", value: null },
        success: true,
        warnings: ["Duplicate connection attempt"],
      };
    }

    return {
      op1Prime: op1,
      op2Prime: op2,
      success: true,
    };
  }

  /**
   * Transform: Disconnect vs Disconnect
   */
  private transformDisconnectDisconnect(
    op1: Operation,
    op2: Operation
  ): TransformResult {
    // If disconnecting the same connection
    if (op1.sourceId === op2.sourceId && op1.targetId === op2.targetId) {
      // Make one a no-op
      return {
        op1Prime: op1,
        op2Prime: { ...op2, type: "update", value: null },
        success: true,
        warnings: ["Duplicate disconnect attempt"],
      };
    }

    return {
      op1Prime: op1,
      op2Prime: op2,
      success: true,
    };
  }

  /**
   * Compose two operations into a single operation
   */
  compose(op1: Operation, op2: Operation): ComposedOperation {
    // Only compose operations on the same path
    if (!this.pathsEqual(op1.path, op2.path)) {
      throw new Error("Cannot compose operations on different paths");
    }

    // Compose based on operation types
    const typeKey = `${op1.type}-${op2.type}`;

    switch (typeKey) {
      case "insert-delete":
        // Insert then delete = no-op
        return {
          ...op1,
          type: "update",
          value: null,
          composedFrom: [op1, op2],
        };

      case "update-update":
        // Chain updates
        return {
          ...op1,
          value: op2.value,
          composedFrom: [op1, op2],
        };

      case "delete-insert":
        // Delete then insert = update
        return {
          ...op1,
          type: "update",
          value: op2.value,
          composedFrom: [op1, op2],
        };

      default:
        // For other combinations, return the second operation
        return {
          ...op2,
          composedFrom: [op1, op2],
        };
    }
  }

  /**
   * Invert an operation (for undo)
   */
  invert(op: Operation): InvertedOperation {
    switch (op.type) {
      case "insert":
        return {
          ...op,
          type: "delete",
          value: op.oldValue,
          oldValue: op.value,
          invertedFrom: op,
        };

      case "delete":
        return {
          ...op,
          type: "insert",
          value: op.oldValue,
          oldValue: op.value,
          invertedFrom: op,
        };

      case "update":
        return {
          ...op,
          value: op.oldValue,
          oldValue: op.value,
          invertedFrom: op,
        };

      case "move":
        return {
          ...op,
          position: op.newPosition,
          newPosition: op.position,
          invertedFrom: op,
        };

      case "connect":
        return {
          ...op,
          type: "disconnect",
          invertedFrom: op,
        };

      case "disconnect":
        return {
          ...op,
          type: "connect",
          invertedFrom: op,
        };

      default:
        throw new Error(`Cannot invert operation of type: ${op.type}`);
    }
  }

  /**
   * Apply an operation to a document
   */
  apply(doc: unknown, op: Operation): unknown {
    const result = JSON.parse(JSON.stringify(doc)); // Deep clone

    switch (op.type) {
      case "insert":
        this.applyInsert(result, op);
        break;

      case "delete":
        this.applyDelete(result, op);
        break;

      case "update":
        this.applyUpdate(result, op);
        break;

      case "move":
        this.applyMove(result, op);
        break;

      case "connect":
        this.applyConnect(result, op);
        break;

      case "disconnect":
        this.applyDisconnect(result, op);
        break;
    }

    return result;
  }

  /**
   * Apply insert operation
   */
  private applyInsert(doc: unknown, op: Operation): void {
    const parent = this.navigateToPath(doc, op.path.slice(0, -1)) as Record<
      string,
      unknown
    >;
    const key = op.path[op.path.length - 1];

    if (key !== undefined) {
      if (Array.isArray(parent[key])) {
        (parent[key] as unknown[]).splice(op.position ?? 0, 0, op.value);
      } else {
        parent[key] = op.value;
      }
    }
  }

  /**
   * Apply delete operation
   */
  private applyDelete(doc: unknown, op: Operation): void {
    const parent = this.navigateToPath(doc, op.path.slice(0, -1)) as Record<
      string,
      unknown
    >;
    const key = op.path[op.path.length - 1];

    if (key !== undefined) {
      if (Array.isArray(parent[key])) {
        (parent[key] as unknown[]).splice(op.position ?? 0, 1);
      } else {
        delete parent[key];
      }
    }
  }

  /**
   * Apply update operation
   */
  private applyUpdate(doc: unknown, op: Operation): void {
    const parent = this.navigateToPath(doc, op.path.slice(0, -1)) as Record<
      string,
      unknown
    >;
    const key = op.path[op.path.length - 1];
    if (key !== undefined) {
      parent[key] = op.value;
    }
  }

  /**
   * Apply move operation
   */
  private applyMove(doc: unknown, op: Operation): void {
    const parent = this.navigateToPath(doc, op.path.slice(0, -1)) as Record<
      string,
      unknown
    >;
    const key = op.path[op.path.length - 1];

    if (key !== undefined && Array.isArray(parent[key])) {
      const item = (parent[key] as unknown[]).splice(op.position ?? 0, 1)[0];
      (parent[key] as unknown[]).splice(op.newPosition ?? 0, 0, item);
    }
  }

  /**
   * Apply connect operation
   */
  private applyConnect(doc: unknown, op: Operation): void {
    const docWithConnections = doc as {
      connections?: Array<{ id: string; source?: string; target?: string }>;
    };
    if (!docWithConnections.connections) {
      docWithConnections.connections = [];
    }

    docWithConnections.connections.push({
      id: op.operationId,
      source: op.sourceId,
      target: op.targetId,
      ...(op.value as Record<string, unknown>),
    });
  }

  /**
   * Apply disconnect operation
   */
  private applyDisconnect(doc: unknown, op: Operation): void {
    const docWithConnections = doc as {
      connections?: Array<{ source?: string; target?: string }>;
    };
    if (!docWithConnections.connections) return;

    docWithConnections.connections = docWithConnections.connections.filter(
      (conn) => !(conn.source === op.sourceId && conn.target === op.targetId)
    );
  }

  /**
   * Navigate to a path in the document
   */
  private navigateToPath(
    doc: unknown,
    path: string[]
  ): Record<string, unknown> {
    let current = doc as Record<string, unknown>;

    for (const segment of path) {
      if (!current[segment]) {
        current[segment] = {};
      }
      current = current[segment] as Record<string, unknown>;
    }

    return current;
  }

  /**
   * Transform a path against an operation
   */
  transformPath(path: string[], op: Operation): PathTransformResult {
    // If operation doesn't affect the path, return as-is
    if (!this.pathsConflict(path, op.path)) {
      return {
        transformedPath: path,
        exists: true,
      };
    }

    // If operation deletes the path or a parent
    if (op.type === "delete" && this.pathIsChildOf(path, op.path)) {
      return {
        transformedPath: path,
        exists: false,
        reason: "Path was deleted",
      };
    }

    // If operation inserts before this path
    if (op.type === "insert") {
      return {
        transformedPath: this.adjustPathForInsert(
          path,
          op.path,
          op.position ?? 0
        ),
        exists: true,
      };
    }

    // Default: path unchanged
    return {
      transformedPath: path,
      exists: true,
    };
  }

  /**
   * Check if path1 is a child of path2
   */
  private pathIsChildOf(path1: string[], path2: string[]): boolean {
    if (path1.length <= path2.length) return false;

    for (let i = 0; i < path2.length; i++) {
      if (path1[i] !== path2[i]) return false;
    }

    return true;
  }

  /**
   * Adjust path for an insert operation
   */
  private adjustPathForInsert(
    path: string[],
    insertPath: string[],
    position: number
  ): string[] {
    if (!this.pathsConflict(path, insertPath)) {
      return path;
    }

    // If insert is at a parent level, adjust the corresponding segment
    const commonLength = Math.min(path.length, insertPath.length);

    for (let i = 0; i < commonLength; i++) {
      const pathSegment = path[i];
      const insertSegment = insertPath[i];
      if (pathSegment !== insertSegment) {
        if (!pathSegment) break;
        const pathIndex = parseInt(pathSegment, 10);
        if (!isNaN(pathIndex) && pathIndex >= position) {
          const newPath = [...path];
          newPath[i] = String(pathIndex + 1);
          return newPath;
        }
        break;
      }
    }

    return path;
  }

  /**
   * Check if two paths are equal
   */
  private pathsEqual(path1: string[], path2: string[]): boolean {
    if (path1.length !== path2.length) return false;

    for (let i = 0; i < path1.length; i++) {
      if (path1[i] !== path2[i]) return false;
    }

    return true;
  }
}

// Export singleton instance
export const operationalTransformService = new OperationalTransformService();
