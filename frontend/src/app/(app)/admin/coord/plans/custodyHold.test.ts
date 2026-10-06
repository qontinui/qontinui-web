/**
 * `custodyHold` — the last live-custody reading, held across background polls
 * that do not ask for it, with its age stated.
 */

import { describe, expect, it } from "vitest";
import type {
  ReconciliationResponse,
  ReconciliationRowData,
} from "@/components/admin/coord/planReconciliationStatus";
import {
  applyHeldCustody,
  captureCustody,
  describeCustodyAge,
} from "./custodyHold";

function row(
  slug: string,
  axis: Partial<ReconciliationRowData["axis_a"]>
): ReconciliationRowData {
  return {
    slug,
    axis_a: { readable: true, present: true, status: "draft", ...axis },
    axis_b: {
      readable: true,
      present: true,
      document_state: "present",
      complete: true,
    },
    axis_c: { readable: true, present: true },
    classification: "AGREE_OPEN",
    verdict: "agree",
    reason: "",
  } as ReconciliationRowData;
}

function body(items: ReconciliationRowData[]): ReconciliationResponse {
  return { items } as ReconciliationResponse;
}

const SESSIONS = [
  { device_id: "box", custody: { state: "sole" as const, session_name: "a" } },
];

describe("custodyHold", () => {
  const hold = captureCustody(
    body([
      row("s1", { live_sessions: SESSIONS, custody_resolved: true }),
      row("s2", { readable: false, present: false }),
    ]),
    Date.UTC(2026, 9, 6, 12, 0)
  );

  it("captures only readable, present rows", () => {
    expect(Object.keys(hold.byStem)).toEqual(["s1"]);
  });

  it("re-applies the held reading to a poll row that carries none", () => {
    const { body: merged, applied } = applyHeldCustody(
      body([row("s1", { live_sessions: null, custody_resolved: null })]),
      hold
    );
    expect(applied).toBe(true);
    expect(merged.items[0].axis_a.live_sessions).toEqual(SESSIONS);
    expect(merged.items[0].axis_a.custody_resolved).toBe(true);
  });

  it("never papers over an unreadable axis A or a fresh reading", () => {
    const unreadable = applyHeldCustody(
      body([row("s1", { readable: false, present: false })]),
      hold
    );
    expect(unreadable.applied).toBe(false);
    expect(unreadable.body.items[0].axis_a.live_sessions).toBeUndefined();
    const fresh = applyHeldCustody(
      body([row("s1", { live_sessions: [], custody_resolved: true })]),
      hold
    );
    expect(fresh.applied).toBe(false);
    expect(fresh.body.items[0].axis_a.live_sessions).toEqual([]);
  });

  it("states the reading's age, and that a held one is held", () => {
    expect(describeCustodyAge(null, false)).toBeNull();
    expect(describeCustodyAge(hold, false)).toMatch(
      /^custody as of \d\d:\d\d$/
    );
    expect(describeCustodyAge(hold, true)).toMatch(
      /^custody as of \d\d:\d\d — held from an earlier read/
    );
  });
});
