/**
 * R3's audit for the continuation palette, plus the readings
 * `paletteDisagreements` cannot make — and the two production populations plan
 * `2026-09-09-continuation-dispatch-fails-silently-three-times-in-four` exists
 * to make visible.
 *
 * The judgements pinned here, each one a way the old surface got it wrong:
 *
 * 1. **A `spawn_failed` row is not a consumed row.** It carries
 *    `continuation_consumed_at`, so every reader asking "was this consumed?"
 *    answered *yes* while 21 gates had failed to open a session at all.
 * 2. **`spawned` is not success.** It says a process started and nothing ever
 *    reported whether the work happened. It must not read green, and it must
 *    not carry the `✓`.
 * 3. **A NULL outcome is neither.** `consumed_silent` must be distinguishable
 *    from both `work_completed` and `spawn_failed`.
 * 4. **Deferral pressure is legible.** 58 deferrals and 1 must not render the
 *    same, and a deferral that has been survived still shows.
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import {
  AUTHOR_RED,
  UNKNOWN_AMBER,
  WAITING_AMBER,
} from "@/components/console/statusRow";
import {
  CONTINUATION_ATTENTION_BY_KIND,
  CONTINUATION_AUTHOR_GLYPH_KINDS,
  CONTINUATION_KIND_CLASS,
  CONTINUATION_STATUS_PALETTE,
  CONTINUATION_UNKNOWN_OUTCOME_KINDS,
  DEFERRAL_SILENT_MS,
  DEFERRAL_STUCK_COUNT,
  DISPATCH_STALE_MS,
  deriveContinuationStatus,
  humanizeDeferralReason,
  type ContinuationKind,
  type ContinuationStatusInput,
} from "./continuationStatus";

const ALL = Object.keys(CONTINUATION_ATTENTION_BY_KIND) as ContinuationKind[];

/** Fixed clock so every age-derived reading is deterministic. */
const NOW = Date.parse("2026-09-09T12:00:00Z");
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const row = (over: Partial<ContinuationStatusInput> = {}): ContinuationStatusInput => ({
  continuation_spawn: { target_device_id: "abcdef1234567890" },
  ...over,
});

/** The derivation, or a thrown assertion — the tests below all expect a status. */
function derive(over: Partial<ContinuationStatusInput> = {}) {
  const s = deriveContinuationStatus(row(over), NOW);
  if (!s) throw new Error("expected a continuation status, got null");
  return s;
}

describe("continuation palette", () => {
  it("agrees with the attention table — red iff author, amber iff waiting", () => {
    expect(
      paletteDisagreements(
        CONTINUATION_ATTENTION_BY_KIND,
        CONTINUATION_STATUS_PALETTE
      )
    ).toEqual([]);
  });

  it("is total over the kind union", () => {
    for (const kind of ALL) {
      expect(CONTINUATION_KIND_CLASS[kind]).toBeTruthy();
    }
    expect(Object.keys(CONTINUATION_KIND_CLASS).sort()).toEqual(
      [...ALL].sort()
    );
  });

  it("names every author kind, and only those, in the glyph set", () => {
    const authors = ALL.filter(
      (k) => CONTINUATION_ATTENTION_BY_KIND[k] === "author"
    );
    expect([...CONTINUATION_AUTHOR_GLYPH_KINDS].sort()).toEqual(
      [...authors].sort()
    );
    // The six states where nothing retries and a human decides.
    expect([...CONTINUATION_AUTHOR_GLYPH_KINDS].sort()).toEqual([
      "deferral_abandoned",
      "deferral_stuck",
      "dispatch_stalled",
      "expired",
      "spawn_failed",
      "work_abandoned",
    ]);
  });

  it("gives the ✓ to work_completed alone — never to spawned", () => {
    expect([...(CONTINUATION_STATUS_PALETTE.doneGlyphKinds ?? [])]).toEqual([
      "work_completed",
    ]);
  });

  it("paints the four unknown-outcome kinds amber, and none of them red", () => {
    for (const kind of CONTINUATION_UNKNOWN_OUTCOME_KINDS) {
      expect(CONTINUATION_KIND_CLASS[kind]).toBe(UNKNOWN_AMBER);
      expect(CONTINUATION_ATTENTION_BY_KIND[kind]).toBe("waiting");
    }
  });

  it("keeps deferred amber and both deferral escalations red", () => {
    expect(CONTINUATION_KIND_CLASS.deferred).toBe(WAITING_AMBER);
    expect(CONTINUATION_KIND_CLASS.deferral_stuck).toBe(AUTHOR_RED);
    expect(CONTINUATION_KIND_CLASS.deferral_abandoned).toBe(AUTHOR_RED);
  });
});

