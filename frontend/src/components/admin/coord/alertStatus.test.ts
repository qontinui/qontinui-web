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
import {
  ALERT_AUTHOR_GLYPH_KINDS,
  ALERT_BADGE_CLASS,
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
    for (const [kind, attention] of Object.entries(ATTENTION_BY_KIND)) {
      const cls = ALERT_BADGE_CLASS[kind as AlertKind];
      expect(/\bbg-red-/.test(cls), `${kind} red?`).toBe(
        attention === "author"
      );
      expect(/\bbg-amber-/.test(cls), `${kind} amber?`).toBe(
        // `unknown` is amber-by-floor but neutral in the badge: its attention
        // is per-row (severity-derived), so the ACCENT carries the escalation.
        attention === "waiting" && kind !== "unknown"
      );
    }
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

  it("carries the colourblind-safe ✕ on exactly the author kinds", () => {
    const authorKinds = (
      Object.keys(ATTENTION_BY_KIND) as AlertKind[]
    ).filter((k) => ATTENTION_BY_KIND[k] === "author");
    for (const kind of authorKinds) {
      expect(ALERT_AUTHOR_GLYPH_KINDS.has(kind), `${kind} red, no ✕`).toBe(
        true
      );
    }
    expect(ALERT_AUTHOR_GLYPH_KINDS.size).toBe(authorKinds.length);
  });
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
