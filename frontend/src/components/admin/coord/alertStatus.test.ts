/**
 * alertStatus — pure status derivation for `coord.alerts` rows.
 *
 * Modelled on `prPipeline.test.ts`: no rendering, no DOM, no fixtures beyond
 * the payload shapes coord actually serves. The three contracts this file
 * exists to hold are the ones the plan
 * `2026-08-05-coord-alerts-surface-and-fleet-style-ui.md` names:
 *
 *   1. `ATTENTION_BY_KIND` is TOTAL over `AlertKind`, and the badge palette
 *      agrees with it (red iff `author`, amber iff `waiting`).
 *   2. NO UUID reaches the default view — not through `alert_key`, not through
 *      coord's own summary strings (which interpolate `device_id`).
 *   3. An unrecognised kind degrades to `unknown` with severity-derived
 *      attention, and never crashes and never renders as calm-by-default.
 *
 * The row payloads below are the live 2026-08-14 production shapes.
 */

import { describe, expect, it } from "vitest";
import {
  ATTENTION_BY_KIND,
  alertGuidance,
  alertSubject,
  attentionFromSeverity,
  classifyAlertKind,
  containsUuid,
  deriveAlertStatus,
  detailEntries,
  stripUuids,
  subjectFromAlertKey,
  type AlertKind,
  type CoordAlertRow,
} from "./alertStatus";
import { paletteDisagreements } from "@/components/console/attention";
import {
  ALERT_AUTHOR_GLYPH_KINDS,
  ALERT_BADGE_CLASS,
  ALERT_PER_ROW_KINDS,
  alertPaletteFor,
} from "./AlertRow";

const DEVICE = "c79a07d5-7e40-49b4-87fa-554c749f9644";

function row(overrides: Partial<CoordAlertRow> = {}): CoordAlertRow {
  return {
    id: 1,
    alert_key: `stale-tree:${DEVICE}:qontinui-runner-wt-mtobs`,
    severity: "critical",
    kind: "stale_primary_tree",
    device_id: DEVICE,
    summary: `primary tree ${DEVICE}/qontinui/qontinui-web is stale (behind) — branch=main`,
    first_seen_at: "2026-08-14T20:00:00Z",
    last_seen_at: "2026-08-14T21:41:00Z",
    occurrences: 42,
    resolved_at: null,
    detail: {
      device_id: DEVICE,
      repo: "qontinui/qontinui-web",
      branch: "main",
      default_branch: "main",
      head_sha: "abc1234",
      behind_default_count: 298,
      tree_clean: false,
      untracked_count: 3,
    },
    ...overrides,
  };
}

// ----------------------------------------------------------------------------
// Contract 1 — the kind → attention table is total, and the palette agrees
// ----------------------------------------------------------------------------

