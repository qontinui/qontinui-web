import { describe, expect, it } from "vitest";
import { describeRunFailure, spawnVetoOf } from "./runFailure";

const URL = "/api/v1/conditions/groups/g1/run";
const COORD_VETO = {
  error: "spawn_vetoed",
  agent_name: "condition_autodispatch",
  disposition: "block",
  hint: "condition checks are disabled in this tenant's agent registry",
};

function rejection(status: number, body: string): Error {
  return new Error(`POST ${URL} failed: ${status} - ${body}`);
}

describe("describeRunFailure", () => {
  it("renders the veto from the web error envelope (coord body as text)", () => {
    const envelope = JSON.stringify({
      error: "conflict",
      message: JSON.stringify(COORD_VETO),
      timestamp: 1,
      path: URL,
    });
    const text = describeRunFailure(rejection(409, envelope));
    expect(text).toContain("turned off for this project");
    expect(text).toContain("disposition: block");
    expect(text).toContain(COORD_VETO.hint);
    expect(text).not.toContain("Failed to start run");
  });

  it("renders the veto when coord's object is the body itself", () => {
    const err = rejection(409, JSON.stringify(COORD_VETO));
    expect(spawnVetoOf(err)).toEqual({
      disposition: "block",
      hint: COORD_VETO.hint,
    });
  });

  it("shows a non-veto 409's own message, not a guess", () => {
    const body = JSON.stringify({ error: "conflict", message: "group busy" });
    expect(describeRunFailure(rejection(409, body))).toBe(
      "Run not started: group busy"
    );
  });

  it("does not read a veto out of another status", () => {
    const err = rejection(500, JSON.stringify(COORD_VETO));
    expect(spawnVetoOf(err)).toBeNull();
    expect(describeRunFailure(err)).toBe(err.message);
  });

  it("falls back to a generic sentence when coord's nested body has no words", () => {
    const envelope = JSON.stringify({
      error: "conflict",
      message: JSON.stringify({ code: 7 }),
    });
    const text = describeRunFailure(rejection(409, envelope));
    expect(text).toBe(
      "Run could not be started (409): the server refused it without saying why."
    );
    expect(text).not.toContain("{");
  });
});
