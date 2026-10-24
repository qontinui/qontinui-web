/**
 * Live-store parity for the split canvas store.
 *
 * The split slices replaced the monolithic `stores/canvas-store.ts`, whose
 * semantics they must reproduce exactly. Each test here pins one behaviour the
 * first cut of the split had lost:
 *
 * - `updateAction` deep-merges `config` (the property panel sends only the
 *   keys it changed).
 * - Every walk over `workflow.connections[sourceId]` touches only the four
 *   connection-type keys (main / error / success / parallel), and only when
 *   the value is an array.
 * - `deleteConnection` marks the workflow dirty once the source and output
 *   array exist, even when the output index is absent.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "./index";
import type { Workflow } from "./types";

function workflowFixture(): Workflow {
  return {
    id: "wf",
    name: "parity",
    version: "1",
    format: "graph",
    actions: [
      { id: "a", type: "CLICK", config: { x: 1, y: 2 }, position: [0, 0] },
      { id: "b", type: "TYPE", config: { text: "s" }, position: [10, 10] },
      { id: "c", type: "TYPE", config: {}, position: [20, 20] },
    ],
    connections: {
      a: {
        main: [[{ action: "b", type: "main", index: 0 }]],
      },
      b: {
        main: [[{ action: "c", type: "main", index: 0 }]],
      },
    },
  } as unknown as Workflow;
}

/** Inject connection keys a typed fixture cannot express. */
function rawConnections(sourceId: string): Record<string, unknown> {
  return useCanvasStore.getState().workflow!.connections[sourceId] as Record<
    string,
    unknown
  >;
}

function loadWorkflow(
  mutate?: (connections: Record<string, Record<string, unknown>>) => void
) {
  const wf = workflowFixture();
  mutate?.(
    wf.connections as unknown as Record<string, Record<string, unknown>>
  );
  useCanvasStore.setState({
    clipboardNodes: [],
    clipboardConnections: {},
    selectedNodes: [],
    selectedEdges: [],
  });
  useCanvasStore.getState().setWorkflow(wf);
}

describe("canvas store live parity", () => {
  beforeEach(() => {
    useCanvasStore.getState().clearWorkflow();
  });

  describe("updateAction", () => {
    it("deep-merges a partial config, keeping untouched config keys", () => {
      loadWorkflow();
      useCanvasStore
        .getState()
        .updateAction("a", { config: { x: 9 } } as never);

      const action = useCanvasStore.getState().getActionById("a");
      expect(action?.config).toEqual({ x: 9, y: 2 });
    });
  });

  describe("addConnection", () => {
    it("is a no-op for an invalid connection type (only the source entry is initialised)", () => {
      loadWorkflow();
      useCanvasStore.getState().addConnection("c", "bogus" as never, 0, "a", 0);

      const state = useCanvasStore.getState();
      expect(state.workflow!.connections.c).toEqual({});
      expect(state.isDirty).toBe(false);
    });

    it("leaves a non-array value under a valid type untouched and does not dirty", () => {
      loadWorkflow((c) => {
        c.b!.success = { notArray: true };
      });
      useCanvasStore.getState().addConnection("b", "success", 0, "a", 0);

      expect(rawConnections("b").success).toEqual({ notArray: true });
      expect(useCanvasStore.getState().isDirty).toBe(false);
    });
  });

  describe("deleteAction / deleteActions connection cleanup", () => {
    const withOddKeys = (c: Record<string, Record<string, unknown>>) => {
      c.a!.custom = [[{ action: "b", type: "main", index: 0 }]];
      c.a!.weird = { x: 1 };
      c.b!.success = { notArray: true };
    };

    it("deleteAction does not throw on non-array / invalid keys and leaves them untouched", () => {
      loadWorkflow(withOddKeys);
      expect(() => useCanvasStore.getState().deleteAction("b")).not.toThrow();

      const a = rawConnections("a");
      expect(a.main).toEqual([[]]);
      expect(a.custom).toEqual([[{ action: "b", type: "main", index: 0 }]]);
      expect(a.weird).toEqual({ x: 1 });
      expect(Object.keys(a).sort()).toEqual(["custom", "main", "weird"]);
    });

    it("deleteActions does not throw on non-array / invalid keys and leaves them untouched", () => {
      loadWorkflow(withOddKeys);
      expect(() =>
        useCanvasStore.getState().deleteActions(["c"])
      ).not.toThrow();

      const a = rawConnections("a");
      expect(a.custom).toEqual([[{ action: "b", type: "main", index: 0 }]]);
      expect(a.weird).toEqual({ x: 1 });
      expect(rawConnections("b").main).toEqual([[]]);
    });
  });

  describe("deleteConnection", () => {
    it("ignores an invalid connection type, even when that key holds an array", () => {
      loadWorkflow((c) => {
        c.a!.custom = [[{ action: "b", type: "main", index: 0 }]];
      });
      useCanvasStore.getState().deleteConnection("a", "custom", 0, "b");

      expect(rawConnections("a").custom).toEqual([
        [{ action: "b", type: "main", index: 0 }],
      ]);
      expect(useCanvasStore.getState().isDirty).toBe(false);
    });

    it("marks the workflow dirty when the output index is absent", () => {
      loadWorkflow();
      useCanvasStore.getState().deleteConnection("a", "main", 5, "b");

      expect(useCanvasStore.getState().isDirty).toBe(true);
      expect(rawConnections("a").main).toEqual([
        [{ action: "b", type: "main", index: 0 }],
      ]);
    });
  });

  describe("clipboard", () => {
    it("copy carries only valid-type array connections", () => {
      loadWorkflow((c) => {
        c.a!.custom = [[{ action: "b", type: "main", index: 0 }]];
        c.a!.weird = { x: 1 };
      });
      const store = useCanvasStore.getState();
      store.selectNodes(["a", "b"]);
      expect(() => useCanvasStore.getState().copy()).not.toThrow();

      const copied = useCanvasStore.getState().clipboardConnections.a as Record<
        string,
        unknown
      >;
      expect(Object.keys(copied)).toEqual(["main"]);
    });

    it("paste merges only valid-type array connections", () => {
      loadWorkflow();
      const a = useCanvasStore.getState().getActionById("a")!;
      useCanvasStore.setState({
        clipboardNodes: [a],
        clipboardConnections: {
          a: {
            main: [[]],
            custom: [[{ action: "a", type: "main", index: 0 }]],
          },
        } as never,
      });
      useCanvasStore.getState().paste();

      const pastedId = useCanvasStore.getState().selectedNodes[0]!;
      expect(pastedId).not.toBe("a");
      expect(Object.keys(rawConnections(pastedId))).toEqual(["main"]);
    });
  });
});