describe("ATTENTION_BY_KIND totality", () => {
  // Written out rather than derived from the table, so ADDING a kind to the
  // union without deciding its attention fails here instead of rendering with
  // no attention semantics — the failure mode that rotted the old hardcoded
  // `KINDS` list.
  const ALL_KINDS: AlertKind[] = [
    "stale-tree",
    "stale-wip",
    "git-invariant",
    "worktree-waste",
    "disk-danger",
    "red-main",
    "auth-config",
    "merge-stuck",
    "machine-health",
    "replication",
    "land-integrity",
    "gate-stuck",
    "gate-pending",
    "config-drift",
    "session-health",
    "serving-drift",
    "backfill-gap",
    "resolved",
    "unknown",
  ];

  it("has an attention for every kind, and no extra entries", () => {
    for (const kind of ALL_KINDS) {
      expect(ATTENTION_BY_KIND[kind], `${kind} has no attention`).toBeTruthy();
    }
    expect(Object.keys(ATTENTION_BY_KIND).sort()).toEqual(
      [...ALL_KINDS].sort()
    );
  });

  it("has a badge class and a guidance line for every kind", () => {
    for (const kind of ALL_KINDS) {
      expect(ALERT_BADGE_CLASS[kind], `${kind} has no badge class`).toBeTruthy();
      expect(alertGuidance(kind), `${kind} has no guidance`).toBeTruthy();
    }
  });

  it("keys the palette off attention — red only for author-action", () => {
    // The SHARED R3 audit (`console/attention.ts`), not a private copy of it.
    // This surface's inline version predated `paletteDisagreements` — it IS
    // what the shared helper was generalised from — and it was the only
    // console palette still auditing itself, so the exemplar was drifting
    // behind the pattern it set.
    //
    // `perRowKinds` exempts `unknown` because its attention is per-row
    // (severity-derived) and `alertPaletteFor` resolves what actually renders
    // — asserted below. Note the exemption is the same SET as the inline
    // check's, but not the same SHAPE: the inline
    // `attention === "waiting" && kind !== "unknown"` positively asserted that
    // `unknown`'s badge is NOT amber, whereas `perRowKinds` skips clause (3)
    // for it entirely. That one bit is no longer pinned. It is deliberate
    // rather than overlooked: amber there would be MORE R3-compliant, not
    // less, so the lost assertion guarded against an improvement.
    expect(
      paletteDisagreements(
        ATTENTION_BY_KIND,
        { badgeClass: ALERT_BADGE_CLASS, authorGlyphKinds: ALERT_AUTHOR_GLYPH_KINDS },
        { perRowKinds: ALERT_PER_ROW_KINDS }
      )
    ).toEqual([]);
  });

  it("paints an ESCALATED row from its computed attention, not its kind's floor", () => {
    // The whole palette rule is that COLOUR encodes who must act. Reading the
    // class straight off the static table would paint a `critical`
    // `machine_degraded` amber, and an unclassified `critical` neutral grey,
    // with only the thin left-edge accent carrying the red.
    const escalated = deriveAlertStatus(
      row({ kind: "machine_degraded", severity: "critical" })
    );
    expect(escalated.attention).toBe("author");
    const palette = alertPaletteFor(escalated);
    expect(palette.badgeClass[escalated.kind]).toMatch(/bg-red-/);
    expect(palette.authorGlyphKinds.has(escalated.kind)).toBe(true);

    const unknownCritical = deriveAlertStatus(
      row({ kind: "brand_new_watcher_2027", severity: "critical" })
    );
    const unknownPalette = alertPaletteFor(unknownCritical);
    expect(unknownPalette.badgeClass.unknown).toMatch(/bg-red-/);
    expect(unknownPalette.authorGlyphKinds.has("unknown")).toBe(true);

    const unknownWarning = deriveAlertStatus(
      row({ kind: "brand_new_watcher_2027", severity: "warning" })
    );
    expect(alertPaletteFor(unknownWarning).badgeClass.unknown).toMatch(
      /bg-amber-/
    );

    // An UNescalated row reuses the shared constant — no per-render allocation.
    const plain = deriveAlertStatus(row({ severity: "critical" }));
    expect(alertPaletteFor(plain).badgeClass).toBe(ALERT_BADGE_CLASS);
  });

  // The `✕`-on-exactly-the-author-kinds loop that stood here is now clause (4)
  // of `paletteDisagreements`, asserted by the test above.
  //
  // It is worth being exact about WHY it went, because the tempting reason is
  // wrong: the shared clause is NOT strictly stronger. Forward containment
  // plus set-size equality already implies set equality, so the loop and the
  // clause pin the same property. The real reason is duplication that was
  // already shipped — Wave 1's `console/attention.test.ts` runs
  // `paletteDisagreements` over THIS palette, with this same `perRowKinds`,
  // as its worked example. The loop was a third copy of an assertion two
  // other places already make.
});

// ----------------------------------------------------------------------------
// Contract 2 — no UUID reaches the default view
// ----------------------------------------------------------------------------

