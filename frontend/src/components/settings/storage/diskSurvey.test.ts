import { describe, it, expect } from "vitest";
import {
  aggregateByClass,
  bucketTotals,
  canClaimNothingToReclaim,
  parseDiskSurvey,
  surveyDisagreement,
  toSurveyItem,
  toSurveyStatus,
  type DiskSurvey,
} from "./diskSurvey";

/**
 * Disk monitoring Phase 2 (plan
 * `2026-08-07-product-disk-monitoring-and-cleanup.md`), web half.
 *
 * These pin the honesty rules, which are the point of the phase: a survey that
 * could not be computed and a machine with nothing to reclaim must never
 * produce the same state, a cold census must never read as "nothing to clean",
 * and no path may manufacture a zero out of a missing byte count.
 */

function surveyOf(payload: unknown): DiskSurvey {
  const parsed = parseDiskSurvey(payload);
  if (parsed.state !== "parsed") {
    throw new Error(`expected a parsed survey, got: ${parsed.reason}`);
  }
  return parsed.survey;
}

function item(over: Record<string, unknown> = {}) {
  return {
    id: "d:/repo/target",
    path: "D:\\repo\\target",
    class: "container",
    status: "reclaimable",
    reason: null,
    reason_detail: null,
    bytes: 1024,
    last_used_at: "2026-08-14T09:00:00Z",
    ...over,
  };
}

describe("parseDiskSurvey", () => {
  it("parses the documented envelope", () => {
    const survey = surveyOf({
      device_id: "dev-1",
      items: [item()],
      summary: { reclaimable_bytes: 1024 },
      census_status: "fresh",
      census_age_secs: 12,
      census_note: "walk took 40s",
    });
    expect(survey.deviceId).toBe("dev-1");
    expect(survey.censusStatus).toBe("fresh");
    expect(survey.censusAgeSecs).toBe(12);
    expect(survey.censusNote).toBe("walk took 40s");
    expect(survey.items).toHaveLength(1);
    expect(survey.items[0].bytes).toBe(1024);
    expect(survey.skippedItems).toBe(0);
  });

  it("is UNPARSEABLE — not empty — when there is no items array", () => {
    const parsed = parseDiskSurvey({ summary: { reclaimable_bytes: 0 } });
    expect(parsed.state).toBe("unparseable");
    if (parsed.state === "unparseable") {
      expect(parsed.reason).toMatch(/not an empty one/i);
    }
  });

  it("is UNPARSEABLE for a non-object payload", () => {
    expect(parseDiskSurvey("nope").state).toBe("unparseable");
    expect(parseDiskSurvey(null).state).toBe("unparseable");
    expect(parseDiskSurvey(undefined).state).toBe("unparseable");
  });

  it("counts unreadable items instead of dropping them silently", () => {
    const survey = surveyOf({
      items: [item(), { status: "no-such-status" }, 42],
      census_status: "fresh",
    });
    expect(survey.items).toHaveLength(1);
    expect(survey.skippedItems).toBe(2);
    // Ten unreadable rows must never be able to render as "nothing to reclaim".
    expect(canClaimNothingToReclaim(survey)).toBe(false);
  });

  it("keeps an unrecognised census status as UNKNOWN, never fresh", () => {
    const survey = surveyOf({ items: [], census_status: "warming-up" });
    expect(survey.censusStatus).toBe("unknown");
    expect(survey.censusStatusRaw).toBe("warming-up");
    expect(canClaimNothingToReclaim(survey)).toBe(false);
  });

  it("treats an ABSENT census status as unknown, not fresh", () => {
    const survey = surveyOf({ items: [] });
    expect(survey.censusStatus).toBe("unknown");
    expect(survey.censusStatusRaw).toBeNull();
    expect(canClaimNothingToReclaim(survey)).toBe(false);
  });

  it("never turns a missing byte count into zero", () => {
    const survey = surveyOf({ items: [item({ bytes: null })] });
    expect(Number.isNaN(survey.items[0].bytes)).toBe(true);
    expect(survey.items[0].bytes).not.toBe(0);
  });

  it("rejects a negative census age rather than rendering it", () => {
    const survey = surveyOf({ items: [], census_age_secs: -5 });
    expect(survey.censusAgeSecs).toBeNull();
  });
});

