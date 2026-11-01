import { describe, expect, it } from "vitest";
import { RowKeyAliases } from "./rowKeyAliases";

describe("RowKeyAliases — a presented row key is an alias of the operator's", () => {
  it("carries none of the operator key, only the list's name", () => {
    const aliases = new RowKeyAliases();
    const key = aliases.key("needs", "agent_question:9f3b2a71-q:0");
    expect(key).toBe("needs:row-1");
    expect(key).not.toMatch(/agent_question|9f3b2a71/);
  });

  it("gives the same operator key the same alias on every poll", () => {
    const aliases = new RowKeyAliases();
    const first = aliases.key("needs", "operator_gate:g-1:1");
    aliases.key("needs", "agent_question:q-2:2");
    expect(aliases.key("needs", "operator_gate:g-1:1")).toBe(first);
  });

  it("gives a row whose operator key changed a new alias — so it collapses as the operator's does", () => {
    // A poll removed the row above: the operator key's index moved, so the
    // operator's open key matches nothing, and the alias must not either.
    const aliases = new RowKeyAliases();
    const open = aliases.key("needs", "operator_gate:g-1:1");
    const moved = aliases.key("needs", "operator_gate:g-1:0");
    const below = aliases.key("needs", "agent_question:q-3:1");
    expect(new Set([open, moved, below]).size).toBe(3);
  });

  it("keeps two lists' rows apart even when their operator keys agree", () => {
    const aliases = new RowKeyAliases();
    expect(aliases.key("degrading", "x:1:0")).not.toBe(
      aliases.key("cleared", "x:1:0")
    );
  });
});