describe("UUID hygiene", () => {
  it("strips the device UUID coord interpolates into its own summaries", () => {
    // `stale_wip_watcher.rs` writes `"primary tree {device_id}/{repo} …"`, so
    // rendering `summary` verbatim would breach the hard rule sideways.
    const cleaned = stripUuids(
      `primary tree ${DEVICE}/qontinui/qontinui-web has been dirty for 9h`
    );
    expect(containsUuid(cleaned)).toBe(false);
    // The separator the removed UUID stranded goes with it.
    expect(cleaned).toBe(
      "primary tree qontinui/qontinui-web has been dirty for 9h"
    );
  });

  it("leaves a UUID-free string BYTE-FOR-BYTE — URLs included", () => {
    // The tidy-up used to run unconditionally, and its slash rule matched the
    // first `/` of `://`: every `https://…` in a `red_main` / `pr_merge_*`
    // summary came out as `https: …`. A string with no UUID is not this
    // function's business.
    const withUrl =
      "Main CI for jspinak/qontinui-runner is RED — see " +
      "https://github.com/jspinak/qontinui-runner/actions/runs/1234567890";
    expect(stripUuids(withUrl)).toBe(withUrl);

    const plain = "12 commits behind main, 3 untracked files";
    expect(stripUuids(plain)).toBe(plain);
  });

  it("keeps a URL usable when a UUID is stripped from elsewhere in the string", () => {
    const s = `device ${DEVICE} — https://github.com/qontinui/qontinui-web/pull/761`;
    const cleaned = stripUuids(s);
    expect(containsUuid(cleaned)).toBe(false);
    expect(cleaned).toContain(
      "https://github.com/qontinui/qontinui-web/pull/761"
    );
  });

  it("cleans the brackets a stripped UUID empties, and the truncated form", () => {
    expect(stripUuids(`worktree {${DEVICE}} is stale`)).toBe(
      "worktree is stale"
    );
    expect(stripUuids(`worktree (${DEVICE}) is stale`)).toBe(
      "worktree is stale"
    );
    // "a truncated UUID is still a UUID" — the deleted AlertCard's `slice(0,8)`
    // spelling, matched only WITH its ellipsis (see the comment on
    // TRUNCATED_UUID_RE for why bare 8-hex is deliberately left alone: it is
    // indistinguishable from the `head_sha` short SHAs the UI legitimately
    // shows).
    expect(stripUuids(`device ${DEVICE.slice(0, 8)}… is degraded`)).toBe(
      "device is degraded"
    );
    const shortSha = "head_sha deadbeef is behind";
    expect(stripUuids(shortSha)).toBe(shortSha);
  });

  it("sanitises `reason` on EVERY branch, not just the summary fallback", () => {
    // `reasonFor` interpolates `detail` values raw — `default_branch` and
    // `workflows` are operator-visible in three places (the row line, its
    // title, and the badge title). The strip happens once at the exit of
    // `deriveAlertStatus`, so a new branch is covered by construction.
    const branchLeak = deriveAlertStatus(
      row({
        detail: {
          repo: "qontinui/qontinui-web",
          default_branch: `main-${DEVICE}`,
          behind_default_count: 4,
        },
      })
    );
    expect(containsUuid(branchLeak.reason)).toBe(false);
    expect(branchLeak.reason).toContain("4 commits behind");

    const workflowLeak = deriveAlertStatus(
      row({
        kind: "red_main",
        detail: { repo: "a/b", workflows: [`CI-${DEVICE}`] },
      })
    );
    expect(containsUuid(workflowLeak.reason)).toBe(false);
  });

  it("derives the subject from detail, never from the alert key", () => {
    expect(alertSubject(row())).toBe("qontinui/qontinui-web · main");
  });

  it("falls back to the NON-UUID tail of the alert key, not the whole key", () => {
    // `stale-tree:<uuid>:qontinui-runner-wt-mtobs` — the worktree name is the
    // thing a human recognises; the namespace and the UUID are not.
    expect(
      subjectFromAlertKey(`stale-tree:${DEVICE}:qontinui-runner-wt-mtobs`)
    ).toBe("qontinui-runner-wt-mtobs");
    // With the kind in hand the restated "disk_danger" segment drops — the
    // status LABEL already says "Disk nearly full"; the volume is the news.
    expect(
      subjectFromAlertKey("worktree:disk_danger::D:", "worktree_disk_danger")
    ).toBe("D");
    // Without it, nothing is dropped but nothing is invented either.
    expect(subjectFromAlertKey("worktree:disk_danger::D:")).toBe(
      "disk_danger · D"
    );
  });

  it("returns an empty subject rather than a machine key when nothing is human-readable", () => {
    expect(subjectFromAlertKey(`red_main:${DEVICE}`)).toBe("");
    const bare = row({ detail: undefined, alert_key: `x:${DEVICE}` });
    expect(alertSubject(bare)).toBe("");
  });

  it("never emits a UUID in any default-view string, for any kind", () => {
    const kinds = [
      "stale_primary_tree",
      "stale_wip",
      "git_inv-2",
      "worktree_unjunctioned",
      "worktree_disk_danger",
      "red_main",
      "auth_client_aud_active_negation",
      "pr_merge_land_conflict_wedged",
      "a_kind_this_build_has_never_seen",
    ];
    for (const kind of kinds) {
      const r = row({
        kind,
        alert_key: `${kind}:${DEVICE}`,
        summary: `watcher ${DEVICE} says ${kind} on device ${DEVICE}`,
        detail: { device_id: DEVICE, owner_id: DEVICE },
      });
      const status = deriveAlertStatus(r);
      for (const s of [status.label, status.reason, alertSubject(r)]) {
        expect(containsUuid(s), `${kind}: "${s}" leaks a UUID`).toBe(false);
      }
    }
  });

  it("drops device_id and every UUID-valued entry from the expanded detail", () => {
    const entries = detailEntries(
      row({ detail: { device_id: DEVICE, session_id: DEVICE, repo: "a/b" } })
    );
    expect(entries.map((e) => e.key)).toEqual(["repo"]);
  });
});

