/**
 * Change Tracking Command Handler
 *
 * Extracted from useUIBridgeTransport.ts for testability.
 * Dispatches camelCase change tracking commands to a ChangeTracker instance.
 */

// ---------------------------------------------------------------------------
// Minimal interface describing the ChangeTracker methods used by dispatch.
// Using an interface avoids a hard import on @qontinui/ui-bridge/ai.
// ---------------------------------------------------------------------------

export interface ChangeTrackerLike {
  saveBookmark(name: string): unknown;
  getBookmark(name: string): { snapshot: unknown } | null;
  deleteBookmark(name: string): boolean;
  listBookmarks(): unknown;
  diffFromBookmark(name: string): unknown;
  executeWithDiff(request: unknown): Promise<unknown>;
  waitForChange(predicate: unknown, options?: unknown): Promise<unknown>;
  categorizeLastDiff(): { diff: unknown } | null;
  scopedDiffFromBookmark(bookmarkName: string, scope: string): unknown;
  summarizeDiff(
    diff: unknown,
    options: {
      budget: number;
      includeIds?: boolean;
      includeCategory?: boolean;
    }
  ): string;
  enableBuffer(): void;
  disableBuffer(): void;
  drainBuffer(): unknown;
  getBufferSize(): number;
  isBufferEnabled(): boolean;
}

/** Dependencies needed only for the `analyzeStructuredChanges` command. */
export interface ChangeTrackingDeps {
  createSnapshot: (...args: unknown[]) => {
    elements: {
      id: unknown;
      type: unknown;
      label: unknown;
      actions: unknown;
      state: unknown;
    }[];
  };
  createSnapshotManager: (...args: unknown[]) => {
    createSnapshot: (opts: unknown) => unknown;
  };
  analyzeStructuredChanges: (...args: unknown[]) => unknown;
}

/**
 * Dispatch a camelCase change tracking command to the ChangeTracker.
 *
 * @returns The command result (varies per action).
 * @throws On unknown action or missing required parameters.
 */
export async function handleChangeTrackingCommand(
  ct: ChangeTrackerLike,
  action: string,
  payload: Record<string, unknown>,
  deps: ChangeTrackingDeps
): Promise<unknown> {
  switch (action) {
    case "saveBookmark": {
      if (typeof payload.name !== "string") {
        throw new Error("saveBookmark requires a 'name' parameter");
      }
      return ct.saveBookmark(payload.name);
    }
    case "getBookmark": {
      if (typeof payload.name !== "string") {
        throw new Error("getBookmark requires a 'name' parameter");
      }
      const bm = ct.getBookmark(payload.name);
      if (!bm) throw new Error(`Bookmark '${payload.name}' not found`);
      return bm;
    }
    case "deleteBookmark": {
      if (typeof payload.name !== "string") {
        throw new Error("deleteBookmark requires a 'name' parameter");
      }
      return { deleted: ct.deleteBookmark(payload.name) };
    }
    case "listBookmarks":
      return ct.listBookmarks();
    case "diffFromBookmark": {
      if (typeof payload.name !== "string") {
        throw new Error("diffFromBookmark requires a 'name' parameter");
      }
      return ct.diffFromBookmark(payload.name);
    }
    case "executeWithDiff":
      return ct.executeWithDiff(payload);
    case "waitForChange": {
      const { predicate, options } = payload as {
        predicate: unknown;
        options?: unknown;
      };
      return ct.waitForChange(predicate, options);
    }
    case "categorizeLastDiff":
      return ct.categorizeLastDiff();
    case "getScopedDiff": {
      const { scope, fromBookmark } = payload as {
        scope: string;
        fromBookmark: string;
      };
      if (!fromBookmark) {
        throw new Error("getScopedDiff requires a fromBookmark parameter");
      }
      return ct.scopedDiffFromBookmark(fromBookmark, scope);
    }
    case "summarizeDiff": {
      const sdPayload = payload as {
        budget: number;
        includeIds?: boolean;
        includeCategory?: boolean;
        fromBookmark?: string;
      };
      let diff: unknown = null;
      if (sdPayload.fromBookmark) {
        diff = ct.diffFromBookmark(sdPayload.fromBookmark);
      } else {
        diff = ct.categorizeLastDiff()?.diff ?? null;
      }
      if (!diff) {
        return { summary: "No changes detected" };
      }
      const summary = ct.summarizeDiff(diff, {
        budget: sdPayload.budget,
        includeIds: sdPayload.includeIds,
        includeCategory: sdPayload.includeCategory,
      });
      return { summary };
    }
    case "analyzeStructuredChanges": {
      const { fromBookmark } = payload as { fromBookmark?: string };
      if (fromBookmark) {
        const bm = ct.getBookmark(fromBookmark);
        if (!bm) throw new Error(`Bookmark '${fromBookmark}' not found`);
        const snap = deps.createSnapshot();
        const manager = deps.createSnapshotManager({});
        const currentSemantic = manager.createSnapshot({
          timestamp: Date.now(),
          elements: snap.elements.map((e) => ({
            id: e.id,
            type: e.type,
            label: e.label,
            actions: e.actions,
            state: e.state,
          })),
          components: [],
          workflows: [],
          activeRuns: [],
        });
        return deps.analyzeStructuredChanges(bm.snapshot, currentSemantic);
      }
      return {
        hasStructuredData: false,
        tableChanges: [],
        listChanges: [],
      };
    }
    case "enableChangeBuffer":
      ct.enableBuffer();
      return { enabled: true };
    case "disableChangeBuffer":
      ct.disableBuffer();
      return { enabled: false };
    case "drainChangeBuffer":
      return ct.drainBuffer();
    case "getChangeBufferSize":
      return {
        size: ct.getBufferSize(),
        enabled: ct.isBufferEnabled(),
      };
    default:
      throw new Error(`Unknown change tracking action: ${action}`);
  }
}
