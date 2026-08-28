import { describe, it, expect } from "vitest";
import {
  aggregateByClass,
  bucketTotals,
  canClaimNothingToReclaim,
  KNOWN_DISK_CLASSES,
  measuredZeroBuckets,
  parseDiskSurvey,
  parseScanStats,
  readErrorsSeen,
  reportOnlyDisagreement,
  rollupDisagreement,
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

/**
 * A report-only row IN THE ONLY SHAPE THE RUNNER CAN EMIT ONE.
 *
 * `in-repo-canonical` never arrives `reclaimable`: `boundary_verdict` returns
 * `Err(SkipReason::ReportOnly)` unconditionally for a class with no verb
 * (`orphan_target_reaper.rs`), and `render_item` maps every `Err` to
 * `status: "blocked"` with the reason token attached. Fixtures that spelled it
 * `status: "reclaimable"` were testing a payload that cannot exist — which is
 * exactly why the tile rendering `0 B` over 1.67 TB passed its own suite.
 */
function reportOnlyItem(over: Record<string, unknown> = {}) {
  return item({
    id: "d:/repo/target",
    class: "in-repo-canonical",
    status: "blocked",
    reason: "report-only",
    reason_detail:
      "Inside a canonical repo checkout. Measured and reported, but v1 has " +
      "no cleanup verb for this class.",
    verb: null,
    ...over,
  });
}

/**
 * A root ANOTHER ENGINE owns, in the shape `render_item` actually produces.
 *
 * `<wt>/target` is the canonical build-dir name the worktree reclaim engine
 * owns, so the reaper refuses it with `SkipReason::OwnedByWorktreeReclaim` —
 * and, because that reason is `owned_elsewhere()`, `render_item` strips the
 * verb. The class is still `sibling-worktree`: the very class whose OTHER
 * roots (`<wt>/target-<slug>`) do carry the verb.
 */
function ownedElsewhereItem(over: Record<string, unknown> = {}) {
  return item({
    id: "d:/wt/target",
    path: "D:\\wt\\target",
    class: "sibling-worktree",
    status: "blocked",
    reason: "owned-by-worktree-reclaim",
    reason_detail:
      "`target` is the canonical build-dir name the worktree reclaim engine " +
      "owns.",
    verb: null,
    ...over,
  });
}

/**
 * The `scan` block a completed walk always carries. `disk_survey.rs` omits
 * `scan` only for `pending` and `unavailable`, so any fixture standing in for
 * a FRESH census has to carry it — and `canClaimNothingToReclaim` requires the
 * walk to report itself complete rather than merely fail to report itself
 * short.
 */
const COMPLETE_SCAN = {
  dirs_visited: 1_200,
  truncated: false,
  read_errors: [],
  roots_with_unknown_bytes: 0,
  roots_with_partial_bytes: 0,
};

describe("parseDiskSurvey", () => {
  it("parses the documented envelope", () => {
    const survey = surveyOf({
      items: [item()],
      summary: { reclaimable_bytes: 1024 },
      census_status: "fresh",
      census_age_secs: 12,
      census_note: "walk took 40s",
    });
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
  it("accepts exactly the runner's two statuses and nothing else", () => {
    expect(toSurveyStatus("reclaimable")).toBe("reclaimable");
    expect(toSurveyStatus("blocked")).toBe("blocked");
    // The worktree route's `reapable` is a DIFFERENT route's vocabulary. This
    // client is pinned to the disk survey's confirmed contract, not to a guess
    // about which spelling might turn up.
    expect(toSurveyStatus("reapable")).toBeNull();
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
      items: [reportOnlyItem({ bytes: 999 })],
      census_status: "fresh",
    });
    const [totals] = aggregateByClass(survey);
    expect(totals.verb).toBe("deferred-v2");
    expect(totals.known).toBe(true);
    expect(totals.note).toMatch(/no cleanup verb ships for this class yet/i);
    // The bytes land in the BLOCKED column, because that is the only status
    // the runner can give this class. The class total is what the tile needs.
    expect(totals.reclaimableBytes).toBe(0);
    expect(totals.blockedBytes).toBe(999);
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
        reportOnlyItem({ id: "c", bytes: 5000 }),
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
    // Only the CONTAINER root is guard-held. The report-only root is blocked
    // too, but nothing is holding it, and counting it here would both make the
    // tile's copy false and count its bytes twice.
    expect(buckets.blockedBytes).toBe(3);
    expect(buckets.blockedItems).toBe(1);
  });

  it("sources the report-only bucket from the WHOLE class, not just reclaimable rows", () => {
    // The regression W1: the runner cannot emit an in-repo-canonical row with
    // `status: "reclaimable"`, so a bucket summed from `reclaimableBytes` alone
    // is always 0 -- and the tile printed a bare `0 B` over the biggest class
    // on the machine while its bytes were relabelled "blocked by a guard".
    const survey = surveyOf({
      items: [
        reportOnlyItem({ id: "a", bytes: 1_000_000 }),
        reportOnlyItem({ id: "b", bytes: 700_000 }),
      ],
      summary: { report_only_bytes: 1_700_000 },
      census_status: "fresh",
    });
    const buckets = bucketTotals(aggregateByClass(survey));
    expect(buckets.reportOnlyBytes).toBe(1_700_000);
    expect(buckets.reportOnlyItems).toBe(2);
    expect(buckets.blockedBytes).toBe(0);
    expect(buckets.blockedItems).toBe(0);
    // ...and the tile figure now matches the runner's own headline, which is
    // `by_class[in-repo-canonical].bytes` -- every status, not just reclaimable.
    expect(buckets.reportOnlyBytes).toBe(survey.summaryReportOnlyBytes);
  });

  it("keeps the four buckets a PARTITION — no root counted twice", () => {
    const survey = surveyOf({
      items: [
        item({ id: "a", class: "container", bytes: 100 }),
        item({ id: "b", class: "container", status: "blocked", bytes: 30 }),
        reportOnlyItem({ id: "c", bytes: 5000 }),
        item({ id: "d", class: "mystery", bytes: 9 }),
      ],
      census_status: "fresh",
    });
    const buckets = bucketTotals(aggregateByClass(survey));
    expect(
      buckets.actionableBytes +
        buckets.reportOnlyBytes +
        buckets.unrecognisedBytes +
        buckets.blockedBytes
    ).toBe(5139);
    expect(
      buckets.actionableItems +
        buckets.reportOnlyItems +
        buckets.unrecognisedItems +
        buckets.blockedItems
    ).toBe(4);
  });

  it("propagates the unknown-size counts so the UI can say 'at least'", () => {
    const survey = surveyOf({
      items: [
        item({ id: "a", class: "container", bytes: undefined }),
        reportOnlyItem({ id: "b", bytes: undefined }),
      ],
      census_status: "fresh",
    });
    const buckets = bucketTotals(aggregateByClass(survey));
    expect(buckets.actionableUnknownByteItems).toBe(1);
    expect(buckets.reportOnlyUnknownByteItems).toBe(1);
    expect(buckets.actionableBytes).toBe(0);
    // The report-only class's unreadable root must not leak into the blocked
    // tile's qualifier either.
    expect(buckets.blockedUnknownByteItems).toBe(0);
  });

  it("carries a report-only root's PARTIAL-size count into the report-only tile", () => {
    const survey = surveyOf({
      items: [reportOnlyItem({ bytes: 4096, bytes_partial: true })],
      census_status: "fresh",
    });
    const buckets = bucketTotals(aggregateByClass(survey));
    expect(buckets.reportOnlyBytes).toBe(4096);
    expect(buckets.reportOnlyPartialByteItems).toBe(1);
    expect(buckets.blockedPartialByteItems).toBe(0);
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
      canClaimNothingToReclaim(
        surveyOf({
          items: [],
          summary: { reclaimable_bytes: 0 },
          scan: COMPLETE_SCAN,
          census_status: "fresh",
        })
      )
    ).toBe(true);
    expect(
      canClaimNothingToReclaim(
        surveyOf({
          items: [],
          summary: { reclaimable_bytes: 0 },
          scan: COMPLETE_SCAN,
          census_status: "stale",
        })
      )
    ).toBe(true);
  });

  it("is FALSE when the walk never REPORTED itself complete", () => {
    // W2: `scan?.truncated !== true` passes for a missing `scan` AND for a
    // `scan` with no `truncated` key -- two absences reading as a completeness
    // claim the payload never made. The walk has to say it finished.
    const noScan = surveyOf({
      items: [],
      summary: { reclaimable_bytes: 0 },
      census_status: "fresh",
    });
    expect(noScan.scan).toBeNull();
    expect(canClaimNothingToReclaim(noScan)).toBe(false);

    const noKey = surveyOf({
      items: [],
      summary: { reclaimable_bytes: 0 },
      scan: { dirs_visited: 1_200, read_errors: [] },
      census_status: "fresh",
    });
    expect(noKey.scan?.hasTruncatedField).toBe(false);
    expect(noKey.scan?.truncated).toBe(false);
    expect(canClaimNothingToReclaim(noKey)).toBe(false);
  });

  it("is FALSE when the runner sent NO reclaimable_bytes at all", () => {
    // W4: absence is UNKNOWN. This is the function whose docstring says a
    // missing total may never license the sentence, and it used to read a
    // missing key as a measured zero -- the exact inversion.
    const survey = surveyOf({
      items: [],
      scan: COMPLETE_SCAN,
      census_status: "fresh",
    });
    expect(Number.isNaN(survey.summaryReclaimableBytes)).toBe(true);
    expect(canClaimNothingToReclaim(survey)).toBe(false);
  });

  it("is FALSE for a present-but-null total (the cold-census shape)", () => {
    const survey = surveyOf({
      items: [],
      summary: { reclaimable_bytes: null },
      scan: COMPLETE_SCAN,
      census_status: "fresh",
    });
    // Absent and `null` both survive as NaN -- both are the runner not having
    // told us a total, and both are refused here.
    expect(Number.isNaN(survey.summaryReclaimableBytes)).toBe(true);
    expect(canClaimNothingToReclaim(survey)).toBe(false);
  });

  it("is FALSE when the walk was TRUNCATED before it found anything", () => {
    // W3: 200k visit cap hit before the first root. `fresh` + `items: []` +
    // `reclaimable_bytes: 0` looks exactly like a clean machine, and is not.
    const survey = surveyOf({
      items: [],
      summary: { reclaimable_bytes: 0, bytes_incomplete: true },
      scan: { dirs_visited: 200_000, truncated: true, read_errors: [] },
      census_status: "fresh",
    });
    expect(survey.scan?.truncated).toBe(true);
    expect(canClaimNothingToReclaim(survey)).toBe(false);
  });

  it("is FALSE when the runner flags bytes_incomplete on an empty list", () => {
    // Permission-denied subtrees, with no `scan` block at all: the ONLY signal
    // is `bytes_incomplete`, which the predicate never consulted.
    const survey = surveyOf({
      items: [],
      summary: { reclaimable_bytes: 0, bytes_incomplete: true },
      census_status: "fresh",
    });
    expect(survey.bytesIncomplete).toBe(true);
    expect(canClaimNothingToReclaim(survey)).toBe(false);
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
    // The CLASS is still one this build cannot place -- `item.verb` is a
    // verdict about the ROOT, and reading it as class metadata is the X1
    // regression. The bytes are actionable anyway: the runner named the engine
    // that would remove this root.
    expect(totals.verb).toBe("unrecognised");
    expect(bucketTotals([totals]).actionableBytes).toBe(1024);
    expect(bucketTotals([totals]).unrecognisedBytes).toBe(0);
  });

  it("does not offer a reclaimable root the runner named NO verb for", () => {
    // The runner cannot emit this shape today (a verdict of `Ok` keeps the
    // class's verb), but if one arrives this page cannot say what would act on
    // it -- so it is surfaced as unplaceable, never as actionable.
    const survey = surveyOf({
      items: [item({ class: "some-future-class", verb: null })],
      census_status: "fresh",
    });
    const buckets = bucketTotals(aggregateByClass(survey));
    expect(buckets.actionableBytes).toBe(0);
    expect(buckets.unrecognisedBytes).toBe(1024);
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

// ---------------------------------------------------------------------------
// The runner's four distinguishable states (confirmed contract).
// ---------------------------------------------------------------------------

describe("roots_unknown vetoes every measured zero", () => {
  /**
   * The exact payload a FAILED walk produced before the runner stopped
   * emitting it: an empty item list, null byte totals, and four per-class rows
   * of `roots: 0`. `ClassSummary.roots` is an unsigned integer on the wire and
   * cannot be nulled the way the bytes are, so those rows are bit-for-bit what
   * a fully-read, genuinely-empty machine sends — and `forBucket` read them as
   * a certified `0 B`, printing "nothing to reclaim" over a walk that saw
   * nothing.
   *
   * `summary.roots_unknown` is the runner's own contradiction of that reading.
   * Reading it is what makes this page safe against an OLDER runner build too:
   * the runner now sends an EMPTY rollup instead, but a machine on the previous
   * build still serves the zeroed one over loopback.
   */
  const zeroedRollup = [
    { class: "in-repo-canonical", roots: 0, bytes: null, verb: null },
    {
      class: "sibling-worktree",
      roots: 0,
      bytes: null,
      verb: "orphan-target-reaper",
    },
    { class: "container", roots: 0, bytes: null, verb: "orphan-target-reaper" },
    {
      class: "sibling-nongit",
      roots: 0,
      bytes: null,
      verb: "orphan-target-reaper",
    },
  ];

  it("refuses both buckets on the zeroed rollup an OLD runner still sends", () => {
    const survey = surveyOf({
      items: [],
      census_status: "fresh",
      summary: {
        reclaimable_bytes: null,
        report_only_bytes: null,
        roots_unknown: true,
        by_class: zeroedRollup,
      },
      scan: {
        ...COMPLETE_SCAN,
        read_errors: [{ path: "D:/x", error: "denied" }],
        read_errors_total: 1,
      },
    });
    expect(survey.summaryRootsUnknown).toBe(true);
    expect(measuredZeroBuckets(survey)).toEqual({
      actionable: false,
      reportOnly: false,
    });
  });

  it("refuses both buckets on the EMPTY rollup a current runner sends", () => {
    const survey = surveyOf({
      items: [],
      census_status: "fresh",
      summary: {
        reclaimable_bytes: null,
        report_only_bytes: null,
        roots_unknown: true,
        by_class: [],
      },
      scan: {
        ...COMPLETE_SCAN,
        read_errors: [{ path: "D:/x", error: "denied" }],
        read_errors_total: 1,
      },
    });
    expect(measuredZeroBuckets(survey)).toEqual({
      actionable: false,
      reportOnly: false,
    });
  });

  it("NON-VACUOUS: the same rollup without the flag is still a measured zero", () => {
    // Drop `roots_unknown` and the identical shape is a real reading of a real
    // empty machine — which is the distinction this flag exists to draw, and
    // which the veto must not erase.
    const survey = surveyOf({
      items: [],
      census_status: "fresh",
      summary: {
        reclaimable_bytes: 0,
        report_only_bytes: 0,
        by_class: zeroedRollup.map((r) => ({ ...r, bytes: 0 })),
      },
      scan: COMPLETE_SCAN,
    });
    expect(survey.summaryRootsUnknown).toBe(false);
    expect(measuredZeroBuckets(survey)).toEqual({
      actionable: true,
      reportOnly: true,
    });
  });
});

describe("readErrorsSeen counts failures, never the sample", () => {
  const scanWith = (over: Record<string, unknown>) =>
    parseScanStats({ ...COMPLETE_SCAN, ...over });

  const listOf = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      path: `D:/x${i}`,
      error: "denied",
    }));

  it("reads the runner's UNCAPPED total, not the 100-entry sample", () => {
    // The runner caps `read_errors` at 100 and sends the real figure beside it.
    // Counting the array reported a locked subtree as a flat "100 directories".
    const scan = scanWith({
      read_errors: listOf(100),
      read_errors_total: 4137,
    });
    expect(scan?.readErrors).toHaveLength(100);
    expect(readErrorsSeen(scan)).toBe(4137);
  });

  it("falls back to the list for a runner build that sends no total", () => {
    // There the list IS the whole set, so the fallback is exact, not a guess.
    const scan = scanWith({ read_errors: listOf(3) });
    expect(scan?.readErrorsTotal).toBeNull();
    expect(readErrorsSeen(scan)).toBe(3);
  });

  it("never reports FEWER errors than the payload visibly carries", () => {
    // A total that contradicts its own list is a runner bug; taking the larger
    // fails toward showing the operator MORE incompleteness, never less.
    const scan = scanWith({ read_errors: listOf(5), read_errors_total: 0 });
    expect(readErrorsSeen(scan)).toBe(5);
  });

  it("is 0 for an absent scan block, and 0 for a clean walk", () => {
    expect(readErrorsSeen(null)).toBe(0);
    expect(readErrorsSeen(scanWith({}))).toBe(0);
  });
});

describe("the four states", () => {
  it("cold start: pending + null totals may NOT say 'nothing to reclaim'", () => {
    const survey = surveyOf({
      items: [],
      summary: { reclaimable_bytes: null, report_only_bytes: null },
      census_status: "pending",
    });
    expect(survey.censusStatus).toBe("pending");
    expect(Number.isNaN(survey.summaryReclaimableBytes)).toBe(true);
    expect(canClaimNothingToReclaim(survey)).toBe(false);
    expect(measuredZeroBuckets(survey)).toEqual({
      actionable: false,
      reportOnly: false,
    });
  });

  it("failed: unavailable carries its reason and claims nothing", () => {
    const survey = surveyOf({
      items: [],
      census_status: "unavailable",
      census_note: "the workspace root could not be resolved",
    });
    expect(survey.censusStatus).toBe("unavailable");
    expect(canClaimNothingToReclaim(survey)).toBe(false);
  });

  it("measured empty: fresh + no items + totals 0 MAY say so", () => {
    const survey = surveyOf({
      items: [],
      summary: { reclaimable_bytes: 0, report_only_bytes: 0 },
      scan: COMPLETE_SCAN,
      census_status: "fresh",
    });
    expect(canClaimNothingToReclaim(survey)).toBe(true);
    expect(measuredZeroBuckets(survey)).toEqual({
      actionable: true,
      reportOnly: true,
    });
  });

  it("a FRESH census with a null total is still not a measured zero", () => {
    // `null` is the runner saying it does not know. Only `0` is a measurement,
    // and this is the pair that collapses if you are careless.
    const survey = surveyOf({
      items: [],
      summary: { reclaimable_bytes: null },
      census_status: "fresh",
    });
    expect(canClaimNothingToReclaim(survey)).toBe(false);
    expect(measuredZeroBuckets(survey).actionable).toBe(false);
  });

  it("normal: fresh + items reports the totals", () => {
    const survey = surveyOf({
      items: [item({ bytes: 1024 })],
      summary: { reclaimable_bytes: 1024 },
      census_status: "fresh",
    });
    expect(surveyDisagreement(survey)).toBeNull();
    expect(bucketTotals(aggregateByClass(survey)).actionableBytes).toBe(1024);
  });
});

describe("report_only_bytes headline", () => {
  it("is parsed and cross-checked against the item-derived total", () => {
    const survey = surveyOf({
      items: [reportOnlyItem({ bytes: 100 })],
      summary: { report_only_bytes: 5000 },
      census_status: "fresh",
    });
    expect(survey.summaryReportOnlyBytes).toBe(5000);
    expect(reportOnlyDisagreement(survey, 100)).toMatch(
      /report-only headline/i
    );
  });

  it("is silent when the two agree, or when the runner sent none", () => {
    const agree = surveyOf({
      items: [reportOnlyItem({ bytes: 100 })],
      summary: { report_only_bytes: 100 },
      census_status: "fresh",
    });
    expect(reportOnlyDisagreement(agree, 100)).toBeNull();
    const absent = surveyOf({ items: [], census_status: "fresh" });
    expect(reportOnlyDisagreement(absent, 0)).toBeNull();
  });

  it("STOPS firing on an ordinary real load once the bucket is class-sourced", () => {
    // W5. Before W1 the derived report-only total was structurally 0 while the
    // headline carried the whole class, so this alert rendered on EVERY load --
    // the "train the operator to ignore honesty banners" outcome the sibling
    // docstring says was designed out. It must now be silent by construction.
    const survey = surveyOf({
      items: [
        reportOnlyItem({ id: "a", bytes: 1_000_000_000 }),
        reportOnlyItem({ id: "b", bytes: 669_800_000 }),
        item({ id: "c", class: "container", bytes: 4096 }),
      ],
      summary: {
        reclaimable_bytes: 4096,
        report_only_bytes: 1_669_800_000,
      },
      census_status: "fresh",
    });
    const derived = bucketTotals(aggregateByClass(survey)).reportOnlyBytes;
    expect(derived).toBe(1_669_800_000);
    expect(reportOnlyDisagreement(survey, derived)).toBeNull();
    expect(surveyDisagreement(survey)).toBeNull();
  });
});

describe("engine-owned skip reasons", () => {
  it("carries owned-by-* as a REASON on a blocked root, never as a class", () => {
    // W8: `owned-by-worktree-reclaim` / `owned-by-build-pool` are
    // `SkipReason::token()` values. They arrive on `item.reason`; the class is
    // still one of the runner's four. Listing them in KNOWN_DISK_CLASSES
    // described a class vocabulary the runner does not have.
    const survey = surveyOf({
      items: [
        item({
          id: "a",
          class: "sibling-worktree",
          status: "blocked",
          reason: "owned-by-worktree-reclaim",
          bytes: 10,
        }),
        item({
          id: "b",
          class: "container",
          status: "blocked",
          reason: "owned-by-build-pool",
          bytes: 20,
        }),
      ],
      census_status: "fresh",
    });
    expect(survey.items.map((i) => i.reason)).toEqual([
      "owned-by-worktree-reclaim",
      "owned-by-build-pool",
    ]);
    const totals = aggregateByClass(survey);
    expect(totals.map((t) => t.classId).sort()).toEqual([
      "container",
      "sibling-worktree",
    ]);
    // Owner-held roots ARE guard-held — something else owns the path — so they
    // belong in the blocked bucket, not the report-only one.
    const buckets = bucketTotals(totals);
    expect(buckets.blockedBytes).toBe(30);
    expect(buckets.reportOnlyBytes).toBe(0);
  });

  it("does not list the skip-reason tokens as classes", () => {
    expect(Object.hasOwn(KNOWN_DISK_CLASSES, "owned-by-worktree-reclaim")).toBe(
      false
    );
    expect(Object.hasOwn(KNOWN_DISK_CLASSES, "owned-by-build-pool")).toBe(
      false
    );
    // Exactly the runner's `TargetClass::all()`, and nothing else.
    expect(Object.keys(KNOWN_DISK_CLASSES).sort()).toEqual([
      "container",
      "in-repo-canonical",
      "sibling-nongit",
      "sibling-worktree",
    ]);
  });
});

describe("scan stats", () => {
  it("parses the walk's own report on itself", () => {
    const survey = surveyOf({
      items: [item()],
      scan: {
        dirs_visited: 12_345,
        truncated: true,
        read_errors: [{ path: "D:\\x", error: "permission denied" }],
        roots_with_unknown_bytes: 2,
        roots_with_partial_bytes: 1,
      },
      census_status: "fresh",
    });
    expect(survey.scan?.dirsVisited).toBe(12_345);
    expect(survey.scan?.truncated).toBe(true);
    expect(survey.scan?.readErrors).toHaveLength(1);
    expect(survey.scan?.readErrors[0].error).toBe("permission denied");
    expect(survey.scan?.rootsWithUnknownBytes).toBe(2);
    expect(survey.scan?.rootsWithPartialBytes).toBe(1);
  });

  it("is null when the runner sent none — UNKNOWN, not 'the walk was complete'", () => {
    expect(surveyOf({ items: [], census_status: "fresh" }).scan).toBeNull();
    expect(parseScanStats(undefined)).toBeNull();
    expect(parseScanStats("nope")).toBeNull();
  });

  it("records whether `truncated` was reported at all", () => {
    expect(parseScanStats({ dirs_visited: 5 })?.hasTruncatedField).toBe(false);
    expect(parseScanStats({ truncated: false })?.hasTruncatedField).toBe(true);
  });

  it("keeps an unreadable count as null rather than as zero", () => {
    const scan = parseScanStats({ dirs_visited: "many", truncated: false });
    expect(scan?.dirsVisited).toBeNull();
    expect(scan?.rootsWithUnknownBytes).toBeNull();
  });

  it("separates 'the LIST is short' from 'the listed rows are under-sized'", () => {
    // W6. A truncated walk whose listed roots were all sized exactly is a very
    // different answer from a complete walk with one unreadable subtree, and
    // only `scan` carries the first fact.
    const prefix = surveyOf({
      items: [item()],
      summary: { bytes_incomplete: false },
      scan: { dirs_visited: 200_000, truncated: true, read_errors: [] },
      census_status: "fresh",
    });
    expect(prefix.scan?.truncated).toBe(true);
    expect(prefix.bytesIncomplete).toBe(false);

    const underSized = surveyOf({
      items: [item({ bytes_partial: true })],
      summary: { bytes_incomplete: true },
      scan: { dirs_visited: 900, truncated: false, read_errors: [] },
      census_status: "fresh",
    });
    expect(underSized.scan?.truncated).toBe(false);
    expect(underSized.bytesIncomplete).toBe(true);
  });
});

describe("measuredZeroBuckets / rollupDisagreement", () => {
  it("refuses to certify zero from the mere PRESENCE of a rollup", () => {
    const survey = surveyOf({
      items: [],
      summary: {
        by_class: [
          { class: "container", roots: 40, verb: "reaper" },
          { class: "in-repo-canonical", roots: 0, verb: null },
        ],
      },
      census_status: "fresh",
    });
    // 40 roots against an empty item list is the runner telling us the list
    // is short -- rendering a `0 B` actionable tile there would be a
    // fabricated zero produced by the anti-fabrication check itself.
    expect(measuredZeroBuckets(survey).actionable).toBe(false);
    expect(measuredZeroBuckets(survey).reportOnly).toBe(true);
    expect(rollupDisagreement(survey)).toMatch(/MORE roots than it itemised/i);
    expect(canClaimNothingToReclaim(survey)).toBe(false);
  });

  it("refuses to certify zero from a PARTLY readable rollup", () => {
    const survey = surveyOf({
      items: [],
      summary: {
        by_class: [{ class: "container", roots: 0, verb: "reaper" }, 7],
      },
      census_status: "fresh",
    });
    expect(survey.byClassSkipped).toBe(1);
    expect(measuredZeroBuckets(survey).actionable).toBe(false);
  });

  it("flags a rollup whose root count could not be read", () => {
    const survey = surveyOf({
      items: [],
      summary: { by_class: [{ class: "container", roots: null }] },
      census_status: "fresh",
    });
    expect(Number.isNaN(survey.byClass?.[0].roots ?? 0)).toBe(true);
    expect(rollupDisagreement(survey)).toMatch(/could not be read/i);
  });
});

describe("per-status byte qualifiers", () => {
  it("keeps the blocked column's unknown counts off the reclaimable total", () => {
    const survey = surveyOf({
      items: [
        item({ id: "a", bytes: 100 }),
        item({ id: "b", status: "blocked", bytes: null }),
      ],
      census_status: "fresh",
    });
    const [totals] = aggregateByClass(survey);
    // The reclaimable total IS exact; the blocked one is the floor.
    expect(totals.reclaimableUnknownByteItems).toBe(0);
    expect(totals.blockedUnknownByteItems).toBe(1);
    const buckets = bucketTotals([totals]);
    expect(buckets.actionableUnknownByteItems).toBe(0);
    expect(buckets.blockedUnknownByteItems).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// X1: a class whose items disagree about `verb`. This is the shape the REAL
// machine produces, and the shape every other fixture in this file avoided --
// which is why both suites stayed green while the page told the operator there
// were no candidates for the classes the cleanup verb covers.
// ---------------------------------------------------------------------------

describe("a class whose roots disagree about `verb`", () => {
  /**
   * `sibling-worktree` as it actually arrives: `<wt>/target` is owned by the
   * worktree reclaim engine (blocked, verb stripped) and `<wt>/target-<slug>`
   * is this reaper's own (reclaimable, verb set). The runner's own test
   * `paths_owned_by_other_engines_are_reported_but_never_candidates` builds
   * exactly this.
   */
  const mixed = () =>
    surveyOf({
      items: [
        ownedElsewhereItem({ id: "a", bytes: 100 }),
        item({
          id: "b",
          path: "D:\\wt\\target-slug",
          class: "sibling-worktree",
          status: "reclaimable",
          verb: "orphan-target-reaper",
          bytes: 500,
        }),
      ],
      census_status: "fresh",
    });

  it("keeps the CLASS verb from the class, not from the first item", () => {
    const [totals] = aggregateByClass(mixed());
    expect(totals.classId).toBe("sibling-worktree");
    // Not `unrecognised`: the disagreement is the runner answering per root.
    expect(totals.verb).toBe("v1");
    expect(totals.note).toBe(KNOWN_DISK_CLASSES["sibling-worktree"].note);
    // ...and no note accusing the runner of contradicting itself.
    expect(totals.note).not.toMatch(/conflicting|contradict|unresolved/i);
  });

  it("routes each root on its OWN verdict — actionable bytes are not hidden", () => {
    const buckets = bucketTotals(aggregateByClass(mixed()));
    // Before the fix: actionable 0, unrecognised 500, and a hidden tile.
    expect(buckets.actionableBytes).toBe(500);
    expect(buckets.actionableItems).toBe(1);
    expect(buckets.unrecognisedBytes).toBe(0);
    expect(buckets.unrecognisedItems).toBe(0);
    // The owned-elsewhere root is held by another engine — blocked, not
    // report-only and not actionable.
    expect(buckets.blockedBytes).toBe(100);
    expect(buckets.blockedItems).toBe(1);
    expect(buckets.reportOnlyBytes).toBe(0);
  });

  it("still counts every root exactly once", () => {
    const buckets = bucketTotals(aggregateByClass(mixed()));
    expect(
      buckets.actionableBytes +
        buckets.reportOnlyBytes +
        buckets.unrecognisedBytes +
        buckets.blockedBytes
    ).toBe(600);
    expect(
      buckets.actionableItems +
        buckets.reportOnlyItems +
        buckets.unrecognisedItems +
        buckets.blockedItems
    ).toBe(2);
  });

  it("handles `sibling-nongit` mixed the same way (pool slots and agent dirs)", () => {
    const survey = surveyOf({
      items: [
        ownedElsewhereItem({
          id: "p",
          path: "D:\\target-pool\\slot-0",
          class: "sibling-nongit",
          reason: "owned-by-build-pool",
          bytes: 7,
        }),
        ownedElsewhereItem({
          id: "u",
          path: "D:\\target-agent",
          class: "sibling-nongit",
          reason: "ownership-unknown",
          bytes: 11,
        }),
        item({
          id: "o",
          path: "D:\\target-orphan",
          class: "sibling-nongit",
          status: "reclaimable",
          verb: "orphan-target-reaper",
          bytes: 13,
        }),
      ],
      census_status: "fresh",
    });
    const [totals] = aggregateByClass(survey);
    expect(totals.verb).toBe("v1");
    const buckets = bucketTotals([totals]);
    expect(buckets.actionableBytes).toBe(13);
    expect(buckets.blockedBytes).toBe(18);
    expect(buckets.unrecognisedBytes).toBe(0);
    expect(buckets.reportOnlyBytes).toBe(0);
  });

  it("never offers an owned-elsewhere root as actionable, whatever its status", () => {
    // Routing keys on the REASON the runner gave, not on the verb it stripped.
    // `reclaimable` beside `owned-by-build-pool` is a shape the runner cannot
    // emit; if one ever arrives, the owner's claim wins over the status —
    // offering another engine's slot for deletion is the expensive direction
    // to be wrong in.
    const survey = surveyOf({
      items: [
        item({
          id: "x",
          class: "sibling-nongit",
          status: "reclaimable",
          reason: "owned-by-build-pool",
          verb: "orphan-target-reaper",
          bytes: 64,
        }),
      ],
      census_status: "fresh",
    });
    const buckets = bucketTotals(aggregateByClass(survey));
    expect(buckets.actionableBytes).toBe(0);
    expect(buckets.blockedBytes).toBe(64);
  });

  it("keeps the per-bucket unknown/partial counts on the right tile", () => {
    const survey = surveyOf({
      items: [
        ownedElsewhereItem({ id: "a", bytes: null }),
        item({
          id: "b",
          class: "sibling-worktree",
          status: "reclaimable",
          verb: "orphan-target-reaper",
          bytes: 500,
          bytes_partial: true,
        }),
      ],
      census_status: "fresh",
    });
    const buckets = bucketTotals(aggregateByClass(survey));
    expect(buckets.actionablePartialByteItems).toBe(1);
    expect(buckets.actionableUnknownByteItems).toBe(0);
    expect(buckets.blockedUnknownByteItems).toBe(1);
    expect(buckets.blockedPartialByteItems).toBe(0);
  });
});