// ----------------------------------------------------------------------------
// Contract 3 — the live kinds, and graceful degradation on an unknown one
// ----------------------------------------------------------------------------

describe("classifyAlertKind", () => {
  const CASES: Array<[string, AlertKind]> = [
    ["stale_primary_tree", "stale-tree"],
    ["repo_pull_hold", "stale-tree"],
    ["stale_wip", "stale-wip"],
    ["orphaned_wip", "stale-wip"],
    ["git_inv-2", "git-invariant"],
    ["git_inv-1", "git-invariant"],
    ["worktree_unjunctioned", "worktree-waste"],
    ["worktree_repair_husks", "worktree-waste"],
    ["worktree_disk_danger", "disk-danger"],
    ["red_main", "red-main"],
    ["auth_client_aud_active_negation", "auth-config"],
    ["pr_merge_land_conflict_wedged", "merge-stuck"],
    ["pr_merge_green_unlanded", "merge-stuck"],
    ["pr_merge_train_stalled", "merge-stuck"],
    ["machine_degraded", "machine-health"],
    ["fleet_partitioned", "machine-health"],
    // Added 2026-08-24 — the families that measured `unknown` in production.
    ["gate_unclearable_terminal", "gate-stuck"],
    ["gate_continuation_pending", "gate-pending"],
    ["gate_stale_open", "gate-pending"],
    ["coord_lost_land", "land-integrity"],
    ["land_verification_stalled", "land-integrity"],
    ["coord_bare_stale_seed", "land-integrity"],
    ["mirror_ref_rejected_persistently", "replication"],
    ["git_no_sync_target", "replication"],
    ["git_conflict_ref_missing", "replication"],
    ["merge_land_replication_failed", "replication"],
    ["expectation_stall_candidate", "session-health"],
    ["session_message_delivery_blocked", "session-health"],
    ["config_armed_but_inert", "config-drift"],
    ["branch_protection_required_contexts", "config-drift"],
    ["route_serving_drift", "serving-drift"],
    ["memory_embedding_gap", "backfill-gap"],
    ["pr_stuck_unattributable", "merge-stuck"],
    ["pr_reconciler_drift", "merge-stuck"],
  ];

  it.each(CASES)("maps %s → %s", (raw, expected) => {
    expect(classifyAlertKind(row({ kind: raw }))).toBe(expected);
  });

  it("classifies an unseen kind as unknown rather than throwing", () => {
    expect(classifyAlertKind(row({ kind: "brand_new_watcher_2027" }))).toBe(
      "unknown"
    );
    expect(classifyAlertKind(row({ kind: undefined }))).toBe("unknown");
    expect(classifyAlertKind(row({ kind: "" }))).toBe("unknown");
  });

  it("classifies a resolved row as resolved whatever produced it", () => {
    expect(
      classifyAlertKind(row({ resolved_at: "2026-08-14T22:00:00Z" }))
    ).toBe("resolved");
  });

  it("lets an EXACT alias beat the prefix family it sits inside", () => {
    // Each of these matches a prefix rule that would give it the WRONG
    // family, so the alias-first order in `classifyAlertKind` is load-bearing
    // rather than incidental. The mapping tables above and below would catch a
    // reversal too — but as four scattered mapping failures. This one names
    // the cause, so the next reader is not left inferring it from a diff.
    expect(classifyAlertKind(row({ kind: "git_no_sync_target" }))).toBe(
      "replication" // not `git-invariant` via `git_`
    );
    expect(classifyAlertKind(row({ kind: "merge_land_replication_failed" }))).toBe(
      "replication" // not `merge-stuck` via `merge_`
    );
    expect(classifyAlertKind(row({ kind: "gate_unclearable_terminal" }))).toBe(
      "gate-stuck" // not `gate-pending` via `gate_`
    );
    expect(classifyAlertKind(row({ kind: "worktree_disk_danger" }))).toBe(
      "disk-danger" // not `worktree-waste` via `worktree_`
    );
  });
});