describe("toSurveyStatus / toSurveyItem", () => {
  it("accepts both `reclaimable` and the sibling route's `reapable`", () => {
    expect(toSurveyStatus("reclaimable")).toBe("reclaimable");
    expect(toSurveyStatus("reapable")).toBe("reclaimable");
    expect(toSurveyStatus("blocked")).toBe("blocked");
  });

  it("refuses to guess an unknown status", () => {
    expect(toSurveyStatus("maybe")).toBeNull();
    expect(toSurveyStatus(undefined)).toBeNull();
    expect(toSurveyItem(item({ status: "maybe" }))).toBeNull();
  });

  it("falls back to `path` when the runner sends no id", () => {
    const parsed = toSurveyItem(item({ id: null }));
    expect(parsed?.id).toBe("D:\\repo\\target");
  });

  it("is unreadable when it has neither id nor path", () => {
    expect(toSurveyItem(item({ id: null, path: null }))).toBeNull();
  });
});

describe("aggregateByClass", () => {
  it("splits reclaimable and blocked bytes per class", () => {
    const survey = surveyOf({
      items: [
        item({ id: "a", class: "container", bytes: 100 }),
        item({ id: "b", class: "container", bytes: 200 }),
        item({
          id: "c",
          class: "container",
          status: "blocked",
          reason: "building",
          bytes: 50,
        }),
      ],
      census_status: "fresh",
    });
    const totals = aggregateByClass(survey);
    expect(totals).toHaveLength(1);
    expect(totals[0].reclaimableBytes).toBe(300);
    expect(totals[0].blockedBytes).toBe(50);
    expect(totals[0].reclaimableCount).toBe(2);
    expect(totals[0].blockedCount).toBe(1);
    expect(totals[0].verb).toBe("v1");
  });

  it("EXCLUDES unreadable byte counts from totals and counts them", () => {
    const survey = surveyOf({
      items: [
        item({ id: "a", bytes: 100 }),
        item({ id: "b", bytes: "big" }),
        item({ id: "c", bytes: -1 }),
      ],
      census_status: "fresh",
    });
    const [totals] = aggregateByClass(survey);
    expect(totals.reclaimableBytes).toBe(100);
    expect(totals.unknownByteItems).toBe(2);
    expect(totals.reclaimableCount).toBe(3);
  });

  it("marks in-repo-canonical as report-only, verb deferred", () => {
    const survey = surveyOf({
      items: [item({ class: "in-repo-canonical", bytes: 999 })],
      census_status: "fresh",
    });
    const [totals] = aggregateByClass(survey);
    expect(totals.verb).toBe("deferred-v2");
    expect(totals.known).toBe(true);
    expect(totals.note).toMatch(/no cleanup verb ships for this class yet/i);
  });

  it("keeps an unrecognised class visible instead of dropping its bytes", () => {
    const survey = surveyOf({
      items: [item({ class: "future-class", bytes: 7 })],
      census_status: "fresh",
    });
    const [totals] = aggregateByClass(survey);
    expect(totals.verb).toBe("unrecognised");
    expect(totals.known).toBe(false);
    expect(totals.reclaimableBytes).toBe(7);
  });

  it("keeps items that named no class at all", () => {
    const survey = surveyOf({
      items: [item({ class: null, bytes: 7 })],
      census_status: "fresh",
    });
    const [totals] = aggregateByClass(survey);
    expect(totals.classId).toBeNull();
    expect(totals.verb).toBe("unrecognised");
    expect(totals.reclaimableBytes).toBe(7);
  });

  it("never invents a row for a class the runner did not mention", () => {
    const survey = surveyOf({
      items: [item({ class: "container" })],
      census_status: "fresh",
    });
    const totals = aggregateByClass(survey);
    // A `0 B` row for `in-repo-canonical` would be a measurement nobody made.
    expect(totals.map((t) => t.classId)).toEqual(["container"]);
  });
});

