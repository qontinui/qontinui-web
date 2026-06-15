import { describe, it, expect } from "vitest";

import {
  canAdminCoord,
  coordRoleAtLeast,
  isCoordMember,
  type CoordIdentity,
} from "./coord-permissions";

/**
 * Anti-drift guard for the coord-console UI gating contract. The web UI must
 * mirror coord's server-side RBAC hierarchy (`operator < agent_supervisor <
 * admin`, `coord/src/rbac.rs`). If these predicates drift, the console either
 * hides controls a caller's coord role can actually drive (over-restrict) or
 * shows controls that would 403 (misleading).
 */

const id = (roles: string[], isAdmin = false): CoordIdentity => ({
  roles,
  isAdmin,
});

describe("coordRoleAtLeast", () => {
  it("honors the operator < agent_supervisor < admin hierarchy", () => {
    expect(coordRoleAtLeast(id(["admin"]), "operator")).toBe(true);
    expect(coordRoleAtLeast(id(["admin"]), "agent_supervisor")).toBe(true);
    expect(coordRoleAtLeast(id(["admin"]), "admin")).toBe(true);

    expect(coordRoleAtLeast(id(["agent_supervisor"]), "operator")).toBe(true);
    expect(coordRoleAtLeast(id(["agent_supervisor"]), "agent_supervisor")).toBe(
      true
    );
    expect(coordRoleAtLeast(id(["agent_supervisor"]), "admin")).toBe(false);

    expect(coordRoleAtLeast(id(["operator"]), "operator")).toBe(true);
    expect(coordRoleAtLeast(id(["operator"]), "agent_supervisor")).toBe(false);
    expect(coordRoleAtLeast(id(["operator"]), "admin")).toBe(false);
  });

  it("matches custom non-hierarchy roles only exactly", () => {
    expect(coordRoleAtLeast(id(["billing"]), "billing")).toBe(true);
    expect(coordRoleAtLeast(id(["billing"]), "operator")).toBe(false);
    expect(coordRoleAtLeast(id(["admin"]), "billing")).toBe(false);
  });

  it("is false for a null / roleless identity", () => {
    expect(coordRoleAtLeast(null, "operator")).toBe(false);
    expect(coordRoleAtLeast(undefined, "operator")).toBe(false);
    expect(coordRoleAtLeast(id([]), "operator")).toBe(false);
  });
});

describe("canAdminCoord", () => {
  it("is true when isAdmin is set", () => {
    expect(canAdminCoord(id([], true))).toBe(true);
    expect(canAdminCoord(id(["operator"], true))).toBe(true);
  });

  it("is true when the role set includes admin", () => {
    expect(canAdminCoord(id(["admin"]))).toBe(true);
  });

  it("is false for non-admin members and for nobody", () => {
    expect(canAdminCoord(id(["agent_supervisor"]))).toBe(false);
    expect(canAdminCoord(id(["operator"]))).toBe(false);
    expect(canAdminCoord(null)).toBe(false);
  });
});

describe("isCoordMember", () => {
  it("is true for any caller with at least one coord role", () => {
    // This is the MEMBER-level gate the console uses for the controls coord
    // gates on tenant membership rather than a role tier: memory upsert/delete
    // (runner federation), agent-question respond ("developers answer their own
    // agents"), and merge onboarding (pair-start/accept/audit). ADMIN-only
    // controls (spawn, plan-transition, memory restore, rollout/kill-switch/
    // settings PATCH) gate on canAdminCoord instead — see coord#598.
    expect(isCoordMember(id(["operator"]))).toBe(true);
    expect(isCoordMember(id(["agent_supervisor"]))).toBe(true);
    expect(isCoordMember(id(["admin"]))).toBe(true);
    expect(isCoordMember(id(["custom-role"]))).toBe(true);
  });

  it("is false for a caller coord can't resolve to a tenant", () => {
    expect(isCoordMember(id([]))).toBe(false);
    expect(isCoordMember(null)).toBe(false);
    expect(isCoordMember(undefined)).toBe(false);
  });
});