/**
 * The live coord vocabulary, measured 2026-08-24 against production the day
 * qontinui-web#986 landed: `GET /coord/alerts?limit=1` reported
 * `total_count: 13830` and served a 43-entry `kinds` list, and each row below
 * carries that kind's own `total_count` from a `?kind=<k>&limit=1` probe.
 *
 * **This test exists because the table it guards had ALREADY rotted when it
 * was written.** Under the vocabulary #986 shipped nine days earlier, 18 of
 * these 43 kinds — 9,520 of the 13,830 unresolved rows, 68.8% — classified
 * `unknown` and rendered as "Needs a look" with no attention floor. The page's
 * `KINDS` filter list had the same disease and was cured by having coord serve
 * it; this table cannot be, because coord's registry
 * (`crates/coord/src/alert_kind.rs`, 126 wire strings) is not exposed over
 * HTTP. A dated pin is the substitute: when coord adds a family, THIS fails.
 *
 * Deliberately a snapshot with a date on it, not a claim about the present.
 * A kind retiring from production does not make its row wrong — the mapping
 * still has to be right — so nothing here asserts the list is still complete.
 * What it does assert is that every kind this fleet was measurably serving
 * gets a real family, and it names the row counts so the next reader can
 * judge whether the sample is still worth anything.
 */
