/**
 * `summarizeSpecGraph` counts states and transitions from the runner's graph
 * as it is actually sent: per-page `stateIds` / `transitionIds` (qontinui-runner
 * `spec_api/handlers.rs` `get_graph`). The type used to declare `states` /
 * `transitions`, and the panel summed states from the spec LIST, whose
 * projection carries none — every app read "0 states" while the local
 * runner's graph listed 544 state ids.
 */

import { describe, expect, it } from "vitest";
import {
  isValidAppId,
  registeredAppSuggestions,
  snapshotHasElementTree,
  summarizeSpecGraph,
} from "./ui-bridge-types";

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

/**
 * `isValidAppId` is the runner registry's own rule (qontinui-schemas
 * `validate_app_id`): an id outside it can never have been registered, and
 * most such ids cannot even cross the relay as one path segment.
 */
describe("isValidAppId", () => {
  it.each([
    "qontinui-runner",
    "qontinui-web",
    "qontinui-supervisor",
    "customer-portal-v2",
    "a",
    "0",
    "a".repeat(64),
  ])("accepts %j", (id) => {
    expect(isValidAppId(id)).toBe(true);
  });

  it.each([
    "",
    "-leading-hyphen",
    "Qontinui-Runner",
    "has_underscore",
    "a".repeat(65),
    // A `/` becomes extra path segments — encoded or not, the relay decodes
    // the path first — and the runner's allowlist refuses those with a 403.
    "qontinui/web",
    "qontinui%2Fweb",
    // Dot segments are dropped or refused by the relay's normaliser.
    ".",
    "..",
    // Characters the backend relay refuses with a 400.
    "qontinui web",
    "app@host",
    "a?b",
  ])("rejects %j", (id) => {
    expect(isValidAppId(id)).toBe(false);
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

describe("registeredAppSuggestions", () => {
  it("suggests each registered id, labelled by display name when it differs", () => {
    expect(
      registeredAppSuggestions({
        ok: true,
        apps: [
          { app_id: "qontinui-runner", display_name: "Qontinui Runner" },
          { app_id: "plain", display_name: "plain" },
          { app_id: "nameless" },
        ],
      })
    ).toEqual([
      { id: "qontinui-runner", note: "Qontinui Runner" },
      { id: "plain" },
      { id: "nameless" },
    ]);
  });

  it("is null when no apps array was read, so the caller falls back", () => {
    expect(registeredAppSuggestions(undefined)).toBeNull();
    expect(registeredAppSuggestions({ ok: true })).toBeNull();
  });

  it("is empty, not null, for an empty registry", () => {
    expect(registeredAppSuggestions({ ok: true, apps: [] })).toEqual([]);
  });

  it("drops ids the registry could never have admitted, and duplicates", () => {
    expect(
      registeredAppSuggestions({
        apps: [
          { app_id: "Bad/Id" },
          { display_name: "no id" },
          { app_id: "dup" },
          { app_id: "dup" },
        ],
      })
    ).toEqual([{ id: "dup" }]);
  });
});