describe("deriveContinuationStatus — no continuation", () => {
  it("returns null when nothing is attached and nothing was stamped", () => {
    expect(deriveContinuationStatus({}, NOW)).toBeNull();
    expect(
      deriveContinuationStatus(
        { continuation_spawn: null, continuation_deferred_count: 0 },
        NOW
      )
    ).toBeNull();
  });

  it("does not return null for a lifecycle stamp with no spawn payload", () => {
    // coord clears `continuation_spawn` on some paths but keeps the stamps; a
    // dispatched continuation must not read as "no continuation".
    const s = deriveContinuationStatus(
      {
        continuation_spawn: null,
        continuation_dispatched_at: minsAgo(1),
      },
      NOW
    );
    expect(s?.status.kind).toBe("dispatched");
  });
});

describe("deriveContinuationStatus — the outcome vocabulary", () => {
  it("reads a spawn_failed row as a FAILURE, not as consumed", () => {
    const s = derive({
      continuation_dispatched_at: minsAgo(90),
      // The shape of the 21-row production population, verbatim.
      continuation_consumed_at: minsAgo(89),
      continuation_consumed_outcome:
        "spawn_failed: no Tauri AppHandle (runner has no webview runtime) — cannot open a visible terminal",
    });
    expect(s.status.kind).toBe("spawn_failed");
    expect(s.status.attention).toBe("author");
    expect(s.status.label).toBe("spawn failed");
    expect(s.outcomeDetail).toBe(
      "no Tauri AppHandle (runner has no webview runtime) — cannot open a visible terminal"
    );
  });

  it("reads a bare spawn_failed with no detail", () => {
    const s = derive({
      continuation_dispatched_at: minsAgo(90),
      continuation_consumed_at: minsAgo(89),
      continuation_consumed_outcome: "spawn_failed",
    });
    expect(s.status.kind).toBe("spawn_failed");
    expect(s.outcomeDetail).toBeNull();
  });

  it("treats spawned as an OPEN question, never as success", () => {
    const s = derive({
      continuation_dispatched_at: minsAgo(90),
      continuation_consumed_at: minsAgo(89),
      continuation_consumed_outcome: "spawned",
    });
    expect(s.status.kind).toBe("spawned");
    expect(s.status.attention).toBe("waiting");
    expect(s.status.label).toContain("outcome unknown");
    expect(CONTINUATION_STATUS_PALETTE.doneGlyphKinds?.has("spawned")).toBe(
      false
    );
  });

  it("reads work_completed as the one success", () => {
    const s = derive({
      continuation_dispatched_at: minsAgo(90),
      continuation_consumed_at: minsAgo(89),
      continuation_consumed_outcome: "work_completed",
    });
    expect(s.status.kind).toBe("work_completed");
    expect(s.status.attention).toBe("none");
  });

  it("reads work_abandoned as somebody's move, with its detail", () => {
    const s = derive({
      continuation_dispatched_at: minsAgo(90),
      continuation_consumed_at: minsAgo(89),
      continuation_consumed_outcome: "work_abandoned: repo was locked",
    });
    expect(s.status.kind).toBe("work_abandoned");
    expect(s.status.attention).toBe("author");
    expect(s.outcomeDetail).toBe("repo was locked");
  });

  it("reads work_unreported as ignorance, not as failure", () => {
    const s = derive({
      continuation_dispatched_at: minsAgo(90),
      continuation_consumed_at: minsAgo(89),
      continuation_consumed_outcome: "work_unreported: terminal 4c1a",
    });
    expect(s.status.kind).toBe("work_unreported");
    expect(s.status.attention).toBe("waiting");
  });

  it("reads a NULL outcome on a consumed row as consumed_silent", () => {
    const s = derive({
      continuation_dispatched_at: minsAgo(90),
      continuation_consumed_at: minsAgo(89),
      continuation_consumed_outcome: null,
    });
    expect(s.status.kind).toBe("consumed_silent");
    // Neither success nor failure — the UX gate this plan is measured against.
    expect(s.status.attention).toBe("waiting");
    expect(CONTINUATION_KIND_CLASS.consumed_silent).toBe(UNKNOWN_AMBER);
  });

  it("quotes an unreadable outcome rather than guessing at it", () => {
    const s = derive({
      continuation_dispatched_at: minsAgo(90),
      continuation_consumed_at: minsAgo(89),
      continuation_consumed_outcome: "teleported",
    });
    expect(s.status.kind).toBe("unknown");
    expect(s.status.reason).toContain("teleported");
    expect(s.rawOutcome).toBe("teleported");
  });
});