describe("live coord vocabulary (measured 2026-08-24)", () => {
  const LIVE: Array<[string, AlertKind, number]> = [
    ["expectation_stall_candidate", "session-health", 4722],
    ["gate_continuation_pending", "gate-pending", 1937],
    ["coord_lost_land", "land-integrity", 1134],
    ["git_inv-2", "git-invariant", 1112],
    ["pr_merge_stuck", "merge-stuck", 900],
    ["land_verification_stalled", "land-integrity", 830],
    ["stale_primary_tree", "stale-tree", 647],
    ["pr_merge_unlandable_escalated", "merge-stuck", 622],
    ["gate_unclearable_terminal", "gate-stuck", 366],
    ["merge_verification_lag", "merge-stuck", 282],
    ["pr_merge_awaiting_ci_requeue_terminal_fail", "merge-stuck", 271],
    ["stale_wip", "stale-wip", 235],
    ["pr_stuck_unattributable", "merge-stuck", 215],
    ["gate_stale_open", "gate-pending", 205],
    ["mirror_ref_rejected_persistently", "replication", 90],
    ["worktree_unjunctioned", "worktree-waste", 62],
    ["repo_pull_hold", "stale-tree", 44],
    ["pr_merge_proposal_requeue_terminal_fail", "merge-stuck", 33],
    ["pr_merge_train_stalled", "merge-stuck", 29],
    ["pr_merge_unlandable_capped", "merge-stuck", 26],
    ["pr_merge_escalate_blocked", "merge-stuck", 12],
    ["pr_merge_conflicting_unproposed", "merge-stuck", 12],
    ["session_message_delivery_blocked", "session-health", 6],
    ["worktree_disk_danger", "disk-danger", 4],
    ["pr_merge_land_conflict_wedged", "merge-stuck", 4],
    ["merge_stacked_parent_abandoned", "merge-stuck", 4],
    ["branch_protection_required_contexts", "config-drift", 4],
    ["route_serving_drift", "serving-drift", 3],
    ["memory_embedding_gap", "backfill-gap", 3],
    ["pr_merge_zero_dispatch", "merge-stuck", 2],
    ["worktree_repair_husks", "worktree-waste", 1],
    ["pr_reconciler_drift", "merge-stuck", 1],
    ["pr_merge_ready_unmerged_age", "merge-stuck", 1],
    ["pr_merge_inflight_slow", "merge-stuck", 1],
    ["pr_merge_execution_stall", "merge-stuck", 1],
    ["pr_merge_dispatch_stall", "merge-stuck", 1],
    ["merge_land_replication_failed", "replication", 1],
    ["git_no_sync_target", "replication", 1],
    ["git_inv-1", "git-invariant", 1],
    ["git_conflict_ref_missing", "replication", 1],
    ["coord_bare_stale_seed", "land-integrity", 1],
    ["config_armed_but_inert", "config-drift", 1],
    ["auth_client_aud_active_negation", "auth-config", 1],
  ];

  it("covers the whole sample — the union is 43 kinds / 13,829 rows", () => {
    // Pins the sample itself, so a row silently dropped from the table below
    // cannot quietly shrink what "the live vocabulary" means. 13,829 is the
    // sum of the per-kind probes; the corpus-wide probe read 13,830 in the
    // same minute, and the one-row gap is a watcher resolving mid-sweep —
    // recorded rather than reconciled, because reconciling it would mean
    // asserting the corpus held still, which it demonstrably does not.
    expect(LIVE).toHaveLength(43);
    expect(LIVE.reduce((n, [, , rows]) => n + rows, 0)).toBe(13829);
    expect(new Set(LIVE.map(([raw]) => raw)).size).toBe(43);
  });

  it.each(LIVE)("classifies %s → %s (%i live rows)", (raw, expected) => {
    expect(classifyAlertKind(row({ kind: raw }))).toBe(expected);
  });

  it("leaves NO live kind unclassified", () => {
    const unclassified = LIVE.filter(
      ([raw]) => classifyAlertKind(row({ kind: raw })) === "unknown"
    );
    expect(unclassified.map(([raw]) => raw)).toEqual([]);
  });

  it("gives every live kind a label and an attention that are not the unknown floor", () => {
    for (const [raw, expected] of LIVE) {
      const status = deriveAlertStatus(row({ kind: raw, severity: "warning" }));
      expect(status.kind, raw).toBe(expected);
      // The point of classifying is that the row says something specific.
      expect(status.label, `${raw} label`).not.toBe("Needs a look");
      expect(alertGuidance(status.kind), `${raw} guidance`).not.toContain(
        "does not recognise"
      );
    }
  });
});

describe("unknown-kind degradation", () => {
  it("escalates an unknown CRITICAL row rather than rendering it calm", () => {
    // Absence of a classification is UNKNOWN, not "nothing is wrong" — the
    // same reading as the `silent-empty-is-unknown` rule.
    const s = deriveAlertStatus(
      row({ kind: "brand_new_watcher_2027", severity: "critical" })
    );
    expect(s.kind).toBe("unknown");
    expect(s.attention).toBe("author");
  });

  it("maps severity to attention, and never to none when severity is absent", () => {
    expect(attentionFromSeverity("critical")).toBe("author");
    expect(attentionFromSeverity("warning")).toBe("waiting");
    expect(attentionFromSeverity("info")).toBe("none");
    expect(attentionFromSeverity(undefined)).toBe("waiting");
    expect(attentionFromSeverity("nonsense")).toBe("waiting");
  });

  it("lets severity ESCALATE a known kind, and never de-escalate one", () => {
    // The kind table encodes the kind's own semantics and is the FLOOR.
    // `machine-health` waits because coord re-probes it — true of a warning
    // row. Coord marking it `critical` is evidence the table cannot see, so
    // the row goes red.
    expect(
      deriveAlertStatus(row({ kind: "fleet_partitioned", severity: "warning" }))
        .attention
    ).toBe("waiting");
    expect(
      deriveAlertStatus(row({ kind: "fleet_partitioned", severity: "critical" }))
        .attention
    ).toBe("author");
    expect(
      deriveAlertStatus(
        row({ kind: "worktree_unjunctioned", severity: "critical" })
      ).attention
    ).toBe("author");

    // Never downward: an `info`-severity red main is still a frozen repo.
    expect(
      deriveAlertStatus(row({ kind: "red_main", severity: "info" })).attention
    ).toBe("author");
    expect(
      deriveAlertStatus(row({ kind: "stale_primary_tree", severity: "info" }))
        .attention
    ).toBe("author");
  });

  it("keeps a resolved row calm whatever severity it carried", () => {
    expect(
      deriveAlertStatus(
        row({ severity: "critical", resolved_at: "2026-08-14T22:00:00Z" })
      ).attention
    ).toBe("none");
  });

  it("still gives an unknown row a label, a guidance line and a subject", () => {
    const r = row({ kind: "brand_new_watcher_2027" });
    const s = deriveAlertStatus(r);
    expect(s.label).toBe("Needs a look");
    expect(alertGuidance(s.kind)).toMatch(/does not recognise/);
    expect(alertSubject(r)).toBe("qontinui/qontinui-web · main");
  });
});

