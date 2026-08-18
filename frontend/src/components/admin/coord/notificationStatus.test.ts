/**
 * Pure tests for the notification row derivations.
 *
 * The contract that matters most here is Acceptance 3 of plan
 * `2026-08-05-coord-notifications-type-and-tab.md`: the default view renders
 * NO UUID, and a reviewer can scan the list and say what happened without
 * expanding anything. Every default-view string goes through `scrubUuids`, so
 * it is testable without rendering.
 *
 * Its converse is tested just as hard, because it was got wrong once: a UUID
 * IS allowed in the expanded panel, and `detailActor` must not strip it.
 */

import { describe, expect, it } from "vitest";
import {
  type CoordNotificationRow,
  MARK_ALL,
  containsUuid,
  detailActor,
  humanKind,
  isContractError,
  isMigrationPending,
  isUnread,
  kindOptions,
  mergeKindVocabulary,
  notificationHeadline,
  notificationSubject,
  scrubUuids,
  selectionIds,
} from "./notificationStatus";

const UUID = "c79a07d5-7e40-49b4-87fa-554c749f9644";
const UUID_RE_ANY =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function row(over: Partial<CoordNotificationRow> = {}): CoordNotificationRow {
  return {
    notification_id: UUID,
    kind: "policy_change",
    summary: "Policy `escalation-bar` was edited by Joshua",
    occurred_at: "2026-08-14T10:00:00Z",
    ...over,
  };
}

describe("containsUuid", () => {
  it("detects a UUID anywhere in the string", () => {
    expect(containsUuid(UUID)).toBe(true);
    expect(containsUuid(`operator:${UUID}`)).toBe(true);
    expect(containsUuid(`stale-tree:${UUID}:qontinui-runner-wt-mtobs`)).toBe(
      true
    );
  });

  it("passes ordinary prose and nullish input", () => {
    expect(containsUuid("PR #742 landed in qontinui-web")).toBe(false);
    expect(containsUuid(null)).toBe(false);
    expect(containsUuid(undefined)).toBe(false);
  });

  it("is stateless across repeated calls (no /g lastIndex carry-over)", () => {
    // A global regex reused with .test() alternates true/false on the same
    // input. This predicate must not.
    for (let i = 0; i < 4; i++) expect(containsUuid(UUID)).toBe(true);
  });
});

describe("scrubUuids", () => {
  it("elides every UUID while keeping the sentence", () => {
    expect(scrubUuids(`stale-tree:${UUID}:qontinui-runner-wt-mtobs`)).toBe(
      "stale-tree:…:qontinui-runner-wt-mtobs"
    );
  });

  it("elides more than one, and is stable when reused", () => {
    const two = `${UUID} then ${UUID}`;
    expect(scrubUuids(two)).toBe("… then …");
    expect(scrubUuids(two)).toBe("… then …");
  });

  it("leaves UUID-free text untouched", () => {
    expect(scrubUuids("PR #742 landed")).toBe("PR #742 landed");
  });
});

describe("humanKind", () => {
  it("turns a machine kind into a scannable label", () => {
    expect(humanKind("policy_change")).toBe("Policy change");
    expect(humanKind("pr_merge_landed")).toBe("Pr merge landed");
    expect(humanKind("stale-wip")).toBe("Stale wip");
  });

  it("falls back rather than rendering an empty badge", () => {
    expect(humanKind("")).toBe("Event");
    expect(humanKind(undefined)).toBe("Event");
    // A kind that is nothing BUT a UUID scrubs down to the elision, which is
    // not a label — fall back rather than render a badge reading "…".
    expect(humanKind(UUID)).toBe("Event");
  });

  it("is a default-view string, so it is scrubbed", () => {
    expect(humanKind(`stale_tree_${UUID}`)).not.toMatch(UUID_RE_ANY);
  });
});

