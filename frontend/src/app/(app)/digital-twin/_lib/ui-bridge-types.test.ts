/**
 * `summarizeSpecGraph` counts states and transitions from the runner's graph
 * as it is actually sent: per-page `stateIds` / `transitionIds` (qontinui-runner
 * `spec_api/handlers.rs` `get_graph`). The type used to declare `states` /
 * `transitions`, and the panel summed states from the spec LIST, whose
 * projection carries none — every app read "0 states" while the local
 * runner's graph listed 544 state ids.
 */

import { describe, expect, it } from "vitest";
import { snapshotHasElementTree, summarizeSpecGraph } from "./ui-bridge-types";

describe("summarizeSpecGraph", () => {
  it("counts states and transitions from the id lists", () => {
    const out = summarizeSpecGraph({
      ok: true,
      pages: [
        {
          id: "runs",
          stateIds: ["runs-list", "runs-empty", "runs-detail"],
          transitionIds: ["open-run", "close-run"],
        },
        { id: "settings", stateIds: ["settings-general"], transitionIds: [] },
      ],
    });

    expect(out.pages).toBe(2);
    expect(out.states).toBe(4);
    expect(out.transitions).toBe(2);
    expect(out.unreadablePages).toBe(0);
    expect(out.statesByPage.get("runs")).toBe(3);
    expect(out.statesByPage.get("settings")).toBe(1);
  });

  it("counts a page with no IR document as zero, not unreadable", () => {
    // `reason: "no-ir-document"` comes with EMPTY lists — a real zero.
    const out = summarizeSpecGraph({
      ok: true,
      pages: [
        {
          id: "draft",
          stateIds: [],
          transitionIds: [],
          reason: "no-ir-document",
        },
      ],
    });

    expect(out.states).toBe(0);
    expect(out.unreadablePages).toBe(0);
    expect(out.statesByPage.get("draft")).toBe(0);
  });

  it("keeps an unreadable page out of the totals and counts it separately", () => {
    // `reason: "ir-read-failed"` carries no lists: its counts are unknown, so
    // folding it in as 0 would pass a partial total off as whole.
    const out = summarizeSpecGraph({
      ok: true,
      pages: [
        { id: "runs", stateIds: ["a", "b"], transitionIds: ["t"] },
        { id: "broken", error: "parse failed", reason: "ir-read-failed" },
      ],
    });

    expect(out.pages).toBe(2);
    expect(out.states).toBe(2);
    expect(out.transitions).toBe(1);
    expect(out.unreadablePages).toBe(1);
    expect(out.statesByPage.has("broken")).toBe(false);
  });

  it("reads an empty graph as empty", () => {
    const out = summarizeSpecGraph({
      ok: true,
      pages: [],
      reason: "no-pages-registered",
    });

    expect(out).toMatchObject({
      pages: 0,
      states: 0,
      transitions: 0,
      unreadablePages: 0,
    });
  });

  it("does not read the retired `states` / `transitions` keys", () => {
    // The wire never sent these; a page shaped that way has no id lists and
    // is therefore unreadable, not a source of counts.
    const out = summarizeSpecGraph({
      pages: [{ id: "legacy", states: [{}, {}], transitions: [{}] } as never],
    });

    expect(out.states).toBe(0);
    expect(out.unreadablePages).toBe(1);
  });
});

describe("snapshotHasElementTree", () => {
  it("is true for an SDK snapshot, empty or not", () => {
    expect(snapshotHasElementTree({ elements: [{ id: "a" }] })).toBe(true);
    // An SDK snapshot with no registered elements really has zero.
    expect(snapshotHasElementTree({ elements: [] })).toBe(true);
  });

  it("is false for the runner's native window-capture fallback", () => {
    // `ui_bridge_get_snapshot_handler` when the SDK did not answer: the empty
    // list sits beside a note that no element tree is available.
    expect(
      snapshotHasElementTree({
        source: "native_capture",
        elements: [],
        note: "SDK was not connected. This is a native window capture fallback — no element tree is available.",
      })
    ).toBe(false);
  });
});