describe("deriveContinuationStatus — dispatch and its staleness", () => {
  it("is calm while a fresh dispatch waits for a runner", () => {
    const s = derive({ continuation_dispatched_at: minsAgo(1) });
    expect(s.status.kind).toBe("dispatched");
    expect(s.status.attention).toBe("none");
  });

  it("escalates an unexplained silence past the stale window", () => {
    const justPast = new Date(NOW - DISPATCH_STALE_MS - 1_000).toISOString();
    const s = derive({ continuation_dispatched_at: justPast });
    expect(s.status.kind).toBe("dispatch_stalled");
    expect(s.status.attention).toBe("author");
    expect(s.status.reason).toContain("no deferral recorded");
  });

  it("never claims a device is offline — the signal is age only", () => {
    const s = derive({ continuation_dispatched_at: minsAgo(600) });
    expect(s.status.reason).not.toMatch(/offline|dead|down/i);
  });

  it("refuses to judge a dispatch whose time it cannot read, with nothing else to go on", () => {
    // Both readings above rest entirely on the age test. An unparseable stamp
    // used to fall through to the CALM one — a positive claim ("waiting for a
    // runner to claim it") whose only evidence is an unreadable string. This
    // arm is reached ONLY when no deferral offers an alternative reading.
    const s = derive({ continuation_dispatched_at: "not a timestamp" });
    expect(s.status.kind).toBe("unknown");
    expect(s.status.attention).toBe("waiting");
    expect(s.status.label).toBe("dispatch time unreadable");
    expect(s.status.reason).toContain("not a timestamp");
    expect(s.status.reason).toContain("no deferral was recorded either");
  });

  it("keeps a known-stuck count red when the DISPATCH time is the unreadable one", () => {
    // The mirror of the deferral-time case, and it must answer the same way:
    // the count test depends on neither timestamp, and the two corruption
    // cases have identical reachability. Hoisting the dispatch read above the
    // deferral branch had re-opened this hole one column over — the row read
    // `unknown` / waiting and fell out of the needs-attention count and filter.
    const s = derive({
      continuation_dispatched_at: "not a timestamp",
      continuation_deferred_at: minsAgo(30),
      continuation_deferred_reason: "thread_pressure:critical:540_over_400",
      continuation_deferred_count: 58,
    });
    expect(s.status.kind).toBe("deferral_stuck");
    expect(s.status.attention).toBe("author");
    expect(s.deferralRendered).toBe(true);
    // It names the test it could not run rather than implying it ran.
    expect(s.status.reason).toContain(
      "no readable dispatch time, so whether this deferral belongs to the dispatch now in flight could not be checked"
    );
  });

  it("answers both unreadable-timestamp cases the same way when the count is stuck", () => {
    const kindOf = (over: Partial<ContinuationStatusInput>) =>
      derive({
        continuation_dispatched_at: minsAgo(10_000),
        continuation_deferred_at: minsAgo(30),
        continuation_deferred_reason: "at_cap:4",
        continuation_deferred_count: 58,
        ...over,
      }).status;
    const badDispatch = kindOf({ continuation_dispatched_at: "nope" });
    const badDeferral = kindOf({ continuation_deferred_at: "nope" });
    expect(badDispatch.kind).toBe("deferral_stuck");
    expect(badDeferral.kind).toBe("deferral_stuck");
    expect(badDispatch.attention).toBe(badDeferral.attention);
  });

  it("still reads a fresh deferral when only the dispatch time is corrupt", () => {
    // Currency is undecidable, but the deferral's own age is not: coord only
    // stamps a deferral on a dispatched, unconsumed row, so a stamp 30 minutes
    // old is evidence a runner was pulling this 30 minutes ago whatever the
    // dispatch column says.
    const s = derive({
      continuation_dispatched_at: "not a timestamp",
      continuation_deferred_at: minsAgo(30),
      continuation_deferred_reason: "at_cap:4",
      continuation_deferred_count: 2,
    });
    expect(s.status.kind).toBe("deferred");
    expect(s.status.attention).toBe("waiting");
    expect(s.status.reason).toContain("could not be checked");
  });
});