// ----------------------------------------------------------------------------
// The plain-language copy itself
// ----------------------------------------------------------------------------

describe("deriveAlertStatus copy", () => {
  it("renders a stale primary tree from its detail fields, not its summary", () => {
    const s = deriveAlertStatus(row());
    expect(s.kind).toBe("stale-tree");
    expect(s.label).toBe("Checkout is stale");
    expect(s.attention).toBe("author");
    expect(s.reason).toBe(
      "298 commits behind main, uncommitted changes, 3 untracked files"
    );
  });

  it("singularises a one-commit / one-file row", () => {
    const s = deriveAlertStatus(
      row({
        detail: {
          repo: "qontinui/qontinui-web",
          default_branch: "main",
          behind_default_count: 1,
          untracked_count: 1,
          tree_clean: true,
        },
      })
    );
    expect(s.reason).toBe("1 commit behind main, 1 untracked file");
  });

  it("renders stale WIP as file count + idle age", () => {
    const s = deriveAlertStatus(
      row({
        kind: "stale_wip",
        detail: { repo: "qontinui/qontinui-web", dirty_file_count: 7, age_hours: 9.4 },
      })
    );
    expect(s.label).toBe("Uncommitted work going stale");
    expect(s.reason).toBe("7 uncommitted files, untouched for 9h");
  });

  it("renders red main as the failing workflows plus the frozen PR count", () => {
    const s = deriveAlertStatus(
      row({
        kind: "red_main",
        alert_key: "red_main:jspinak/qontinui-runner",
        detail: {
          repo: "jspinak/qontinui-runner",
          workflows: ["CI", "security"],
          blocked_pr_count: 3,
        },
      })
    );
    expect(s.kind).toBe("red-main");
    expect(s.attention).toBe("author");
    expect(s.reason).toBe("failing: CI, security · 3 PRs frozen");
  });

  it("falls back to coord's UUID-stripped summary when detail is thin", () => {
    const s = deriveAlertStatus(
      row({ kind: "git_inv-2", detail: {}, summary: `Ξ_Git INV-2 on ${DEVICE}: x` })
    );
    expect(containsUuid(s.reason)).toBe(false);
    expect(s.reason).toContain("INV-2");
  });

  it("de-escalates a resolved row to calm, whatever its original kind", () => {
    const s = deriveAlertStatus(row({ resolved_at: "2026-08-14T22:00:00Z" }));
    expect(s.kind).toBe("resolved");
    expect(s.attention).toBe("none");
    expect(ALERT_BADGE_CLASS[s.kind]).not.toMatch(/bg-red-/);
  });

  it("prefers a PR number over a branch when the payload has one", () => {
    expect(
      alertSubject(
        row({
          kind: "pr_merge_green_unlanded",
          detail: { repo: "qontinui/qontinui-web", pr_number: 761, branch: "feat/x" },
        })
      )
    ).toBe("qontinui/qontinui-web · #761");
  });
});