describe("bucketTotals", () => {
  it("separates the actionable bytes from the report-only ones", () => {
    const survey = surveyOf({
      items: [
        item({ id: "a", class: "container", bytes: 100 }),
        item({ id: "b", class: "sibling-worktree", bytes: 200 }),
        item({ id: "c", class: "in-repo-canonical", bytes: 5000 }),
        item({ id: "d", class: "mystery", bytes: 9 }),
        item({ id: "e", class: "container", status: "blocked", bytes: 3 }),
      ],
      census_status: "fresh",
    });
    const buckets = bucketTotals(aggregateByClass(survey));
    expect(buckets.actionableBytes).toBe(300);
    expect(buckets.actionableItems).toBe(2);
    expect(buckets.reportOnlyBytes).toBe(5000);
    expect(buckets.reportOnlyItems).toBe(1);
    expect(buckets.unrecognisedBytes).toBe(9);
    expect(buckets.blockedBytes).toBe(3);
    expect(buckets.blockedItems).toBe(1);
  });

  it("propagates the unknown-size counts so the UI can say 'at least'", () => {
    const survey = surveyOf({
      items: [
        item({ id: "a", class: "container", bytes: undefined }),
        item({ id: "b", class: "in-repo-canonical", bytes: undefined }),
      ],
      census_status: "fresh",
    });
    const buckets = bucketTotals(aggregateByClass(survey));
    expect(buckets.actionableUnknownByteItems).toBe(1);
    expect(buckets.reportOnlyUnknownByteItems).toBe(1);
    expect(buckets.actionableBytes).toBe(0);
  });
});

describe("surveyDisagreement", () => {
  it("is silent when the summary matches the items", () => {
    const survey = surveyOf({
      items: [item({ bytes: 100 })],
      summary: { reclaimable_bytes: 100 },
      census_status: "fresh",
    });
    expect(surveyDisagreement(survey)).toBeNull();
  });

  it("flags an EMPTY item list that the summary contradicts", () => {
    const survey = surveyOf({
      items: [],
      summary: { reclaimable_bytes: 5000 },
      census_status: "fresh",
    });
    expect(surveyDisagreement(survey)).toMatch(/disagree/i);
  });

  it("does not flag a shortfall that unreadable byte counts explain", () => {
    const survey = surveyOf({
      items: [item({ id: "a", bytes: 100 }), item({ id: "b", bytes: null })],
      summary: { reclaimable_bytes: 500 },
      census_status: "fresh",
    });
    expect(surveyDisagreement(survey)).toBeNull();
  });

  it("stays silent when the runner sent no summary total", () => {
    const survey = surveyOf({ items: [item()], census_status: "fresh" });
    expect(surveyDisagreement(survey)).toBeNull();
  });
});