describe("deriveContinuationStatus — deferral pressure", () => {
  it("distinguishes one deferral from 58", () => {
    const once = derive({
      continuation_dispatched_at: minsAgo(120),
      continuation_deferred_at: minsAgo(60),
      continuation_deferred_reason: "thread_pressure:warn:300_over_256",
      continuation_deferred_count: 1,
    });
    const many = derive({
      continuation_dispatched_at: minsAgo(6000),
      continuation_deferred_at: minsAgo(30),
      continuation_deferred_reason: "thread_pressure:critical:540_over_400",
      continuation_deferred_count: 58,
    });
    expect(once.status.label).toBe("deferred ×1");
    expect(many.status.label).toBe("deferred ×58");
    expect(once.status.kind).toBe("deferred");
    expect(once.status.attention).toBe("waiting");
    expect(many.status.kind).toBe("deferral_stuck");
    expect(many.status.attention).toBe("author");
  });

  it("escalates exactly at DEFERRAL_STUCK_COUNT", () => {
    const at = (n: number) =>
      derive({
        continuation_dispatched_at: minsAgo(600),
        continuation_deferred_at: minsAgo(30),
        continuation_deferred_reason: "at_cap:4",
        continuation_deferred_count: n,
      }).status.kind;
    expect(at(DEFERRAL_STUCK_COUNT - 1)).toBe("deferred");
    expect(at(DEFERRAL_STUCK_COUNT)).toBe("deferral_stuck");
  });

  // --- the SILENCE arm ------------------------------------------------------
  //
  // The asymmetry this closes: a row dispatched 16 minutes ago with no
  // deferral read red `dispatch_stalled`, while one dispatched days ago and
  // deferred twice days ago read calm amber over a reason string promising it
  // was still "re-deliverable". The runner re-lists a deferred row every ~300s
  // and stamps at most hourly, so a `deferred_at` past three stamp intervals
  // means nothing is pulling it — `dispatch_stalled`'s condition, with a
  // reason attached.

  it("escalates a QUIET deferral to red however few times it was pushed back", () => {
    const s = derive({
      continuation_dispatched_at: minsAgo(6 * 24 * 60),
      continuation_deferred_at: minsAgo(6 * 24 * 60),
      continuation_deferred_reason: "at_cap:4",
      continuation_deferred_count: 2,
    });
    expect(s.status.kind).toBe("deferral_abandoned");
    expect(s.status.attention).toBe("author");
    expect(s.status.label).toContain("deferred ×2");
    expect(s.status.label).toContain("nothing pulling");
    // The reason it was refused is KEPT — the escalation adds a fact, it does
    // not replace the one coord recorded.
    expect(s.status.reason).toContain("continuation cap of 4");
    // ...and it no longer promises the row is coming back.
    expect(s.status.reason).not.toContain("re-deliverable");
  });

  it("escalates exactly at DEFERRAL_SILENT_MS", () => {
    const at = (ms: number) =>
      derive({
        continuation_dispatched_at: minsAgo(10_000),
        continuation_deferred_at: new Date(NOW - ms).toISOString(),
        continuation_deferred_reason: "at_cap:4",
        continuation_deferred_count: 2,
      }).status.kind;
    expect(at(DEFERRAL_SILENT_MS - 1_000)).toBe("deferred");
    expect(at(DEFERRAL_SILENT_MS)).toBe("deferral_abandoned");
  });

  it("lets silence beat the count when both fire", () => {
    // 58 deferrals AND quiet for days: "nothing is pulling this" is the fact
    // that changes what the operator does, and it needs a different fix from a
    // row still being actively refused.
    const s = derive({
      continuation_dispatched_at: minsAgo(10_000),
      continuation_deferred_at: minsAgo(10_000),
      continuation_deferred_reason: "thread_pressure:critical:540_over_400",
      continuation_deferred_count: 58,
    });
    expect(s.status.kind).toBe("deferral_abandoned");
  });

  it("still reads a FRESH high-count deferral as actively refused, not abandoned", () => {
    const s = derive({
      continuation_dispatched_at: minsAgo(10_000),
      continuation_deferred_at: minsAgo(10),
      continuation_deferred_reason: "thread_pressure:critical:540_over_400",
      continuation_deferred_count: 58,
    });
    expect(s.status.kind).toBe("deferral_stuck");
    expect(s.status.reason).toContain("still doing so");
  });

  it("refuses to judge a deferral whose time it cannot read", () => {
    // The silence test is the whole basis of the amber reading here, so
    // without a readable stamp neither amber nor red is available — UNLESS the
    // count already settles it (the case below).
    const s = derive({
      continuation_dispatched_at: minsAgo(10_000),
      continuation_deferred_at: "not a timestamp",
      continuation_deferred_reason: "at_cap:4",
      continuation_deferred_count: 2,
    });
    expect(s.status.kind).toBe("unknown");
    expect(s.status.attention).toBe("waiting");
    expect(s.status.reason).toContain("cannot be established");
  });

  it("keeps a known-stuck count red when only the TIME is missing", () => {
    // The count test needs no timestamp. Letting ignorance about *when* erase
    // a judgement that never depended on knowing when would put the row below
    // the evidence — the ignorance floor upside down.
    const s = derive({
      continuation_dispatched_at: minsAgo(10_000),
      continuation_deferred_at: null,
      continuation_deferred_reason: "thread_pressure:critical:540_over_400",
      continuation_deferred_count: 58,
    });
    expect(s.status.kind).toBe("deferral_stuck");
    expect(s.status.attention).toBe("author");
    // ...and it says which test it could not run, rather than implying it did.
    expect(s.status.reason).toContain("could not be checked");
  });

  // --- whose dispatch is the deferral about? --------------------------------
  //
  // coord's `stamp_continuation_dispatched` re-stamps
  // `continuation_dispatched_at`, NULLs the two expiry columns and touches
  // NONE of the three deferral columns; no writer anywhere in coord resets
  // them. So a re-dispatched gate carries the previous cycle's deferral
  // stamps, by design.

  it("does not call a freshly re-dispatched row abandoned on old deferral stamps", () => {
    const s = derive({
      // Dispatched three seconds ago; deferral stamps ~2.8 days old.
      continuation_dispatched_at: new Date(NOW - 3_000).toISOString(),
      continuation_deferred_at: minsAgo(4_000),
      continuation_deferred_reason: "at_cap:4",
      continuation_deferred_count: 3,
    });
    expect(s.status.kind).toBe("dispatched");
    expect(s.status.attention).toBe("none");
    expect(s.status.reason).toContain("re-dispatched");
    expect(s.status.reason).toContain("from an earlier dispatch");
    // The deferrals are not lost — they become history the panel still reports.
    expect(s.deferral?.count).toBe(3);
    expect(s.deferralRendered).toBe(false);
  });

  it("judges a re-dispatched row on the DISPATCH age, not the stale deferral", () => {
    const s = derive({
      continuation_dispatched_at: new Date(
        NOW - DISPATCH_STALE_MS - 1_000
      ).toISOString(),
      continuation_deferred_at: minsAgo(4_000),
      continuation_deferred_reason: "at_cap:4",
      continuation_deferred_count: 3,
    });
    expect(s.status.kind).toBe("dispatch_stalled");
    expect(s.status.attention).toBe("author");
    expect(s.status.reason).toContain("from an earlier dispatch");
  });

  it("still uses the deferral when it belongs to the dispatch in flight", () => {
    // Deferred AFTER the dispatch — the ordinary case, and the boundary is
    // inclusive because a deferral stamped in the same instant is this cycle's.
    const s = derive({
      continuation_dispatched_at: minsAgo(120),
      continuation_deferred_at: minsAgo(120),
      continuation_deferred_reason: "at_cap:4",
      continuation_deferred_count: 3,
    });
    expect(s.status.kind).toBe("deferred");
    expect(s.deferralRendered).toBe(true);
  });

  it("prefers the stated deferral over an unexplained stall", () => {
    // Dispatched days ago and never consumed — but a runner said WHY, so the
    // row must report the reason rather than manufacture a mystery.
    const s = derive({
      continuation_dispatched_at: minsAgo(10_000),
      continuation_deferred_at: minsAgo(30),
      continuation_deferred_reason: "at_cap:4",
      continuation_deferred_count: 3,
    });
    expect(s.status.kind).toBe("deferred");
  });

  it("marks a deferral as NOT the rendered state once the row has moved past it", () => {
    const s = derive({
      continuation_dispatched_at: minsAgo(500),
      continuation_deferred_at: minsAgo(400),
      continuation_deferred_reason: "at_cap:4",
      continuation_deferred_count: 12,
      continuation_consumed_at: minsAgo(200),
      continuation_consumed_outcome: "spawn_failed: no AppHandle",
    });
    expect(s.status.kind).toBe("spawn_failed");
    expect(s.deferralRendered).toBe(false);
  });

  it("marks every deferral-derived reading as rendering the deferral", () => {
    // The flag is what the table excludes the history chip on, so it must be
    // true for EVERY arm of the deferral branch — including the `unknown` one,
    // whose kind three unrelated branches also produce.
    const arms: Array<[string, Partial<ContinuationStatusInput>]> = [
      ["deferred", { continuation_deferred_count: 2 }],
      ["deferral_stuck", { continuation_deferred_count: 58 }],
      [
        "deferral_abandoned",
        {
          continuation_deferred_at: minsAgo(10_000),
          continuation_deferred_count: 2,
        },
      ],
      [
        "unknown",
        { continuation_deferred_at: "not a timestamp", continuation_deferred_count: 2 },
      ],
    ];
    for (const [expected, over] of arms) {
      const s = derive({
        continuation_dispatched_at: minsAgo(20_000),
        continuation_deferred_at: minsAgo(30),
        continuation_deferred_reason: "at_cap:4",
        ...over,
      });
      expect(s.status.kind).toBe(expected);
      expect(s.deferralRendered).toBe(true);
    }
  });

  it("keeps reporting the deferrals a row has already moved past", () => {
    const s = derive({
      continuation_dispatched_at: minsAgo(500),
      continuation_deferred_at: minsAgo(400),
      continuation_deferred_reason: "thread_pressure:warn:300_over_256",
      continuation_deferred_count: 12,
      continuation_consumed_at: minsAgo(200),
      continuation_consumed_outcome: "work_completed",
    });
    expect(s.status.kind).toBe("work_completed");
    expect(s.deferral?.count).toBe(12);
    expect(s.deferral?.stuck).toBe(false);
  });

  it("renders a missing count as UNKNOWN, never as zero", () => {
    const s = derive({
      continuation_dispatched_at: minsAgo(120),
      continuation_deferred_at: minsAgo(60),
      continuation_deferred_reason: "at_cap:4",
      continuation_deferred_count: null,
    });
    expect(s.deferral?.countKnown).toBe(false);
    expect(s.status.label).toBe("deferred ×?");
  });

  it("reports no deferral at all when the count is zero and nothing was stamped", () => {
    const s = derive({
      continuation_dispatched_at: minsAgo(1),
      continuation_deferred_count: 0,
    });
    expect(s.deferral).toBeNull();
  });

  it("reports a genuine zero count as a MEASUREMENT, not as a missing one", () => {
    // A stamped deferral carrying `deferred_count: 0` is a real reading of a
    // real column. It used to render `deferred ×?` — the same rendering as "no
    // count came with it" — which is the null/zero collapse this module
    // refuses everywhere else.
    const s = derive({
      continuation_dispatched_at: minsAgo(60),
      continuation_deferred_at: minsAgo(30),
      continuation_deferred_reason: "at_cap:4",
      continuation_deferred_count: 0,
    });
    expect(s.deferral?.countKnown).toBe(true);
    expect(s.deferral?.count).toBe(0);
    expect(s.status.label).toBe("deferred ×0");
  });
});