describe("notificationSubject", () => {
  it("identifies by repo and PR number, short-repo form", () => {
    expect(
      notificationSubject({ repo: "qontinui/qontinui-web", pr_number: 742 })
    ).toBe("qontinui-web#742");
    expect(
      notificationSubject({ repo: "qontinui/qontinui-web", pr_number: null })
    ).toBe("qontinui-web");
    expect(notificationSubject({ repo: null, pr_number: 742 })).toBeNull();
  });

  it("is a default-view string, so it is scrubbed", () => {
    // A UUID-bearing repo is a producer bug; without the scrub it would land
    // on the scan line, and again via the headline fallback.
    const subject = notificationSubject({
      repo: `qontinui/worktree-${UUID}`,
      pr_number: null,
    });
    expect(subject).toBe("worktree-…");
    expect(subject).not.toMatch(UUID_RE_ANY);
  });
});

describe("detailActor", () => {
  it("shows a human actor", () => {
    expect(detailActor({ actor: "merge-train-steward" })).toBe(
      "merge-train-steward"
    );
  });

  it("KEEPS coord principal ids — this renders only in expanded detail", () => {
    // Previously this nulled UUID-bearing actors. That protected nothing (the
    // collapsed row never renders it) and deleted the paste target the panel
    // exists to hand over.
    expect(detailActor({ actor: `operator:${UUID}` })).toBe(`operator:${UUID}`);
    expect(detailActor({ actor: `device:${UUID}` })).toBe(`device:${UUID}`);
  });

  it("returns null only for an empty actor", () => {
    expect(detailActor({ actor: "" })).toBeNull();
    expect(detailActor({ actor: "   " })).toBeNull();
    expect(detailActor({ actor: null })).toBeNull();
  });
});

describe("notificationHeadline", () => {
  it("prefers coord's pre-rendered summary", () => {
    expect(notificationHeadline(row())).toBe(
      "Policy `escalation-bar` was edited by Joshua"
    );
  });

  it("scrubs a summary carrying a UUID, keeping the sentence", () => {
    const headline = notificationHeadline(
      row({ summary: `worktree ${UUID} went stale` })
    );
    expect(headline).toBe("worktree … went stale");
    expect(headline).not.toMatch(UUID_RE_ANY);
  });

  it("still says something when a producer sends no summary at all", () => {
    expect(
      notificationHeadline(
        row({ summary: null, repo: "qontinui/qontinui-web", pr_number: 742 })
      )
    ).toBe("Policy change — qontinui-web#742");
    expect(
      notificationHeadline(row({ summary: "  ", repo: null, pr_number: null }))
    ).toBe("Policy change");
  });

  it("cannot emit a UUID from ANY field combination", () => {
    const headline = notificationHeadline(
      row({
        summary: null,
        kind: `stale_${UUID}`,
        repo: `qontinui/wt-${UUID}`,
        pr_number: null,
      })
    );
    expect(headline).not.toMatch(UUID_RE_ANY);
  });
});

describe("isUnread", () => {
  it("is read state, not severity — absent read_at means unread", () => {
    expect(isUnread(row())).toBe(true);
    expect(isUnread(row({ read_at: null }))).toBe(true);
    expect(isUnread(row({ read_at: "2026-08-14T11:00:00Z" }))).toBe(false);
  });
});

describe("mergeKindVocabulary", () => {
  it("accumulates kinds across pages", () => {
    const a = mergeKindVocabulary([], [{ kind: "policy_change" }]);
    expect(a).toEqual(["policy_change"]);
    expect(mergeKindVocabulary(a, [{ kind: "pr_landed" }])).toEqual([
      "policy_change",
      "pr_landed",
    ]);
  });

  it("NEVER shrinks — a filtered page must not erase the vocabulary", () => {
    // The bug this prevents: select kind A, the next page contains only A, and
    // the dropdown collapses to ["A"] so you cannot get to B without detouring
    // via "All kinds".
    const vocab = ["policy_change", "pr_landed"];
    expect(mergeKindVocabulary(vocab, [{ kind: "pr_landed" }])).toEqual(vocab);
  });

  it("returns the SAME reference when nothing is new", () => {
    // So a 10s poll does not re-render the dropdown on every tick.
    const vocab = ["policy_change"];
    expect(mergeKindVocabulary(vocab, [{ kind: "policy_change" }])).toBe(vocab);
    expect(mergeKindVocabulary(vocab, [])).toBe(vocab);
  });

  it("ignores blank kinds", () => {
    expect(mergeKindVocabulary([], [{ kind: "" }, { kind: "  " }])).toEqual([]);
  });
});