describe("canClaimNothingToReclaim", () => {
  it("is TRUE only for a completed census with a genuinely empty result", () => {
    expect(
      canClaimNothingToReclaim(surveyOf({ items: [], census_status: "fresh" }))
    ).toBe(true);
    expect(
      canClaimNothingToReclaim(surveyOf({ items: [], census_status: "stale" }))
    ).toBe(true);
  });

  it("is FALSE for a pending (cold-start) census", () => {
    const survey = surveyOf({ items: [], census_status: "pending" });
    expect(survey.censusStatus).toBe("pending");
    // The whole point: a cold start must render "not ready", never
    // "nothing to clean".
    expect(canClaimNothingToReclaim(survey)).toBe(false);
  });

  it("is FALSE when rows were dropped, even with a fresh census", () => {
    const survey = surveyOf({
      items: [{ status: "bogus" }],
      census_status: "fresh",
    });
    expect(canClaimNothingToReclaim(survey)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fields the RUNNER's actual wire types carry (verified against the runner's
// `agent_worktree/disk_survey.rs`), which the aggregate treats as
// authoritative over this module's own class table.
// ---------------------------------------------------------------------------

describe("runner-declared verb", () => {
  it("puts an item with a verb in the actionable bucket, whatever its class", () => {
    const survey = surveyOf({
      items: [
        item({ class: "some-future-class", verb: "orphan_target_reaper" }),
      ],
      census_status: "fresh",
    });
    const [totals] = aggregateByClass(survey);
    expect(totals.verb).toBe("v1");
    expect(bucketTotals([totals]).actionableBytes).toBe(1024);
  });

  it("treats an explicit `verb: null` as report-only, not unrecognised", () => {
    const survey = surveyOf({
      items: [item({ class: "some-future-class", verb: null })],
      census_status: "fresh",
    });
    const [totals] = aggregateByClass(survey);
    expect(totals.verb).toBe("deferred-v2");
    expect(bucketTotals([totals]).reportOnlyBytes).toBe(1024);
  });

  it("falls back to the class table when the runner reports no verb key", () => {
    const survey = surveyOf({
      items: [item({ class: "in-repo-canonical" })],
      census_status: "fresh",
    });
    expect(aggregateByClass(survey)[0].verb).toBe("deferred-v2");
    const known = surveyOf({
      items: [item({ class: "container" })],
      census_status: "fresh",
    });
    expect(aggregateByClass(known)[0].verb).toBe("v1");
  });

  it("takes the verb from `by_class` when the item omits it", () => {
    const survey = surveyOf({
      items: [item({ class: "some-future-class" })],
      summary: {
        by_class: [{ class: "some-future-class", verb: null, roots: 1 }],
      },
      census_status: "fresh",
    });
    expect(aggregateByClass(survey)[0].verb).toBe("deferred-v2");
  });

  it("prefers the runner's own class note over the built-in one", () => {
    const survey = surveyOf({
      items: [item({ class: "container" })],
      summary: {
        by_class: [{ class: "container", verb: "reaper", note: "runner says" }],
      },
      census_status: "fresh",
    });
    expect(aggregateByClass(survey)[0].note).toBe("runner says");
  });
});

describe("by_class presence", () => {
  it("is null when the runner sent none — the UI may not render measured zeros", () => {
    expect(surveyOf({ items: [], census_status: "fresh" }).byClass).toBeNull();
  });

  it("is null when the rollup existed but no row could be read", () => {
    const survey = surveyOf({
      items: [],
      summary: { by_class: [{ roots: 1 }, 7] },
      census_status: "fresh",
    });
    expect(survey.byClass).toBeNull();
  });

  it("keeps a class the runner measured as genuinely zero", () => {
    const survey = surveyOf({
      items: [],
      summary: {
        by_class: [
          {
            class: "container",
            roots: 0,
            bytes: null,
            reclaimable_roots: 0,
            reclaimable_bytes: null,
            roots_with_unknown_bytes: 0,
            verb: "reaper",
            note: "n/a",
          },
        ],
      },
      census_status: "fresh",
    });
    expect(survey.byClass).toHaveLength(1);
    expect(survey.byClass?.[0].roots).toBe(0);
    // A null byte total stays NaN — "unknown", not "0 B".
    expect(Number.isNaN(survey.byClass?.[0].bytes ?? 0)).toBe(true);
  });
});

describe("lower-bound flags", () => {
  it("counts a partially-sized root apart from an unreadable one", () => {
    const survey = surveyOf({
      items: [
        item({ id: "a", bytes: 100, bytes_partial: true }),
        item({ id: "b", bytes: null }),
        item({ id: "c", bytes: 50 }),
      ],
      census_status: "fresh",
    });
    const [totals] = aggregateByClass(survey);
    // The partial root's bytes ARE counted (it is a floor, not unknown).
    expect(totals.reclaimableBytes).toBe(150);
    expect(totals.partialByteItems).toBe(1);
    expect(totals.unknownByteItems).toBe(1);
  });

  it("carries the runner's own bytes_incomplete flag", () => {
    const survey = surveyOf({
      items: [],
      summary: { bytes_incomplete: true },
      census_status: "fresh",
    });
    expect(survey.bytesIncomplete).toBe(true);
  });

  it("does not call a shortfall a contradiction when a root was partial", () => {
    const survey = surveyOf({
      items: [item({ bytes: 100, bytes_partial: true })],
      summary: { reclaimable_bytes: 500 },
      census_status: "fresh",
    });
    expect(surveyDisagreement(survey)).toBeNull();
  });
});

describe("census_status: unavailable", () => {
  it("is preserved as its own state, not flattened into unknown", () => {
    const survey = surveyOf({
      items: [],
      census_status: "unavailable",
      census_note: "the workspace root could not be resolved",
    });
    expect(survey.censusStatus).toBe("unavailable");
    expect(survey.censusNote).toBe("the workspace root could not be resolved");
  });

  it("may never claim there is nothing to reclaim", () => {
    const survey = surveyOf({ items: [], census_status: "unavailable" });
    expect(canClaimNothingToReclaim(survey)).toBe(false);
  });
});
