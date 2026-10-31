/**
 * When the agentic-activity page collapses its ledger sections under one
 * notice: only for an issue saying coord does not serve the ledger, and only
 * while no last good read is held.
 */

import { describe, expect, it } from "vitest";
import { listFx, rowFx, statsFx } from "../__fixtures__/coordSpawns";
import type { SpawnReadIssue } from "./spawnStatus";
import { LEDGER_UNSERVED_KINDS, ledgerUnserved } from "./ledgerServed";

function ledger(
  issue: SpawnReadIssue,
  held: { list?: boolean; stats?: boolean } = {}
) {
  return {
    list: { data: held.list ? listFx([rowFx()]) : null, issue },
    stats: { data: held.stats ? statsFx() : null, issue },
  };
}

describe("ledgerUnserved", () => {
  it("collapses for a route coord has switched off, as for one it does not serve", () => {
    expect(LEDGER_UNSERVED_KINDS.has("route_disabled")).toBe(true);
    expect(ledgerUnserved(ledger({ kind: "route_disabled" }))).toEqual({
      kind: "route_disabled",
    });
    expect(ledgerUnserved(ledger({ kind: "route_unavailable" }))).toEqual({
      kind: "route_unavailable",
    });
  });

  it("collapses nothing while a last good list or stats read is held", () => {
    for (const kind of ["route_disabled", "route_unavailable"] as const) {
      expect(ledgerUnserved(ledger({ kind }, { list: true }))).toBeNull();
      expect(ledgerUnserved(ledger({ kind }, { stats: true }))).toBeNull();
    }
  });

  it("collapses nothing for a read that failed", () => {
    expect(
      ledgerUnserved(ledger({ kind: "error", message: "coord unreachable" }))
    ).toBeNull();
  });
});