describe("deriveContinuationStatus — terminal by decision", () => {
  it("puts cancellation ahead of every other stamp", () => {
    const s = derive({
      continuation_dispatched_at: minsAgo(500),
      continuation_consumed_at: minsAgo(400),
      continuation_consumed_outcome: "spawn_failed: whatever",
      continuation_cancelled_at: minsAgo(10),
      continuation_cancel_reason: "taken over by hand",
    });
    expect(s.status.kind).toBe("cancelled");
    expect(s.status.attention).toBe("none");
    expect(s.status.reason).toContain("taken over by hand");
  });

  it("keeps EXPIRY when a cancel lands on an already-expired row", () => {
    // coord's cancel writer guards only on consumed/cancelled being NULL, so
    // this row shape is reachable. Ordering `cancelled` first turned an
    // alerted `ttl_7d_elapsed` into a calm grey badge with attention `none`.
    const s = derive({
      continuation_dispatched_at: minsAgo(20_000),
      continuation_expired_at: minsAgo(100),
      continuation_expired_reason: "ttl_7d_elapsed",
      continuation_cancelled_at: minsAgo(10),
      continuation_cancel_reason: "tidying up",
    });
    expect(s.status.kind).toBe("expired");
    expect(s.status.attention).toBe("author");
    // The cancellation is named, not dropped.
    expect(s.status.reason).toContain("cancellation was recorded afterwards");
  });

  it("reads expiry as somebody's move — nothing re-arms it", () => {
    const s = derive({
      continuation_dispatched_at: minsAgo(20_000),
      continuation_expired_at: minsAgo(10),
      continuation_expired_reason: "ttl_7d_elapsed",
    });
    expect(s.status.kind).toBe("expired");
    expect(s.status.attention).toBe("author");
    expect(s.status.reason).toContain("ttl_7d_elapsed");
  });
});

