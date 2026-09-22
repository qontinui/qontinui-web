import { describe, expect, it } from "vitest";
import { statusAfterEdit, type Status } from "./status";

describe("statusAfterEdit", () => {
  it("clears a finished attempt, so its message cannot outlive the draft", () => {
    // "Saved as version 4" over three freshly pasted tables is a false
    // statement about what the server holds.
    expect(statusAfterEdit({ kind: "saved", version: 4 })).toEqual({
      kind: "idle",
    });
    expect(statusAfterEdit({ kind: "conflict", currentVersion: 9 })).toEqual({
      kind: "idle",
    });
    expect(statusAfterEdit({ kind: "failed", message: "boom" })).toEqual({
      kind: "idle",
    });
  });

  it("leaves an UNFINISHED attempt alone", () => {
    // Clearing `saving` re-enabled Save mid-request — a second submit one
    // click away — and let the resolving banner describe a draft the
    // request never carried.
    const saving: Status = { kind: "saving" };
    expect(statusAfterEdit(saving)).toBe(saving);
  });

  it("returns the same object when already idle, so React does not re-render", () => {
    const idle: Status = { kind: "idle" };
    expect(statusAfterEdit(idle)).toBe(idle);
  });
});
