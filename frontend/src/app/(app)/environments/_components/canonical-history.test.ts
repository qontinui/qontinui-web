import { describe, expect, it } from "vitest";
import type { CanonicalChange } from "@/services/devenv-api";
import {
  actorLabel,
  describeLatestChange,
  formatChangedAt,
  isInitialDesignation,
  machineLabel,
} from "./canonical-history";

function change(over: Partial<CanonicalChange> = {}): CanonicalChange {
  return {
    id: "c1",
    environment_id: "e1",
    from_machine_id: null,
    to_machine_id: "11111111-2222-3333-4444-555555555555",
    changed_by_user_id: "99999999-8888-7777-6666-555555555555",
    tenant_id: null,
    note: null,
    changed_at: "2026-07-19T16:05:00Z",
    changed_by_email: "josh@qontinui.io",
    from_machine_name: null,
    to_machine_name: "monster",
    ...over,
  };
}

describe("machineLabel", () => {
  it("prefers the resolved name", () => {
    expect(machineLabel("monster", "11111111-2222", "—")).toBe("monster");
  });

  // The machine refs are soft (NOT foreign keys) so the audit outlives machine
  // deletion — a null name with a live id is a NORMAL row, not an error.
  it("falls back to a short id prefix when the machine was deleted", () => {
    expect(
      machineLabel(null, "11111111-2222-3333-4444-555555555555", "—")
    ).toBe("deleted machine (11111111)");
  });

  it("uses the caller's empty label when there is no ref at all", () => {
    expect(machineLabel(null, null, "—")).toBe("—");
    expect(machineLabel(null, null)).toBe("unknown machine");
  });

  it("never renders a bare UUID", () => {
    const label = machineLabel(null, "11111111-2222-3333-4444-555555555555");
    expect(label).not.toBe("11111111-2222-3333-4444-555555555555");
    expect(label).toContain("deleted");
  });
});

describe("actorLabel", () => {
  it("prefers the email", () => {
    expect(actorLabel("josh@qontinui.io", "9999")).toBe("josh@qontinui.io");
  });

  // changed_by_user_id is FK ON DELETE SET NULL — both fields can be null.
  it("falls back to a deleted-user hint, then to an honest unknown", () => {
    expect(actorLabel(null, "99999999-8888-7777-6666-555555555555")).toBe(
      "deleted user (99999999)"
    );
    expect(actorLabel(null, null)).toBe("an unknown user");
  });
});

describe("formatChangedAt", () => {
  it("returns the raw string when the timestamp is unparseable", () => {
    expect(formatChangedAt("not-a-date")).toBe("not-a-date");
  });

  it("formats a valid ISO timestamp to something other than the raw ISO", () => {
    expect(formatChangedAt("2026-07-19T16:05:00Z")).not.toBe(
      "2026-07-19T16:05:00Z"
    );
  });
});

describe("isInitialDesignation", () => {
  it("is true only when there is no prior canonical ref at all", () => {
    expect(isInitialDesignation(change())).toBe(true);
    expect(
      isInitialDesignation(
        change({ from_machine_id: "abc", from_machine_name: null })
      )
    ).toBe(false);
    expect(isInitialDesignation(change({ from_machine_name: "old-box" }))).toBe(
      false
    );
  });
});

describe("describeLatestChange", () => {
  it("names the target machine and the actor", () => {
    const line = describeLatestChange(change());
    expect(line).toContain("Canonical set to monster");
    expect(line).toContain("by josh@qontinui.io");
  });

  it("degrades gracefully when every joined name is null", () => {
    const line = describeLatestChange(
      change({
        to_machine_name: null,
        changed_by_email: null,
      })
    );
    expect(line).toContain("deleted machine (11111111)");
    expect(line).toContain("deleted user (99999999)");
    expect(line).not.toContain("null");
  });

  it("handles a fully-null row without throwing", () => {
    const line = describeLatestChange(
      change({
        to_machine_id: null,
        to_machine_name: null,
        changed_by_user_id: null,
        changed_by_email: null,
      })
    );
    expect(line).toContain("Canonical set to no machine by an unknown user");
  });
});