describe("deriveContinuationStatus — armed vs inert", () => {
  it("reads an attached, undispatched continuation as armed", () => {
    const s = derive({ continuation_action: "run_skill" });
    expect(s.status.kind).toBe("armed");
    expect(s.status.reason).toContain("run_skill");
  });

  it("reads coord's will_dispatch=false as INERT rather than armed", () => {
    const s = derive({
      continuation_action: "notify_only",
      continuation_will_dispatch: false,
    });
    expect(s.status.kind).toBe("inert");
    expect(s.status.label).toBe("no dispatch");
  });

  it("stays armed when the build serves no will_dispatch predicate", () => {
    // A coord predating the honesty predicate omits it. "A continuation is
    // attached" is still true, so the row says that and no more.
    const s = derive({ continuation_will_dispatch: null });
    expect(s.status.kind).toBe("armed");
  });
});

describe("humanizeDeferralReason", () => {
  it("expands the thread-pressure grammar", () => {
    expect(humanizeDeferralReason("thread_pressure:critical:540_over_400")).toBe(
      "the machine was out of OS threads (critical) — 540 observed against a limit of 400"
    );
  });

  it("expands the other three producer constructors", () => {
    expect(humanizeDeferralReason("at_cap:4")).toContain(
      "continuation cap of 4"
    );
    expect(humanizeDeferralReason("duplicate_anchor:term-9f")).toContain(
      "terminal term-9f"
    );
    expect(humanizeDeferralReason("spawn_authorization_deny")).toContain(
      "agent registry refused the spawn (deny)"
    );
  });

  it("returns an unrecognised reason verbatim rather than blanking it", () => {
    // coord writes this one directly, and it is already plain English.
    expect(humanizeDeferralReason("no runner online")).toBe("no runner online");
    expect(humanizeDeferralReason("thread_pressure:malformed")).toBe(
      "thread_pressure:malformed"
    );
  });

  it("is null only for a genuinely absent reason", () => {
    expect(humanizeDeferralReason(null)).toBeNull();
    expect(humanizeDeferralReason("   ")).toBeNull();
  });
});
