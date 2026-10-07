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
  navEntryVisibleTo,
  type NavGroup,
  type NavViewer,
} from "./coordNavModel";
import { isActiveTenantCoordAdmin, isCoordAdminUser } from "@/lib/coord-admin";

function group(id: string): NavGroup {
  const found = GROUPS.find((g) => g.id === id);
  if (!found) throw new Error(`no group ${id}`);
  return found;
}

const labels = (id: string) => group(id).items.map((i) => i.label);
const MEMBER: NavViewer = { isSuperuser: false, isCoordAdmin: false };
const COORD_ADMIN: NavViewer = { isSuperuser: false, isCoordAdmin: true };
// `isCoordAdminUser` counts a superuser as a coord admin, so a real
// superuser viewer carries both.
const SUPERUSER: NavViewer = { isSuperuser: true, isCoordAdmin: true };

const visibleLabels = (id: string, viewer: NavViewer) =>
  group(id)
    .items.filter((i) => navEntryVisibleTo(i, viewer))
    .map((i) => i.label);
const memberLabels = (id: string) => visibleLabels(id, MEMBER);

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
      "Plan Library Settings",
      "Artifact Library",
      "Plan Candidates",
      "Plan Forks",
      "Plan Follow-ups",
      "Questions",
      "Findings",
      "Agents",
      "Unfinished Sessions",
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

  it("gives a member exactly Overview and CI under Dev Ops", () => {
    expect(memberLabels("devops")).toEqual(["Overview", "CI"]);
    expect(labels("devops")).toEqual([
      "Overview",
      "CI",
      "Computers",
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

  it("gates Computers on coord tenant admin — the same gate as its proxies", () => {
    const computers = group("devops").items.find(
      (i) => i.label === "Computers"
    );
    expect(computers?.coordAdminOnly).toBe(true);
    expect(computers?.operatorOnly).toBeUndefined();
    // Plain member: exactly Overview and CI (resolved Q3, extended by the
    // CI dashboard plan's D1 — both are member reads).
    expect(visibleLabels("devops", MEMBER)).toEqual(["Overview", "CI"]);
    // A coord admin who is NOT staff sees Computers and nothing operator-only.
    expect(visibleLabels("devops", COORD_ADMIN)).toEqual([
      "Overview",
      "CI",
      "Computers",
    ]);
    // A superuser sees every Dev Ops member.
    expect(visibleLabels("devops", SUPERUSER)).toEqual(labels("devops"));
  });

  it("asks admin IN THE ACTIVE TENANT, as require_coord_tenant_admin does", () => {
    const tenants = [
      { id: "t-a", roles: ["admin"] },
      { id: "t-b", roles: ["developer"] },
      { id: "t-old" }, // a backend predating per-tenant roles
    ];
    const unionAdmin = { coord_is_admin: true, is_superuser: false };
    // Admin of A, A active: yes.
    expect(
      isActiveTenantCoordAdmin({
        user: unionAdmin,
        tenants,
        activeTenantId: "t-a",
      })
    ).toBe(true);
    // Admin of A, B active: the union says yes, the gate says no — follow the gate.
    expect(
      isActiveTenantCoordAdmin({
        user: unionAdmin,
        tenants,
        activeTenantId: "t-b",
      })
    ).toBe(false);
    // Roles absent for the active tenant: fall back to the union.
    expect(
      isActiveTenantCoordAdmin({
        user: unionAdmin,
        tenants,
        activeTenantId: "t-old",
      })
    ).toBe(true);
    expect(
      isActiveTenantCoordAdmin({
        user: { coord_is_admin: false, is_superuser: false },
        tenants,
        activeTenantId: "t-old",
      })
    ).toBe(false);
    // A superuser passes whatever the tenant roles say.
    expect(
      isActiveTenantCoordAdmin({
        user: { coord_is_admin: false, is_superuser: true },
        tenants,
        activeTenantId: "t-b",
      })
    ).toBe(true);
  });

  it("keeps the union predicate for what it is", () => {
    expect(
      isCoordAdminUser({ coord_is_admin: true, is_superuser: false })
    ).toBe(true);
    expect(
      isCoordAdminUser({ coord_is_admin: false, is_superuser: true })
    ).toBe(true);
    expect(
      isCoordAdminUser({ coord_is_admin: null, is_superuser: false })
    ).toBe(false);
    expect(isCoordAdminUser(null)).toBe(false);
    // No viewer (auth loading) sees neither restricted class.
    expect(navEntryVisibleTo({ coordAdminOnly: true }, null)).toBe(false);
    expect(navEntryVisibleTo({ operatorOnly: true }, null)).toBe(false);
    expect(navEntryVisibleTo({}, null)).toBe(true);
  });

  it("keeps Access to the console's own pages", () => {
    // Claims and Sessions were cross-links out of the console; they are
    // sidebar items in the Sessions section now.
    expect(group("access").items.map((i) => i.href)).toEqual([
      "/admin/coord/members",
      "/admin/coord/agent-registry",
      "/admin/coord/tenant-policy",
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
