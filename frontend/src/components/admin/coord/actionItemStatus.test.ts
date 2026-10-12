import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import {
  ACTION_ITEM_ATTENTION_BY_KIND,
  ACTION_ITEM_STATUS_PALETTE,
  coordErrorCode,
  deriveActionItemStatus,
  deriveActionItemsHealth,
  isMigrationPending,
  presentLink,
  pushLabel,
  resolvedSentence,
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
  it.each([
    "pending",
    "accepted",
    "failed",
    "undeliverable",
    "no_recipients",
    "no_devices",
    "something_new",
  ])(
    "an open item is red (the operator's move) when its push is %s",
    (state) => {
      const s = deriveActionItemStatus(item({ push: push(state) }));
      expect(s.kind).toBe("open");
      expect(s.attention).toBe("author");
    }
  );

  it("names an undelivered push in the label, not the colour", () => {
    expect(
      deriveActionItemStatus(item({ push: push("no_devices") })).label
    ).toBe("Owed — not on your phone");
    expect(deriveActionItemStatus(item()).label).toBe("Owed");
  });

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

describe("resolvedSentence", () => {
  it("says the status verbatim when it is not recognised", () => {
    expect(resolvedSentence(item({ status: "snoozed" }))).toContain(
      'Status "snoozed"'
    );
    expect(
      resolvedSentence(
        item({
          status: "dismissed",
          resolved_by: "operator:x",
          resolution_note: "n/a",
        })
      )
    ).toBe("Dismissed by operator:x — n/a");
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
  const err = (status: number, body: string) =>
    new Error(
      `GET /api/v1/operations/action-items failed: ${status} - ${body}`
    );

  it("needs a 503 AND coord's schema_migration_pending code", () => {
    // The web envelope with coord's code forwarded at the top level.
    expect(
      isMigrationPending(
        err(503, '{"error":"schema_migration_pending","message":"x"}')
      )
    ).toBe(true);
    // Coord's JSON carried as text inside the envelope's message.
    expect(
      isMigrationPending(
        err(
          503,
          '{"error":"SERVICE_UNAVAILABLE","message":"{\\"error\\":\\"schema_migration_pending\\"}"}'
        )
      )
    ).toBe(true);
  });

  it("any other 503 is a read failure, not migration pending", () => {
    expect(isMigrationPending(err(503, '{"error":"deadline"}'))).toBe(false);
    expect(isMigrationPending(err(503, "upstream down"))).toBe(false);
    expect(
      isMigrationPending(err(500, '{"error":"schema_migration_pending"}'))
    ).toBe(false);
    expect(isMigrationPending(new TypeError("Failed to fetch"))).toBe(false);
  });

  it("reads coord's code as data", () => {
    expect(coordErrorCode(err(409, '{"error":"already_resolved"}'))).toBe(
      "already_resolved"
    );
    expect(coordErrorCode(new TypeError("x"))).toBeNull();
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

  it("is red when items are owed, and counts undelivered pushes separately", () => {
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
    expect(h.headline).toBe("2 action items owed by you");
    expect(h.detail).toContain("1+ did not reach your phone");
  });

  it("is still red when items are owed and every push landed", () => {
    const h = deriveActionItemsHealth({
      loaded: true,
      migrationPending: false,
      readFailed: false,
      tab: "open",
      response: response([item(), item()]),
      counts,
    });
    expect(h.level).toBe("red");
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

  it("a failed read after a success is amber and says it shows the last answer", () => {
    const h = deriveActionItemsHealth({
      loaded: true,
      migrationPending: false,
      readFailed: true,
      tab: "open",
      response: response([item({ push: push("failed") })]),
      counts,
    });
    expect(h.level).toBe("amber");
    expect(h.headline).toBe(
      "Could not read action items — showing the last answer"
    );
    expect(h.undelivered).toBeNull();
  });

  it("a failed first read is amber and unknown", () => {
    const h = deriveActionItemsHealth({
      loaded: false,
      migrationPending: false,
      readFailed: true,
      tab: "open",
      response: null,
      counts: null,
    });
    expect(h.level).toBe("amber");
    expect(h.headline).toBe("Could not read action items");
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
