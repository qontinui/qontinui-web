/**
 * coordNavModel — the Coord Console's page structure.
 *
 * Both renderers read this model (the app sidebar and the console header's
 * crumb), so the structural decisions are pinned here once:
 *  - operator gating: operator-only items (Merge Settings, and every `Dev Ops`
 *    member except `Overview`). The GROUP flag and the ITEM flag are
 *    independent: `Dev Ops` stays member-visible carrying exactly one entry
 *    (resolved Q3 of `2026-08-25-coord-console-intent-and-devops-sections`)
 *  - `Intent` holds the prompt-document cluster and `Merge` no longer does,
 *    while `Gate Clearance` stays in `Merge`, because a gate is merge-chain
 *    machinery (Phase 3 / resolved Q2 of the same plan)
 *  - agent tooling (Agent Commands / Agent Skills) sits in `Work` beside
 *    Agents, never in `Merge` (plan `2026-08-20-fleet-served-agent-skills`)
 *  - no two hrefs prefix one another, which is what lets both renderers
 *    match a page's detail routes by prefix without double-highlighting
 */

import { describe, expect, it } from "vitest";
import {
  DIRECT_TABS,
  GROUPS,
  findActiveLeaf,
  type NavGroup,
} from "./coordNavModel";

function group(id: string): NavGroup {
  const found = GROUPS.find((g) => g.id === id);
  if (!found) throw new Error(`no group ${id}`);
  return found;
}

const labels = (id: string) => group(id).items.map((i) => i.label);
const memberLabels = (id: string) =>
  group(id)
    .items.filter((i) => !i.operatorOnly)
    .map((i) => i.label);

describe("coordNavModel", () => {
  it("keeps the four daily destinations as direct tabs", () => {
    expect(DIRECT_TABS.map((t) => [t.label, t.href])).toEqual([
      ["Pipeline", "/admin/coord/pipeline"],
      ["Pull Requests", "/admin/coord/prs"],
      ["Gates", "/admin/coord/gates"],
      ["Notifications", "/admin/coord/notifications"],
    ]);
  });

  it("orders the groups Work · Merge · Intent · Dev Ops · Access", () => {
    expect(GROUPS.map((g) => g.id)).toEqual([
      "work",
      "merge",
      "intent",
      "devops",
      "access",
    ]);
    // None is hidden wholesale: each carries something a member may reach.
    expect(GROUPS.filter((g) => g.operatorOnly)).toEqual([]);
  });

  it("keeps agent tooling in Work beside Agents", () => {
    expect(labels("work")).toEqual([
      "Plans",
      "Work Units",
      "Plan Library",
      "Plan Candidates",
      "Plan Forks",
      "Plan Follow-ups",
      "Questions",
      "Findings",
      "Agents",
      "Agent Commands",
      "Agent Skills",
      "Prompt Log",
      "History",
      "Lands",
    ]);
  });

  it("leaves Merge with the merge chain only, Gate Clearance included", () => {
    expect(labels("merge")).toEqual([
      "Pull Decisions",
      "Automation Rules",
      "Gate Clearance",
      "Merge Settings",
    ]);
    expect(memberLabels("merge")).not.toContain("Merge Settings");
  });

  it("shows the whole Intent group to a plain member", () => {
    expect(memberLabels("intent")).toEqual([
      "Prompt Documents",
      "Policies",
      "Decision Policies",
      "Policy Edit Review",
    ]);
  });

  it("gives a member exactly Overview under Dev Ops", () => {
    expect(memberLabels("devops")).toEqual(["Overview"]);
    expect(labels("devops")).toEqual([
      "Overview",
      "Trees",
      "Spawn",
      "Runner Drain",
      "Test Targets",
      "Migrations",
      "Deploys",
      "Releases",
      "Git Ops",
      "Federation",
      "Memory",
      "Onboarding",
      "Onboarding Status",
    ]);
  });

  it("keeps Access to the console's own pages", () => {
    // Claims and Sessions were cross-links out of the console; they are
    // sidebar items in the Sessions section now.
    expect(group("access").items.map((i) => i.href)).toEqual([
      "/admin/coord/members",
      "/admin/coord/agent-registry",
    ]);
  });

  it("has unique testIds and no href that prefixes another", () => {
    const leaves = [...DIRECT_TABS, ...GROUPS.flatMap((g) => g.items)];
    expect(new Set(leaves.map((l) => l.testId)).size).toBe(leaves.length);
    for (const a of leaves) {
      for (const b of leaves) {
        if (a === b) continue;
        expect(b.href.startsWith(a.href + "/")).toBe(false);
      }
    }
  });

  describe("findActiveLeaf", () => {
    it("finds a direct tab with no group", () => {
      const active = findActiveLeaf("/admin/coord/gates");
      expect(active?.group).toBeNull();
      expect(active?.leaf.label).toBe("Gates");
    });

    it("finds a grouped page and its detail routes", () => {
      expect(findActiveLeaf("/admin/coord/plans/x")?.leaf.label).toBe("Plans");
      expect(findActiveLeaf("/admin/coord/plans/x")?.group?.id).toBe("work");
    });

    it("does not let /admin/coord/agent-registry claim a Work page", () => {
      const active = findActiveLeaf("/admin/coord/agent-registry");
      expect(active?.group?.id).toBe("access");
      expect(active?.leaf.label).toBe("Agent Registry");
    });

    it("returns null off the console's pages", () => {
      expect(findActiveLeaf("/admin/coord")).toBeNull();
      expect(findActiveLeaf("/sessions")).toBeNull();
    });
  });
});
