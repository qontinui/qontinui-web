import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import {
  ACTION_ITEM_ATTENTION_BY_KIND,
  ACTION_ITEM_STATUS_PALETTE,
  deriveActionItemStatus,
  deriveActionItemsHealth,
  isMigrationPending,
  presentLink,
  pushLabel,
  sourceChip,
  type ActionItemsResponse,
  type CoordActionItem,
} from "./actionItemStatus";

function item(over: Partial<CoordActionItem> = {}): CoordActionItem {
  return {
    item_id: "11111111-2222-3333-4444-555555555555",
    title: "Route High and Medium plans to Opus",
    body: "web#1780 is deployed.",
    links: [],
    status: "open",
    source_kind: "gate",
    source_ref: {},
    created_by: "gate:abc",
    created_at: "2026-10-13T10:00:00Z",
    updated_at: "2026-10-13T10:00:00Z",
    resolved_at: null,
    resolved_by: null,
    resolution_note: null,
    push: {
      state: "accepted",
      attempts: 1,
      last_attempt_at: null,
      next_attempt_at: null,
      detail: {},
    },
    ...over,
  };
}

const push = (state: string) => ({
  state,
  attempts: 0,
  last_attempt_at: null,
  next_attempt_at: null,
  detail: {},
});

describe("actionItemStatus palette", () => {
  it("agrees with its attention table (R3)", () => {
    expect(
      paletteDisagreements(
        ACTION_ITEM_ATTENTION_BY_KIND,
        ACTION_ITEM_STATUS_PALETTE
      )
    ).toEqual([]);
  });
});

describe("deriveActionItemStatus", () => {
  it.each(["failed", "undeliverable", "no_recipients", "no_devices"])(
    "an open item whose push is %s is red",
    (state) => {
      const s = deriveActionItemStatus(item({ push: push(state) }));
      expect(s.kind).toBe("open_undelivered");
      expect(s.attention).toBe("author");
    }
  );

  it.each(["pending", "accepted", "something_new"])(
    "an open item whose push is %s is amber",
    (state) => {
      const s = deriveActionItemStatus(item({ push: push(state) }));
      expect(s.kind).toBe("open");
      expect(s.attention).toBe("waiting");
    }
  );

  it("a resolved item is calm even when its push failed", () => {
    for (const status of ["done", "dismissed"]) {
      const s = deriveActionItemStatus(item({ status, push: push("failed") }));
      expect(s.kind).toBe(status);
      expect(s.attention).toBe("none");
    }
  });

  it("an unrecognised status floors at amber, shown verbatim", () => {
    const s = deriveActionItemStatus(item({ status: "snoozed" }));
    expect(s.kind).toBe("unknown");
    expect(s.attention).toBe("waiting");
    expect(s.label).toBe("snoozed");
  });
});

describe("presentLink", () => {
  it("links https, shows app routes as text, never links other schemes", () => {
    expect(presentLink("https://qontinui.io/x")).toEqual({
      kind: "web",
      href: "https://qontinui.io/x",
    });
    expect(presentLink("qontinui://coord/actions/1")).toEqual({
      kind: "app",
      route: "qontinui://coord/actions/1",
    });
    expect(presentLink("javascript:alert(1)")).toEqual({ kind: "text" });
    expect(presentLink("http://insecure.example")).toEqual({ kind: "text" });
  });
});

describe("labels", () => {
  it("names push states in words and flags unknown ones", () => {
    expect(pushLabel("accepted")).toBe("pushed to your phone");
    expect(pushLabel("new_state")).toContain("not recognised");
    expect(pushLabel(null)).toBe("push state unknown");
    expect(sourceChip("work_unit")).toBe("work unit");
  });
});

describe("isMigrationPending", () => {
  it("reads the anchored status, not the body", () => {
    expect(
      isMigrationPending(
        new Error(
          'GET /api/v1/operations/action-items failed: 503 - {"error":"schema_migration_pending"}'
        )
      )
    ).toBe(true);
    expect(
      isMigrationPending(
        new Error(
          "GET /api/v1/operations/action-items failed: 500 - failed: 503"
        )
      )
    ).toBe(false);
    expect(isMigrationPending(new TypeError("Failed to fetch"))).toBe(false);
  });
});

describe("deriveActionItemsHealth", () => {
  const counts = { open: 2, done: 5, dismissed: 1 };
  const response = (items: CoordActionItem[], next: string | null = null) =>
    ({ items, next_cursor: next, counts }) as ActionItemsResponse;

  it("is amber and unknown before the first read", () => {
    const h = deriveActionItemsHealth({
      loaded: false,
      migrationPending: false,
      readFailed: false,
      tab: "open",
      response: null,
      counts: null,
    });
    expect(h.level).toBe("amber");
    expect(h.undelivered).toBeNull();
  });

  it("says not-available-yet on migration pending, never nothing owed", () => {
    const h = deriveActionItemsHealth({
      loaded: false,
      migrationPending: true,
      readFailed: false,
      tab: "open",
      response: null,
      counts: null,
    });
    expect(h.level).toBe("amber");
    expect(h.headline).toMatch(/not available/);
  });

  it("is red when an open item did not reach the phone", () => {
    const h = deriveActionItemsHealth({
      loaded: true,
      migrationPending: false,
      readFailed: false,
      tab: "open",
      response: response([item({ push: push("no_devices") }), item()], "c1"),
      counts,
    });
    expect(h.level).toBe("red");
    expect(h.undelivered).toBe(1);
    expect(h.undeliveredIsFloor).toBe(true);
    expect(h.headline).toContain("1+");
  });

  it("is amber when items are owed and all were delivered", () => {
    const h = deriveActionItemsHealth({
      loaded: true,
      migrationPending: false,
      readFailed: false,
      tab: "open",
      response: response([item(), item()]),
      counts,
    });
    expect(h.level).toBe("amber");
    expect(h.undelivered).toBe(0);
  });

  it("does not claim zero push problems off another tab", () => {
    const h = deriveActionItemsHealth({
      loaded: true,
      migrationPending: false,
      readFailed: false,
      tab: "done",
      response: response([]),
      counts,
    });
    expect(h.undelivered).toBeNull();
  });

  it("is green when nothing is owed", () => {
    const h = deriveActionItemsHealth({
      loaded: true,
      migrationPending: false,
      readFailed: false,
      tab: "open",
      response: response([]),
      counts: { open: 0, done: 3, dismissed: 0 },
    });
    expect(h.level).toBe("green");
  });
});