describe("kindOptions", () => {
  it("offers the accumulated vocabulary, alphabetised", () => {
    expect(kindOptions(["pr_landed", "policy_change"], "any")).toEqual([
      "policy_change",
      "pr_landed",
    ]);
  });

  it("keeps the selected kind even when the vocabulary lacks it", () => {
    // Filtering to a kind that returns nothing must not make the filter that
    // produced the empty result disappear from its own dropdown.
    expect(kindOptions([], "policy_change")).toEqual(["policy_change"]);
  });
});

describe("mark-read selection", () => {
  it("MARK_ALL is the explicit destructive arm", () => {
    expect(MARK_ALL).toEqual({ all: true });
    expect(selectionIds(MARK_ALL)).toBeNull();
  });

  it("the ids arm uses the snake_case wire name coord accepts", () => {
    // With coord's `deny_unknown_fields`, `notificationIds` is a 400. This
    // assertion is the guard against the natural TypeScript spelling.
    const selection = { notification_ids: ["a", "b"] };
    expect(Object.keys(selection)).toEqual(["notification_ids"]);
    expect(selectionIds(selection)).toEqual(["a", "b"]);
  });

  it("an empty ids array is a no-op selection, not a mark-all", () => {
    expect(selectionIds({ notification_ids: [] })).toEqual([]);
  });
});

describe("isMigrationPending", () => {
  it("recognises coord's pre-migration degrade", () => {
    expect(
      isMigrationPending(
        new Error(
          'GET /api/v1/operations/notifications failed: 503 - {"error":"schema_migration_pending"}'
        )
      )
    ).toBe(true);
    expect(
      isMigrationPending(new Error("GET /x failed: 503 - Service Unavailable"))
    ).toBe(true);
  });

  it("does not swallow a real failure", () => {
    expect(
      isMigrationPending(new Error("GET /notifications failed: 500 - boom"))
    ).toBe(false);
    expect(isMigrationPending(new Error("coord is not reachable"))).toBe(false);
  });

  it("does not match 503 appearing in a body rather than the status", () => {
    // The anchored form is the fix: an unanchored /\b503\b/ swallowed a real
    // 500 whose body happened to contain those digits.
    expect(
      isMigrationPending(
        new Error("GET /x failed: 500 - upstream returned 503 rows")
      )
    ).toBe(false);
    expect(
      isMigrationPending(new Error("GET /x failed: 500 - PR #503 exploded"))
    ).toBe(false);
  });
});

describe("isContractError", () => {
  it("recognises a rejected body", () => {
    expect(
      isContractError(
        new Error(
          "POST /api/v1/operations/notifications/mark-read failed: 400 - " +
            "Send `notification_ids: [...]` or `all: true`."
        )
      )
    ).toBe(true);
    expect(
      isContractError(new Error("POST /x failed: 422 - unknown field"))
    ).toBe(true);
  });

  it("is disjoint from the migration-pending degrade", () => {
    const pending = new Error(
      'GET /x failed: 503 - {"error":"schema_migration_pending"}'
    );
    expect(isContractError(pending)).toBe(false);
    expect(isMigrationPending(pending)).toBe(true);

    const rejected = new Error("POST /x failed: 400 - bad body");
    expect(isMigrationPending(rejected)).toBe(false);
    expect(isContractError(rejected)).toBe(true);
  });

  it("does not claim a 500 or a connection failure", () => {
    expect(isContractError(new Error("POST /x failed: 500 - boom"))).toBe(
      false
    );
    expect(isContractError(new Error("coord is not reachable"))).toBe(false);
  });
});
